import * as os from "os"
import * as path from "path"
import * as crypto from "crypto"
import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Anthropic } from "@anthropic-ai/sdk"
import type { GlobalState, ProviderSettings } from "@roo-code/types"

import { Task, MAX_API_RETRIES } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
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
		readFile: vi.fn().mockImplementation((filePath: string) => {
			if (typeof filePath === "string" && filePath.includes("mcp")) {
				return Promise.resolve(JSON.stringify({ mcpServers: {} }))
			}
			return Promise.resolve("[]")
		}),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		stat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true, size: 0 }),
	}

	return {
		...actual,
		...mockFunctions,
		default: {
			...actual,
			...mockFunctions,
		},
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
	const mockTab = { label: "file.ts", isDirty: false, input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
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

vi.mock("../../../utils/storage", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	return {
		...actual,
		getTaskDirectoryPath: vi
			.fn()
			.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
		getSettingsDirectoryPath: vi
			.fn()
			.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
	}
})

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(false),
}))

function sha256(content: string): string {
	return crypto.createHash("sha256").update(content).digest("hex")
}

function mockTaskSay(task: Task) {
	vi.spyOn(task, "say").mockImplementation(async (type, text, images, partial) => {
		task.clineMessages.push({
			ts: Date.now(),
			type: "say",
			say: type,
			text: text ?? "",
			images,
			partial,
		} as any)
		return undefined
	})
}

