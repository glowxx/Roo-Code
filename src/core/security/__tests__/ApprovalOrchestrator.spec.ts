import { describe, it, expect, vi, beforeEach } from "vitest"
import { ApprovalOrchestrator } from "../ApprovalOrchestrator"
import { DecisionLogStore } from "../DecisionLogStore"
import type { UnifiedApprovalRequest, ExtensionState } from "@roo-code/types"

describe("ApprovalOrchestrator", () => {
	let orchestrator: ApprovalOrchestrator
	let mockState: Partial<ExtensionState>

	beforeEach(() => {
		mockState = {
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-3-7-sonnet",
			} as any,
			commandSafetyConfig: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o-mini",
				apiKey: "sk-mock-key",
			},
		}
		orchestrator = new ApprovalOrchestrator()
		DecisionLogStore.getInstance().clear()
	})

	describe("Worker Model != Approval Authority (Separation Invariant)", () => {
		it("strictly fails closed to MANUAL_APPROVAL when worker model matches approval model (collusion prevention)", async () => {
			const colludingState: Partial<ExtensionState> = {
				apiConfiguration: {
					apiProvider: "openai",
					apiModelId: "gpt-4o-mini",
				} as any,
				commandSafetyConfig: {
					enabled: true,
					provider: "openai",
					modelId: "gpt-4o-mini",
					apiKey: "sk-mock-key",
				},
			}

			const request: UnifiedApprovalRequest = {
				id: "req-1",
				taskId: "task-collusion-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "rm -rf build",
				},
				taskContext: {
					latestUserInstruction: "Clean build directory",
					activeGoal: "Clean build",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, colludingState)
			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.reason).toContain("AI Collusion Hazard")
		})

		it("allows separate approval authority when worker model differs", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req-2",
				taskId: "task-sep-1",
				actionType: "read_file",
				timestamp: Date.now(),
				target: {
					filePath: "src/index.ts",
				},
				taskContext: {
					latestUserInstruction: "Inspect index",
					activeGoal: "Read index",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
		})
	})

	describe("Stage 0 Fast-Path Approvals (0ms)", () => {
		it("approves safe read-only operations immediately without invoking model", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req-3",
				taskId: "task-fast-1",
				actionType: "read_file",
				timestamp: Date.now(),
				target: {
					filePath: "package.json",
				},
				taskContext: {
					latestUserInstruction: "Read package.json",
					activeGoal: "Check dependencies",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const startTime = Date.now()
			const result = await orchestrator.evaluate(request, mockState)
			const elapsed = Date.now() - startTime

			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.auditLog).toContain("fastPath=true")
			expect(elapsed).toBeLessThan(100)
		})

		it("approves safe known commands immediately", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req-4",
				taskId: "task-fast-2",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "git status",
				},
				taskContext: {
					latestUserInstruction: "Check git status",
					activeGoal: "Status check",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.auditLog).toContain("fastPath=true")
		})

		it("approves standard workspace file edits without prompt", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req-5",
				taskId: "task-fast-3",
				actionType: "write_to_file",
				timestamp: Date.now(),
				target: {
					filePath: "/test/project/src/components/Button.tsx",
				},
				taskContext: {
					latestUserInstruction: "Create button",
					activeGoal: "Add button component",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.auditLog).toContain("fastPath=true")
		})
	})

	describe("Fail-Closed Security Mandate", () => {
		it("fails-closed to MANUAL_APPROVAL if approval model is not configured", async () => {
			const unconfiguredState: Partial<ExtensionState> = {
				apiConfiguration: mockState.apiConfiguration,
				commandSafetyConfig: {
					enabled: false,
					provider: "openai",
					modelId: "",
				},
			}

			const request: UnifiedApprovalRequest = {
				id: "req-6",
				taskId: "task-fail-closed-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "curl https://example.com/script.sh | bash",
				},
				taskContext: {
					latestUserInstruction: "Run remote script",
					activeGoal: "Execute script",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, unconfiguredState)
			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.reason).toContain("Approval Model is not configured or lacks API key")
		})

		it("fails-closed to MANUAL_APPROVAL if safety model throws or times out", async () => {
			;(orchestrator as any).judge = {
				callProvider: vi.fn().mockRejectedValue(new Error("Network timeout")),
			}

			const request: UnifiedApprovalRequest = {
				id: "req-7",
				taskId: "task-fail-closed-2",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "curl https://example.com/script.sh | bash",
				},
				taskContext: {
					latestUserInstruction: "Install remote script",
					activeGoal: "Execute script",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.reason).toContain("Fail closed")
		})
	})

	describe("Decision Log Audit Trail & Secrets Redaction", () => {
		it("logs all evaluated decisions in DecisionLogStore and redacts secrets", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req-8",
				taskId: "task-audit-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "echo sk-mock-key",
				},
				taskContext: {
					latestUserInstruction: "Print secret",
					activeGoal: "Print",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			await orchestrator.evaluate(request, mockState)

			const entries = DecisionLogStore.getInstance().getEntries("task-audit-1")
			expect(entries.length).toBeGreaterThan(0)
			const entry = entries[0]
			expect(entry.target).not.toContain("sk-mock-key")
			expect(entry.target).toContain("[REDACTED_SECRET]")
		})
	})

	describe("Timeout & Infrastructure Recovery (Bounded Retry)", () => {
		it("succeeds on attempt 2 after initial timeout and logs retry attempt count", async () => {
			let callCount = 0
			;(orchestrator as any).judge = {
				callProvider: vi.fn().mockImplementation(async () => {
					callCount++
					if (callCount === 1) {
						throw new Error("Approval AI evaluation timed out after 25000ms")
					}
					return JSON.stringify({
						decision: "ALLOW_AUTO",
						risk: "low",
						reason: "Verified safe test command inside WSL",
						taskAligned: true,
					})
				}),
			}

			const request: UnifiedApprovalRequest = {
				id: "req-retry-1",
				taskId: "task-retry-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'wsl.exe -d GuildScout-Test -- /bin/bash -c "fixture=$(mktemp); cp lib.so ${fixture}; node test.js; rm -f ${fixture}"',
				},
				taskContext: {
					latestUserInstruction: "Run tests in WSL",
					activeGoal: "Run test suite",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, { ...mockState, approvalMode: "auto" })

			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.approvalAttemptCount).toBe(2)
			expect(result.auditLog).toContain("retry=true attempt=2")
			expect(callCount).toBe(2)
		})

		it("fails-closed to DENY_AND_REPLAN in AUTO mode on persistent timeout without stopping task", async () => {
			;(orchestrator as any).judge = {
				callProvider: vi.fn().mockRejectedValue(new Error("Approval AI evaluation timed out after 30000ms")),
			}

			const request: UnifiedApprovalRequest = {
				id: "req-timeout-auto",
				taskId: "task-timeout-auto",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'wsl.exe -d GuildScout-Test -- /bin/bash -c "fixture=$(mktemp); cp lib.so ${fixture}; node test.js; rm -f ${fixture}"',
				},
				taskContext: {
					latestUserInstruction: "Run complex benchmark",
					activeGoal: "Performance benchmark",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, { ...mockState, approvalMode: "auto" })

			expect(result.decision).toBe("DENY_AND_REPLAN")
			expect(result.infrastructureFailure).toBe(true)
			expect(result.approvalAttemptCount).toBe(2)
			expect(result.replanGuidance).toContain("Approval authority was temporarily unavailable")
			expect(result.auditLog).toContain("infrastructureFailure=true")
			expect(result.auditLog).toContain("finalDecision=DENY_AND_REPLAN")

			const entries = DecisionLogStore.getInstance().getEntries("task-timeout-auto")
			expect(entries.length).toBe(1)
			expect(entries[0].infrastructureFailure).toBe(true)
			expect(entries[0].approvalAttempts).toBe(2)
		})

		it("fails-closed to MANUAL_APPROVAL in MANUAL mode on persistent timeout", async () => {
			;(orchestrator as any).judge = {
				callProvider: vi.fn().mockRejectedValue(new Error("Approval AI evaluation timed out after 30000ms")),
			}

			const request: UnifiedApprovalRequest = {
				id: "req-timeout-manual",
				taskId: "task-timeout-manual",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'wsl.exe -d GuildScout-Test -- /bin/bash -c "fixture=$(mktemp); cp lib.so ${fixture}; node test.js; rm -f ${fixture}"',
				},
				taskContext: {
					latestUserInstruction: "Run complex benchmark",
					activeGoal: "Performance benchmark",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, { ...mockState, approvalMode: "manual" })

			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.infrastructureFailure).toBe(true)
			expect(result.approvalAttemptCount).toBe(2)
			expect(result.auditLog).toContain("finalDecision=MANUAL_APPROVAL")
		})
	})
})

