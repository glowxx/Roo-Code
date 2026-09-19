import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"

import type { GlobalState, ProviderSettings } from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import * as ContextCompactorModule from "../../context/ContextCompactor"

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
	return { mockPWaitFor: vi.fn().mockImplementation(async (condition: () => boolean) => {
		if (!condition()) {
			throw new Error("Condition not met")
		}
		return Promise.resolve()
	}) }
})

vi.mock("p-wait-for", () => ({
	default: mockPWaitFor,
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }

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
			visibleTextEditors: [],
			tabGroups: {
				all: [],
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
			onDidChangeWorkspaceFolders: vi.fn(() => mockDisposable),
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

describe("Task compactConversation", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: any
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		vi.restoreAllMocks()

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

	it("executes context compaction successfully and notifies webview", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "Initial user task",
			startTask: false,
		})

		const mockNewHistory = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Initial user task" },
					{ type: "text", text: "[Context Compacted Summary]\n\nSummary of work" },
				],
				ts: 1,
				isSummary: true,
			},
			{ role: "assistant", content: [{ type: "text", text: "Recent reply" }], ts: 3 },
		]

		vi.spyOn(ContextCompactorModule, "compactHistory").mockResolvedValue({
			newHistory: mockNewHistory as any,
			summary: "Summary of work",
			previousTokens: 1000,
			newTokens: 300,
			cost: 0.01,
		})

		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("mock system prompt")
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory").mockResolvedValue(undefined)
		const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined as any)
		const flushSpy = vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)

		const result = await task.compactConversation("Extra focus on components")

		expect(flushSpy).toHaveBeenCalled()
		expect(ContextCompactorModule.compactHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: task.taskId,
				customInstructions: "Extra focus on components",
				abortSignal: expect.any(AbortSignal),
			}),
		)
		expect(overwriteSpy).toHaveBeenCalledWith(mockNewHistory)
		expect(saySpy).toHaveBeenCalledWith(
			"condense_context",
			undefined,
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
			expect.objectContaining({
				summary: "Summary of work",
				cost: 0.01,
				prevContextTokens: 1000,
				newContextTokens: 300,
			}),
		)

		// Check webview emissions
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "taskCompacted",
				text: task.taskId,
				payload: expect.objectContaining({
					taskId: task.taskId,
					previousTokens: 1000,
					newTokens: 300,
					savedTokens: 700,
					savedTokensPercentage: 70,
				}),
			}),
		)
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "condenseTaskContextResponse",
			text: task.taskId,
		})

		expect(result).toEqual({ previousTokens: 1000, newTokens: 300, savedTokensPercentage: 70 })
		expect((task as any).isCompacting).toBe(false)
	})

	it("guards against concurrent compaction using isCompacting lock", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "Initial user task",
			startTask: false,
		})

		// Set isCompacting to true
		;(task as any).isCompacting = true

		await expect(task.compactConversation()).rejects.toThrow(/already in progress/i)
	})

	it("resets isCompacting flag to false if compaction throws an error", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "Initial user task",
			startTask: false,
		})

		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("mock system prompt")
		vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)
		vi.spyOn(ContextCompactorModule, "compactHistory").mockRejectedValue(new Error("API exploded"))

		await expect(task.compactConversation()).rejects.toThrow("API exploded")
		expect((task as any).isCompacting).toBe(false)
	})

	it("does not overwrite history and cleans up if compaction is aborted", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "Initial user task",
			startTask: false,
		})

		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("mock system prompt")
		vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory").mockResolvedValue(undefined)

		vi.spyOn(ContextCompactorModule, "compactHistory").mockImplementation(async (opts) => {
			task.abortCompaction()
			if (opts.abortSignal?.aborted) {
				throw new Error("Context condensation was aborted.")
			}
			return {
				newHistory: [],
				summary: "Aborted summary",
				previousTokens: 500,
				newTokens: 100,
				cost: 0,
			}
		})

		await expect(task.compactConversation()).rejects.toThrow(/aborted/i)
		expect(overwriteSpy).not.toHaveBeenCalled()
		expect((task as any).isCompacting).toBe(false)
		expect((task as any).compactionAbortController).toBeUndefined()
	})

	it("does not overwrite history and notifies UI via say when output is truncated", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "Initial user task",
			startTask: false,
		})

		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("mock system prompt")
		vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true)
		const overwriteSpy = vi.spyOn(task, "overwriteApiConversationHistory").mockResolvedValue(undefined)
		const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined as any)

		vi.spyOn(ContextCompactorModule, "compactHistory").mockRejectedValue(
			new Error("Context condensation incomplete: model output was truncated (finish_reason: max_tokens)."),
		)

		await expect(task.compactConversation()).rejects.toThrow(/truncated/i)
		expect(overwriteSpy).not.toHaveBeenCalled()
		expect(saySpy).toHaveBeenCalledWith(
			"condense_context_error",
			expect.stringContaining("truncated"),
			undefined,
			false,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
		expect((task as any).isCompacting).toBe(false)
	})
})
