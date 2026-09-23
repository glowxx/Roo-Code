import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Anthropic } from "@anthropic-ai/sdk"
import type { GlobalState, ProviderSettings } from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import { validateAndFixToolResultIds } from "../validateToolResultIds"
import { formatResponse } from "../../prompts/responses"
import { attemptCompletionTool } from "../../tools/AttemptCompletionTool"

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue("[]"),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

const { mockPWaitFor } = vi.hoisted(() => {
	return { mockPWaitFor: vi.fn().mockImplementation(async () => Promise.resolve()) }
})

vi.mock("p-wait-for", () => ({
	default: mockPWaitFor,
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }),
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (_key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve({ text: `processed: ${text}`, mode: undefined, contentBlocks: [] })
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(false),
}))

describe("Hardened attempt_completion Fallback and Recovery", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: any
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		const storageUri = {
			fsPath: path.join(os.tmpdir(), "test-storage"),
		}

		mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((_key: keyof GlobalState) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockImplementation((_key) => Promise.resolve(undefined)),
				store: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				delete: vi.fn().mockImplementation((_key) => Promise.resolve()),
			},
			extensionUri: {
				fsPath: "/mock/extension/path",
			},
			extension: {
				packageJSON: {
					version: "1.0.0",
				},
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as any

		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.updateTaskHistory = vi.fn().mockResolvedValue(undefined)
	})

	// Scenario 1: attempt_completion + real successful completion + missing result caused by legacy/history anomaly
	it("Scenario 1: attempt_completion + real successful completion + missing result falls back to success", () => {
		const assistantMessage: Anthropic.MessageParam = {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool-legacy-completion",
					name: "attempt_completion",
					input: { result: "Report finished" },
				},
			],
		}

		const userMessage: Anthropic.MessageParam = {
			role: "user",
			content: [],
		}

		const validated = validateAndFixToolResultIds(userMessage, [assistantMessage], { isTaskCompleted: true })
		expect(Array.isArray(validated.content)).toBe(true)
		const content = validated.content as Anthropic.ToolResultBlockParam[]
		expect(content.length).toBe(1)
		expect(content[0].type).toBe("tool_result")
		expect(content[0].tool_use_id).toBe("tool-legacy-completion")
		expect(content[0].content).toBe("Task completed successfully.")
	})

	// Scenario 2: attempt_completion + task NOT completed + missing tool_result
	it("Scenario 2: attempt_completion + task NOT completed + missing result falls back to interrupted", () => {
		const assistantMessage: Anthropic.MessageParam = {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool-crashed-completion",
					name: "attempt_completion",
					input: { result: "Half done before crash" },
				},
			],
		}

		const userMessage: Anthropic.MessageParam = {
			role: "user",
			content: [],
		}

		// When unconfirmed / not completed, MUST NOT report success
		const validated = validateAndFixToolResultIds(userMessage, [assistantMessage], { isTaskCompleted: false })
		const content = validated.content as Anthropic.ToolResultBlockParam[]
		expect(content.length).toBe(1)
		expect(content[0].type).toBe("tool_result")
		expect(content[0].tool_use_id).toBe("tool-crashed-completion")
		expect(content[0].content).toBe("Tool execution was interrupted before completion.")

		// Same behavior when options is omitted
		const validatedDefault = validateAndFixToolResultIds(userMessage, [assistantMessage])
		const contentDefault = validatedDefault.content as Anthropic.ToolResultBlockParam[]
		expect(contentDefault[0].content).toBe("Tool execution was interrupted before completion.")
	})

	// Scenario 3: normal tool missing result
	it("Scenario 3: normal tool missing result retains existing interrupted behavior", () => {
		const assistantMessage: Anthropic.MessageParam = {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool-read-file",
					name: "read_file",
					input: { path: "src/index.ts" },
				},
			],
		}

		const userMessage: Anthropic.MessageParam = {
			role: "user",
			content: [],
		}

		// Even if task was completed later, unexecuted read_file was interrupted
		const validated = validateAndFixToolResultIds(userMessage, [assistantMessage], { isTaskCompleted: true })
		const content = validated.content as Anthropic.ToolResultBlockParam[]
		expect(content.length).toBe(1)
		expect(content[0].type).toBe("tool_result")
		expect(content[0].tool_use_id).toBe("tool-read-file")
		expect(content[0].content).toBe("Tool execution was interrupted before completion.")
	})

	// Scenario 4: successful current attempt_completion
	it("Scenario 4: successful current attempt_completion provides real tool_result and validator synthesizes nothing", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test current attempt_completion",
			startTask: false,
		})

		const mockPushToolResult = vi.fn((res) => {
			task.userMessageContent.push({
				type: "tool_result",
				tool_use_id: "tool-curr-comp",
				content: "Task completed successfully.",
			})
		})

		vi.spyOn(task, "say").mockResolvedValue(undefined)
		vi.spyOn(task, "ask").mockResolvedValue({ response: "yesButtonClicked" })
		vi.spyOn(task, "emitFinalTokenUsageUpdate").mockImplementation(() => {})
		vi.spyOn(task, "emit").mockReturnValue(true as any)
		const flushSpy = vi.spyOn(task, "flushPendingToolResultsToHistory")

		await attemptCompletionTool.handle(
			task,
			{
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "All objectives met." },
				nativeArgs: { result: "All objectives met." },
				partial: false,
			},
			{
				pushToolResult: mockPushToolResult,
				handleError: vi.fn(),
				askApproval: vi.fn(),
				askFinishSubTaskApproval: vi.fn(),
				toolDescription: vi.fn(),
			} as any,
		)

		expect(task.isTaskCompleted).toBe(true)
		expect(mockPushToolResult).toHaveBeenCalled()
		expect(flushSpy).toHaveBeenCalled()

		// Verify validator behavior on the resulting user message:
		const assistantMessage: Anthropic.MessageParam = {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool-curr-comp",
					name: "attempt_completion",
					input: { result: "All objectives met." },
				},
			],
		}

		const userMessage: Anthropic.MessageParam = {
			role: "user",
			content: task.userMessageContent,
		}

		const validated = validateAndFixToolResultIds(userMessage, [assistantMessage], {
			isTaskCompleted: task.isTaskCompleted,
		})

		const content = validated.content as Anthropic.ToolResultBlockParam[]
		// Real tool_result already existed; validator did NOT inject any duplicate
		expect(content.length).toBe(1)
		expect(content[0].tool_use_id).toBe("tool-curr-comp")
		expect(content[0].content).toBe("Task completed successfully.")
	})

	// Scenario 5: resume historical successfully completed task
	it("Scenario 5: resume historical successfully completed task does not send any API request", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "resume completed task test",
			startTask: false,
			historyItem: {
				id: "hist-123",
				ts: Date.now() - 10000,
				task: "completed task",
				status: "completed",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.01,
				size: 500,
			} as any,
		})

		// Mock saved messages representing a completed task
		vi.spyOn(task as any, "getSavedClineMessages").mockResolvedValue([
			{ ts: 1, type: "say", say: "task", text: "completed task" },
			{ ts: 2, type: "ask", ask: "completion_result", text: "Done!" },
		])
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue([
			{
				role: "user",
				content: [{ type: "text", text: "completed task" }],
				ts: 1,
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-c1",
						name: "attempt_completion",
						input: { result: "Done!" },
					},
				],
				ts: 2,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-c1",
						content: "Task completed successfully.",
					},
				],
				ts: 3,
			},
		])
		vi.spyOn(task as any, "overwriteClineMessages").mockResolvedValue(undefined)

		let askedType: string | undefined
		vi.spyOn(task, "ask").mockImplementation(async (type: any) => {
			askedType = type
			// Simulate waiting at prompt - does NOT submit any feedback
			return { response: "yesButtonClicked" }
		})

		const requestSpy = vi.spyOn(task, "recursivelyMakeClineRequests")

		// Run resumeTaskFromHistory
		await (task as any).resumeTaskFromHistory()

		// Verified: It prompted for resume_completed_task, and made ZERO API requests
		expect(askedType).toBe("resume_completed_task")
		expect(requestSpy).not.toHaveBeenCalled()
	})

	// Scenario 6: resume interrupted attempt_completion
	it("Scenario 6: resume interrupted attempt_completion is NOT falsely marked as success", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "interrupted task test",
			startTask: false,
			historyItem: {
				id: "hist-interrupted",
				ts: Date.now() - 10000,
				task: "interrupted task",
				status: "active", // NOT completed
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.01,
				size: 500,
			} as any,
		})

		// Saved history where attempt_completion was called but never completed (crashed/killed)
		vi.spyOn(task as any, "getSavedClineMessages").mockResolvedValue([
			{ ts: 1, type: "say", say: "task", text: "interrupted task" },
		])
		vi.spyOn(task as any, "getSavedApiConversationHistory").mockResolvedValue([
			{
				role: "user",
				content: [{ type: "text", text: "interrupted task" }],
				ts: 1,
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-interrupted-comp",
						name: "attempt_completion",
						input: { result: "Unfinished attempt" },
					},
				],
				ts: 2,
			},
		])
		vi.spyOn(task as any, "overwriteClineMessages").mockResolvedValue(undefined)

		const askedTypes: string[] = []
		let askCalls = 0
		vi.spyOn(task, "ask").mockImplementation(async (type: any) => {
			askedTypes.push(type)
			askCalls++
			if (askCalls === 1) {
				// User types message to resume
				return { response: "messageResponse", text: "Please continue" }
			}
			return { response: "yesButtonClicked" }
		})

		let initiatedUserContent: any = null
		vi.spyOn(task as any, "initiateTaskLoop").mockImplementation(async (content: any) => {
			initiatedUserContent = content
			task.abort = true
		})

		await (task as any).resumeTaskFromHistory()

		// Verified: It prompted for regular resume_task (not resume_completed_task)
		expect(askedTypes[0]).toBe("resume_task")
		expect(task.isTaskCompleted).toBe(false)

		// Check the userContent synthesized for resuming
		expect(initiatedUserContent).not.toBeNull()
		const toolResultBlock = initiatedUserContent.find(
			(b: any) => b.type === "tool_result" && b.tool_use_id === "tool-interrupted-comp",
		)
		expect(toolResultBlock).toBeDefined()
		// Must NOT be falsely marked as success!
		expect(toolResultBlock.content).toBe("Task was interrupted before this tool call could be completed.")
	})
})
