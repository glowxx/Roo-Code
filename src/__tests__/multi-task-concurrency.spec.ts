import { describe, it, expect, vi, beforeEach } from "vitest"
import { ClineProvider } from "../core/webview/ClineProvider"
import { RooCodeEventName } from "@roo-code/types"
import * as ProfileValidatorMod from "../shared/ProfileValidator"

// Mock Task class
vi.mock("../core/task/Task", () => {
	class TaskStub {
		public taskId: string
		public instanceId = "inst"
		public parentTask?: any
		public apiConfiguration: any
		public rootTask?: any
		public clineMessages: any[] = []
		public isStreaming = false
		public didFinishAbortingStream = true
		public isWaitingForFirstChunk = false
		public abandoned = false
		public abortReason?: string
		public events: Record<string, Function[]> = {}

		constructor(opts: any) {
			this.taskId = opts.historyItem?.id ?? opts.taskId ?? `task-${Math.random().toString(36).slice(2, 8)}`
			this.parentTask = opts.parentTask
			this.apiConfiguration = opts.apiConfiguration ?? { apiProvider: "anthropic" }
			opts.onCreated?.(this)
		}
		start() {}
		on(event: string, fn: Function) {
			if (!this.events[event]) this.events[event] = []
			this.events[event].push(fn)
		}
		off(event: string, fn: Function) {
			if (this.events[event]) {
				this.events[event] = this.events[event].filter((f) => f !== fn)
			}
		}
		emit(event: string, ...args: any[]) {
			if (this.events[event]) {
				this.events[event].forEach((fn) => fn(...args))
			}
		}
		cancelCurrentRequest = vi.fn()
		abortCompaction = vi.fn()
		abortTask = vi.fn().mockResolvedValue(undefined)
	}
	return { Task: TaskStub }
})

describe("Multi-Chat Concurrency & Task Registry", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	function createMockProvider() {
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const provider = {
			clineStack: [] as any[],
			runningTasks: new Map<string, any>(),
			foregroundTaskId: undefined as string | undefined,
			taskEventListeners: new Map(),
			setValues: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic", consecutiveMistakeLimit: 0 },
				organizationAllowList: "*",
				enableCheckpoints: true,
				checkpointTimeout: 60,
				cloudUserInfo: null,
				mode: "code",
			}),
			removeClineFromStack,
			addClineToStack: ClineProvider.prototype.addClineToStack,
			getCurrentTask: ClineProvider.prototype.getCurrentTask,
			showTaskWithId: ClineProvider.prototype.showTaskWithId,
			clearTask: ClineProvider.prototype.clearTask,
			cancelTask: ClineProvider.prototype.cancelTask,
			createTask: ClineProvider.prototype.createTask,
			createTaskWithHistoryItem: ClineProvider.prototype.createTaskWithHistoryItem,
			performPreparationTasks: vi.fn().mockResolvedValue(undefined),
			setProviderProfile: vi.fn(),
			log: vi.fn(),
			getStateToPostToWebview: vi.fn().mockResolvedValue({ clineMessages: [] }),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			providerSettingsManager: { getModeConfigId: vi.fn(), listConfig: vi.fn() },
			customModesManager: { getCustomModes: vi.fn().mockResolvedValue([]) },
			taskCreationCallback: vi.fn(),
			getTaskWithId: vi.fn(),
			getPendingEditOperation: vi.fn().mockReturnValue(undefined),
			clearPendingEditOperation: vi.fn(),
			context: { extension: { packageJSON: {} }, globalStorageUri: { fsPath: "/tmp" } },
			contextProxy: {
				extensionUri: {},
				setValue: vi.fn(),
				getValue: vi.fn(),
				setProviderSettings: vi.fn(),
				getProviderSettings: vi.fn(() => ({})),
			},
		} as unknown as ClineProvider
		return provider
	}

	it("creates multiple tasks concurrently without aborting existing tasks", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)
		const provider = createMockProvider()

		// Create Task 1
		const task1 = await provider.createTask("Task 1")
		expect(task1).toBeDefined()
		expect(provider.runningTasks.has(task1.taskId)).toBe(true)
		expect(provider.foregroundTaskId).toBe(task1.taskId)
		expect(provider.getCurrentTask()?.taskId).toBe(task1.taskId)

		// Create Task 2 concurrently
		const task2 = await provider.createTask("Task 2")
		expect(task2).toBeDefined()
		expect(task2.taskId).not.toBe(task1.taskId)

		// Both tasks must be concurrently present in runningTasks!
		expect(provider.runningTasks.has(task1.taskId)).toBe(true)
		expect(provider.runningTasks.has(task2.taskId)).toBe(true)
		expect(provider.runningTasks.size).toBe(2)

		// Task 2 is now the active foreground task
		expect(provider.foregroundTaskId).toBe(task2.taskId)
		expect(provider.getCurrentTask()?.taskId).toBe(task2.taskId)

		// Task 1 was NOT aborted
		expect(task1.abortTask).not.toHaveBeenCalled()
		expect((provider.removeClineFromStack as any)).not.toHaveBeenCalled()
	})

	it("switches between concurrent tasks via showTaskWithId without re-instantiation", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)
		const provider = createMockProvider()

		const task1 = await provider.createTask("Task 1")
		const task2 = await provider.createTask("Task 2")

		const unfocusSpy1 = vi.fn()
		const focusSpy1 = vi.fn()
		task1.on(RooCodeEventName.TaskUnfocused, unfocusSpy1)
		task1.on(RooCodeEventName.TaskFocused, focusSpy1)

		// Switch back to Task 1
		await provider.showTaskWithId(task1.taskId)

		expect(provider.foregroundTaskId).toBe(task1.taskId)
		expect(provider.getCurrentTask()?.taskId).toBe(task1.taskId)
		expect(focusSpy1).toHaveBeenCalled()
		expect(provider.getTaskWithId).not.toHaveBeenCalled() // No disk re-read needed!
		expect(task2.abortTask).not.toHaveBeenCalled() // Task 2 is still running in background!
	})

	it("clearTask clears foreground view without aborting running background tasks", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)
		const provider = createMockProvider()

		const task1 = await provider.createTask("Task 1")
		expect(provider.foregroundTaskId).toBe(task1.taskId)

		await provider.clearTask()

		// Foreground task is cleared
		expect(provider.foregroundTaskId).toBeUndefined()
		expect(provider.postStateToWebview).toHaveBeenCalled()

		// Task 1 is still preserved in runningTasks in the background
		expect(provider.runningTasks.has(task1.taskId)).toBe(true)
		expect(task1.abortTask).not.toHaveBeenCalled()
	})

	it("cancelTask removes only the targeted task from runningTasks", async () => {
		vi.spyOn(ProfileValidatorMod.ProfileValidator, "isProfileAllowed").mockReturnValue(true)
		const provider = createMockProvider()

		const task1 = await provider.createTask("Task 1")
		const task2 = await provider.createTask("Task 2")

		;(provider.getTaskWithId as any).mockResolvedValue({
			historyItem: { id: task1.taskId, task: "Task 1" },
		})

		// Cancel task1 specifically while task2 is in foreground
		await provider.cancelTask(task1.taskId)

		expect(task1.abortTask).toHaveBeenCalled()
		expect(provider.runningTasks.has(task1.taskId)).toBe(false)
		expect(provider.runningTasks.has(task2.taskId)).toBe(true)
		expect(task2.abortTask).not.toHaveBeenCalled()
	})
})
