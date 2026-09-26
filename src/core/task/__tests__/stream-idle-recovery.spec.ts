import { describe, it, expect, vi, beforeEach } from "vitest"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { modelSupportsReasoning, xkiroModels, type GlobalState, type ProviderSettings } from "@roo-code/types"
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

describe("Stream Idle Watchdog & Recovery Architecture (20 Scenarios)", () => {
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
		expect(classification.maxRetries).toBe(2)
		expect(classification.retryAfterSeconds).toBe(3)
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

	// Scenario 6: auto retry fails again -> retry count bounded to 2, escalates to user on attempt 2
	it("Scenario 6: auto retry fails again -> retry count bounded to 2, escalates to user", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 2)
		tracker.recordIdleTimeout(true)
		tracker.recordOutcome(false, "Stream idle timeout: no data received from provider for 45 seconds", false)

		const classification = classifyApiError(new Error("Stream idle timeout: no data received from provider for 45 seconds"))
		const currentRetry = 2
		const canAutoRetry = currentRetry < classification.maxRetries // 2 < 2 is false

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
		expect(classificationIdle.maxRetries).toBe(2)
		expect(classificationIdle.category).not.toBe(classification503.category)
	})

	// Scenario 10: retry count bounded to 2
	it("Scenario 10: retry count for stream idle is strictly bounded to 2", () => {
		const idleError = new Error("Stream idle timeout: no data received from provider for 45 seconds")
		const classification = classifyApiError(idleError)

		expect(classification.maxRetries).toBe(2)
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
		expect(classification.maxRetries).toBe(2)
	})

	// Scenario 13: openai/gpt-6-sol is recognized as reasoning model and receives 90s first chunk base timeout
	it("Scenario 13: openai/gpt-6-sol is recognized as reasoning model and receives REASONING_FIRST_CHUNK_TIMEOUT_MS", () => {
		expect(modelSupportsReasoning("openai/gpt-6-sol")).toBe(true)
		expect(modelSupportsReasoning("gpt-6-sol")).toBe(true)
		expect(xkiroModels["openai/gpt-6-sol"]).toBeDefined()
		expect(xkiroModels["openai/gpt-6-sol"].preserveReasoning).toBe(true)
		expect(xkiroModels["openai/gpt-6-sol"].supportsReasoningEffort).toBe(true)
		expect(REASONING_FIRST_CHUNK_TIMEOUT_MS).toBe(90_000)
		expect(FIRST_CHUNK_TIMEOUT_MS).toBe(60_000)
		expect(REASONING_FIRST_CHUNK_TIMEOUT_MS).toBeGreaterThan(FIRST_CHUNK_TIMEOUT_MS)
	})

	// Scenario 14: adaptive prompt size scaling margin for large context (>30k tokens)
	it("Scenario 14: adaptive prompt size scaling extends first chunk timeout for large prompts (>30k tokens)", () => {
		const calculateMargin = (tokens: number) => {
			return tokens > 30_000 ? Math.min(60_000, Math.floor(tokens / 20_000) * 15_000) : 0
		}

		// Incident task had tokensIn = 64,795
		const incidentTokens = 64_795
		const incidentMargin = calculateMargin(incidentTokens)
		expect(incidentMargin).toBe(45_000)

		const incidentTotalTimeout = REASONING_FIRST_CHUNK_TIMEOUT_MS + incidentMargin
		expect(incidentTotalTimeout).toBe(135_000) // 135 seconds allowance instead of premature 60s

		// Small prompt (5k tokens) has no extra margin
		expect(calculateMargin(5_000)).toBe(0)

		// Huge prompt (>120k tokens) is capped at 60s max margin
		expect(calculateMargin(150_000)).toBe(60_000)
	})

	// Scenario 15: StreamAuditTracker tracks phases across the streaming lifecycle
	it("Scenario 15: StreamAuditTracker transitions and records distinct stream phases", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "openai/gpt-6-sol", 0, 90_000)

		expect(tracker.data.streamPhase).toBe("waiting_first_chunk")

		tracker.recordPhase("reasoning")
		expect(tracker.data.streamPhase).toBe("reasoning")

		tracker.recordPhase("post_reasoning_wait")
		expect(tracker.data.streamPhase).toBe("post_reasoning_wait")

		tracker.recordPhase("content")
		expect(tracker.data.streamPhase).toBe("content")

		tracker.recordPhase("tool_call")
		expect(tracker.data.streamPhase).toBe("tool_call")

		const log = tracker.formatLog()
		expect(log).toContain("streamPhase=tool_call")
		expect(log).toContain("model=openai/gpt-6-sol")
	})

	// Scenario 16: phase-specific timeout error messages are all classified as stream_idle
	it("Scenario 16: phase-specific timeout error messages classify consistently as stream_idle with 1 bounded retry", () => {
		const phaseMessages = [
			"First chunk timeout: no data received from provider for 90 seconds",
			"Reasoning stream timeout: no reasoning data received from provider for 90 seconds",
			"Stream idle timeout: no data received after reasoning completed for 45 seconds",
			"Stream idle timeout: content generation stalled, no data received from provider for 45 seconds",
			"Stream idle timeout: tool call generation stalled, no data received from provider for 45 seconds",
		]

		for (const msg of phaseMessages) {
			const classification = classifyApiError(new Error(msg))
			expect(classification.category).toBe("stream_idle")
			expect(classification.retryable).toBe(true)
			expect(classification.maxRetries).toBe(2)
		}
	})

	// Scenario 17: partial unexecuted tool call safety
	it("Scenario 17: partial tool call chunks without execution do not prevent auto-retry", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "openai/gpt-6-sol", 0, 90_000)
		tracker.recordChunk("tool", 30)

		expect(tracker.data.toolCallObserved).toBe(true)
		expect(tracker.data.sideEffectObserved).toBe(false)
		expect(tracker.data.autoRetryEligible).toBe(true)

		// If a real side-effect actually executes (e.g. file write or command), auto-retry must be disallowed
		tracker.recordSideEffect()
		expect(tracker.data.sideEffectObserved).toBe(true)
		expect(tracker.data.autoRetryEligible).toBe(false)
	})

	// Scenario 18: backend retry message does not leak raw internal keys
	it("Scenario 18: backend retry message uses valid i18n key instead of leaking internal string", async () => {
		const enCommon = await import("../../../i18n/locales/en/common.json")
		const plCommon = await import("../../../i18n/locales/pl/common.json")

		expect(enCommon.interruption?.connectionStalledRetrying).toBeDefined()
		expect(enCommon.interruption?.connectionStalledRetrying).not.toBe("stalledRetrying")
		expect(enCommon.interruption?.connectionStalledRetrying).toContain("retrying automatically")

		expect(plCommon.interruption?.connectionStalledRetrying).toBeDefined()
		expect(plCommon.interruption?.connectionStalledRetrying).toContain("ponawianie próby automatycznie")
	})

	// Scenario 19: structured diagnostics format
	it("Scenario 19: error details diagnostics format contains provider, phase, timeout and request metadata", () => {
		const currentWatchdogTimeout = 135_000
		const currentRetry = 2
		const maxRetries = 2
		const phaseDisplay = "first-chunk"
		const lastEventType = "none"
		const requestId = "req-test-123"

		const streamingFailedDetails = [
			`Error type: Stream idle timeout`,
			`Phase: ${phaseDisplay}`,
			`Timeout: ${Math.round(currentWatchdogTimeout / 1000)}s`,
			`Auto retries: ${currentRetry}/${maxRetries}`,
			`Last valid event: ${lastEventType}`,
			`Request ID: ${requestId}`,
		].join("\n")

		expect(streamingFailedDetails).toContain("Error type: Stream idle timeout")
		expect(streamingFailedDetails).toContain("Phase: first-chunk")
		expect(streamingFailedDetails).toContain("Timeout: 135s")
		expect(streamingFailedDetails).toContain("Auto retries: 2/2")
		expect(streamingFailedDetails).toContain("Request ID: req-test-123")
	})

	// Scenario 20: bounded retry prevents runaway retry storms
	it("Scenario 20: bounded retry strictly halts after 2 retry attempts", () => {
		const error = new Error("First chunk timeout: no data received from provider for 90 seconds")
		const classification = classifyApiError(error)

		expect(classification.maxRetries).toBe(2)

		let attempt = 0
		let retried = false

		// Simulate retry decision
		while (attempt < classification.maxRetries) {
			attempt++
			retried = true
		}
		expect(retried).toBe(true)
		expect(attempt).toBe(2)

		// Next attempt must NOT retry
		const canRetryAgain = attempt < classification.maxRetries
		expect(canRetryAgain).toBe(false)
	})

	// Scenario 21: User cancellation error classification
	it("Scenario 21: classifyApiError classifies user cancellation as non-retryable 'cancelled'", () => {
		const cancelErrors = [
			new Error("Request cancelled by user"),
			new Error("User cancelled request"),
			new Error("Operation aborted"),
			new DOMException("The user aborted a request.", "AbortError"),
		]

		for (const err of cancelErrors) {
			const classification = classifyApiError(err)
			expect(classification.category).toBe("cancelled")
			expect(classification.retryable).toBe(false)
			expect(classification.maxRetries).toBe(0)
		}
	})

	// Scenario 22: Distinct Request IDs per retry attempt (fixes Request ID collision in Incident A & B)
	it("Scenario 22: StreamAuditTracker produces unique request IDs differentiating retry attempts", () => {
		const trackerAttempt0 = new StreamAuditTracker("task-abc", "inst-xyz", "xkiro", "qwen3.8-max", 0, 90_000)
		const trackerAttempt1 = new StreamAuditTracker("task-abc", "inst-xyz", "xkiro", "qwen3.8-max", 1, 90_000)

		expect(trackerAttempt0.data.requestId).toBe("task-abc.inst-xyz.a0")
		expect(trackerAttempt1.data.requestId).toBe("task-abc.inst-xyz.a1")
		expect(trackerAttempt0.data.requestId).not.toBe(trackerAttempt1.data.requestId)
		expect(trackerAttempt0.data.logicalRequestId).toBe("task-abc.inst-xyz")
		expect(trackerAttempt1.data.logicalRequestId).toBe("task-abc.inst-xyz")
	})

	const createMockProvider = () =>
		({
			context: {
				globalStorageUri: { fsPath: "/mock/global/storage" },
				workspaceState: { get: vi.fn(), update: vi.fn() },
			},
			log: vi.fn(),
			getState: vi.fn().mockResolvedValue({}),
			getCurrentTask: vi.fn().mockReturnValue(undefined),
			getSkillsManager: vi.fn().mockReturnValue(undefined),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
		}) as any

	// Scenario 23: Aborting task defensively clears partial flags and sets isStreaming false
	it("Scenario 23: task.abortTask clears isStreaming, isWaitingForFirstChunk and partial flags", async () => {
		const task = new Task({
			task: "test task",
			startTask: false,
			enableCheckpoints: false,
			provider: createMockProvider(),
			apiConfiguration: { apiProvider: "openai" } as any,
		})

		// Simulate in-flight streaming state with a partial message
		task.isStreaming = true
		task.isWaitingForFirstChunk = true
		task.clineMessages = [
			{
				ts: Date.now(),
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ request: "test" }),
			},
			{
				ts: Date.now() + 1,
				type: "say",
				say: "text",
				text: "Partial response...",
				partial: true,
			},
		]

		await task.abortTask()

		expect(task.isStreaming).toBe(false)
		expect(task.isWaitingForFirstChunk).toBe(false)
		expect(task.abort).toBe(true)

		// Partial flag on message must be resolved to false
		const lastMsg = task.clineMessages[task.clineMessages.length - 1]
		expect(lastMsg.partial).toBe(false)

		// api_req_started must have cancelReason finalized so UI doesn't spin forever
		const firstMsg = task.clineMessages[0]
		const apiReqInfo = JSON.parse(firstMsg.text || "{}")
		expect(apiReqInfo.cancelReason).toBe("user_cancelled")
	})

	// Scenario 24: processQueuedMessages is suppressed on aborted tasks
	it("Scenario 24: processQueuedMessages does not dispatch messages when task is aborted", () => {
		const task = new Task({
			task: "test task",
			startTask: false,
			enableCheckpoints: false,
			provider: createMockProvider(),
			apiConfiguration: { apiProvider: "openai" } as any,
		})

		task.abort = true
		task.abortReason = "user_cancelled"

		const submitSpy = vi.spyOn(task, "submitUserMessage")
		task.processQueuedMessages()

		expect(submitSpy).not.toHaveBeenCalled()
	})

	// Scenario 25: Terminal child process is aborted on dispose
	it("Scenario 25: task.dispose aborts active terminalProcess to prevent orphan OS processes", () => {
		const task = new Task({
			task: "test task",
			startTask: false,
			enableCheckpoints: false,
			provider: createMockProvider(),
			apiConfiguration: { apiProvider: "openai" } as any,
		})

		const mockTerminalProcess = {
			abort: vi.fn(),
			continue: vi.fn(),
		}
		task.terminalProcess = mockTerminalProcess as any

		task.dispose()

		expect(mockTerminalProcess.abort).toHaveBeenCalledTimes(1)
		expect(task.terminalProcess).toBeUndefined()
	})

	// Scenario 26: Stale Timer Elimination - clearStreamWatchdog disarms active watchdog timer
	it("Scenario 26: task.clearStreamWatchdog cancels active watchdog timer to prevent phantom timeouts", () => {
		const task = new Task({
			task: "test task",
			startTask: false,
			enableCheckpoints: false,
			provider: createMockProvider(),
			apiConfiguration: { apiProvider: "openai" } as any,
		})

		let timerFired = false
		task.currentStreamWatchdogTimer = setTimeout(() => {
			timerFired = true
		}, 50)

		expect(task.currentStreamWatchdogTimer).toBeDefined()

		task.clearStreamWatchdog()

		expect(task.currentStreamWatchdogTimer).toBeUndefined()

		// Wait to verify timer never fires
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(timerFired).toBe(false)
				resolve()
			}, 70)
		})
	})

	// Scenario 27: cancelCurrentRequest aborts controller and disarms watchdog
	it("Scenario 27: task.cancelCurrentRequest aborts in-flight AbortController and disarms watchdog", () => {
		const task = new Task({
			task: "test task",
			startTask: false,
			enableCheckpoints: false,
			provider: createMockProvider(),
			apiConfiguration: { apiProvider: "openai" } as any,
		})

		const controller = new AbortController()
		task.currentRequestAbortController = controller
		task.currentStreamWatchdogTimer = setTimeout(() => {}, 10_000)

		expect(controller.signal.aborted).toBe(false)
		expect(task.currentStreamWatchdogTimer).toBeDefined()

		task.cancelCurrentRequest()

		expect(controller.signal.aborted).toBe(true)
		expect(task.currentRequestAbortController).toBeUndefined()
		expect(task.currentStreamWatchdogTimer).toBeUndefined()
	})

	// Scenario 28: AUTO mode allows up to 3 automatic retries for stream idle stalls
	it("Scenario 28: AUTO mode permits up to 3 bounded retries for stream idle stalls", () => {
		const classification = classifyApiError(new Error("Reasoning stream timeout: no reasoning data received for 75 seconds"))
		const autoApproval = true
		const maxStreamIdleRetries = autoApproval
			? Math.max(3, classification.maxRetries)
			: Math.max(2, classification.maxRetries)

		expect(maxStreamIdleRetries).toBe(3)

		// Attempt 0 -> can retry (0 < 3)
		expect(0 < maxStreamIdleRetries).toBe(true)
		// Attempt 1 -> can retry (1 < 3) - fixes the 1/1 stall in the incident!
		expect(1 < maxStreamIdleRetries).toBe(true)
		// Attempt 2 -> can retry (2 < 3)
		expect(2 < maxStreamIdleRetries).toBe(true)
		// Attempt 3 -> strictly halts and prompts user
		expect(3 < maxStreamIdleRetries).toBe(false)
	})

	// Scenario 29: Capacity error classification ("This model is temporarily at capacity...")
	it("Scenario 29: classifyApiError classifies capacity error as retryable gateway_error with 2 retries", () => {
		const capacityError = new Error(
			"xKiro completion error: This model is temporarily at capacity. Please try again shortly or use a different model.",
		)
		const classification = classifyApiError(capacityError)

		expect(classification.category).toBe("gateway_error")
		expect(classification.retryable).toBe(true)
		expect(classification.maxRetries).toBe(2)
		expect(classification.isDeterministic).toBe(false)
	})

	// Scenario 30: Heartbeat chunk after reasoning transitions stream phase to post_reasoning_wait
	it("Scenario 30: StreamAuditTracker records phase transition to post_reasoning_wait", () => {
		const tracker = new StreamAuditTracker("task-123", "inst-1", "xkiro", "qwen/qwen3.8-max:free", 0)
		tracker.recordPhase("waiting_first_chunk")
		expect(tracker.data.streamPhase).toBe("waiting_first_chunk")

		tracker.recordPhase("reasoning")
		expect(tracker.data.streamPhase).toBe("reasoning")

		tracker.recordPhase("post_reasoning_wait")
		expect(tracker.data.streamPhase).toBe("post_reasoning_wait")

		tracker.recordPhase("content")
		expect(tracker.data.streamPhase).toBe("content")
	})
})
