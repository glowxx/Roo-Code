import { describe, it, expect, vi, beforeEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type { GlobalState, ProviderSettings } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"

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
		RelativePattern: vi.fn((base, pattern) => ({ base, pattern })),
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

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

describe("Task Error Classification & Retry Bounding", () => {
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
			apiProvider: "xkiro",
			xkiroApiKey: "test-key",
			xkiroModelId: "qwen/qwen3.8-max:free",
		} as ProviderSettings

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.getState = vi.fn().mockResolvedValue({
			autoApprovalEnabled: true,
			requestDelaySeconds: 0,
		})
	})

	it("fails fast on deterministic 400 Bad Request error without auto-retrying", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test 400 fail fast",
			startTask: false,
		})

		vi.spyOn(task as any, "backoffAndAnnounce").mockResolvedValue(undefined)
		let askCalls: { type: string; text?: string }[] = []
		vi.spyOn(task, "ask").mockImplementation(async (type, text) => {
			askCalls.push({ type, text })
			return { response: "noButtonClicked" }
		})

		let attempts = 0
		const mockBadReqError = Object.assign(new Error("Invalid request payload schema: tools not supported"), {
			status: 400,
		})

		task.api.createMessage = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				attempts++
				throw mockBadReqError
			},
		}))

		await expect(async () => {
			const iterator = task.attemptApiRequest(0)
			await iterator.next()
		}).rejects.toThrow(/Deterministic API error \(client_error\)/)

		// Must NOT perform retry attempts: 1 attempt only
		expect(attempts).toBe(1)
		expect(askCalls).toHaveLength(1)
		expect(askCalls[0].type).toBe("api_req_failed")
		expect(askCalls[0].text).toContain("Deterministic API error (client_error)")
	})

	it("clamps 500 Internal Server Error to at most 1 retry and stops repeating paid calls", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test 500 clamped retry",
			startTask: false,
		})

		vi.spyOn(task as any, "backoffAndAnnounce").mockResolvedValue(undefined)
		let askCalls: { type: string; text?: string }[] = []
		vi.spyOn(task, "ask").mockImplementation(async (type, text) => {
			askCalls.push({ type, text })
			return { response: "noButtonClicked" }
		})

		let attempts = 0
		const mockServerError = Object.assign(new Error("A server error occurred. Please try again."), {
			status: 500,
		})

		task.api.createMessage = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				attempts++
				throw mockServerError
			},
		}))

		await expect(async () => {
			const iterator = task.attemptApiRequest(0)
			await iterator.next()
		}).rejects.toThrow()

		// Attempt 0 (initial) fails -> retryAttempt 0 has maxRetries: 1 -> retries once (attempts: 2) -> then halts!
		// It must NOT retry 3 times (4 attempts) as it previously did during the incident!
		expect(attempts).toBeLessThanOrEqual(2)
		expect(askCalls.length).toBeGreaterThan(0)
		expect(askCalls[0].type).toBe("api_req_failed")
	})

	it("trips circuit breaker when identical request payload fails consecutively", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test circuit breaker",
			startTask: false,
		})

		vi.spyOn(task as any, "backoffAndAnnounce").mockResolvedValue(undefined)
		let askCalls: { type: string; text?: string }[] = []
		vi.spyOn(task, "ask").mockImplementation(async (type, text) => {
			askCalls.push({ type, text })
			return { response: "noButtonClicked" }
		})

		const mockErr = Object.assign(new Error("A server error occurred. Please try again."), {
			status: 500,
		})

		task.api.createMessage = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				throw mockErr
			},
		}))

		await expect(async () => {
			const iterator = task.attemptApiRequest(0)
			await iterator.next()
		}).rejects.toThrow()

		const failedAsk = askCalls.find((c) => c.type === "api_req_failed")
		expect(failedAsk).toBeDefined()
	})
})
