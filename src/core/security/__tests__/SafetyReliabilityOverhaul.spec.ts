import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ApprovalOrchestrator } from "../ApprovalOrchestrator"
import { ProviderRequestCoordinator } from "../../../api/coordination/ProviderRequestCoordinator"
import { CommandSafetyJudge } from "../CommandSafetyJudge"
import { DecisionLogStore } from "../DecisionLogStore"
import { buildAutonomousApprovalPrompt } from "../safetyPromptTemplate"
import { VerifierFailureCategory } from "@roo-code/types"
import type { UnifiedApprovalRequest, ExtensionState } from "@roo-code/types"

describe("AI Command Safety Guardrail - Reliability & Forensic Regression Suite", () => {
	let orchestrator: ApprovalOrchestrator
	let mockState: Partial<ExtensionState>

	beforeEach(() => {
		mockState = {
			approvalMode: "auto",
			apiConfiguration: {
				apiProvider: "openrouter",
				apiModelId: "anthropic/claude-3.7-sonnet",
				apiKey: "sk-worker-key",
			} as any,
			commandSafetyConfig: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o-mini",
				apiKey: "sk-mock-key",
			},
		}
		orchestrator = new ApprovalOrchestrator({ timeoutMs: 5000 })
		DecisionLogStore.getInstance().clear()
		ApprovalOrchestrator.resetVerifierHealth()
	})

	afterEach(() => {
		ApprovalOrchestrator.resetVerifierHealth()
		vi.useRealTimers()
	})

	describe("1. Exact Incident Replay (timeout 90 2>&1)", () => {
		it("fast-paths Windows timeout utility with stderr redirection (timeout 90 2>&1) with 0ms and 0 tokens", async () => {
			const fastPath = CommandSafetyJudge.evaluateFastPath("timeout 90 2>&1")
			expect(fastPath).not.toBeNull()
			expect(fastPath?.isSafe).toBe(true)
			expect(fastPath?.riskLevel).toBe("safe")

			const request: UnifiedApprovalRequest = {
				id: "req-incident-replay",
				taskId: "01a0f41a-d684-719d-a73e-275f22720d0f",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "timeout 90 2>&1",
				},
				taskContext: {
					latestUserInstruction: "Wait for background tests to complete",
					activeGoal: "Run and monitor test suite",
					workspacePath: "c:/Users/Kamil/Documents/Roo-Code",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.risk).toBe("safe")
			expect(result.auditLog).toContain("fastPath=true")
			expect(result.auditLog).toContain("approvalModelCalled=false")

			// Check decision log entry
			const entries = DecisionLogStore.getInstance().getEntries("01a0f41a-d684-719d-a73e-275f22720d0f")
			expect(entries.length).toBe(1)
			expect(entries[0].fastPath).toBe(true)
			expect(entries[0].evaluatorModel).toBe("deterministic-policy")
		})

		it("fast-paths ripgrep (rg) queries", async () => {
			const fastPath = CommandSafetyJudge.evaluateFastPath("rg 'export interface VerifierHealthState' src/")
			expect(fastPath).not.toBeNull()
			expect(fastPath?.isSafe).toBe(true)
			expect(fastPath?.riskLevel).toBe("safe")
		})
	})

	describe("2. Safe Command Chains (&&, ;, pipes)", () => {
		it("fast-paths composite chains of deterministically safe commands (SAFE && SAFE)", async () => {
			const cmd = "git status && git diff"
			const fastPath = CommandSafetyJudge.evaluateFastPath(cmd)
			expect(fastPath).not.toBeNull()
			expect(fastPath?.isSafe).toBe(true)

			const request: UnifiedApprovalRequest = {
				id: "req-chain-safe",
				taskId: "task-chain-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: { command: cmd },
				taskContext: {
					latestUserInstruction: "Check changes",
					activeGoal: "Inspect repository",
					workspacePath: "/workspace",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.auditLog).toContain("fastPath=true")
		})

		it("fast-paths safe piped inspection commands (cat | grep)", async () => {
			const cmd = "cat logs.txt | grep ERROR"
			const fastPath = CommandSafetyJudge.evaluateFastPath(cmd)
			expect(fastPath).not.toBeNull()
			expect(fastPath?.isSafe).toBe(true)
		})

		it("strictly rejects dangerous commands chained with safe commands (SAFE && DANGEROUS)", async () => {
			const cmd = "git status && rm -rf /"
			const fastPath = CommandSafetyJudge.evaluateFastPath(cmd)
			expect(fastPath).toBeNull() // Disqualified from fast path
		})

		it("strictly rejects command substitution and arbitrary piped execution (cat | bash)", async () => {
			const cmd = "cat script.sh | bash"
			const fastPath = CommandSafetyJudge.evaluateFastPath(cmd)
			expect(fastPath).toBeNull() // Disqualified from fast path
		})
	})

	describe("3. Circuit Breaker & Cooldown Behavior", () => {
		const candidateKey = ProviderRequestCoordinator.getInstance().deriveProviderKey(
			"openai", "sk-mock-key", undefined, "verifier",
		) + ":gpt-4o-mini"
		it("trips circuit breaker after 2 consecutive failures and enters 30s cooldown", async () => {
			expect(ApprovalOrchestrator.getVerifierHealth(candidateKey)).toBeUndefined()

			// Failure 1: transient timeout
			const f1 = ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)
			expect(f1.consecutiveFailures).toBe(1)
			expect(f1.cooldownUntil).toBe(0) // Not yet in cooldown

			// Failure 2: transient timeout
			const f2 = ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)
			expect(f2.consecutiveFailures).toBe(2)
			expect(f2.cooldownUntil).toBeGreaterThan(Date.now()) // Now in cooldown!
		})

		it("immediately permits deterministic safe actions during verifier cooldown (ALLOW_AUTO)", async () => {
			// Trip circuit breaker
			ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)
			ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)

			// Fast-path safe action
			const request: UnifiedApprovalRequest = {
				id: "req-safe-cooldown",
				taskId: "task-cooldown-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: { command: "git status" },
				taskContext: {
					latestUserInstruction: "Check git status",
					activeGoal: "Git check",
					workspacePath: "/workspace",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
		})

		it("immediately fails closed ambiguous actions during cooldown without waiting 30s (0ms delay)", async () => {
			// Trip circuit breaker
			ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)
			ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)

			// Ambiguous action (not in fast path, not dangerous)
			const request: UnifiedApprovalRequest = {
				id: "req-ambiguous-cooldown",
				taskId: "task-cooldown-2",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: { command: "python migrate.py --phase=2" },
				taskContext: {
					latestUserInstruction: "Run phase 2 migration",
					activeGoal: "Database migration",
					workspacePath: "/workspace",
					isWithinWorkspace: true,
				},
			}

			const start = Date.now()
			const result = await orchestrator.evaluate(request, mockState)
			const duration = Date.now() - start

			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.reason).toContain("cooldown")
			expect(result.auditLog).toContain("inCooldown=true")
			// Must be immediate (< 500ms), NEVER stalling 30 seconds!
			expect(duration).toBeLessThan(500)
		})

		it("never allows dangerous actions during cooldown (NEVER fail-open)", async () => {
			// Trip circuit breaker
			ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)
			ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)

			// Dangerous action
			const request: UnifiedApprovalRequest = {
				id: "req-dangerous-cooldown",
				taskId: "task-cooldown-3",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: { command: "rm -rf / --no-preserve-root" },
				taskContext: {
					latestUserInstruction: "Delete root",
					activeGoal: "System destruction",
					workspacePath: "/workspace",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.decision).not.toBe("ALLOW_AUTO")
		})

		it("automatically resets health on successful verification", async () => {
			ApprovalOrchestrator.recordVerifierFailure(candidateKey, VerifierFailureCategory.TIMEOUT)
			expect(ApprovalOrchestrator.getVerifierHealth(candidateKey)?.consecutiveFailures).toBe(1)

			ApprovalOrchestrator.recordVerifierSuccess(candidateKey)
			expect(ApprovalOrchestrator.getVerifierHealth(candidateKey)).toBeUndefined()
		})
	})

	describe("4. Telemetry Metrics Separation (queueWaitMs vs requestMs vs totalMs)", () => {
		it("measures and logs separated queueWaitMs and requestMs in successful evaluation", async () => {
			;(orchestrator as any).judge = {
				callProvider: vi.fn().mockImplementation(async () => {
					// Simulate generation time
					await new Promise((r) => setTimeout(r, 50))
					return JSON.stringify({
						decision: "ALLOW_AUTO",
						risk: "low",
						reason: "Verified safe",
						taskAligned: true,
					})
				}),
			}

			const request: UnifiedApprovalRequest = {
				id: "req-telemetry-1",
				taskId: "task-telemetry",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: { command: "python test_helper.py" },
				taskContext: {
					latestUserInstruction: "Run helper",
					activeGoal: "Testing",
					workspacePath: "/workspace",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.queueWaitMs).toBeDefined()
			expect(result.requestMs).toBeDefined()
			expect(result.totalMs).toBeDefined()
			expect(result.totalMs).toBeGreaterThanOrEqual(result.requestMs!)
			expect(result.auditLog).toContain("queueWaitMs=")
			expect(result.auditLog).toContain("requestMs=")
			expect(result.auditLog).toContain("totalMs=")

			const entries = DecisionLogStore.getInstance().getEntries("task-telemetry")
			expect(entries[0].latencyMs).toBe(result.totalMs)
		})
	})

	describe("5. Approval Prompt Context Deduplication", () => {
		it("avoids redundant duplication of identical instruction strings and omits empty constraints", () => {
			const { userPrompt } = buildAutonomousApprovalPrompt({
				actionType: "execute_command",
				target: { command: "npm test" },
				taskContext: {
					latestUserInstruction: "Run npm test to verify changes",
					latestSubstantiveInstruction: "Run npm test to verify changes", // Identical!
					activeGoal: "Run npm test to verify changes", // Identical!
					workspacePath: "/workspace",
					isWithinWorkspace: true,
					explicitConstraints: [], // Empty!
				},
			})

			// Instruction string should only appear once in userPrompt, not repeated 3-4 times
			const matches = userPrompt.match(/Run npm test to verify changes/g)
			expect(matches?.length).toBe(1)
			// Empty constraints section should be omitted
			expect(userPrompt).not.toContain("Active Constraints:\nNone")
		})
	})
})
