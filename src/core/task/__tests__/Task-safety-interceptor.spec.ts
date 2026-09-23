import { describe, it, expect, vi, beforeEach } from "vitest"
import { Task } from "../Task"
import { CommandSafetyJudge, SAFETY_EVALUATION_FALLBACK_RESULT } from "../../security/CommandSafetyJudge"
import { MessageQueueService } from "../../message-queue/MessageQueueService"
import type { ExtensionState, SafetyEvaluationResult } from "@roo-code/types"

describe("Task safety interceptor", () => {
	let task: Task
	let mockProvider: {
		getState: ReturnType<typeof vi.fn>
		postMessageToWebview: ReturnType<typeof vi.fn>
	}
	let defaultState: Partial<ExtensionState>

	beforeEach(() => {
		vi.restoreAllMocks()
		CommandSafetyJudge.clearCache()

		task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).workspacePath = "/test/workspace"
		;(task as any).deniedActionHistory = []
		;(task as any).consecutiveReplanCount = 0
		;(task as any).totalReplanCount = 0

		;(task as any).messageQueueService = new MessageQueueService()
		;(task as any).addToClineMessages = vi.fn(async (msg: any) => {
			;(task as any).clineMessages.push(msg)
		})
		;(task as any).saveClineMessages = vi.fn(async () => {})
		;(task as any).updateClineMessage = vi.fn(async () => {})
		;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).emit = vi.fn()
		;(task as any).findMessageByTimestamp = vi.fn((ts: number) =>
			(task as any).clineMessages.find((m: any) => m.ts === ts),
		)

		defaultState = {
			autoApprovalEnabled: true,
			alwaysAllowExecute: true,
			allowedCommands: ["npm", "echo", "ls", "rm"],
			deniedCommands: [],
			commandSafetyConfig: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o",
				apiKey: "test-api-key",
			},
		}

		mockProvider = {
			getState: vi.fn().mockResolvedValue(defaultState),
			postMessageToWebview: vi.fn(),
		}
		;(task as any).providerRef = { deref: () => mockProvider }
	})

	it("executes auto-approval when command is safe (isSafe: true, riskLevel: 'safe')", async () => {
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: true,
			riskLevel: "safe",
			reason: "Echo command is completely safe",
		})
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "echo hello")
		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).toHaveBeenCalledTimes(1)
		expect(evaluateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "echo hello",
				cwd: "/test/workspace",
			}),
		)
		expect(saySpy).not.toHaveBeenCalledWith("command_safety_warning", expect.anything())
	})

	it("executes auto-approval when command is low risk (isSafe: true, riskLevel: 'low')", async () => {
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: true,
			riskLevel: "low",
			reason: "Minor read operation with minimal impact",
		})

		const result = await task.ask("command", "ls")

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).toHaveBeenCalledTimes(1)
	})

	it("blocks auto-approval and emits command_safety_warning when riskLevel is medium", async () => {
		const mediumRiskResult: SafetyEvaluationResult = {
			isSafe: true, // Note: even if isSafe is true, medium risk blocks auto-approval
			riskLevel: "medium",
			reason: "Modifies package dependencies or system files",
		}
		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue(mediumRiskResult)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "npm test")

		// Allow async ask processing to complete up to blocking pWaitFor
		await new Promise((r) => setTimeout(r, 50))

		// Auto-approval must NOT have executed
		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith("command_safety_warning", JSON.stringify(mediumRiskResult))

		// User manually approves
		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("blocks auto-approval and emits command_safety_warning when riskLevel is high", async () => {
		const highRiskResult: SafetyEvaluationResult = {
			isSafe: false,
			riskLevel: "high",
			reason: "Recursive directory deletion detected",
		}
		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue(highRiskResult)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "rm -rf build")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith("command_safety_warning", JSON.stringify(highRiskResult))

		task.handleWebviewAskResponse("noButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("noButtonClicked")
	})

	it("blocks auto-approval and emits command_safety_warning when riskLevel is critical", async () => {
		const criticalResult: SafetyEvaluationResult = {
			isSafe: false,
			riskLevel: "critical",
			reason: "System-wide destructive operation",
		}
		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue(criticalResult)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "rm -rf /")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith("command_safety_warning", JSON.stringify(criticalResult))

		task.handleWebviewAskResponse("noButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("noButtonClicked")
	})

	it("blocks auto-approval when isSafe is false regardless of riskLevel", async () => {
		const unsafeResult: SafetyEvaluationResult = {
			isSafe: false,
			riskLevel: "low",
			reason: "Flagged unsafe by classifier",
		}
		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue(unsafeResult)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "echo test")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith("command_safety_warning", JSON.stringify(unsafeResult))

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("defensively blocks auto-approval when verifier times out or rejects with error", async () => {
		vi.spyOn(CommandSafetyJudge, "evaluate").mockRejectedValue(
			new Error("Command safety evaluation timed out after 5000ms"),
		)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "npm test")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith(
			"command_safety_warning",
			expect.stringContaining("Command safety evaluation timed out after 5000ms"),
		)

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("blocks auto-approval and emits warning when verifier rejects with network error", async () => {
		vi.spyOn(CommandSafetyJudge, "evaluate").mockRejectedValue(
			new Error("Network connection refused: ECONNREFUSED"),
		)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "npm install")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith(
			"command_safety_warning",
			expect.stringContaining("Network connection refused: ECONNREFUSED"),
		)

		task.handleWebviewAskResponse("noButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("noButtonClicked")
	})

	it("blocks auto-approval and emits warning when verifier returns malformed response result", async () => {
		const malformedResult: SafetyEvaluationResult = {
			isSafe: false,
			riskLevel: "critical",
			reason: "Command safety verification failed: Invalid or malformed JSON response from safety auditor model. Manual approval required.",
		}
		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue(malformedResult)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "ls -la")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith(
			"command_safety_warning",
			JSON.stringify(malformedResult),
		)

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("blocks auto-approval and emits warning when verifier returns HTTP error fail-closed result", async () => {
		const httpErrorResult: SafetyEvaluationResult = {
			isSafe: false,
			riskLevel: "critical",
			reason: "Command safety verification failed: HTTP 500: Internal Server Error. Manual approval required.",
		}
		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue(httpErrorResult)
		const saySpy = vi.spyOn(task, "say")

		const askPromise = task.ask("command", "npm start")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith(
			"command_safety_warning",
			JSON.stringify(httpErrorResult),
		)

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("allows auto-approval when safety model is not configured (disabled) and command is allowed", async () => {
		mockProvider.getState.mockResolvedValue({
			...defaultState,
			commandSafetyConfig: {
				enabled: false,
				provider: "openai",
				modelId: "gpt-4o",
				apiKey: "test-api-key",
			},
		})
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate")

		const result = await task.ask("command", "echo hello")

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).not.toHaveBeenCalled()
	})

	it("allows auto-approval when safety model is missing configuration and command is allowed", async () => {
		mockProvider.getState.mockResolvedValue({
			...defaultState,
			commandSafetyConfig: undefined,
		})
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate")

		const result = await task.ask("command", "echo hello")

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).not.toHaveBeenCalled()
	})

	it("blocks auto-approval when safety model is not configured and command is not allowed", async () => {
		mockProvider.getState.mockResolvedValue({
			...defaultState,
			commandSafetyConfig: undefined,
			allowedCommands: ["echo", "ls"],
		})
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate")

		const askPromise = task.ask("command", "reboot")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(evaluateSpy).not.toHaveBeenCalled()

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("auto-approves git diff when alwaysAllowExecute is true and CommandSafetyJudge returns safe", async () => {
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: true,
			riskLevel: "safe",
			reason: "Safe git diff inspect operation",
		})

		const result = await task.ask("command", "git diff -- packages/types")

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).toHaveBeenCalledTimes(1)
	})

	it("auto-approves git diff even when allowedCommands list is empty (default safe commands)", async () => {
		mockProvider.getState.mockResolvedValue({
			...defaultState,
			allowedCommands: [],
		})
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: true,
			riskLevel: "safe",
			reason: "Safe git diff inspect operation",
		})

		const result = await task.ask("command", "git diff")

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).toHaveBeenCalledTimes(1)
	})

	it("auto-approves git diff when safety model is disabled and allowedCommands is empty", async () => {
		mockProvider.getState.mockResolvedValue({
			...defaultState,
			commandSafetyConfig: undefined,
			allowedCommands: [],
		})
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate")

		const result = await task.ask("command", "git diff")

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).not.toHaveBeenCalled()
	})

	it("extracts recent commands from clineMessages for contextual analysis", async () => {
		;(task as any).clineMessages = [
			{ ts: 100, type: "ask", ask: "command", text: "git status" },
			{ ts: 200, type: "say", say: "text", text: "analyzing repository" },
			{ ts: 300, type: "ask", ask: "command", text: "cd src" },
			{ ts: 400, type: "ask", ask: "command", text: "npm run lint" },
		]

		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: true,
			riskLevel: "safe",
			reason: "Safe build command in src",
		})

		const askPromise = task.ask("command", "npm run build")
		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		expect(evaluateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "npm run build",
				recentCommands: ["git status", "cd src", "npm run lint"],
			}),
		)
	})

	it("two-stage auto-approves safe service restart in GuildScout-Test when task context aligns", async () => {
		;(task as any).metadata = { task: "Perform Linux validation in GuildScout-Test" }
		;(task as any).clineMessages = [
			{ ts: 100, type: "say", say: "user_feedback", text: "Restart the velune-headless service in GuildScout-Test" },
		]
		defaultState.allowedCommands = ["wsl.exe", "wsl"]

		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: false,
			riskLevel: "medium",
			reason: "Service restart modifies system init state",
		})

		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_AUTO_APPROVE",
				risk: "low",
				reason: "Task explicitly requested Linux systemd service validation in test distro",
				taskAlignment: true,
				executionBoundary: {
					host: "windows",
					targetType: "wsl",
					target: "GuildScout-Test",
					hostImpact: false,
				},
				criticalRiskDetected: false,
			}),
		)

		const saySpy = vi.spyOn(task, "say")
		const result = await task.ask("command", 'wsl.exe -d GuildScout-Test -- bash -lc "systemctl restart velune-headless"')

		expect(result.response).toBe("yesButtonClicked")
		expect(saySpy).not.toHaveBeenCalledWith("command_safety_warning", expect.anything())
	})

	it("blocks WSL command touching Windows host filesystem (/mnt/c) even in test distro", async () => {
		;(task as any).metadata = { task: "Perform Linux validation in GuildScout-Test" }
		defaultState.allowedCommands = ["wsl.exe", "wsl"]

		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: false,
			riskLevel: "medium",
			reason: "Directory removal",
		})

		const saySpy = vi.spyOn(task, "say")
		const askPromise = task.ask("command", 'wsl.exe -d GuildScout-Test -- bash -lc "rm -rf /mnt/c/Users/Kamil/cache"')

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith(
			"command_safety_warning",
			expect.stringContaining("Host impact detected"),
		)

		task.handleWebviewAskResponse("noButtonClicked")
		await askPromise
	})

	it("two-stage auto-approves scoped Docker test command inside container", async () => {
		;(task as any).metadata = { task: "Run test suite in docker container" }
		;(task as any).clineMessages = [
			{ ts: 100, type: "say", say: "user_feedback", text: "Run tests in docker container" },
		]
		defaultState.allowedCommands = ["docker"]

		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: false,
			riskLevel: "medium",
			reason: "Runs test suite inside container",
		})

		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_AUTO_APPROVE",
				risk: "low",
				reason: "Test command scoped to container",
				taskAlignment: true,
				executionBoundary: {
					host: "windows",
					targetType: "docker",
					target: "test-runner",
					hostImpact: false,
				},
				criticalRiskDetected: false,
			}),
		)

		const saySpy = vi.spyOn(task, "say")
		const result = await task.ask("command", "docker exec test-runner npm test")

		expect(result.response).toBe("yesButtonClicked")
		expect(saySpy).not.toHaveBeenCalledWith("command_safety_warning", expect.anything())
	})

	it("blocks Docker command with --privileged flag due to host escape invariant", async () => {
		;(task as any).metadata = { task: "Run container" }
		defaultState.allowedCommands = ["docker"]

		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: false,
			riskLevel: "medium",
			reason: "Container run with privileged flag",
		})

		const saySpy = vi.spyOn(task, "say")
		const askPromise = task.ask("command", "docker run --privileged -it alpine sh")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith(
			"command_safety_warning",
			expect.stringContaining("Host impact detected"),
		)

		task.handleWebviewAskResponse("noButtonClicked")
		await askPromise
	})

	it("fails closed to manual approval when Stage 2 returns malformed JSON", async () => {
		;(task as any).metadata = { task: "Linux test in GuildScout-Test" }
		;(task as any).clineMessages = [
			{ ts: 100, type: "say", say: "user_feedback", text: "Check status in GuildScout-Test" },
		]
		defaultState.allowedCommands = ["wsl.exe", "wsl"]

		vi.spyOn(CommandSafetyJudge, "evaluate").mockResolvedValue({
			isSafe: false,
			riskLevel: "medium",
			reason: "Service inspection in distro",
		})

		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue("THIS IS NOT JSON")

		const saySpy = vi.spyOn(task, "say")
		const askPromise = task.ask("command", 'wsl.exe -d GuildScout-Test -- bash -lc "systemctl status test"')

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(saySpy).toHaveBeenCalledWith("command_safety_warning", expect.anything())

		task.handleWebviewAskResponse("yesButtonClicked")
		await askPromise
	})

	describe("Unified Context & Autonomous Timeout Recovery", () => {
		it("extracts workerReason, userTask, activeGoal and currentStep in buildApprovalRequest", () => {
			;(task as any).metadata = { task: "Run security compliance checks in GuildScout-Test" }
			;(task as any).taskId = "task-context-1"
			;(task as any).currentStreamingContentIndex = 2
			;(task as any).assistantMessageContent = [
				{
					type: "text",
					content: "I will now test the native security addon inside WSL to verify license enforcement.",
				},
				{
					type: "tool_use",
					name: "execute_command",
					params: { command: "wsl.exe -d GuildScout-Test -- /bin/bash" },
				},
			]
			;(task as any).todoList = [
				{ content: "Setup environment", status: "completed" },
				{ content: "Run native security tests", status: "in_progress" },
			]
			;(task as any).deniedActionHistory = []

			const req = (task as any).buildApprovalRequest({
				askType: "command",
				text: 'wsl.exe -d GuildScout-Test -- /bin/bash -c "node test.js"',
				isProtected: false,
				askTs: 5000,
			})

			expect(req.taskContext.userTask).toBe("Run security compliance checks in GuildScout-Test")
			expect(req.taskContext.activeGoal).toBe("Run security compliance checks in GuildScout-Test")
			expect(req.taskContext.currentStep).toContain("Run native security tests")
			expect(req.taskContext.workerReason).toContain("verify license enforcement")
			expect(req.target.workerReason).toContain("verify license enforcement")
		})

		it("auto-denies with replan guidance on infrastructure timeout in AUTO mode without stopping task", async () => {
			;(task as any).taskId = "task-auto-timeout-1"
			;(task as any).metadata = { task: "Automated regression testing" }
			;(task as any).approvalOrchestrator = {
				evaluate: vi.fn().mockResolvedValue({
					decision: "DENY_AND_REPLAN",
					risk: "medium",
					reason: "Approval authority temporarily unavailable (timeout after 25000ms). Unverified action blocked.",
					taskAligned: false,
					hardBoundaryViolation: false,
					replanGuidance: "Approval authority was temporarily unavailable. Try a lower-risk or deterministic alternative.",
					infrastructureFailure: true,
					approvalAttemptCount: 2,
					auditLog: "[ApprovalAudit] infrastructureFailure=true",
				}),
			}
			const denySpy = vi.spyOn(task, "denyAsk")
			const saySpy = vi.spyOn(task, "say")

			defaultState.approvalMode = "auto"
			mockProvider.getState.mockResolvedValue(defaultState)

			const result = await task.ask("command", 'wsl.exe -d GuildScout-Test -- /bin/bash -c "node complex_suite.js"')

			// In autonomous deny-and-replan, denyAsk is called and resolves with noButtonClicked + guidance
			expect(result.response).toBe("noButtonClicked")
			expect(result.text).toContain("Approval authority was temporarily unavailable")
			expect(denySpy).toHaveBeenCalledTimes(1)
			expect(saySpy).not.toHaveBeenCalledWith("command_safety_warning", expect.anything())
			expect((task as any).consecutiveReplanCount).toBe(1)
		})

		it("escalates to manual approval when consecutive replan threshold is exceeded (thrashing protection)", async () => {
			;(task as any).taskId = "task-thrash-1"
			;(task as any).metadata = { task: "Automated regression testing" }
			;(task as any).consecutiveReplanCount = 3 // Threshold reached
			;(task as any).deniedActionHistory = []
			;(task as any).approvalOrchestrator = {
				evaluate: vi.fn().mockResolvedValue({
					decision: "DENY_AND_REPLAN",
					risk: "high",
					reason: "Approval AI rejected unverified command.",
					taskAligned: false,
					hardBoundaryViolation: false,
					replanGuidance: "Do not repeat command.",
				}),
			}
			const denySpy = vi.spyOn(task, "denyAsk")
			const saySpy = vi.spyOn(task, "say")

			defaultState.approvalMode = "auto"
			mockProvider.getState.mockResolvedValue(defaultState)

			const askPromise = task.ask("command", 'wsl.exe -d GuildScout-Test -- /bin/bash -c "node failing.js"')

			// Give async evaluate a cycle
			await new Promise((r) => setTimeout(r, 50))

			// Thrashing threshold reached -> escalates to manual approval
			expect(denySpy).not.toHaveBeenCalled()
			expect(saySpy).toHaveBeenCalledWith(
				"command_safety_warning",
				expect.stringContaining("Safety replan limit reached")
			)

			// Resolve manual response
			task.handleWebviewAskResponse("yesButtonClicked")
			await askPromise
		})
	})
})

