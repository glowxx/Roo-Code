import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type { GlobalState, ProviderSettings } from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import { formatResponse } from "../../prompts/responses"

// Mock delay before any imports that might use it
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

describe("Task completion loop and termination", () => {
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

	it("markTaskCompleted sets isTaskCompleted flag", () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		expect(task.isTaskCompleted).toBe(false)
		task.markTaskCompleted()
		expect(task.isTaskCompleted).toBe(true)
	})

	it("initiateTaskLoop terminates immediately when isTaskCompleted is true without sending noToolsUsed request", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		let requestCount = 0
		vi.spyOn(task, "recursivelyMakeClineRequests").mockImplementation(async () => {
			requestCount++
			task.markTaskCompleted()
			return true
		})

		// Run initiateTaskLoop
		await (task as any).initiateTaskLoop([{ type: "text", text: "initial" }])

		// Exactly one request was made, task loop exited cleanly
		expect(requestCount).toBe(1)
		expect(task.isTaskCompleted).toBe(true)
	})

	it("initiateTaskLoop breaks when task is completed even if didEndLoop was false", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		let requestCount = 0
		vi.spyOn(task, "recursivelyMakeClineRequests").mockImplementation(async () => {
			requestCount++
			task.markTaskCompleted()
			return false // simulates historical edge case where didEndLoop was false
		})

		await (task as any).initiateTaskLoop([{ type: "text", text: "initial" }])

		// Must not loop infinitely!
		expect(requestCount).toBe(1)
		expect(task.isTaskCompleted).toBe(true)
	})

	it("attemptApiRequest yields nothing when isTaskCompleted is true", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		task.markTaskCompleted()

		const chunks = []
		for await (const chunk of task.attemptApiRequest(0)) {
			chunks.push(chunk)
		}

		expect(chunks.length).toBe(0)
	})

	it("recursivelyMakeClineRequests flushes pending tool results and returns true when isTaskCompleted is true", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		task.markTaskCompleted()
		const flushSpy = vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)

		const result = await task.recursivelyMakeClineRequests([{ type: "text", text: "test" }])

		expect(result).toBe(true)
	})

	it("markTaskCompleted clears streaming flags and cleans up unfinalized api_req_started", () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		task.isStreaming = true
		task.isWaitingForFirstChunk = true
		task.clineMessages = [
			{
				ts: 100,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ cost: undefined }),
			},
		]

		task.markTaskCompleted()

		expect(task.isTaskCompleted).toBe(true)
		expect(task.isStreaming).toBe(false)
		expect(task.isWaitingForFirstChunk).toBe(false)
		expect(task.clineMessages.length).toBe(0)
	})

	it("after task completion, user can immediately send next prompt without restart", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "initial prompt",
			startTask: false,
		})

		const requestsReceived: any[] = []
		let askCallCount = 0

		// Mock initiateTaskLoop: on first call, simulates completion of first turn;
		// on second call, captures the new user content and aborts the task.
		vi.spyOn(task as any, "initiateTaskLoop").mockImplementation(async (content: any) => {
			requestsReceived.push(content)
			if (requestsReceived.length === 1) {
				task.markTaskCompleted()
			} else {
				task.abort = true
			}
		})

		// Mock ask: when resume_completed_task is asked, simulate user immediately sending "continue"
		vi.spyOn(task, "ask").mockImplementation(async (askType: any) => {
			askCallCount++
			if (askType === "resume_completed_task") {
				// Assert completion invariants while waiting for continuation
				expect(task.isTaskCompleted).toBe(true)
				expect(task.isStreaming).toBe(false)
				expect(task.isWaitingForFirstChunk).toBe(false)

				return { response: "messageResponse", text: "continue", images: undefined }
			}
			return { response: "yesButtonClicked" }
		})

		const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined as any)

		// Start task lifecycle
		await (task as any).startTask("initial prompt")

		// 1. Initial turn + continuation turn occurred
		expect(requestsReceived.length).toBe(2)

		// 2. The continuation content contains the user's prompt "continue"
		expect(requestsReceived[1][0].text).toContain("continue")

		// 3. User feedback message was appended to UI
		expect(saySpy).toHaveBeenCalledWith("user_feedback", "continue", undefined)

		// 4. Exactly one resume_completed_task ask was invoked
		expect(askCallCount).toBe(1)
	})

	it("continuation prompt produces exactly one worker execution and resets isTaskCompleted", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test task",
			startTask: false,
		})

		let loopExecutions = 0
		vi.spyOn(task as any, "initiateTaskLoop").mockImplementation(async () => {
			loopExecutions++
			if (loopExecutions === 1) {
				// Turn 1: Worker finishes task
				task.markTaskCompleted()
			} else {
				// Turn 2: Continuation turn - isTaskCompleted must be reset to false
				expect(task.isTaskCompleted).toBe(false)
				task.abort = true
			}
		})

		vi.spyOn(task, "ask").mockResolvedValue({
			response: "messageResponse",
			text: "do next step",
		})
		vi.spyOn(task, "say").mockResolvedValue(undefined as any)

		// Trigger startTask
		await (task as any).startTask("test task")

		// Turn 1 + exactly 1 continuation turn were executed
		expect(loopExecutions).toBe(2)
		expect(task.isTaskCompleted).toBe(false)
	})
})
