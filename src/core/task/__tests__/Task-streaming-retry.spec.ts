import { describe, it, expect, vi, beforeEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type { GlobalState, ProviderSettings } from "@roo-code/types"
import { Task, MAX_API_RETRIES, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"

const { mockPWaitFor } = vi.hoisted(() => {
	return {
		mockPWaitFor: vi.fn().mockImplementation(async (condition: () => boolean) => {
			if (!condition()) {
				throw new Error("Promise timed out after 60000 milliseconds")
			}
			return Promise.resolve()
		}),
	}
})

vi.mock("p-wait-for", () => ({
	default: mockPWaitFor,
}))

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockImplementation(() => Promise.resolve("[]")),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

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
			getConfiguration: vi.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
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
	fileExistsAtPath: vi.fn().mockImplementation(() => false),
}))

vi.mock("../../context/ContextCompactor", () => ({
	compactHistory: vi.fn().mockResolvedValue({
		messages: [],
		prevTokens: 62000,
		newTokens: 35000,
		summary: "Mock summary",
	}),
}))

describe("Task Streaming and Retry Architecture", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: any
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		vi.clearAllMocks()

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
			apiProvider: "openai-native",
			apiModelId: "openai/gpt-5.6-terra",
			apiKey: "test-api-key",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.getState = vi.fn().mockResolvedValue({})
	})

	it("exports expected constants for retry bounding and stream idle timeout", () => {
		expect(MAX_API_RETRIES).toBe(3)
		expect(DEFAULT_STREAM_IDLE_TIMEOUT_MS).toBe(45_000)
	})

	it("does NOT deadlock when compactContext is autoTriggered even if isStreaming was true", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test deadlock prevention",
			startTask: false,
			enableCheckpoints: false,
		})

		// Simulate isStreaming being true (which previously caused 60s pWaitFor timeout)
		;(task as any).isStreaming = true

		// Mock say, updateClineMessage, and flushPendingToolResultsToHistory
		vi.spyOn(task, "say").mockResolvedValue(undefined)
		vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("mock prompt")

		// Calling compactContext(true) should bypass pWaitFor and succeed without throwing
		await expect(task.compactContext(true)).resolves.not.toThrow()
		// pWaitFor should NOT have been called for auto-triggered compaction
		expect(mockPWaitFor).not.toHaveBeenCalled()
	})

	it("calls pWaitFor for manual compactContext(false) when streaming", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test manual compaction wait",
			startTask: false,
			enableCheckpoints: false,
		})

		;(task as any).isStreaming = false // condition met
		vi.spyOn(task, "say").mockResolvedValue(undefined)
		vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("mock prompt")

		await task.compactContext(false)
		expect(mockPWaitFor).toHaveBeenCalledWith(
			expect.any(Function),
			expect.objectContaining({ timeout: 60000, interval: 100 }),
		)
	})

	it("gracefully catches pWaitFor timeout during manual compactConversation with user-friendly error", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test manual conversation compaction wait",
			startTask: false,
			enableCheckpoints: false,
		})

		;(task as any).isStreaming = true // will cause mockPWaitFor to throw "Promise timed out..."
		vi.spyOn(task, "say").mockResolvedValue(undefined)
		vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)

		await expect(task.compactConversation()).rejects.toThrow(
			"Cannot compact context: active streaming or tool execution did not finish within 60 seconds",
		)
	})
})
