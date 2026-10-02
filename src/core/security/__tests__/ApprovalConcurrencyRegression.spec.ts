import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ExtensionState, UnifiedApprovalRequest } from "@roo-code/types"
import { ApprovalOrchestrator } from "../ApprovalOrchestrator"
import { CommandSafetyJudge } from "../CommandSafetyJudge"
import { DecisionLogStore } from "../DecisionLogStore"
import { ProviderRequestCoordinator } from "../../../api/coordination/ProviderRequestCoordinator"

const allowed = JSON.stringify({
	decision: "ALLOW_AUTO",
	risk: "safe",
	reason: "Approved",
	taskAligned: true,
})

function state(apiKey = "sanitized-real-settings-key"): Partial<ExtensionState> {
	return {
		approvalMode: "auto",
		commandSafetyConfig: {
			enabled: true,
			provider: "xkiro",
			modelId: "qwen/qwen3.8-omni-flash:free",
			apiKey,
		},
		apiConfiguration: {
			apiProvider: "xkiro",
			xkiroModelId: "qwen/qwen3.8-max:free",
			reasoningEffort: "high",
		} as ExtensionState["apiConfiguration"],
	}
}

function request(taskId: string, id = `req_${taskId}_1`): UnifiedApprovalRequest {
	return {
		id,
		taskId,
		actionType: "execute_command",
		timestamp: Date.now(),
		target: { command: "python build_assets.py" },
		taskContext: {
			latestUserInstruction: `Build assets for ${taskId}`,
			activeGoal: `Finish ${taskId}`,
			workspacePath: "C:/workspace",
			isWithinWorkspace: true,
		},
	}
}

