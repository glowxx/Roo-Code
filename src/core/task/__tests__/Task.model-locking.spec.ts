import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ProviderSettings } from "@roo-code/types"
import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { RooCodeEventName } from "@roo-code/types"

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

describe("Task - Model Locking Architecture", () => {
	const modelAConfig: ProviderSettings = {
		apiProvider: "anthropic",
		apiModelId: "claude-3-5-sonnet-20241022",
		apiKey: "test-anthropic-key",
		reasoningEffort: "medium",
	} as any

	const modelBConfig: ProviderSettings = {
		apiProvider: "openai",
		openAiModelId: "gpt-4o",
		openAiApiKey: "test-openai-key",
		reasoningEffort: "high",
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
				apiConfiguration: modelAConfig,
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

	it("INVARIANT 1: Active task model must be immutable when global profile changes", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: modelAConfig,
			task: "long running task",
			startTask: false,
		})

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.foregroundTaskId = task.taskId
		mockProvider.getCurrentTask.mockReturnValue(task)

		expect(task.apiConfiguration.apiModelId).toBe("claude-3-5-sonnet-20241022")
		expect(task.apiConfiguration.apiProvider).toBe("anthropic")

		// User in Chat B switches model to Model B
		mockProvider.getState.mockResolvedValue({
			apiConfiguration: modelBConfig,
			mode: "code",
			currentApiConfigName: "openai-profile",
		})

		// Provider Profile Changed event emitted
		mockProvider.emit(RooCodeEventName.ProviderProfileChanged, {
			name: "openai-profile",
			provider: "openai",
			targetTaskId: task.taskId,
		})

		// Allow async events to settle
		await new Promise((r) => setTimeout(r, 50))

		// Invariant: Task A must STILL have Model A!
		expect(task.apiConfiguration.apiModelId).toBe("claude-3-5-sonnet-20241022")
		expect(task.apiConfiguration.apiProvider).toBe("anthropic")
	})

	it("INVARIANT 2: Resuming task via submitUserMessage (WAITING_USER) must not overwrite active task model", async () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: modelAConfig,
			task: "task waiting user",
			startTask: false,
		})

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.getCurrentTask.mockReturnValue(task)

		// Provider now has Model B
		mockProvider.getState.mockResolvedValue({
			apiConfiguration: modelBConfig,
			mode: "code",
			currentApiConfigName: "openai-profile",
		})

		// User submits response to resume
		await task.submitUserMessage("Here is the answer to your question")

		// Invariant: Task A must NOT have switched to Model B!
		expect(task.apiConfiguration.apiModelId).toBe("claude-3-5-sonnet-20241022")
		expect(task.apiConfiguration.apiProvider).toBe("anthropic")
	})

	it("INVARIANT 3: updateTaskApiHandlerIfNeeded must NOT mutate active task", () => {
		// Mock real ClineProvider method behavior
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: modelAConfig,
			task: "active task",
			startTask: false,
		})

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.foregroundTaskId = task.taskId
		mockProvider.getCurrentTask.mockReturnValue(task)

		const clineProviderProto = ClineProvider.prototype
		clineProviderProto.updateTaskApiHandlerIfNeeded.call(
			mockProvider,
			modelBConfig,
			{ forceRebuild: true, targetTaskId: task.taskId },
		)

		// Task was active -> must NOT be mutated!
		expect(task.apiConfiguration.apiModelId).toBe("claude-3-5-sonnet-20241022")
		expect(task.apiConfiguration.apiProvider).toBe("anthropic")
	})

	it("INVARIANT 4: taskStart metadata preserves initial model snapshot", () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: modelAConfig,
			task: "metadata test",
			startTask: false,
		})

		expect(task.taskStartModel).toBe("claude-3-5-sonnet-20241022")
		expect(task.taskStartProvider).toBe("anthropic")
		expect(task.taskStartEffort).toBe("medium")
	})

	it("INVARIANT 5: Completed task allows model update for next task cycle", () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: modelAConfig,
			task: "completed task transition",
			startTask: false,
		})

		// Mark task completed
		task.isTaskCompleted = true

		// Now updateApiConfiguration is permitted
		task.updateApiConfiguration(modelBConfig)

		expect(task.apiConfiguration.apiProvider).toBe("openai")
		expect((task.apiConfiguration as any).openAiModelId).toBe("gpt-4o")
	})

	it("INVARIANT 6: External callers cannot force mutate active task unless allowActiveTaskUpdate is explicitly true", () => {
		const task = new Task({
			provider: mockProvider as unknown as ClineProvider,
			apiConfiguration: modelAConfig,
			task: "force mutate protection",
			startTask: false,
		})

		mockProvider.runningTasks.set(task.taskId, task)
		mockProvider.getCurrentTask.mockReturnValue(task)

		const clineProviderProto = ClineProvider.prototype
		clineProviderProto.updateTaskApiHandlerIfNeeded.call(
			mockProvider,
			modelBConfig,
			{ forceRebuild: true, targetTaskId: task.taskId },
		)

		// Still Model A
		expect(task.apiConfiguration.apiModelId).toBe("claude-3-5-sonnet-20241022")

		// Explicit allowActiveTaskUpdate
		clineProviderProto.updateTaskApiHandlerIfNeeded.call(
			mockProvider,
			modelBConfig,
			{ forceRebuild: true, targetTaskId: task.taskId, allowActiveTaskUpdate: true },
		)

		// Mutated only when explicitly allowed
		expect(task.apiConfiguration.apiProvider).toBe("openai")
	})
})
