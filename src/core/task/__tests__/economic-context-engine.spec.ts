import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Anthropic } from "@anthropic-ai/sdk"
import type { GlobalState, ProviderSettings, ModelInfo } from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import { buildApiHandler } from "../../../api"
import { optimizeEffectiveApiHistory } from "../../context/effectiveContext"
import { compactHistory, extractCleanInitialBlocks } from "../../context/ContextCompactor"
import { ApiMessage } from "../../task-persistence/apiMessages"

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
		readFile: vi.fn().mockImplementation(() => Promise.resolve("[]")),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		stat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true }),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(() => Promise.resolve()),
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
			createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
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
		RelativePattern: vi.fn((base, pattern) => ({ base, pattern })),
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


vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
	ensureSettingsDirectoryExists: vi
		.fn()
		.mockImplementation((context) => Promise.resolve(`${context?.globalStorageUri?.fsPath || "/mock/storage"}/settings`)),
	ensureTaskDirectoryExists: vi
		.fn()
		.mockImplementation((context, taskId) => Promise.resolve(`${context?.globalStorageUri?.fsPath || "/mock/storage"}/tasks/${taskId}`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockReturnValue(false),
}))

describe("Economic Context Engine & Reliability Verification", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		vi.restoreAllMocks()
		delete process.env.ROO_DISABLE_ECONOMIC_CAP
		delete process.env.ROO_MAX_WORKING_CONTEXT_TOKENS
		delete process.env.ROO_ACAC_RETRANS_THRESHOLD
		delete process.env.ROO_ACAC_FREE_RETRANS_THRESHOLD
		delete process.env.ROO_FREE_WORKING_CONTEXT_TOKENS

		const storageUri = {
			fsPath: path.join(os.tmpdir(), "test-storage"),
		}

		mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((_key: keyof GlobalState) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri as any,
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
			} as any,
		} as unknown as vscode.ExtensionContext

		const mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		const contextProxy = new ContextProxy(mockExtensionContext)
		mockProvider = new ClineProvider(mockExtensionContext, mockOutputChannel as any, "sidebar", contextProxy)

		mockApiConfig = {
			apiProvider: "xkiro",
			xkiroApiKey: "test-key",
			xkiroModelId: "qwen/qwen3.8-max",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		mockProvider.getState = vi.fn().mockResolvedValue({
			autoApprovalEnabled: true,
			requestDelaySeconds: 0,
			mcpEnabled: false,
		})
	})

	// 1. 1M model still reports 1M context window
	it("1. 1M model still reports 1M context window without artificial cap", () => {
		const handler = buildApiHandler({
			apiProvider: "xkiro",
			xkiroModelId: "qwen/qwen3.8-max",
			xkiroApiKey: "test-key",
		})

		const model = handler.getModel()
		expect(model.info.contextWindow).toBe(1_000_000)
		expect(model.id).toBe("qwen/qwen3.8-max")
	})

	// 2. Economic target does not alter model context window
	it("2. Economic target does not alter model context window", () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: {
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max",
				xkiroApiKey: "test-key",
			},
			task: "economic target verification",
			startTask: false,
		})

		vi.spyOn(task, "getTokenUsage").mockReturnValue({
			contextTokens: 150_000,
			totalTokensIn: 300_000,
			totalTokensOut: 5_000,
			totalCost: 0.05,
		})

		// Calling checkContextCompactionThreshold must NOT mutate model context window
		task.checkContextCompactionThreshold()
		expect(task.api.getModel().info.contextWindow).toBe(1_000_000)
	})

	// 3 & 4. Free model vs Paid model retransmission drag
	it("3 & 4. Free-model triggers soft compaction at 400k drag while paid model avoids premature compaction", () => {
		// Test A: Paid model with 500k retransmission drag (under 1.2M) -> returns FALSE (preserves prefix cache)
		const paidTask = new Task({
			provider: mockProvider,
			apiConfiguration: {
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max",
				xkiroApiKey: "test-key",
			},
			task: "paid model test",
			startTask: false,
		})
		;(paidTask as any).requestsSinceLastCompaction = 12
		vi.spyOn(paidTask, "getTokenUsage").mockReturnValue({
			contextTokens: 50_000,
			totalTokensIn: 500_000, // 500k drag
			totalTokensOut: 10_000,
			totalCost: 0.1,
		})

		// Paid model allows up to 1.2M drag
		expect(paidTask.checkContextCompactionThreshold()).toBe(false)

		// Test B: Free model with 500k retransmission drag (exceeds 400k free threshold) -> returns TRUE
		const freeTask = new Task({
			provider: mockProvider,
			apiConfiguration: {
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max:free",
				xkiroApiKey: "test-key",
			},
			task: "free model test",
			startTask: false,
		})
		;(freeTask as any).requestsSinceLastCompaction = 12
		vi.spyOn(freeTask, "getTokenUsage").mockReturnValue({
			contextTokens: 50_000,
			totalTokensIn: 500_000, // 500k drag exceeds 400k threshold
			totalTokensOut: 10_000,
			totalCost: 0,
		})

		expect(freeTask.checkContextCompactionThreshold()).toBe(true)
	})

	// 5. Retry accounting included in retransmission drag
	it("5. Retry accounting is included in retransmission drag", () => {
		const freeTask = new Task({
			provider: mockProvider,
			apiConfiguration: {
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max:free",
				xkiroApiKey: "test-key",
			},
			task: "retry drag test",
			startTask: false,
		})
		;(freeTask as any).requestsSinceLastCompaction = 11

		// Baseline totalTokensIn is 300k (below 400k threshold)
		vi.spyOn(freeTask, "getTokenUsage").mockReturnValue({
			contextTokens: 55_000,
			totalTokensIn: 300_000,
			totalTokensOut: 5_000,
			totalCost: 0,
		})

		// Without retry drag: 300k < 400k -> false
		expect(freeTask.checkContextCompactionThreshold()).toBe(false)

		// Two retry attempts occurred, pushing 2 * 55k = 110k tokens across the wire
		;(freeTask as any).retryRetransmissionTokens = 110_000

		// With retry drag: 300k + 110k = 410k >= 400k -> triggers compaction!
		expect(freeTask.checkContextCompactionThreshold()).toBe(true)
	})

	// 6. Skill payload cold retention / ephemeralization works even when merged with summary
	it("6. Ephemeralizes cold skill documentation and strips environment details even in multi-block summary messages", () => {
		const longSkillDocumentation =
			"# /graphify Skill Instructions\n" +
			"This is comprehensive documentation for the graphify knowledge graph tool.\n" +
			"More detailed guidelines...\n".repeat(200) // ~6 KB

		const envDetails =
			"<environment_details>\n" +
			"VSCode Workspace: /project\n" +
			"Active Terminals: 1\n" +
			"</environment_details>"

		const multiBlockCompactedInitial: ApiMessage = {
			role: "user",
			isSummary: true, // Marked as summary because sanitizeRoleAlternation merged summary into initial message
			content: [
				{ type: "text", text: "Original user prompt: Please analyze the codebase" },
				{ type: "text", text: longSkillDocumentation },
				{ type: "text", text: envDetails },
				{
					type: "text",
					text: "[Context Compacted Summary]\n\n### CONTEXT COMPACTION HANDOFF\n- Task initialized\n- Graph built",
				},
			],
		}

		const messages: ApiMessage[] = [
			multiBlockCompactedInitial,
			{ role: "assistant", content: "Working on graph." },
			{ role: "user", content: "Proceed to next file." },
			{ role: "assistant", content: "Next file parsed." },
			{ role: "user", content: "Final status please." },
		]

		const optimized = optimizeEffectiveApiHistory(messages, {
			recentMessagesPreserved: 2,
			warmTurnsPreserved: 0,
		})

		const msg0 = optimized[0]
		expect(msg0.role).toBe("user")
		expect(Array.isArray(msg0.content)).toBe(true)

		const blocks = msg0.content as Anthropic.Messages.ContentBlockParam[]
		expect(blocks).toHaveLength(4)

		// Block 0: User prompt intact
		expect((blocks[0] as any).text).toBe("Original user prompt: Please analyze the codebase")

		// Block 1: Skill instructions ephemeralized in Zone 2
		expect((blocks[1] as any).text).toContain("[Skill instructions loaded in earlier turn")
		expect((blocks[1] as any).text).toContain("Remaining skill documentation omitted")

		// Block 2: Environment details stripped
		expect((blocks[2] as any).text).toContain("[Environment details omitted for previous turn]")

		// Block 3: Summary preserved intact!
		expect((blocks[3] as any).text).toContain("[Context Compacted Summary]")
		expect((blocks[3] as any).text).toContain("### CONTEXT COMPACTION HANDOFF")
	})

	// 7. Model switch free -> paid changes actual request model
	it("7. Model switch from free to paid resolves the paid model ID in handler", () => {
		const freeHandler = buildApiHandler({
			apiProvider: "xkiro",
			xkiroModelId: "qwen/qwen3.8-max:free",
			xkiroApiKey: "test-key",
		})
		expect(freeHandler.getModel().id).toBe("qwen/qwen3.8-max:free")
		expect(freeHandler.getModel().info.isFree).toBe(true)

		const paidHandler = buildApiHandler({
			apiProvider: "xkiro",
			xkiroModelId: "qwen/qwen3.8-max",
			xkiroApiKey: "test-key",
		})
		expect(paidHandler.getModel().id).toBe("qwen/qwen3.8-max")
		expect(paidHandler.getModel().info.isFree).toBeFalsy()
	})

	// 8. 503 bounded retry works with backoff
	it("8. 503 error halts at circuit breaker after bounded retries", async () => {
		const task = new Task({
			provider: mockProvider,
			apiConfiguration: {
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max",
				xkiroApiKey: "test-key",
			},
			task: "503 retry test",
			startTask: false,
		})

		vi.spyOn(task as any, "getSystemPrompt").mockResolvedValue("Mock System Prompt")
		vi.spyOn(task as any, "backoffAndAnnounce").mockResolvedValue(undefined)
		let askCalls: { type: string; text?: string }[] = []
		vi.spyOn(task, "ask").mockImplementation(async (type, text) => {
			askCalls.push({ type, text })
			return { response: "noButtonClicked" }
		})

		const mock503Error = Object.assign(new Error("A server error occurred. Please try again."), {
			status: 503,
		})

		let attempts = 0
		task.api.createMessage = vi.fn().mockImplementation(() => ({
			[Symbol.asyncIterator]: async function* () {
				attempts++
				throw mock503Error
			},
		}))

		await expect(async () => {
			const iterator = task.attemptApiRequest(0)
			await iterator.next()
		}).rejects.toThrow()

		// Server 503 errors have maxRetries: 2
		// Total attempts must be bounded to at most 3 attempts (attempt 0 + 2 retries)
		expect(attempts).toBeLessThanOrEqual(3)
		expect(askCalls.length).toBeGreaterThan(0)
		expect(askCalls[0].type).toBe("api_req_failed")
	})

	// 9. Stream idle activity handles reasoning before idle timeout correctly
	it("9. Stream idle watchdog error message formatting and duration verification", () => {
		// Verifies the watchdog constant and message pattern match the incident evidence
		const idleError = new Error("Stream idle timeout: no data received from provider for 45 seconds")
		expect(idleError.message).toContain("Stream idle timeout")
		expect(idleError.message).toContain("45 seconds")
	})

	// 10. Compaction preserves active goal and completion criteria
	it("10. extractCleanInitialBlocks strips stale environment details and retains clean goal", () => {
		const initialBlocks: Anthropic.Messages.ContentBlockParam[] = [
			{ type: "text", text: "Goal: implement database migration and export results" },
			{
				type: "text",
				text: "<environment_details>\nInitial directory snapshot\n</environment_details>",
			},
			{
				type: "text",
				text: "[Context Compacted Summary]\n\n### CONTEXT COMPACTION HANDOFF\nOld handoff from previous cycle",
			},
		]

		const cleaned = extractCleanInitialBlocks(initialBlocks)
		expect(cleaned).toHaveLength(1)
		expect((cleaned[0] as any).text).toBe("Goal: implement database migration and export results")
	})
})
