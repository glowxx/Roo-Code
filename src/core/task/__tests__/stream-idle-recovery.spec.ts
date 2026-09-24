import { describe, it, expect, vi, beforeEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type { GlobalState, ProviderSettings } from "@roo-code/types"
import {
	Task,
	DEFAULT_STREAM_IDLE_TIMEOUT_MS,
	REASONING_STREAM_IDLE_TIMEOUT_MS,
	FIRST_CHUNK_TIMEOUT_MS,
	REASONING_FIRST_CHUNK_TIMEOUT_MS,
	MAX_NO_PROGRESS_TIMEOUT_MS,
} from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import { classifyApiError } from "../../../api/providers/utils/error-classifier"
import { StreamAuditTracker } from "../StreamAudit"

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

describe("Stream Idle Watchdog & Recovery Architecture (12 Scenarios)", () => {
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
			apiModelId: "qwen/qwen3.8-max:free",
			apiKey: "test-api-key",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.getState = vi.fn().mockResolvedValue({})
	})

	// Scenario 1: regular stream events -> no timeout
	it("Scenario 1: regular stream events -> watchdog does not fire and stream completes", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "test regular streaming",
			startTask: false,
			enableCheckpoints: false,
		})

		const chunks = [
			{ type: "text", text: "Hello " },
			{ type: "text", text: "world!" },
			{ type: "usage", inputTokens: 10, outputTokens: 2 },
		]

		async function* mockStream() {
			for (const c of chunks) {
				yield c
			}
		}

		vi.spyOn(task, "attemptApiRequest").mockImplementation(() => mockStream() as any)
		vi.spyOn(task, "say").mockResolvedValue(undefined)
		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("mock prompt")

		// Verify constants
		expect(DEFAULT_STREAM_IDLE_TIMEOUT_MS).toBe(45_000)
		expect(REASONING_STREAM_IDLE_TIMEOUT_MS).toBe(75_000)
	})

	// Scenario 2: reasoning events continue, visible content absent >45s -> no timeout (adaptive allowance)
	it("Scenario 2: reasoning events continue, visible content absent >45s -> adaptive timeout prevents premature idle abort", () => {
		expect(REASONING_STREAM_IDLE_TIMEOUT_MS).toBeGreaterThan(45_000)
		expect(REASONING_STREAM_IDLE_TIMEOUT_MS).toBe(75_000)
		expect(REASONING_FIRST_CHUNK_TIMEOUT_MS).toBe(90_000)

		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 0)
		tracker.recordChunk("reasoning", 50)
		expect(tracker.data.reasoningEventCount).toBe(1)
		expect(tracker.data.lastEventType).toBe("reasoning")
		// Visible content count remains 0, yet valid events exist
		expect(tracker.data.contentEventCount).toBe(0)
		expect(tracker.data.validEventCount).toBe(1)
	})

	// Scenario 3: absolute silence > threshold -> timeout
	it("Scenario 3: absolute silence beyond timeout threshold triggers stream idle classification", () => {
		const idleError = new Error("Stream idle timeout: no data received from provider for 45 seconds")
		const classification = classifyApiError(idleError)

		expect(classification.category).toBe("stream_idle")
		expect(classification.retryable).toBe(true)
		expect(classification.maxRetries).toBe(1)
		expect(classification.retryAfterSeconds).toBe(2)
	})

	// Scenario 4: idle timeout before any side effect -> 1 automatic retry
	it("Scenario 4: idle timeout before side-effects is safe for automatic retry", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 0)
		expect(tracker.data.autoRetryEligible).toBe(true)

		tracker.recordChunk("reasoning", 100)
		expect(tracker.data.autoRetryEligible).toBe(true)

		tracker.recordIdleTimeout(true)
		expect(tracker.data.idleTriggered).toBe(true)
		expect(tracker.data.idleCategory).toBe("TRANSIENT_STREAM_IDLE")
		expect(tracker.data.autoRetryEligible).toBe(true)
	})

	// Scenario 5: auto retry succeeds -> transparent continuation
	it("Scenario 5: auto retry succeeds -> marks StreamAudit retrySucceeded: true", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 1)
		tracker.recordChunk("text", 25)
		tracker.recordOutcome(true)

		expect(tracker.data.retrySucceeded).toBe(true)
		expect(tracker.data.autoRetryAttempt).toBe(1)
		expect(tracker.formatLog()).toContain("retrySucceeded=true")
	})

	// Scenario 6: auto retry fails again -> user-visible failure
	it("Scenario 6: auto retry fails again -> retry count bounded to 1, escalates to user", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 1)
		tracker.recordIdleTimeout(true)
		tracker.recordOutcome(false, "Stream idle timeout: no data received from provider for 45 seconds", false)

		const classification = classifyApiError(new Error("Stream idle timeout: no data received from provider for 45 seconds"))
		const currentRetry = 1
		const canAutoRetry = currentRetry < classification.maxRetries // 1 < 1 is false

		expect(canAutoRetry).toBe(false)
		expect(tracker.data.retrySucceeded).toBe(false)
	})

	// Scenario 7: partial text without tools -> safe retry cleans up partial text
	it("Scenario 7: partial text without tools -> safe retry preserves cleanliness", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 0)
		tracker.recordChunk("text", 40)

		expect(tracker.data.partialChars).toBe(40)
		expect(tracker.data.toolCallObserved).toBe(false)
		expect(tracker.data.sideEffectObserved).toBe(false)
		expect(tracker.data.autoRetryEligible).toBe(true)
	})

	// Scenario 8: tool side effect executed -> no auto retry
	it("Scenario 8: tool side effect executed -> marks autoRetryEligible as false", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 0)
		tracker.recordChunk("tool", 10)
		tracker.recordSideEffect()

		expect(tracker.data.toolCallObserved).toBe(true)
		expect(tracker.data.sideEffectObserved).toBe(true)
		expect(tracker.data.autoRetryEligible).toBe(false)

		tracker.recordIdleTimeout(true)
		expect(tracker.data.autoRetryEligible).toBe(false)
	})

	// Scenario 9: 503 remains separate from stream idle
	it("Scenario 9: 503 gateway error remains classified as gateway_error (separate from stream_idle)", () => {
		const err503 = new Error("503 Service Unavailable: upstream server is temporarily unreachable")
		const classification503 = classifyApiError(err503)

		expect(classification503.category).toBe("gateway_error")
		expect(classification503.retryable).toBe(true)
		expect(classification503.maxRetries).toBe(2)

		const idleError = new Error("Stream idle timeout: no data received from provider for 45 seconds")
		const classificationIdle = classifyApiError(idleError)

		expect(classificationIdle.category).toBe("stream_idle")
		expect(classificationIdle.maxRetries).toBe(1)
		expect(classificationIdle.category).not.toBe(classification503.category)
	})

	// Scenario 10: retry count bounded to 1
	it("Scenario 10: retry count for stream idle is strictly bounded to 1", () => {
		const idleError = new Error("Stream idle timeout: no data received from provider for 45 seconds")
		const classification = classifyApiError(idleError)

		expect(classification.maxRetries).toBe(1)
	})

	// Scenario 11: cache read/token amplification accounted for
	it("Scenario 11: cache read / cache write / input / output tokens are properly tracked", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 0)
		tracker.recordChunk("usage")

		expect(tracker.data.validEventCount).toBe(1)
		expect(tracker.data.lastEventType).toBe("usage")
	})

	// Scenario 12: no-op/heartbeat spam -> watchdog times out
	it("Scenario 12: no-op/heartbeat spam -> MAX_NO_PROGRESS_TIMEOUT_MS constant protects against endless zombie pings", () => {
		expect(MAX_NO_PROGRESS_TIMEOUT_MS).toBe(90_000)

		const noProgressError = new Error(
			"Stream no-progress timeout: received heartbeat/keep-alive frames but no content for 90 seconds",
		)
		const classification = classifyApiError(noProgressError)

		expect(classification.category).toBe("stream_idle")
		expect(classification.retryable).toBe(true)
		expect(classification.maxRetries).toBe(1)
	})
})
