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

		task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined
		;(task as any).workspacePath = "/test/workspace"

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

	it("blocks auto-approval when safety model is not configured (disabled)", async () => {
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

		const askPromise = task.ask("command", "echo hello")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(evaluateSpy).not.toHaveBeenCalled()

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("blocks auto-approval when safety model is missing configuration", async () => {
		mockProvider.getState.mockResolvedValue({
			...defaultState,
			commandSafetyConfig: undefined,
		})
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate")

		const askPromise = task.ask("command", "echo hello")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(evaluateSpy).not.toHaveBeenCalled()

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
	})

	it("blocks auto-approval when safety model has no apiKey and cannot be resolved", async () => {
		mockProvider.getState.mockResolvedValue({
			...defaultState,
			commandSafetyConfig: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o",
				apiKey: "",
			},
			apiConfiguration: {
				apiProvider: "anthropic",
				apiKey: "anthropic-key-only",
			},
		})
		const evaluateSpy = vi.spyOn(CommandSafetyJudge, "evaluate")

		const askPromise = task.ask("command", "echo hello")

		await new Promise((r) => setTimeout(r, 50))

		expect((task as any).askResponse).toBeUndefined()
		expect(evaluateSpy).not.toHaveBeenCalled()

		task.handleWebviewAskResponse("yesButtonClicked")
		const result = await askPromise
		expect(result.response).toBe("yesButtonClicked")
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
})
