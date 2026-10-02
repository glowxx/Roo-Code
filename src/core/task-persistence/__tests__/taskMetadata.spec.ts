// pnpm --filter roo-cline test core/task-persistence/__tests__/taskMetadata.spec.ts

import { describe, it, expect, vi } from "vitest"
import type { ClineMessage } from "@roo-code/types"
import { taskMetadata } from "../taskMetadata"

vi.mock("get-folder-size", () => ({
	default: {
		loose: vi.fn().mockResolvedValue(1024),
	},
}))

vi.mock("../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn().mockImplementation(async (base, id) => `${base}/tasks/${id}`),
}))

vi.mock("../../i18n", () => ({
	t: vi.fn().mockImplementation((key, params) => key),
}))

describe("taskMetadata lifecycle & attention derivation", () => {
	const baseOptions = {
		taskId: "test-task-1",
		taskNumber: 1,
		globalStoragePath: "/test/storage",
		workspace: "/test/workspace",
	}

	it("marks completed tasks with needsAttention: false and status: completed", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Do some work" },
			{ ts: 2000, type: "say", say: "completion_result", text: "Done!" },
			{ ts: 3000, type: "ask", ask: "resume_completed_task", text: "Continue?" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "completed",
		})

		expect(result.historyItem.status).toBe("completed")
		expect(result.historyItem.needsAttention).toBe(false)
	})

	it("does NOT treat resume_completed_task as requiring user attention even if initialStatus is not provided", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Do some work" },
			{ ts: 2000, type: "say", say: "completion_result", text: "Done!" },
			{ ts: 3000, type: "ask", ask: "resume_completed_task", text: "Continue?" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
		})

		expect(result.historyItem.status).toBe("completed")
		expect(result.historyItem.needsAttention).toBe(false)
	})

	it("does NOT treat resolved past tool/command asks as requiring attention", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Run a command" },
			{ ts: 2000, type: "ask", ask: "command", text: "npm test" },
			{ ts: 3000, type: "say", say: "command_output", text: "Tests passed" },
			{ ts: 4000, type: "say", say: "text", text: "All tests are passing now." },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "active",
		})

		expect(result.historyItem.needsAttention).toBe(false)
	})

	it("does NOT treat AUTO_APPROVED asks as requiring user attention", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Run tool" },
			{ ts: 2000, type: "ask", ask: "tool", text: "read_file", approvalState: "AUTO_APPROVED" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "active",
		})

		expect(result.historyItem.needsAttention).toBe(false)
	})

	it("flags unresolved asks waiting for user decision with needsAttention: true", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Run tool" },
			{ ts: 2000, type: "ask", ask: "tool", text: "execute_command", approvalState: "USER_DECISION_REQUIRED" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "active",
		})

		expect(result.historyItem.needsAttention).toBe(true)
	})

	it("flags unresolved followup questions with needsAttention: true", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Start" },
			{ ts: 2000, type: "ask", ask: "followup", text: "Which file should I edit?" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "active",
		})

		expect(result.historyItem.needsAttention).toBe(true)
	})

	it("flags interrupted resumable tasks with needsAttention: true", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Start" },
			{ ts: 2000, type: "ask", ask: "resume_task", text: "Task was interrupted" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "interrupted",
		})

		expect(result.historyItem.status).toBe("interrupted")
		expect(result.historyItem.needsAttention).toBe(true)
	})

	it("marks delegated tasks awaiting child with needsAttention: false and status: delegated even with tool ask", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Starting parent task" },
			{ ts: 2000, type: "ask", ask: "tool", text: "newTask" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "delegated",
			awaitingChildId: "child-task-1",
			delegatedToId: "child-task-1",
		})

		expect(result.historyItem.status).toBe("delegated")
		expect(result.historyItem.needsAttention).toBe(false)
		expect(result.historyItem.awaitingChildId).toBe("child-task-1")
		expect(result.historyItem.delegatedToId).toBe("child-task-1")
	})

	it("flags delegated task with needsAttention: true if an explicit USER_DECISION_REQUIRED ask is present", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Parent task" },
			{ ts: 1500, type: "ask", ask: "command", text: "rm -rf /", approvalState: "USER_DECISION_REQUIRED" },
			{ ts: 2000, type: "ask", ask: "tool", text: "newTask" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "delegated",
			awaitingChildId: "child-task-1",
		})

		expect(result.historyItem.status).toBe("delegated")
		expect(result.historyItem.needsAttention).toBe(true)
	})
})
