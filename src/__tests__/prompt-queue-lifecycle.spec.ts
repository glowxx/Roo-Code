import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import type { HistoryItem, QueuedMessage } from "@roo-code/types"
import { MessageQueueService } from "../core/message-queue/MessageQueueService"
import { TaskHistoryStore } from "../core/task-persistence/TaskHistoryStore"

vi.mock("../utils/storage", () => ({
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
}))

vi.mock("../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn().mockImplementation(async (filePath: string, data: any) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data, null, "\t"), "utf8")
	}),
}))

describe("Prompt Queue Lifecycle & Crash Recovery", () => {
	describe("MessageQueueService Rehydration & Ordering", () => {
		it("rehydrates queued messages from stored historyItem and preserves order", () => {
			const initialQueue: QueuedMessage[] = [
				{ id: "msg-1", timestamp: 1000, text: "First prompt" },
				{ id: "msg-2", timestamp: 2000, text: "Second prompt" },
			]

			const queueService = new MessageQueueService(initialQueue)

			expect(queueService.isEmpty()).toBe(false)
			expect(queueService.messages.length).toBe(2)
			expect(queueService.messages[0].text).toBe("First prompt")

			const first = queueService.dequeueMessage()
			expect(first?.text).toBe("First prompt")

			const second = queueService.dequeueMessage()
			expect(second?.text).toBe("Second prompt")

			expect(queueService.isEmpty()).toBe(true)
		})

		it("supports loadMessages dynamically", () => {
			const queueService = new MessageQueueService()
			expect(queueService.isEmpty()).toBe(true)

			queueService.loadMessages([
				{ id: "msg-loaded", timestamp: 3000, text: "Loaded dynamically" },
			])

			expect(queueService.isEmpty()).toBe(false)
			expect(queueService.messages[0].text).toBe("Loaded dynamically")
		})
	})

	describe("TaskHistoryStore Crash Recovery", () => {
		let tmpDir: string
		let store: TaskHistoryStore

		beforeEach(async () => {
			tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-queue-crash-test-"))
			store = new TaskHistoryStore(tmpDir)
		})

		afterEach(async () => {
			store.dispose()
			await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
		})

		it("transitions unclosed active tasks to 'interrupted' upon store initialization", async () => {
			const tasksDir = path.join(tmpDir, "tasks")
			await fs.mkdir(tasksDir, { recursive: true })

			const activeItem: HistoryItem = {
				id: "task-active-123",
				number: 1,
				ts: Date.now(),
				task: "Unfinished active task before crash",
				tokensIn: 100,
				tokensOut: 50,
				totalCost: 0.01,
				workspace: "/test/workspace",
				status: "active",
				promptQueue: [{ id: "q-1", timestamp: Date.now(), text: "Queued follow-up" }],
			}

			const completedItem: HistoryItem = {
				id: "task-completed-456",
				number: 2,
				ts: Date.now(),
				task: "Cleanly completed task",
				tokensIn: 200,
				tokensOut: 80,
				totalCost: 0.02,
				workspace: "/test/workspace",
				status: "completed",
			}

			// Write task files directly to disk simulating prior state before app closed/crashed
			const activeTaskDir = path.join(tasksDir, activeItem.id)
			await fs.mkdir(activeTaskDir, { recursive: true })
			await fs.writeFile(path.join(activeTaskDir, "history_item.json"), JSON.stringify(activeItem), "utf8")

			const completedTaskDir = path.join(tasksDir, completedItem.id)
			await fs.mkdir(completedTaskDir, { recursive: true })
			await fs.writeFile(path.join(completedTaskDir, "history_item.json"), JSON.stringify(completedItem), "utf8")

			// Initialize store - should reconcile and run crash recovery
			await store.initialize()

			const recoveredActive = await store.get(activeItem.id)
			expect(recoveredActive).toBeDefined()
			expect(recoveredActive?.status).toBe("interrupted")
			expect(recoveredActive?.promptQueue).toHaveLength(1)

			const retainedCompleted = await store.get(completedItem.id)
			expect(retainedCompleted).toBeDefined()
			expect(retainedCompleted?.status).toBe("completed")
		})
	})
})
