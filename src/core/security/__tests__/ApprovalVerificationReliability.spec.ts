import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ApprovalOrchestrator } from "../ApprovalOrchestrator"
import { CommandSafetyJudge } from "../CommandSafetyJudge"
import type { UnifiedApprovalRequest, ExtensionState } from "@roo-code/types"
import { VerifierFailureCategory } from "@roo-code/types"

describe("ApprovalVerificationReliability - Verification Reliability & UX Test Matrix", () => {
	let orchestrator: ApprovalOrchestrator
	let mockState: Partial<ExtensionState>

	beforeEach(() => {
		orchestrator = new ApprovalOrchestrator()
		ApprovalOrchestrator.resetVerifierHealth()
		CommandSafetyJudge.globalCallProviderOverride = undefined

		mockState = {
			approvalMode: "auto",
			commandSafetyConfig: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o-mini",
				apiKey: "sk-approval-test-key",
			},
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-3-5-sonnet-20241022",
				apiKey: "sk-worker-test-key",
			},
		}
	})

	afterEach(() => {
		CommandSafetyJudge.globalCallProviderOverride = undefined
		ApprovalOrchestrator.resetVerifierHealth()
	})

	const createRequest = (command: string, id = "req-test"): UnifiedApprovalRequest => ({
		id,
		taskId: "task-test",
		actionType: "execute_command",
		timestamp: Date.now(),
		target: {
			command,
		},
		taskContext: {
			latestUserInstruction: "Execute operations",
			activeGoal: "System management",
			workspacePath: "/test/project",
			isWithinWorkspace: true,
		},
	})

	// Scenario 1: Verifier ALLOW -> normal execution
	it("Scenario 1: Verifier ALLOW returns ALLOW_AUTO with no retries and verifierAvailable", async () => {
		const callMock = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_AUTO",
				risk: "safe",
				reason: "Verified safe to execute",
				taskAligned: true,
			})
		)
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --custom-op"), mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.verifierUnavailable).toBeFalsy()
		expect(result.approvalAttemptCount).toBe(1)
		expect(callMock).toHaveBeenCalledTimes(1)
	})

	// Scenario 2: Verifier rejection (DENY) is a valid decision, not infrastructure failure, no retry
	it("Scenario 2: Verifier DENY is treated as successful rejection, not failure, no retry", async () => {
		const callMock = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "DENY_AND_REPLAN",
				risk: "critical",
				reason: "Destructive modification outside workspace bounds",
				taskAligned: false,
			})
		)
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --format-disk"), mockState)
		expect(result.decision).toBe("DENY_AND_REPLAN")
		expect(result.infrastructureFailure).toBeFalsy()
		expect(result.verifierUnavailable).toBeFalsy()
		expect(result.approvalAttemptCount).toBe(1)
		expect(callMock).toHaveBeenCalledTimes(1)
		expect(result.reason).toContain("Safety verification rejected this action.")
		expect(result.reason).toContain("Destructive modification")
	})

	// Scenario 3: Initial timeout -> retry succeeds -> normal execution
	it("Scenario 3: Initial timeout triggers bounded auto-retry, succeeds on attempt 2", async () => {
		const callMock = vi.fn()
			.mockRejectedValueOnce(new Error("Approval AI evaluation timed out after 15000ms"))
			.mockResolvedValueOnce(
				JSON.stringify({
					decision: "ALLOW_AUTO",
					risk: "safe",
					reason: "Second attempt approved",
					taskAligned: true,
				})
			)
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.approvalAttemptCount).toBe(2)
		expect(callMock).toHaveBeenCalledTimes(2)
		expect(result.infrastructureFailure).toBeFalsy()
	})

	// Scenario 4: Initial 503 -> retry succeeds
	it("Scenario 4: Initial 503 Service Unavailable triggers bounded retry, succeeds on attempt 2", async () => {
		const callMock = vi.fn()
			.mockRejectedValueOnce(new Error("503 Service Unavailable: server overloaded"))
			.mockResolvedValueOnce(
				JSON.stringify({
					decision: "ALLOW_AUTO",
					risk: "safe",
					reason: "Recovered from 503",
					taskAligned: true,
				})
			)
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.approvalAttemptCount).toBe(2)
		expect(callMock).toHaveBeenCalledTimes(2)
	})

	// Scenario 5: Double timeout -> manual fallback with accurate UX message
	it("Scenario 5: Double timeout falls back closed to MANUAL_APPROVAL with 'temporarily unavailable' message", async () => {
		const callMock = vi.fn()
			.mockRejectedValue(new Error("Approval AI evaluation timed out after 9488ms"))
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.infrastructureFailure).toBe(true)
		expect(result.verifierUnavailable).toBe(false)
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.TIMEOUT)
		expect(result.approvalAttemptCount).toBe(2)
		expect(result.reason).toContain("Safety verification temporarily unavailable. Review this action manually.")
		expect(result.reason).toContain("(TIMEOUT: Approval AI evaluation timed out after 9488ms)")
		expect(result.reason).not.toContain("Verification model unavailable")
	})

	// Scenario 6: 503 is classified as PROVIDER_ERROR, NOT MODEL_UNAVAILABLE
	it("Scenario 6: 503 persistent failure is classified as PROVIDER_ERROR, not MODEL_UNAVAILABLE", async () => {
		const callMock = vi.fn()
			.mockRejectedValue(new Error("503 Service Unavailable: Overloaded"))
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.PROVIDER_ERROR)
		expect(result.verifierUnavailable).toBe(false)
		expect(result.reason).toContain("Safety verification temporarily unavailable. Review this action manually.")
		expect(result.reason).toContain("(PROVIDER_ERROR: 503 Service Unavailable: Overloaded)")
		expect(result.reason).not.toContain("Verification model unavailable")
	})

	// Scenario 7: Network error (ECONNRESET) retries and reports NETWORK category
	it("Scenario 7: ECONNRESET retries once and reports NETWORK error without calling model unavailable", async () => {
		const callMock = vi.fn().mockRejectedValue(new Error("read ECONNRESET at TCP.onStreamRead"))
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.NETWORK)
		expect(result.verifierUnavailable).toBe(false)
		expect(result.approvalAttemptCount).toBe(2)
		expect(result.reason).toContain("Safety verification temporarily unavailable. Review this action manually.")
		expect(result.reason).toContain("(NETWORK: read ECONNRESET at TCP.onStreamRead)")
	})

	// Scenario 8: Genuinely unavailable / deleted model (404 model_not_found) -> MODEL_UNAVAILABLE
	it("Scenario 8: 404 model_not_found is classified as MODEL_UNAVAILABLE, verifierUnavailable=true, no retry", async () => {
		const callMock = vi.fn().mockRejectedValue(new Error("404 The model `gpt-4o-mini-deprecated` does not exist"))
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.MODEL_UNAVAILABLE)
		expect(result.verifierUnavailable).toBe(true)
		expect(result.approvalAttemptCount).toBe(1) // No retry on model not found
		expect(result.reason).toContain("Safety verification model is unavailable. Configured model no longer exists or cannot be used.")
		expect(result.reason).toContain("(MODEL_UNAVAILABLE: 404 The model `gpt-4o-mini-deprecated` does not exist)")
	})

	// Scenario 9: Rate limiting (429) -> RATE_LIMIT, no retry, verifierUnavailable=false
	it("Scenario 9: HTTP 429 is classified as RATE_LIMIT, no immediate retry loop, verifierUnavailable=false", async () => {
		const callMock = vi.fn().mockRejectedValue(new Error("429 Too Many Requests: Rate limit reached"))
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.RATE_LIMIT)
		expect(result.verifierUnavailable).toBe(false)
		expect(result.approvalAttemptCount).toBe(1)
		expect(result.reason).toContain("Safety verification is temporarily rate limited. Review this action manually.")
	})

	// Scenario 10: Single transient failure does NOT trip circuit breaker cooldown
	it("Scenario 10: A single failed request (2 timeouts internally) does NOT trip circuit breaker cooldown", async () => {
		const callMock = vi.fn().mockRejectedValue(new Error("Approval AI evaluation timed out after 10000ms"))
		;(orchestrator as any).judge = { callProvider: callMock }

		// Request 1 fails (attempt 1 + attempt 2)
		const result1 = await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-1"), mockState)
		expect(result1.decision).toBe("MANUAL_APPROVAL")
		expect(result1.reason).toContain("Safety verification temporarily unavailable")

		// Circuit breaker must NOT be tripped after just 1 failed verification!
		// If callMock now succeeds, request 2 should be attempted and succeed!
		callMock.mockReset()
		callMock.mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_AUTO",
				risk: "safe",
				reason: "Successful after first request failure",
				taskAligned: true,
			})
		)

		const result2 = await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-2"), mockState)
		expect(result2.decision).toBe("ALLOW_AUTO")
		expect(callMock).toHaveBeenCalledTimes(1)
	})

	// Scenario 11: Consecutive failed requests DO trip circuit breaker cooldown
	it("Scenario 11: Consecutive failed verifications (>= 2 requests) trip cooldown", async () => {
		const callMock = vi.fn().mockRejectedValue(new Error("503 Service Unavailable: overloaded"))
		;(orchestrator as any).judge = { callProvider: callMock }

		// Request 1 fails
		await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-1"), mockState)
		// Request 2 fails
		await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-2"), mockState)

		// Request 3 should now encounter circuit breaker cooldown without making API calls
		callMock.mockClear()
		const result3 = await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-3"), mockState)
		expect(result3.decision).toBe("MANUAL_APPROVAL")
		expect(result3.reason).toContain("Safety verification is in cooldown after repeated failures")
		expect(callMock).toHaveBeenCalledTimes(0)
	})

	// Scenario 12: Cooldown reset on success
	it("Scenario 12: Successful verification resets failure streak", async () => {
		const callMock = vi.fn()
			// Request 1 fails
			.mockRejectedValueOnce(new Error("500 Internal Server Error"))
			.mockRejectedValueOnce(new Error("500 Internal Server Error"))
			// Request 2 succeeds
			.mockResolvedValueOnce(
				JSON.stringify({
					decision: "ALLOW_AUTO",
					risk: "safe",
					reason: "All good",
					taskAligned: true,
				})
			)
			// Request 3 fails once then once more
			.mockRejectedValueOnce(new Error("500 Internal Server Error"))
			.mockRejectedValueOnce(new Error("500 Internal Server Error"))
		;(orchestrator as any).judge = { callProvider: callMock }

		// Request 1 fails (streak = 1)
		await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-1"), mockState)
		// Request 2 succeeds (streak reset to 0)
		const res2 = await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-2"), mockState)
		expect(res2.decision).toBe("ALLOW_AUTO")

		// Request 3 fails (streak = 1, NOT 2, so circuit breaker is not tripped yet)
		const res3 = await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-3"), mockState)
		expect(res3.decision).toBe("MANUAL_APPROVAL")
		expect(res3.reason).toContain("Safety verification temporarily unavailable")
		expect(res3.reason).not.toContain("cooldown")
	})

	// Scenario 13: Deterministic safe commands bypass cooldown completely
	it("Scenario 13: Deterministic safe commands are unaffected by verifier cooldown", async () => {
		// Trip cooldown
		const callMock = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"))
		;(orchestrator as any).judge = { callProvider: callMock }

		await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-1"), mockState)
		await orchestrator.evaluate(createRequest("wsl.exe --bench", "req-2"), mockState)

		// Fast-path safe command must succeed immediately with ALLOW_AUTO
		const safeResult = await orchestrator.evaluate(createRequest("git status", "req-safe"), mockState)
		expect(safeResult.decision).toBe("ALLOW_AUTO")
		expect(safeResult.risk).toBe("safe")
	})

	// Scenario 14: Unique attemptId per attempt with preserved logicalVerificationId
	it("Scenario 14: Passes unique attemptId and preserved logicalVerificationId to each call", async () => {
		const capturedCalls: any[] = []
		;(orchestrator as any).judge = {
			callProviderDetails: vi.fn().mockImplementation(async (params: any) => {
				capturedCalls.push({ ...params })
				if (capturedCalls.length === 1) {
					throw new Error("Approval AI evaluation timed out after 10000ms")
				}
				return {
					text: JSON.stringify({
						decision: "ALLOW_AUTO",
						risk: "safe",
						reason: "Passed on retry",
						taskAligned: true,
					}),
				}
			}),
		}

		await orchestrator.evaluate(createRequest("wsl.exe --bench", "logical-verif-42"), mockState)
		expect(capturedCalls.length).toBe(2)
		expect(capturedCalls[0].logicalVerificationId).toBe("logical-verif-42")
		expect(capturedCalls[0].attemptId).toBe("logical-verif-42-attempt-1")
		expect(capturedCalls[1].logicalVerificationId).toBe("logical-verif-42")
		expect(capturedCalls[1].attemptId).toBe("logical-verif-42-attempt-2")
	})

	// Scenario 15: User cancellation stops retry and does not trip cooldown
	it("Scenario 15: Cancellation aborts attempt without retry and records CANCELLED", async () => {
		const abortController = new AbortController()
		const callMock = vi.fn().mockImplementation(async () => {
			abortController.abort(new Error("User cancelled action"))
			const err = new Error("AbortError: The operation was aborted")
			err.name = "AbortError"
			throw err
		})
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(
			createRequest("wsl.exe --bench", "req-abort"),
			mockState,
			{ signal: abortController.signal }
		)

		expect(callMock).toHaveBeenCalledTimes(1) // No retry after abort
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.CANCELLED)
		expect(result.reason).toContain("cancelled")
	})

	// Scenario 16: Max 2 attempts total across verification
	it("Scenario 16: Never exceeds 2 total attempts across verification", async () => {
		let callCount = 0
		const callMock = vi.fn().mockImplementation(async () => {
			callCount++
			throw new Error("Connection reset by peer")
		})
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(callCount).toBe(2)
		expect(result.approvalAttemptCount).toBe(2)
	})

	// Scenario 17: Rejection (DENY) does not count toward failure streak
	it("Scenario 17: Verifier rejections (DENY) do not count toward failure streak", async () => {
		const callMock = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "DENY_AND_REPLAN",
				risk: "high",
				reason: "Blocked policy violation",
				taskAligned: false,
			})
		)
		;(orchestrator as any).judge = { callProvider: callMock }

		// 3 consecutive rejections
		await orchestrator.evaluate(createRequest("wsl.exe --rm1", "req-1"), mockState)
		await orchestrator.evaluate(createRequest("wsl.exe --rm2", "req-2"), mockState)
		await orchestrator.evaluate(createRequest("wsl.exe --rm3", "req-3"), mockState)

		// 4th request should NOT be in cooldown
		callMock.mockClear()
		callMock.mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_AUTO",
				risk: "safe",
				reason: "Now allowed",
				taskAligned: true,
			})
		)

		const res4 = await orchestrator.evaluate(createRequest("wsl.exe --safe", "req-4"), mockState)
		expect(res4.decision).toBe("ALLOW_AUTO")
		expect(callMock).toHaveBeenCalledTimes(1)
	})

	// Scenario 18: Incident replay: Task 01a0f93b-82fc-772b-be13-28eb0c89af25 timeout
	it("Scenario 18: Real incident replay: task 01a0f93b-82fc-772b-be13-28eb0c89af25 timeout UX", async () => {
		const callMock = vi.fn().mockRejectedValue(new Error("Approval AI evaluation timed out after 9488ms"))
		;(orchestrator as any).judge = { callProvider: callMock }

		const request: UnifiedApprovalRequest = {
			id: "req-incident-01a0f93b",
			taskId: "01a0f93b-82fc-772b-be13-28eb0c89af25",
			actionType: "execute_command",
			timestamp: 1790888825045,
			target: {
				command: "git checkout -- app/settings.env",
			},
			taskContext: {
				latestUserInstruction: "Revert settings changes",
				activeGoal: "Reset config",
				workspacePath: "/test/project",
				isWithinWorkspace: true,
			},
		}

		const result = await orchestrator.evaluate(request, mockState)

		// Must NOT claim model is unavailable
		expect(result.reason).not.toContain("Verification model unavailable")
		// Must clearly state temporary unavailability with accurate TIMEOUT category
		expect(result.reason).toBe(
			"Safety verification temporarily unavailable. Review this action manually. (TIMEOUT: Approval AI evaluation timed out after 9488ms)"
		)
		expect(result.verifierUnavailable).toBe(false)
		expect(result.infrastructureFailure).toBe(true)
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.TIMEOUT)
	})

	// Scenario 19: Incident replay: Task 01a0e446-c298-719d-a00e-24ba77497a95 429 quota/rate limit
	it("Scenario 19: Real incident replay: 429 quota/rate limit correctly reported without calling model unavailable", async () => {
		// Quota exhausted case
		const quotaMock = vi.fn().mockRejectedValue(new Error("429 You exceeded your current quota, please check your plan and billing details."))
		;(orchestrator as any).judge = { callProvider: quotaMock }

		const request1 = createRequest("git checkout -- app/settings.env", "req-incident-quota")
		const result1 = await orchestrator.evaluate(request1, mockState)

		expect(result1.decision).toBe("MANUAL_APPROVAL")
		expect(result1.verifierFailureCategory).toBe(VerifierFailureCategory.FREE_QUOTA_EXHAUSTED)
		expect(result1.verifierUnavailable).toBe(true)
		expect(result1.reason).toContain("Safety verification quota exhausted. Review this action manually.")
		expect(result1.reason).not.toContain("Verification model unavailable")

		// Rate limit (RPM / TPM) case
		ApprovalOrchestrator.resetVerifierHealth()
		const rateMock = vi.fn().mockRejectedValue(new Error("429 Rate limit exceeded: TPM limit reached"))
		;(orchestrator as any).judge = { callProvider: rateMock }

		const request2 = createRequest("git checkout -- app/settings.env", "req-incident-rate")
		const result2 = await orchestrator.evaluate(request2, mockState)

		expect(result2.decision).toBe("MANUAL_APPROVAL")
		expect(result2.verifierFailureCategory).toBe(VerifierFailureCategory.RATE_LIMIT)
		expect(result2.verifierUnavailable).toBe(false)
		expect(result2.reason).toContain("Safety verification is temporarily rate limited. Review this action manually.")
		expect(result2.reason).not.toContain("Verification model unavailable")
	})

	// Scenario 20: 502 / 504 bad gateway / gateway timeout classification
	it("Scenario 20: 502 Bad Gateway and 504 Gateway Timeout are classified as PROVIDER_ERROR", async () => {
		const callMock = vi.fn().mockRejectedValue(new Error("502 Bad Gateway: Upstream service error"))
		;(orchestrator as any).judge = { callProvider: callMock }

		const result = await orchestrator.evaluate(createRequest("wsl.exe --bench"), mockState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.verifierFailureCategory).toBe(VerifierFailureCategory.PROVIDER_ERROR)
		expect(result.verifierUnavailable).toBe(false)
		expect(result.reason).toContain("(PROVIDER_ERROR: 502 Bad Gateway: Upstream service error)")
	})
})
