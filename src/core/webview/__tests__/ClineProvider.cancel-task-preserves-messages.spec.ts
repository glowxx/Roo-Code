import { describe, expect, it, vi } from "vitest"
import { ClineProvider } from "../ClineProvider"

describe("cancelTask - message preservation & hydration regression", () => {
	it("preserves conversation transcript and current task identity when stopping the foreground task", async () => {
		const provider = Object.create(ClineProvider.prototype) as ClineProvider

		const initialMessages = [
			{ type: "say" as const, say: "text" as const, text: "Initial task prompt", ts: 1000 },
			{ type: "say" as const, say: "api_req_started" as const, text: JSON.stringify({ request: "1" }), ts: 1001 },
			{ type: "say" as const, say: "text" as const, text: "Streaming answer...", ts: 1002 },
		]

		const historyItem = {
			id: "task-A",
			ts: 1000,
			task: "Initial task prompt",
			status: "active" as const,
			workspace: "c:/test",
		}

		const taskA: any = {
			taskId: "task-A",
			instanceId: "task-A-instance-1",
			clineMessages: [...initialMessages],
			apiConversationHistory: [],
			historyItem: { ...historyItem },
			isStreaming: true,
			isWaitingForFirstChunk: false,
			abandoned: false,
			cancelCurrentRequest: vi.fn(),
			abortCompaction: vi.fn(),
			abortTask: vi.fn(async function (this: any) {
				this.isStreaming = false
			}),
		}

		;(provider as any).runningTasks = new Map([["task-A", taskA]])
		;(provider as any).clineStack = [taskA]
		provider.foregroundTaskId = "task-A"
		provider.getTaskWithId = vi.fn().mockResolvedValue({ historyItem }) as any
		provider.updateTaskHistory = vi.fn().mockResolvedValue(undefined) as any
		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined) as any
		;(provider as any).log = vi.fn()

		let rehydratedTask: any = null
		provider.createTaskWithHistoryItem = vi.fn(async (item: any, options?: any) => {
			rehydratedTask = {
				taskId: item.id,
				instanceId: "task-A-instance-2",
				// If startTask: false was passed without message initialization, clineMessages starts empty []
				clineMessages: options?.initialClineMessages ? [...options.initialClineMessages] : [],
				historyItem: { ...item },
				overwriteClineMessages: vi.fn(async function (this: any, msgs: any[]) {
					this.clineMessages = [...msgs]
				}),
				overwriteApiConversationHistory: vi.fn(),
			}
			;(provider as any).clineStack = [rehydratedTask]
			return rehydratedTask
		}) as any

		;(provider as any).taskHistoryStore = {
			initialized: Promise.resolve(),
			get: vi.fn(() => historyItem),
			getAll: vi.fn(() => [historyItem]),
		}
		;(provider as any).context = {
			extension: { packageJSON: { version: "1.0.0" } },
			globalStorageUri: { fsPath: "c:/test/storage" },
			globalState: { get: vi.fn(() => undefined), update: vi.fn() },
		}
		provider.getState = vi.fn().mockResolvedValue({
			allowedCommands: [],
			deniedCommands: [],
			mode: "code",
		}) as any
		;(provider as any).mergeAllowedCommands = vi.fn((cmds) => cmds || []) as any
		;(provider as any).mergeDeniedCommands = vi.fn((cmds) => cmds || []) as any
		;(provider as any).contextProxy = {
			getValue: vi.fn(),
		}
		Object.defineProperty(provider, "cwd", { get: () => "c:/test", configurable: true })

		// STOP task A
		await provider.cancelTask("task-A")

		// 1. Task A runtime must be aborted and removed from runningTasks
		expect(taskA.abortTask).toHaveBeenCalledTimes(1)
		expect(taskA.cancelCurrentRequest).toHaveBeenCalledTimes(1)
		expect(provider.runningTasks.has("task-A")).toBe(false)

		// 2. Foreground task identity must remain task-A
		expect(provider.foregroundTaskId).toBe("task-A")
		expect(provider.getCurrentTask()?.taskId).toBe("task-A")

		// 3. State to webview must preserve all transcript messages (not empty array [])
		const postedState = await provider.getStateToPostToWebview()
		expect(postedState.currentTaskId).toBe("task-A")
		expect(postedState.clineMessages).toBeDefined()
		expect(postedState.clineMessages.length).toBeGreaterThan(0)
		expect(postedState.clineMessages).toEqual(initialMessages)

		// 4. Must notify webview of updated state
		expect(provider.postStateToWebview).toHaveBeenCalled()
	})
})
