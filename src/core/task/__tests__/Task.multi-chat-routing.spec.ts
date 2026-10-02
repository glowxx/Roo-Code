import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ProviderSettings, HistoryItem } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { RooCodeEventName, getModelId } from "@roo-code/types"
import { resolveTaskExecutionConfig } from "../../config/resolveTaskExecutionConfig"

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
			getConfiguration: vi.fn(() => ({ get: (_k: string, d: any) => d })),
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
		version: "1.85.0",
	}
})

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

describe("Multi-Chat Model Routing & Task Isolation", () => {
	const xkiroGpt61Config: ProviderSettings = {
		apiProvider: "xkiro",
		xkiroApiKey: "xkiro-test-key",
		xkiroModelId: "openai/gpt-6.1-sol",
		apiModelId: "openai/gpt-6.1-sol",
		reasoningEffort: "medium",
		enableReasoningEffort: true,
	} as any

	const xkiroQwenConfig: ProviderSettings = {
		apiProvider: "xkiro",
		xkiroApiKey: "xkiro-test-key",
		xkiroModelId: "qwen/qwen3.8-max:free",
		apiModelId: "qwen/qwen3.8-max:free",
		reasoningEffort: "disable",
		enableReasoningEffort: false,
	} as any

	let mockProvider: any
	let eventListeners: Record<string, ((...args: any[]) => any)[]> = {}

	beforeEach(() => {
		eventListeners = {}
		mockProvider = {
			context: {
				globalStorageUri: { fsPath: "/test/storage" },
			},
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: xkiroGpt61Config,
				mode: "code",
				currentApiConfigName: "default",
			}),
			log: vi.fn(),
			on: vi.fn((event: string, cb: (...args: any[]) => any) => {
				eventListeners[event] = eventListeners[event] || []
				eventListeners[event].push(cb)
			}),
			off: vi.fn((event: string, cb: (...args: any[]) => any) => {
				if (eventListeners[event]) {
					eventListeners[event] = eventListeners[event].filter((f) => f !== cb)
				}
			}),
			emit: vi.fn((event: string, ...args: any[]) => {
				if (eventListeners[event]) {
					for (const cb of eventListeners[event]) {
						cb(...args)
					}
				}
			}),
			isActiveTask: vi.fn().mockReturnValue(false),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue(undefined),
			getCurrentTask: vi.fn(),
			runningTasks: new Map<string, Task>(),
			foregroundTaskId: undefined as string | undefined,
		}
	})

	it("TM-01: Two concurrent tasks (Chat A: GPT-6.1 Sol, Chat B: qwen3.8-max) have strictly isolated execution snapshots", () => {
		const taskA = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroGpt61Config,
			task: "Chat A task",
			startTask: false,
		})

		const taskB = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Chat B task",
			startTask: false,
		})

		mockProvider.runningTasks.set(taskA.taskId, taskA)
		mockProvider.runningTasks.set(taskB.taskId, taskB)

		expect(getModelId(taskA.apiConfiguration)).toBe("openai/gpt-6.1-sol")
		expect(taskA.taskStartModel).toBe("openai/gpt-6.1-sol")
		expect(taskA.taskStartProvider).toBe("xkiro")
		expect((taskA.apiConfiguration as any).reasoningEffort).toBe("medium")

		expect(getModelId(taskB.apiConfiguration)).toBe("qwen/qwen3.8-max:free")
		expect(taskB.taskStartModel).toBe("qwen/qwen3.8-max:free")
		expect(taskB.taskStartProvider).toBe("xkiro")
		expect((taskB.apiConfiguration as any).reasoningEffort).toBe("disable")
	})

	it("TM-02: Rapid switching between Task A and Task B does not bleed model configuration", async () => {
		const taskA = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroGpt61Config,
			task: "Chat A task",
			startTask: false,
		})

		const taskB = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Chat B task",
			startTask: false,
		})

		mockProvider.runningTasks.set(taskA.taskId, taskA)
		mockProvider.runningTasks.set(taskB.taskId, taskB)

		// Focus Task A
		mockProvider.foregroundTaskId = taskA.taskId
		taskA.emit(RooCodeEventName.TaskFocused)

		// Rapid switch to Task B
		taskA.emit(RooCodeEventName.TaskUnfocused)
		mockProvider.foregroundTaskId = taskB.taskId
		taskB.emit(RooCodeEventName.TaskFocused)

		// Rapid switch back to Task A
		taskB.emit(RooCodeEventName.TaskUnfocused)
		mockProvider.foregroundTaskId = taskA.taskId
		taskA.emit(RooCodeEventName.TaskFocused)

		// Both tasks must retain their original models without mutation
		expect(getModelId(taskA.apiConfiguration)).toBe("openai/gpt-6.1-sol")
		expect(getModelId(taskB.apiConfiguration)).toBe("qwen/qwen3.8-max:free")
	})

	it("TM-03: Changing preferred model in Chat B does NOT alter Task A's running execution snapshot", async () => {
		const taskA = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroGpt61Config,
			task: "Chat A task",
			startTask: false,
		})

		const taskB = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroQwenConfig,
			task: "Chat B task",
			startTask: false,
		})

		mockProvider.runningTasks.set(taskA.taskId, taskA)
		mockProvider.runningTasks.set(taskB.taskId, taskB)

		// Chat B preference changed in history item
		if (taskB.historyItem) {
			taskB.historyItem.chatModelId = "anthropic/claude-3.7-sonnet"
		}

		// Also global profile changes
		mockProvider.getState.mockResolvedValue({
			apiConfiguration: {
				...xkiroQwenConfig,
				apiModelId: "anthropic/claude-3.7-sonnet",
			},
			mode: "code",
			currentApiConfigName: "qwen-profile",
		})

		// Provider Profile Changed event for B
		mockProvider.emit(RooCodeEventName.ProviderProfileChanged, {
			name: "qwen-profile",
			provider: "xkiro",
			targetTaskId: taskB.taskId,
		})

		await new Promise((r) => setTimeout(r, 20))

		// Task A must still be running GPT-6.1 Sol!
		expect(getModelId(taskA.apiConfiguration)).toBe("openai/gpt-6.1-sol")
		expect(taskA.taskStartModel).toBe("openai/gpt-6.1-sol")
	})

	it("TM-04: Rehydrating task from history with chatModelId enforces chat model even if base provider has a different model", () => {
		const historyItem: HistoryItem = {
			id: "task-chat-a-123",
			number: 1,
			ts: Date.now(),
			task: "Chat A history",
			tokensIn: 100,
			tokensOut: 50,
			cacheWrites: 0,
			cacheReads: 0,
			totalCost: 0.1,
			size: 1000,
			chatModelId: "openai/gpt-6.1-sol",
			chatProvider: "xkiro",
			chatReasoningEffort: "medium",
		}

		// Base configuration has Qwen (e.g. from currently active global profile)
		const baseApiConfig = { ...xkiroQwenConfig }

		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: baseApiConfig,
			chatMetadata: historyItem,
			isNewChat: false,
		})

		expect(getModelId(resolved)).toBe("openai/gpt-6.1-sol")
		expect(resolved.apiProvider).toBe("xkiro")
		expect((resolved as any).reasoningEffort).toBe("medium")

		// Instantiating Task with this resolved config + historyItem pins it
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: resolved,
			historyItem,
			startTask: false,
		})

		expect(getModelId(task.apiConfiguration)).toBe("openai/gpt-6.1-sol")
		expect(task.taskStartModel).toBe("openai/gpt-6.1-sol")
		expect(task.taskStartProvider).toBe("xkiro")
	})

	it("TM-05: Existing chat ignores lastManuallySelectedModel fallback", () => {
		const historyItem: HistoryItem = {
			id: "existing-task-id",
			number: 2,
			ts: Date.now(),
			task: "Existing task",
			tokensIn: 10,
			tokensOut: 10,
			cacheWrites: 0,
			cacheReads: 0,
			totalCost: 0.01,
			size: 500,
			chatModelId: "openai/gpt-6.1-sol",
			chatProvider: "xkiro",
		}

		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: xkiroGpt61Config,
			chatMetadata: historyItem,
			lastManualModel: {
				modelId: "qwen/qwen3.8-max:free",
				provider: "xkiro",
			},
			isNewChat: false, // existing chat!
		})

		// Must NOT use Qwen from lastManualModel
		expect(getModelId(resolved)).toBe("openai/gpt-6.1-sol")
	})

	it("TM-06: New unassigned chat uses lastManuallySelectedModel fallback", () => {
		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: xkiroGpt61Config,
			chatMetadata: undefined,
			lastManualModel: {
				modelId: "qwen/qwen3.8-max:free",
				provider: "xkiro",
				reasoningEffort: "disable",
			},
			isNewChat: true,
		})

		// For new chat without metadata, fallback to lastManualModel is applied
		expect(getModelId(resolved)).toBe("qwen/qwen3.8-max:free")
		expect(resolved.apiProvider).toBe("xkiro")
	})

	it("TM-07: In-place updateTaskApiHandlerIfNeeded blocks mutation of active task", () => {
		const taskA = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroGpt61Config,
			task: "Active Task A",
			startTask: false,
		})

		mockProvider.runningTasks.set(taskA.taskId, taskA)
		mockProvider.foregroundTaskId = taskA.taskId
		mockProvider.getCurrentTask.mockReturnValue(taskA)

		// Background model discovery or profile change attempts to update task
		const proto = ClineProvider.prototype
		proto.updateTaskApiHandlerIfNeeded.call(
			mockProvider,
			xkiroQwenConfig,
			{ forceRebuild: true, targetTaskId: taskA.taskId },
		)

		// Active task must NOT be changed to Qwen
		expect(getModelId(taskA.apiConfiguration)).toBe("openai/gpt-6.1-sol")
	})

	it("TM-08: Task apiConfiguration is deep cloned and not affected by external mutations to providerSettings", () => {
		const mutableSettings: ProviderSettings = {
			apiProvider: "xkiro",
			xkiroModelId: "openai/gpt-6.1-sol",
			apiModelId: "openai/gpt-6.1-sol",
		} as any

		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: mutableSettings,
			task: "Clone test",
			startTask: false,
		})

		// Mutate original settings object
		;(mutableSettings as any).xkiroModelId = "qwen/qwen3.8-max:free"
		;(mutableSettings as any).apiModelId = "qwen/qwen3.8-max:free"

		// Task must retain its own deep-cloned copy
		expect(getModelId(task.apiConfiguration)).toBe("openai/gpt-6.1-sol")
	})

	it("TM-09: Interrupted task with preferred model change resumes with original execution snapshot model, next task uses new preferred model", async () => {
		// 1. Task A starts with GPT-6.1 Sol
		const taskA = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: xkiroGpt61Config,
			task: "Task A with Sol",
			startTask: false,
		})

		expect(taskA.taskStartModel).toBe("openai/gpt-6.1-sol")
		await taskA.saveClineMessages()
		expect(taskA.historyItem?.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(taskA.historyItem?.chatModelId).toBe("openai/gpt-6.1-sol")

		// 2. User changes preferred model in UI to Qwen during Task A
		// Simulating webviewMessageHandler upsertApiConfiguration
		if (taskA.historyItem) {
			taskA.historyItem.chatModelId = "qwen/qwen3.8-max:free"
			taskA.historyItem.chatProvider = "xkiro"
		}
		await taskA.saveClineMessages()

		// Verify taskA's saved historyItem has executionModelId intact and chatModelId updated
		expect(taskA.historyItem?.executionModelId).toBe("openai/gpt-6.1-sol")
		expect(taskA.historyItem?.chatModelId).toBe("qwen/qwen3.8-max:free")

		// 3. Task A is interrupted, Roo restarts -> historyItem is restored from disk
		const savedHistoryItem = structuredClone(taskA.historyItem!)

		// 4. Continue Task A: resolveTaskExecutionConfig for resumed task
		const resumedConfig = resolveTaskExecutionConfig({
			baseProviderSettings: xkiroQwenConfig, // Global state might now even be Qwen
			chatMetadata: savedHistoryItem,
			isNewChat: false,
		})

		const resumedTask = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: resumedConfig,
			historyItem: savedHistoryItem,
			task: "Task A resumed",
			startTask: false,
		})

		// Resumed Task A MUST continue with GPT-6.1 Sol!
		expect(getModelId(resumedTask.apiConfiguration)).toBe("openai/gpt-6.1-sol")
		expect(resumedTask.taskStartModel).toBe("openai/gpt-6.1-sol")

		// 5. Next new task in this chat uses preferred model: Qwen!
		const nextTaskConfig = resolveTaskExecutionConfig({
			baseProviderSettings: xkiroGpt61Config,
			chatMetadata: {
				chatModelId: savedHistoryItem.chatModelId,
				chatProvider: savedHistoryItem.chatProvider,
			},
			isNewChat: true,
		})

		expect(getModelId(nextTaskConfig)).toBe("qwen/qwen3.8-max:free")
	})
})
