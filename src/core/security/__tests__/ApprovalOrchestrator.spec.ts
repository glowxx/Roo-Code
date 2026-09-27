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

			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.infrastructureFailure).toBe(true)
			expect(result.verifierUnavailable).toBe(true)
			expect(result.approvalAttemptCount).toBe(2)
			expect(result.reason).toContain("Verification model unavailable")
			expect(result.auditLog).toContain("infrastructureFailure=true")
			expect(result.auditLog).toContain("finalDecision=MANUAL_APPROVAL")
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

		it("does not retry on quota exhaustion (402) and falls back immediately to secondary verifier", async () => {
			const callProviderMock = vi.fn()
				// Primary verifier fails with 402 quota exhausted
				.mockRejectedValueOnce(new Error("402 Payment Required: insufficient_quota"))
				// Secondary verifier succeeds
				.mockResolvedValueOnce(
					JSON.stringify({
						decision: "ALLOW_AUTO",
						risk: "safe",
						reason: "Secondary verifier approved command",
						taskAligned: true,
					})
				)

			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const stateWithSecondary: Partial<ExtensionState> = {
				...mockState,
				approvalMode: "auto",
				commandSafetyConfig: {
					enabled: true,
					provider: "openai",
					modelId: "gpt-4o-mini",
					apiKey: "sk-mock-primary",
					secondaryProvider: "anthropic",
					secondaryModelId: "claude-3-5-haiku",
					secondaryApiKey: "sk-mock-secondary",
				},
			}

			const request: UnifiedApprovalRequest = {
				id: "req-quota-1",
				taskId: "task-quota-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'wsl.exe -d GuildScout-Test -- /bin/bash -c "fixture=$(mktemp); cp lib.so ${fixture}; node test.js; rm -f ${fixture}"',
				},
				taskContext: {
					latestUserInstruction: "Run test",
					activeGoal: "Run test",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, stateWithSecondary)

			// Exactly 2 calls: 1 for primary (no retry storm on 402!), 1 for secondary
			expect(callProviderMock).toHaveBeenCalledTimes(2)
			expect(callProviderMock.mock.calls[0][0].provider).toBe("openai")
			expect(callProviderMock.mock.calls[1][0].provider).toBe("anthropic")
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.reason).toBe("Secondary verifier approved command")
			expect(result.auditLog).toContain("tier=secondary")
		})

		it("falls back to worker model when policy allows, with isolated auditor prompt", async () => {
			const callProviderMock = vi.fn()
				// Primary verifier fails with 402
				.mockRejectedValueOnce(new Error("402 Payment Required: quota exceeded"))
				// Worker fallback succeeds
				.mockResolvedValueOnce(
					JSON.stringify({
						decision: "ALLOW_AUTO",
						risk: "low",
						reason: "Worker approved in isolated auditor context",
						taskAligned: true,
					})
				)

			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const stateWithWorkerFallback: Partial<ExtensionState> = {
				...mockState,
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
					apiKey: "sk-primary-key",
					allowWorkerFallback: true,
				},
			}

			const request: UnifiedApprovalRequest = {
				id: "req-worker-fallback",
				taskId: "task-worker-fallback",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'wsl.exe -d GuildScout-Test -- /bin/bash -c "fixture=$(mktemp); cp lib.so ${fixture}; node test.js; rm -f ${fixture}"',
				},
				taskContext: {
					latestUserInstruction: "Run test",
					activeGoal: "Run test",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, stateWithWorkerFallback)

			expect(callProviderMock).toHaveBeenCalledTimes(2)
			// First call to primary
			expect(callProviderMock.mock.calls[0][0].provider).toBe("openai")
			// Second call to worker model
			expect(callProviderMock.mock.calls[1][0].provider).toBe("openrouter")
			expect(callProviderMock.mock.calls[1][0].modelId).toBe("anthropic/claude-3.7-sonnet")
			// Verify isolated auditor prompt was injected
			expect(callProviderMock.mock.calls[1][0].systemPrompt).toContain("independent external security auditor")

			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.auditLog).toContain("tier=worker_fallback")
		})

		it("prohibits worker fallback when allowWorkerFallback is false and escalates to manual approval", async () => {
			const callProviderMock = vi.fn()
				.mockRejectedValueOnce(new Error("402 Payment Required: quota exceeded"))

			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const stateWithoutWorkerFallback: Partial<ExtensionState> = {
				...mockState,
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
					apiKey: "sk-primary-key",
					allowWorkerFallback: false,
				},
			}

			const request: UnifiedApprovalRequest = {
				id: "req-no-worker-fallback",
				taskId: "task-no-worker-fallback",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'wsl.exe -d GuildScout-Test -- /bin/bash -c "fixture=$(mktemp); cp lib.so ${fixture}; node test.js; rm -f ${fixture}"',
				},
				taskContext: {
					latestUserInstruction: "Run test",
					activeGoal: "Run test",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, stateWithoutWorkerFallback)

			// Exactly 1 call (no fallback allowed)
			expect(callProviderMock).toHaveBeenCalledTimes(1)
			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.verifierUnavailable).toBe(true)
			expect(result.verifierFailureCategory).toBe("FREE_QUOTA_EXHAUSTED")
		})
	})

	describe("Explicit User Constraints Enforcement", () => {
		it("deterministically denies file writes when read-only constraint is active", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req-ro-write",
				taskId: "task-ro-1",
				actionType: "write_to_file",
				timestamp: Date.now(),
				target: {
					filePath: "src/security/FutureHttpLicenseTransport.js",
					isOutsideWorkspace: false,
					isProtected: false,
				},
				taskContext: {
					latestUserInstruction: "Wykonaj SECURITY REVIEW. NIE modyfikuj kodu.",
					activeGoal: "SECURITY REVIEW",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
					explicitConstraints: ["DO NOT modify code (READ-ONLY review)"],
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("DENY_AND_REPLAN")
			expect(result.isUserConstraintViolation).toBe(true)
			expect(result.violatedConstraint).toContain("DO NOT modify code")
			expect(result.replanGuidance).toContain("explicitly read-only")
		})

		it("deterministically denies git commits when 'do not commit' constraint is active", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req-ro-commit",
				taskId: "task-ro-2",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "git commit -m 'fix test'",
				},
				taskContext: {
					latestUserInstruction: "NIE commituj",
					activeGoal: "SECURITY REVIEW",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
					explicitConstraints: ["DO NOT commit changes (NIE commituj)"],
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("DENY_AND_REPLAN")
			expect(result.isUserConstraintViolation).toBe(true)
			expect(result.violatedConstraint).toContain("NIE commituj")
			expect(result.replanGuidance).toContain("Do not stage or commit files")
		})
	})

	describe("Verifier Structured Output Robustness & Auto-Recovery", () => {
		const realIncidentRawResponse = JSON.stringify({
			decision: "ALLOW_AUTO",
			risk: "safe",
			taskAligned: true,
			boundary: "local-workspace",
			hostImpact: false,
			reason: "The command performs read-only status and diff checks along with PowerShell inspection inside the authorized redesign workspace.",
			hardBoundaryViolation: false,
			isUserConstraintViolation: false,
			violatedConstraint: null,
			replanGuidance: null,
		})

		it("correctly parses real incident response with violatedConstraint: null without failing closed", async () => {
			const parsed = orchestrator.parseApprovalResponse(realIncidentRawResponse)
			expect(parsed.decision).toBe("ALLOW_AUTO")
			expect(parsed.risk).toBe("safe")
			expect(parsed.reason).toContain("read-only status and diff checks")
			expect(parsed.violatedConstraint).toBeUndefined()
			expect(parsed.replanGuidance).toBeUndefined()
			expect(parsed.infrastructureFailure).toBeUndefined()

			const callProviderMock = vi.fn().mockResolvedValue(realIncidentRawResponse)
			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req-incident-1",
				taskId: "01a0dfad-d882-778c-aacf-197afa6c2e48",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'powershell.exe -NoProfile -Command "Get-ChildItem -Path ./src -Recurse | Select-Object -First 10"',
				},
				taskContext: {
					latestUserInstruction: "Inspect repo status",
					activeGoal: "Status check",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.risk).toBe("safe")
			expect(result.reason).toContain("read-only status and diff checks")
			expect(callProviderMock).toHaveBeenCalledTimes(1)
		})

		it("fails validation when required critical fields are missing (e.g. decision is missing)", () => {
			const invalidRaw = JSON.stringify({
				risk: "safe",
				reason: "Missing decision field",
			})
			const parsed = orchestrator.parseApprovalResponse(invalidRaw)
			expect(parsed.decision).toBe("MANUAL_APPROVAL")
			expect(parsed.infrastructureFailure).toBe(true)
			expect(parsed.verifierFailureCategory).toBe("APPROVAL_RESPONSE_INVALID")
			expect(parsed.reason).toContain("Approval response schema validation failed")
		})

		it("executes verifier-only bounded retry when primary model returns malformed JSON on attempt 1 and recovers on attempt 2", async () => {
			const callProviderMock = vi
				.fn()
				// Attempt 1: Malformed JSON (truncated open brace)
				.mockResolvedValueOnce('{"decision": "ALLOW_AUTO", "risk": "safe", "reason": "incomplete')
				// Attempt 2: Valid response after correction prompt
				.mockResolvedValueOnce(realIncidentRawResponse)

			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req-retry-1",
				taskId: "task-retry-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'powershell.exe -NoProfile -Command "Get-ChildItem -Path ./src -Recurse | Select-Object -First 10"',
				},
				taskContext: {
					latestUserInstruction: "Check node version",
					activeGoal: "Node version check",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(callProviderMock).toHaveBeenCalledTimes(2)
			expect(callProviderMock.mock.calls[1][0].userPrompt).toContain("[CRITICAL CORRECTION FOR PREVIOUS RESPONSE]")
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.approvalAttemptCount).toBe(2)
			expect(result.auditLog).toContain("retry=true attempt=2")
		})

		it("falls back to secondary verifier when primary verifier repeatedly fails schema validation", async () => {
			const callProviderMock = vi
				.fn()
				// Primary attempt 1: Invalid schema
				.mockResolvedValueOnce('{"decision": "INVALID_DECISION", "risk": "unknown"}')
				// Primary attempt 2: Still invalid schema
				.mockResolvedValueOnce('{"wrong": "format"}')
				// Secondary attempt 1: Valid schema
				.mockResolvedValueOnce(realIncidentRawResponse)

			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const stateWithSecondary: Partial<ExtensionState> = {
				...mockState,
				commandSafetyConfig: {
					enabled: true,
					provider: "openai",
					modelId: "gpt-4o-mini",
					apiKey: "sk-mock-primary",
					secondaryProvider: "anthropic",
					secondaryModelId: "claude-3-5-haiku",
					secondaryApiKey: "sk-mock-secondary",
				},
			}

			const request: UnifiedApprovalRequest = {
				id: "req-secondary-schema-1",
				taskId: "task-secondary-schema-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'powershell.exe -NoProfile -Command "Get-ChildItem -Path ./src -Recurse | Select-Object -First 10"',
				},
				taskContext: {
					latestUserInstruction: "Run unit tests",
					activeGoal: "Test suite execution",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, stateWithSecondary)
			expect(callProviderMock).toHaveBeenCalledTimes(3)
			expect(callProviderMock.mock.calls[0][0].provider).toBe("openai")
			expect(callProviderMock.mock.calls[1][0].provider).toBe("openai")
			expect(callProviderMock.mock.calls[2][0].provider).toBe("anthropic")
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.auditLog).toContain("tier=secondary")
		})

		it("fails closed cleanly with APPROVAL_RESPONSE_INVALID when all candidates fail schema validation", async () => {
			const callProviderMock = vi
				.fn()
				// Candidate attempts all return garbage
				.mockResolvedValue('{"invalid": true}')

			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req-all-fail-1",
				taskId: "task-all-fail-1",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'powershell.exe -NoProfile -Command "Get-ChildItem -Path ./src -Recurse | Select-Object -First 10"',
				},
				taskContext: {
					latestUserInstruction: "Lint code",
					activeGoal: "Linting",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, mockState)
			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.infrastructureFailure).toBe(true)
			expect(result.verifierFailureCategory).toBe("APPROVAL_RESPONSE_INVALID")
			expect(result.reason).toContain("Approval response schema validation failed")
			expect(result.risk).not.toBe("critical")
		})
	})
})