describe("approval requests with the user's sanitized xKiro configuration", () => {
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

	it("shares one active verification for the same task and action", async () => {
		let complete!: (value: string) => void
		const call = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					complete = resolve
				}),
		)
		CommandSafetyJudge.globalCallProviderOverride = call
		const orchestrator = new ApprovalOrchestrator()
		const action = request("chat-a")
		const first = orchestrator.evaluate(action, state())
		const second = orchestrator.evaluate(action, state())
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1))
		complete(allowed)
		const [a, b] = await Promise.all([first, second])
		expect(a.decision).toBe("ALLOW_AUTO")
		expect(b.decision).toBe("ALLOW_AUTO")
		expect(call).toHaveBeenCalledTimes(1)
	})

	it("does not auto-approve a cancelled follower of a shared verification", async () => {
		let complete!: (value: string) => void
		const call = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					complete = resolve
				}),
		)
		CommandSafetyJudge.globalCallProviderOverride = call
		const orchestrator = new ApprovalOrchestrator()
		const action = request("chat-a")
		const first = orchestrator.evaluate(action, state())
		await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1))
		const followerAbort = new AbortController()
		const second = orchestrator.evaluate(action, state(), { signal: followerAbort.signal })
		followerAbort.abort()
		const follower = await second
		complete(allowed)
		const leader = await first
		expect(follower.decision).toBe("MANUAL_APPROVAL")
		expect(leader.decision).toBe("ALLOW_AUTO")
		expect(call).toHaveBeenCalledTimes(1)
	})

	it("runs two chats independently with distinct IDs and isolated prompts", async () => {
		const calls: Array<{ attemptId?: string; logicalVerificationId?: string; userPrompt: string }> = []
		CommandSafetyJudge.globalCallProviderOverride = vi.fn(async (params: any) => {
			calls.push(params)
			return allowed
		})
		const [a, b] = await Promise.all([
			new ApprovalOrchestrator().evaluate(request("chat-a"), state()),
			new ApprovalOrchestrator().evaluate(request("chat-b"), state()),
		])
		expect([a.decision, b.decision]).toEqual(["ALLOW_AUTO", "ALLOW_AUTO"])
		expect(calls).toHaveLength(2)
		expect(new Set(calls.map((c) => c.attemptId)).size).toBe(2)
		expect(calls[0].userPrompt).toContain("chat-a")
		expect(calls[0].userPrompt).not.toContain("chat-b")
		expect(calls[1].userPrompt).toContain("chat-b")
		expect(calls[1].userPrompt).not.toContain("chat-a")
	})

	it("assigns unique IDs to direct concurrent verifier calls", async () => {
		const ids: string[] = []
		CommandSafetyJudge.globalCallProviderOverride = vi.fn(async (params: any) => {
			ids.push(params.attemptId)
			return allowed
		})
		const orchestrator = new ApprovalOrchestrator()
		await Promise.all([
			orchestrator.executeWithFallback({ systemPrompt: "Safety", userPrompt: "A", state: state() }),
			orchestrator.executeWithFallback({ systemPrompt: "Safety", userPrompt: "B", state: state() }),
		])
		expect(new Set(ids).size).toBe(2)
	})

	it("starts two verifier chats while two worker streams hold their own slots", async () => {
		const coordinator = ProviderRequestCoordinator.getInstance()
		const workerKey = coordinator.deriveProviderKey("xkiro", "sanitized-real-settings-key")
		const workerA = await coordinator.acquireTicket({ providerKey: workerKey, taskId: "chat-a" })
		const workerB = await coordinator.acquireTicket({ providerKey: workerKey, taskId: "chat-b" })
		const call = vi.fn().mockResolvedValue(allowed)
		CommandSafetyJudge.globalCallProviderOverride = call
		try {
			const [a, b] = await Promise.all([
				new ApprovalOrchestrator().evaluate(request("chat-a"), state()),
				new ApprovalOrchestrator().evaluate(request("chat-b"), state()),
			])
			expect([a.decision, b.decision]).toEqual(["ALLOW_AUTO", "ALLOW_AUTO"])
			expect(call).toHaveBeenCalledTimes(2)
			expect(coordinator.getStats(workerKey).activeCount).toBe(2)
		} finally {
			workerA.release()
			workerB.release()
		}
		expect(coordinator.getStats(workerKey).activeCount).toBe(0)
	})

	it("accepts an eight-second verifier response with the real 25-second budget", async () => {
		vi.useFakeTimers()
		const call = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve(allowed), 8000)))
		CommandSafetyJudge.globalCallProviderOverride = call
		const evaluation = new ApprovalOrchestrator().evaluate(request("chat-a"), state())
		await vi.advanceTimersByTimeAsync(8000)
		const result = await evaluation
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.approvalAttemptCount).toBe(1)
	})

	it("gives a retry useful time after an unresponsive first attempt", async () => {
		vi.useFakeTimers()
		const call = vi
			.fn()
			.mockImplementationOnce(() => new Promise<string>(() => {}))
			.mockImplementationOnce(() => new Promise<string>((resolve) => setTimeout(() => resolve(allowed), 1000)))
		CommandSafetyJudge.globalCallProviderOverride = call
		const evaluation = new ApprovalOrchestrator().evaluate(request("chat-a"), state())
		await vi.advanceTimersByTimeAsync(15_000)
		const result = await evaluation
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.approvalAttemptCount).toBe(2)
		expect(call).toHaveBeenCalledTimes(2)
	})

	it("measures elapsed request time when the provider call fails", async () => {
		CommandSafetyJudge.globalCallProviderOverride = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20))
			throw Object.assign(new Error("Unavailable"), { status: 503 })
		})
		const result = await new ApprovalOrchestrator().evaluate(request("chat-a"), state())
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.requestMs).toBeGreaterThan(0)
		expect(result.totalMs).toBeGreaterThanOrEqual(result.requestMs!)
		const persisted = DecisionLogStore.getInstance().getEntries("chat-a").at(-1)
		expect(persisted?.attemptTimeline).toHaveLength(2)
		expect(persisted?.attemptTimeline?.[0].requestMs).toBeGreaterThan(0)
		expect(persisted?.approvalPromptBytes).toBeGreaterThan(0)
	})

	it("retries a 429 only when Retry-After fits the approval budget", async () => {
		const error = Object.assign(new Error("Rate limited"), {
			status: 429,
			headers: new Headers({ "retry-after": "1" }),
		})
		const call = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(allowed)
		CommandSafetyJudge.globalCallProviderOverride = call
		const result = await new ApprovalOrchestrator().evaluate(request("chat-a"), state())
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(call).toHaveBeenCalledTimes(2)
	})

	it("returns manual review promptly for a long Retry-After", async () => {
		const error = Object.assign(new Error("Rate limited"), {
			status: 429,
			headers: new Headers({ "retry-after": "60" }),
		})
		const call = vi.fn().mockRejectedValue(error)
		CommandSafetyJudge.globalCallProviderOverride = call
		const result = await new ApprovalOrchestrator().evaluate(request("chat-a"), state())
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(call).toHaveBeenCalledTimes(1)
	})

	it("does not apply a key-specific cooldown to another xKiro account", async () => {
		const call = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }))
			.mockResolvedValueOnce(allowed)
		CommandSafetyJudge.globalCallProviderOverride = call
		const a = await new ApprovalOrchestrator().evaluate(request("chat-a"), state("account-a-key"))
		const b = await new ApprovalOrchestrator().evaluate(request("chat-b"), state("account-b-key"))
		expect(a.decision).toBe("MANUAL_APPROVAL")
		expect(b.decision).toBe("ALLOW_AUTO")
		expect(call).toHaveBeenCalledTimes(2)
	})

	it("never auto-approves a response missing its safety reason", async () => {
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_AUTO",
				risk: "safe",
				taskAligned: true,
			}),
		)
		const result = await new ApprovalOrchestrator().evaluate(request("chat-a"), state())
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.infrastructureFailure).toBe(true)
	})

	it("cancels one stalled verifier promptly without cancelling another chat", async () => {
		const abortA = new AbortController()
		let startA!: () => void
		const startedA = new Promise<void>((resolve) => {
			startA = resolve
		})
		CommandSafetyJudge.globalCallProviderOverride = vi.fn((params: any) => {
			if (params.logicalVerificationId === "req_chat-a_1") {
				startA()
				return new Promise<string>(() => {})
			}
			return Promise.resolve(allowed)
		})
		const a = new ApprovalOrchestrator().evaluate(request("chat-a"), state(), { signal: abortA.signal })
		await startedA
		const b = new ApprovalOrchestrator().evaluate(request("chat-b"), state())
		abortA.abort()
		const resultA = await Promise.race([
			a,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Cancellation was not prompt")), 250)),
		])
		const resultB = await b
		expect(resultA.decision).toBe("MANUAL_APPROVAL")
		expect(resultB.decision).toBe("ALLOW_AUTO")
	})
})
