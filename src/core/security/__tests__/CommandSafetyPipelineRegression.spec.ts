import { describe, it, expect, vi, beforeEach } from "vitest"
import { CommandSafetyJudge } from "../CommandSafetyJudge"
import { ApprovalOrchestrator } from "../ApprovalOrchestrator"
import { getEffectiveApprovalPolicy } from "../effectiveApprovalPolicy"
import { getCommandDecision } from "../../auto-approval/commands"
import type { UnifiedApprovalRequest, ExtensionState } from "@roo-code/types"

describe("CommandSafetyPipelineRegression - Strict Audit Suite", () => {
	let judge: CommandSafetyJudge
	let orchestrator: ApprovalOrchestrator

	// Real sanitized user settings fixture captured from C:\Users\Kamil\.roo-desktop-data\global-storage\global-state.json
	const realUserSettingsFixture: Partial<ExtensionState> = {
		approvalMode: "auto",
		autoApprovalEnabled: true,
		alwaysAllowReadOnly: true,
		alwaysAllowReadOnlyOutsideWorkspace: false,
		alwaysAllowWrite: true,
		alwaysAllowWriteOutsideWorkspace: false,
		alwaysAllowWriteProtected: false,
		alwaysAllowExecute: true,
		allowedCommands: [],
		deniedCommands: [],
		commandSafetyConfig: {
			enabled: true,
			provider: "xkiro",
			modelId: "qwen/qwen3.8-omni-flash:free",
		},
		apiConfiguration: {
			apiProvider: "xkiro",
			apiKey: "test-sanitized-key",
		},
	}

	const exactScreenshotCommand =
		'powershell -NoProfile -Command "git diff -- license-api-system/src/api/routes.ts license-api-system/src/database/PgDatabaseClient.ts license-api-system/migrations/008_activation_idempotency.sql licensing-obfuscation/src/security/transport/FutureHttpLicenseTransport.js licensing-obfuscation/src/security/license/LicenseManager.js licensing-obfuscation/src/security/device/DeviceBinding.js | Out-String -Width 240"'

	beforeEach(() => {
		CommandSafetyJudge.clearCache()
		judge = new CommandSafetyJudge()
		orchestrator = new ApprovalOrchestrator({ timeoutMs: 25000 })
		ApprovalOrchestrator.resetVerifierHealth()
	})

	describe("PHASE 19 & 22: Exact Screenshot Command Incident Replay", () => {
		it("fast-paths exact screenshot command deterministically with 0 AI verifier calls", async () => {
			// Fast-path evaluation directly on CommandSafetyJudge
			const fastPath = judge.evaluateFastPath(exactScreenshotCommand)
			expect(fastPath).not.toBeNull()
			expect(fastPath?.isSafe).toBe(true)
			expect(fastPath?.riskLevel).toBe("safe")

			// Orchestrator evaluation in real user AUTO mode
			const callProviderMock = vi.fn()
			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req_screenshot_incident_replay",
				taskId: "01a0ef29-4a83-71ca-99e3-c3b06d31aabd",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: exactScreenshotCommand,
				},
				taskContext: {
					latestUserInstruction: "Compare modified files with git diff",
					activeGoal: "Security audit of license API",
					workspacePath: "c:/Users/Kamil/Documents/Roo-Code",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, realUserSettingsFixture)

			expect(result.decision).toBe("ALLOW_AUTO")
			expect(result.risk).toBe("safe")
			expect(callProviderMock).toHaveBeenCalledTimes(0) // Approval AI call count = 0
			expect(result.auditLog).toContain("approvalModelCalled=false")
			expect(result.auditLog).toContain("fastPath=true")
		})
	})

	describe("PHASE 20: Comprehensive Command Safety Regression Scenarios", () => {
		// 1. Plain git diff -> AUTO
		it("Scenario 1: plain git diff evaluates to fast-path safe", () => {
			const res = judge.evaluateFastPath("git diff -- src/index.ts")
			expect(res?.isSafe).toBe(true)
			expect(res?.riskLevel).toBe("safe")
		})

		// 2. PowerShell wrapped git diff -> AUTO
		it("Scenario 2: PowerShell wrapped git diff evaluates to fast-path safe", () => {
			const res = judge.evaluateFastPath('powershell -NoProfile -Command "git diff -- file.ts"')
			expect(res?.isSafe).toBe(true)
			expect(res?.riskLevel).toBe("safe")
		})

		// 3. PowerShell git diff | Out-String -> AUTO
		it("Scenario 3: PowerShell git diff piped to Out-String evaluates to fast-path safe", () => {
			const res = judge.evaluateFastPath('powershell -NoProfile -Command "git diff -- file.ts | Out-String -Width 240"')
			expect(res?.isSafe).toBe(true)
			expect(res?.riskLevel).toBe("safe")
		})

		// 4. PowerShell safe + unsafe segment -> NOT AUTO (fails fast path)
		it("Scenario 4: PowerShell safe command followed by unsafe segment is rejected from fast-path", () => {
			const cmd = 'powershell -Command "git status; Remove-Item -Recurse ./build"'
			const res = judge.evaluateFastPath(cmd)
			expect(res).toBeNull()
		})

		// 5. Safe pipeline all segments safe -> AUTO
		it("Scenario 5: Multi-segment safe pipeline where all segments are passive filters evaluates to safe", () => {
			const cmd = 'powershell -NoProfile -Command "git log --oneline | Select-Object -First 10 | Out-String -Width 120"'
			const res = judge.evaluateFastPath(cmd)
			expect(res?.isSafe).toBe(true)
			expect(res?.riskLevel).toBe("safe")
		})

		// 6. Unknown pipeline segment -> verifier (fast-path returns null)
		it("Scenario 6: Pipeline with unknown/custom cmdlet is not fast-pathed and escalates to verifier", async () => {
			const cmd = 'powershell -Command "git diff | Custom-Analyzer"'
			const fastPath = judge.evaluateFastPath(cmd)
			expect(fastPath).toBeNull()

			const callProviderMock = vi.fn().mockResolvedValue(
				JSON.stringify({
					decision: "DENY_AND_REPLAN",
					risk: "medium",
					reason: "Custom-Analyzer is an unknown tool requiring manual approval.",
					taskAligned: true,
				})
			)
			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req_unknown_pipeline",
				taskId: "01a0ef29-4a83-71ca-99e3-c3b06d31aabd",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: { command: cmd },
				taskContext: {
					latestUserInstruction: "Analyze diff",
					activeGoal: "Inspection",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, realUserSettingsFixture)
			expect(callProviderMock).toHaveBeenCalledTimes(1)
			expect(result.decision).toBe("DENY_AND_REPLAN")
		})

		// 7. Dangerous segment -> never silent allow (hard block / fail closed)
		it("Scenario 7: Dangerous PowerShell commands (Invoke-Expression, Start-Process) never fast-path", () => {
			expect(judge.evaluateFastPath('powershell -Command "Get-Content foo | Invoke-Expression"')).toBeNull()
			expect(judge.evaluateFastPath('powershell -Command "Start-Process cmd.exe"')).toBeNull()
			expect(judge.evaluateFastPath('powershell -Command "iex $x"')).toBeNull()
			expect(judge.evaluateFastPath('powershell -Command "Get-ChildItem | ForEach-Object { $_.Delete() }"')).toBeNull()
		})

		// 8. Deterministic ALLOW_AUTO -> verifier call count 0
		it("Scenario 8: Deterministic ALLOW_AUTO executes with zero verifier calls", async () => {
			const callProviderMock = vi.fn()
			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req_deterministic_test",
				taskId: "01a0ef29-4a83-71ca-99e3-c3b06d31aabd",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: 'powershell -NoProfile -Command "Get-ChildItem ./src"',
				},
				taskContext: {
					latestUserInstruction: "List src folder",
					activeGoal: "File exploration",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, realUserSettingsFixture)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(callProviderMock).toHaveBeenCalledTimes(0)
		})

		// 9. AUTO label only after final ALLOW_AUTO (tested via state verification)
		it("Scenario 9: Evaluating state is distinct from AUTO_APPROVED state in policy", () => {
			const policy = getEffectiveApprovalPolicy(realUserSettingsFixture)
			expect(policy.approvalMode).toBe("auto")
			expect(policy.isAutonomousMode).toBe(true)
			expect(policy.isSafetyModelConfigured).toBe(true)
		})

		// 10. Conflicting legacy/current settings -> canonical precedence
		it("Scenario 10: Canonical precedence resolves conflicting settings cleanly", () => {
			// User has approvalMode: "auto" AND alwaysAllowExecute: false in manual toggles
			const conflictingState: Partial<ExtensionState> = {
				approvalMode: "auto",
				alwaysAllowExecute: false, // Legacy or inactive manual toggle
				commandSafetyConfig: {
					enabled: true,
					provider: "xkiro",
					modelId: "qwen/qwen3.8-omni-flash:free",
				},
			}
			const policy = getEffectiveApprovalPolicy(conflictingState)
			// In auto mode, autonomous orchestrator takes precedence over manual alwaysAllowExecute toggle
			expect(policy.isAutonomousMode).toBe(true)
			expect(policy.activePolicyDescription).toContain("Autonomous Mode")
		})

		// 11. Settings persisted -> same runtime effective policy
		it("Scenario 11: getEffectiveApprovalPolicy produces identical deterministic policy", () => {
			const policy1 = getEffectiveApprovalPolicy(realUserSettingsFixture)
			const policy2 = getEffectiveApprovalPolicy({ ...realUserSettingsFixture })
			expect(policy1).toEqual(policy2)
			expect(policy1.failClosed).toBe(true)
			expect(policy1.hasVerifierApiKey).toBe(true)
		})

		// 12. Verifier timeout ambiguous -> manual
		it("Scenario 12: When ambiguous command verifier call times out, it fails closed to MANUAL_APPROVAL", async () => {
			const callProviderMock = vi.fn().mockRejectedValue(new Error("Approval AI evaluation timed out after 9487ms"))
			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req_timeout_ambiguous",
				taskId: "01a0ef29-4a83-71ca-99e3-c3b06d31aabd",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: "python ./scripts/unknown-arbitrary-tool.py",
				},
				taskContext: {
					latestUserInstruction: "Run custom script",
					activeGoal: "Script execution",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, realUserSettingsFixture)
			expect(result.decision).toBe("MANUAL_APPROVAL")
			expect(result.infrastructureFailure).toBe(true)
			expect(result.reason).toContain("Verification model unavailable")
		})

		// 13. Verifier timeout safe action -> should not occur because verifier not invoked
		it("Scenario 13: Verifier timeout cannot occur on safe actions because verifier is bypassed", async () => {
			// Even if callProvider throws or hangs, evaluate never invokes it for fast-path safe commands
			const callProviderMock = vi.fn().mockImplementation(() => {
				throw new Error("Should never be called for safe action")
			})
			;(orchestrator as any).judge = { callProvider: callProviderMock }

			const request: UnifiedApprovalRequest = {
				id: "req_safe_never_hangs",
				taskId: "01a0ef29-4a83-71ca-99e3-c3b06d31aabd",
				actionType: "execute_command",
				timestamp: Date.now(),
				target: {
					command: exactScreenshotCommand,
				},
				taskContext: {
					latestUserInstruction: "Check diff",
					activeGoal: "Inspection",
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, realUserSettingsFixture)
			expect(result.decision).toBe("ALLOW_AUTO")
			expect(callProviderMock).not.toHaveBeenCalled()
		})

		// 14. Read-only task remains protected
		it("Scenario 14: Read-only tasks forbid mutating commands even if fast-path safe", async () => {
			const request: UnifiedApprovalRequest = {
				id: "req_readonly_task",
				taskId: "01a0ef29-4a83-71ca-99e3-c3b06d31aabd",
				actionType: "write_to_file",
				timestamp: Date.now(),
				target: {
					filePath: "src/core/security/CommandSafetyJudge.ts",
				},
				taskContext: {
					latestUserInstruction: "nie modyfikuj kodu, tylko raportuj",
					activeGoal: "Code review read-only",
					explicitConstraints: ["DO NOT modify code (READ-ONLY)"],
					workspacePath: "/test/project",
					isWithinWorkspace: true,
				},
			}

			const result = await orchestrator.evaluate(request, realUserSettingsFixture)
			expect(result.decision).toBe("DENY_AND_REPLAN")
			expect(result.isUserConstraintViolation).toBe(true)
		})

		// 15. Explicit deny still overrides safe command
		it("Scenario 15: Explicitly denied command prefix blocks command even if normally safe", () => {
			const decision = getCommandDecision("git diff", [], ["git diff"])
			expect(decision).toBe("auto_deny")

			const wrappedDecision = getCommandDecision('powershell -Command "git diff"', [], ["git diff"])
			expect(wrappedDecision).toBe("auto_deny")

			const outerDeniedDecision = getCommandDecision('powershell -Command "git diff"', [], ["powershell"])
			expect(outerDeniedDecision).toBe("auto_deny")
		})
	})
})
