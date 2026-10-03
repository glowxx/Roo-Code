import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VerifierFailureCategory, type ExtensionState, type UnifiedApprovalRequest } from "@roo-code/types"
import {
	calculateDeferredBackoff,
	extractRetryAfterMsFromTimeline,
	DeferredApprovalRecoveryController,
} from "../DeferredApprovalRecovery"
import {
	ApprovalOrchestrator,
	isDeferredRetryableCategory,
	isTransientVerifierError,
} from "../ApprovalOrchestrator"
import { CommandSafetyJudge } from "../CommandSafetyJudge"
import { ProviderRequestCoordinator } from "../../../api/coordination/ProviderRequestCoordinator"

describe("DeferredApprovalRecovery Unit & Integration Tests", () => {
	beforeEach(() => {
		ApprovalOrchestrator.resetVerifierHealth()
		ProviderRequestCoordinator.resetInstance()
		CommandSafetyJudge.globalCallProviderOverride = undefined
	})

	afterEach(() => {
		CommandSafetyJudge.globalCallProviderOverride = undefined
		ApprovalOrchestrator.resetVerifierHealth()
		ProviderRequestCoordinator.resetInstance()
		vi.useRealTimers()
	})

	describe("calculateDeferredBackoff", () => {
		it("calculates exponential backoff with jitter around 15s, 30s, 60s", () => {
			// Attempt 1: base 15s with 20% jitter -> [12s, 18s]
			const a1 = calculateDeferredBackoff(1, undefined, { jitterRatio: 0.2 })
			expect(a1.attempt).toBe(1)
			expect(a1.delayMs).toBeGreaterThanOrEqual(12000)
			expect(a1.delayMs).toBeLessThanOrEqual(18000)

			// Attempt 2: base 30s with 20% jitter -> [24s, 36s]
			const a2 = calculateDeferredBackoff(2, undefined, { jitterRatio: 0.2 })
			expect(a2.attempt).toBe(2)
			expect(a2.delayMs).toBeGreaterThanOrEqual(24000)
			expect(a2.delayMs).toBeLessThanOrEqual(36000)

			// Attempt 3: base 60s clamped to maxDelayMs 60s
			const a3 = calculateDeferredBackoff(3, undefined, { jitterRatio: 0.2 })
			expect(a3.attempt).toBe(3)
			expect(a3.delayMs).toBeGreaterThanOrEqual(48000)
			expect(a3.delayMs).toBeLessThanOrEqual(60000)
		})

		it("gives upstream Retry-After absolute precedence over local backoff", () => {
			// Upstream says 10s Retry-After -> should use 10s regardless of attempt number
			const schedule = calculateDeferredBackoff(1, 10000)
			expect(schedule.delayMs).toBe(10000)

			// Upstream says 25s Retry-After on attempt 2
			const schedule2 = calculateDeferredBackoff(2, 25000)
			expect(schedule2.delayMs).toBe(25000)
		})

		it("clamps Retry-After to safe bounds [5s, 60s]", () => {
			// Too small (e.g. 500ms) clamped to minDelayMs (5000ms)
			const tooSmall = calculateDeferredBackoff(1, 500)
			expect(tooSmall.delayMs).toBe(5000)

			// Too large (e.g. 120s) clamped to maxDelayMs (60000ms)
			const tooLarge = calculateDeferredBackoff(1, 120000)
			expect(tooLarge.delayMs).toBe(60000)
		})
	})

	describe("extractRetryAfterMsFromTimeline", () => {
		it("extracts numeric seconds from timeline attempt", () => {
			const ms = extractRetryAfterMsFromTimeline([
				{
					logicalVerificationId: "log-1",
					attemptId: "att-1",
					provider: "xkiro",
					model: "qwen",
					createdAt: Date.now(),
					queueEnterAt: Date.now(),
					requestStartAt: null,
					transportStartAt: null,
					responseHeadersAt: null,
					requestEndAt: null,
					localWaitEndAt: null,
					attemptEndAt: Date.now(),
					queueWaitMs: 0,
					requestMs: 0,
					backoffMs: 0,
					totalMs: 10,
					httpStatus: 429,
					retryAfter: "14",
					rateLimitHeaders: {},
					category: "RATE_LIMIT",
				},
			])
			expect(ms).toBe(14000)
		})

		it("returns undefined when no retryAfter header is present", () => {
			const ms = extractRetryAfterMsFromTimeline([
				{
					logicalVerificationId: "log-1",
					attemptId: "att-1",
					provider: "xkiro",
					model: "qwen",
					createdAt: Date.now(),
					queueEnterAt: Date.now(),
					requestStartAt: null,
					transportStartAt: null,
					responseHeadersAt: null,
					requestEndAt: null,
					localWaitEndAt: null,
					attemptEndAt: Date.now(),
					queueWaitMs: 0,
					requestMs: 0,
					backoffMs: 0,
					totalMs: 10,
					httpStatus: 504,
					retryAfter: null,
					rateLimitHeaders: {},
					category: "TIMEOUT",
				},
			])
			expect(ms).toBeUndefined()
		})
	})

	describe("DeferredApprovalRecoveryController", () => {
		it("bounds attempts strictly to maxAttempts (3)", () => {
			const controller = new DeferredApprovalRecoveryController({ maxAttempts: 3 })
			const att1 = controller.scheduleAttempt()
			expect(att1).not.toBeNull()
			expect(att1?.schedule.attempt).toBe(1)

			const att2 = controller.scheduleAttempt()
			expect(att2).not.toBeNull()
			expect(att2?.schedule.attempt).toBe(2)

			const att3 = controller.scheduleAttempt()
			expect(att3).not.toBeNull()
			expect(att3?.schedule.attempt).toBe(3)

			// Attempt 4 must return null (bounded, no infinite loop!)
			const att4 = controller.scheduleAttempt()
			expect(att4).toBeNull()
		})

		it("cancels wait promise immediately and aborts signal when user interacts", async () => {
			const controller = new DeferredApprovalRecoveryController({ baseDelayMs: 30000 })
			const scheduled = controller.scheduleAttempt()
			expect(scheduled).not.toBeNull()

			let waitResult: boolean | null = null
			scheduled!.waitPromise.then((res) => {
				waitResult = res
			})

			expect(scheduled!.abortSignal.aborted).toBe(false)
			expect(controller.isCancelled).toBe(false)

			// User clicks Run or Deny -> cancel
			controller.cancel("user_interaction")

			expect(controller.isCancelled).toBe(true)
			expect(scheduled!.abortSignal.aborted).toBe(true)

			// Wait promise resolves immediately with false
			await scheduled!.waitPromise
			expect(waitResult).toBe(false)

			// Subsequent schedule attempts return null
			expect(controller.scheduleAttempt()).toBeNull()
		})

		it("resolves wait promise with true when timer expires naturally", async () => {
			vi.useFakeTimers()
			const controller = new DeferredApprovalRecoveryController({ minDelayMs: 5000, baseDelayMs: 5000, jitterRatio: 0 })
			const scheduled = controller.scheduleAttempt()
			expect(scheduled).not.toBeNull()

			let waitResult: boolean | null = null
			scheduled!.waitPromise.then((res) => {
				waitResult = res
			})

			expect(waitResult).toBeNull()

			// Fast forward timer
			vi.advanceTimersByTime(5000)
			await Promise.resolve()

			expect(waitResult).toBe(true)
			expect(scheduled!.abortSignal.aborted).toBe(false)
		})
	})

	describe("Error classification & retryability", () => {
		it("correctly identifies transient retryable categories", () => {
			expect(isDeferredRetryableCategory(VerifierFailureCategory.TIMEOUT)).toBe(true)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.PROVIDER_ERROR)).toBe(true)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.NETWORK)).toBe(true)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.RATE_LIMIT)).toBe(true)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.OTHER_TRANSIENT)).toBe(true)
		})

		it("correctly identifies non-retryable permanent categories", () => {
			expect(isDeferredRetryableCategory(VerifierFailureCategory.AUTH)).toBe(false)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.FREE_QUOTA_EXHAUSTED)).toBe(false)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.MODEL_UNAVAILABLE)).toBe(false)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.INVALID_MODEL)).toBe(false)
			expect(isDeferredRetryableCategory(VerifierFailureCategory.CANCELLED)).toBe(false)
			expect(isDeferredRetryableCategory(undefined)).toBe(false)
		})
	})

	describe("Multi-task concurrency isolation", () => {
		it("does not hold global semaphore or lock while task is in deferred recovery wait", async () => {
			const coordinator = ProviderRequestCoordinator.getInstance()
			const providerKey = coordinator.deriveProviderKey("xkiro", "test-key", undefined, "verifier")

			// Check concurrency before
			const activeBefore = coordinator.getStats(providerKey).activeCount
			expect(activeBefore).toBe(0)

			// Controller waiting on timer
			const controller = new DeferredApprovalRecoveryController({ baseDelayMs: 15000 })
			const scheduled = controller.scheduleAttempt()
			expect(scheduled).not.toBeNull()

			// Concurrency during timer wait must be 0 (no semaphore slot held during backoff sleep!)
			const activeDuringSleep = coordinator.getStats(providerKey).activeCount
			expect(activeDuringSleep).toBe(0)

			controller.cancel("cleanup")
		})
	})
})