describe("Task Long Response & Streaming Resilience", () => {
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
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.updateTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: mockApiConfig,
			autoApprovalEnabled: true,
		})
	})

	// TEST 1 (LONG NORMAL STREAM)
	it("TEST 1: handles long normal stream (50,000 chars across 50 chunks) with 1 request, 0 retries, and SHA-256 match", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "long normal stream test",
			startTask: false,
		})

		mockTaskSay(task)

		// Generate 50,000 characters of synthetic text across 50 chunks of 1,000 characters
		const chunkCount = 50
		const chunkSize = 1000
		const totalLength = chunkCount * chunkSize
		let expectedFullText = ""
		const chunks: Array<{ type: "text"; text: string }> = []

		for (let i = 0; i < chunkCount; i++) {
			const prefix = `[Chunk ${i.toString().padStart(4, "0")}] `
			const piece = prefix + "X".repeat(chunkSize - prefix.length)
			expectedFullText += piece
			chunks.push({ type: "text", text: piece })
		}
		expect(expectedFullText.length).toBe(totalLength)
		const expectedHash = sha256(expectedFullText)

		// Mock attemptApiRequest to yield these 50 chunks
		let requestCounter = 0
		async function* mockStreamGenerator() {
			requestCounter++
			for (const chunk of chunks) {
				yield chunk
			}
			yield {
				type: "usage" as const,
				inputTokens: 100,
				outputTokens: 12000,
				totalCost: 0.05,
			}
			task.markTaskCompleted()
		}

		vi.spyOn(task, "attemptApiRequest").mockImplementation(() => mockStreamGenerator() as any)

		await task.recursivelyMakeClineRequests([{ type: "text", text: "Please generate big report" }])

		// Invariant checks:
		// Exactly 1 API request executed, 0 retries
		expect(requestCounter).toBe(1)

		// Assistant message collected in assistantMessageContent
		const textBlocks = task.assistantMessageContent.filter((b) => b.type === "text")
		expect(textBlocks.length).toBeGreaterThan(0)
		const accumulatedText = textBlocks.map((b) => (b as any).content).join("")

		expect(accumulatedText.length).toBe(totalLength)
		expect(sha256(accumulatedText)).toBe(expectedHash)

		// Check conversation history contains the full message without truncation
		const lastAssistantMsg = task.apiConversationHistory.find((m) => m.role === "assistant")
		expect(lastAssistantMsg).toBeDefined()
		const historyTextBlocks = (lastAssistantMsg?.content as Array<Anthropic.TextBlockParam>).filter(
			(b) => b.type === "text",
		)
		const historyText = historyTextBlocks.map((b) => b.text).join("")
		expect(sha256(historyText)).toBe(expectedHash)
	})

	// TEST 2 (LONG attempt_completion TOOL CALL)
	it("TEST 2: streams long attempt_completion tool call (50,000 chars result), matches SHA-256, completes task and terminates loop", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "long attempt_completion test",
			startTask: false,
		})

		mockTaskSay(task)
		vi.spyOn(task, "emitFinalTokenUsageUpdate").mockImplementation(() => {})
		vi.spyOn(task, "emit").mockReturnValue(true as any)

		// 50,000 chars result payload
		const largeResultPayload = "A".repeat(50000)
		const expectedHash = sha256(largeResultPayload)

		// Simulate NativeToolCallParser streaming accumulation across incremental JSON chunks
		const toolId = "call_attempt_comp_long_123"
		const jsonFull = JSON.stringify({ result: largeResultPayload })
		const chunkSize = 1000
		const jsonChunks: string[] = []
		for (let i = 0; i < jsonFull.length; i += chunkSize) {
			jsonChunks.push(jsonFull.slice(i, i + chunkSize))
		}

		// 1. Parser verification: startStreamingToolCall -> processStreamingChunk -> finalizeStreamingToolCall
		NativeToolCallParser.clearRawChunkState()
		NativeToolCallParser.startStreamingToolCall(toolId, "attempt_completion")
		for (const delta of jsonChunks) {
			NativeToolCallParser.processStreamingChunk(toolId, delta)
		}
		const finalizedToolUse = NativeToolCallParser.finalizeStreamingToolCall(toolId)

		const compToolUse = finalizedToolUse as any
		expect(compToolUse).toBeDefined()
		expect(compToolUse?.name).toBe("attempt_completion")
		expect(compToolUse?.nativeArgs?.result).toBeDefined()
		expect(compToolUse?.nativeArgs?.result.length).toBe(50000)
		expect(sha256(compToolUse?.nativeArgs?.result)).toBe(expectedHash)

		// 2. Execution through AttemptCompletionTool
		let pushToolResultCalledWith: any = null
		const mockPushToolResult = vi.fn((res) => {
			pushToolResultCalledWith = res
			task.userMessageContent.push({
				type: "tool_result",
				tool_use_id: toolId,
				content: res,
			})
		})

		// User accepts completion
		vi.spyOn(task, "ask").mockResolvedValue({ response: "yesButtonClicked" })
		const flushSpy = vi.spyOn(task, "flushPendingToolResultsToHistory")

		await attemptCompletionTool.handle(
			task,
			{
				type: "tool_use",
				name: "attempt_completion",
				params: compToolUse?.params ?? {},
				nativeArgs: compToolUse?.nativeArgs,
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

		// Verifications:
		expect(task.isTaskCompleted).toBe(true)
		expect(mockPushToolResult).toHaveBeenCalled()
		expect(pushToolResultCalledWith).toContain("Task completed successfully.")
		expect(flushSpy).toHaveBeenCalled()

		// 3. Verify task loop termination: NO subsequent requests can be initiated
		const apiSpy = vi.spyOn(task, "attemptApiRequest")
		const loopResult = await task.recursivelyMakeClineRequests([{ type: "text", text: "more" }])
		expect(loopResult).toBe(true) // Immediately returns true
		expect(apiSpy).not.toHaveBeenCalled()
	})

	// TEST 3 (finish_reason = "length")
	it("TEST 3: handles finish_reason = 'length' gracefully without treating as network timeout or triggering blind retry", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "finish_reason length test",
			startTask: false,
		})

		mockTaskSay(task)

		const partialText = "This is a partial response cut off by max tokens limit..."
		let apiCallCount = 0

		async function* mockStreamGenerator() {
			apiCallCount++
			yield { type: "text" as const, text: partialText }
			yield {
				type: "usage" as const,
				inputTokens: 50,
				outputTokens: 4096,
				totalCost: 0.02,
				// finish_reason is length/max_tokens
				finish_reason: "length",
			} as any
			task.markTaskCompleted()
		}

		vi.spyOn(task, "attemptApiRequest").mockImplementation(() => mockStreamGenerator() as any)

		await task.recursivelyMakeClineRequests([{ type: "text", text: "Generate huge output" }])

		// Exactly 1 API call - no blind retry / loop
		expect(apiCallCount).toBe(1)

		// Partial text is preserved
		const textBlocks = task.assistantMessageContent.filter((b) => b.type === "text")
		expect(textBlocks.length).toBeGreaterThan(0)
		expect((textBlocks[0] as any).content).toBe(partialText)

		// Conversation history preserved
		const assistantMsg = task.apiConversationHistory.find((m) => m.role === "assistant")
		expect(assistantMsg).toBeDefined()
	})

	// TEST 4 (STREAM CONNECTION DROP / RETRY BOUNDS)
	it("TEST 4: bounds mid-stream connection drop retries to MAX_API_RETRIES and enters controlled state without infinite loop", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "stream connection drop test",
			startTask: false,
		})

		mockTaskSay(task)
		vi.spyOn(task as any, "backoffAndAnnounce").mockResolvedValue(undefined)

		let streamAttempts = 0
		async function* mockFailingStreamGenerator() {
			streamAttempts++
			// Yield 2 chunks before connection drops mid-stream
			yield { type: "text" as const, text: "Beginning of stream..." }
			yield { type: "text" as const, text: " continuation before drop..." }
			throw new Error("Connection reset by peer: ECONNRESET")
		}

		vi.spyOn(task, "attemptApiRequest").mockImplementation(() => mockFailingStreamGenerator() as any)

		let askedQuestion: string | undefined
		vi.spyOn(task, "ask").mockImplementation(async (type, text) => {
			askedQuestion = type
			// User clicks cancel after max retries exceeded
			return { response: "noButtonClicked" }
		})

		// Run request loop
		await task.recursivelyMakeClineRequests([{ type: "text", text: "Fetch something" }])

		// Must retry up to MAX_API_RETRIES (initial + retries = MAX_API_RETRIES + 1 total attempts)
		expect(streamAttempts).toBe(MAX_API_RETRIES + 1)

		// When attempts exhausted, asks user instead of looping forever
		expect(askedQuestion).toBe("api_req_failed")

		// Task enters aborted state
		expect(task.abortReason).toBe("streaming_failed")
	})

	// LOOP GUARD INVARIANT TEST
	it("LOOP GUARD: absolute invariant that when isTaskCompleted is true, ZERO Worker API requests can be initiated", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: mockApiConfig,
			task: "loop guard invariant test",
			startTask: false,
		})

		mockTaskSay(task)
		const apiSpy = vi.spyOn(task.api, "createMessage")

		// Mark task as completed
		task.markTaskCompleted()
		expect(task.isTaskCompleted).toBe(true)

		// 1. attemptApiRequest yields nothing
		const chunks: any[] = []
		for await (const chunk of task.attemptApiRequest(0)) {
			chunks.push(chunk)
		}
		expect(chunks.length).toBe(0)
		expect(apiSpy).not.toHaveBeenCalled()

		// 2. recursivelyMakeClineRequests immediately returns true
		const recursiveResult = await task.recursivelyMakeClineRequests([{ type: "text", text: "should not run" }])
		expect(recursiveResult).toBe(true)
		expect(apiSpy).not.toHaveBeenCalled()

		// 3. initiateTaskLoop immediately breaks
		const reqSpy = vi.spyOn(task, "recursivelyMakeClineRequests")
		await (task as any).initiateTaskLoop([{ type: "text", text: "should not run" }])
		expect(reqSpy).not.toHaveBeenCalled()
		expect(apiSpy).not.toHaveBeenCalled()
	})
})
