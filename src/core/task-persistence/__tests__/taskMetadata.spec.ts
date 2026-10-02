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

	it("keeps delegated parent with needsAttention: false even if historical USER_DECISION_REQUIRED ask was present", async () => {
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
		expect(result.historyItem.needsAttention).toBe(false)
	})

	it("keeps delegated parent needsAttention: false after historical approved run", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Starting parent work" },
			{ ts: 1500, type: "ask", ask: "command", text: "npm test", approvalState: "USER_DECISION_REQUIRED" },
			{ ts: 1600, type: "say", say: "command_output", text: "All tests passed" },
			{ ts: 1700, type: "say", say: "text", text: "Tests succeeded, now delegating to subtask" },
			{ ts: 1800, type: "ask", ask: "tool", text: "new_task" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "delegated",
			awaitingChildId: "child-task-1",
		})

		expect(result.historyItem.status).toBe("delegated")
		expect(result.historyItem.needsAttention).toBe(false)
	})

	it("keeps delegated parent needsAttention: false after historical denied run", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Starting parent work" },
			{ ts: 1500, type: "ask", ask: "command", text: "npm run deploy", approvalState: "USER_DECISION_REQUIRED" },
			{ ts: 1600, type: "say", say: "user_feedback", text: "Denied by user" },
			{ ts: 1700, type: "say", say: "text", text: "Understood, delegating research instead" },
			{ ts: 1800, type: "ask", ask: "tool", text: "new_task" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "delegated",
			awaitingChildId: "child-task-1",
		})

		expect(result.historyItem.status).toBe("delegated")
		expect(result.historyItem.needsAttention).toBe(false)
	})

	it("flags active task with needsAttention: true when there is a REAL current unresolved USER_DECISION_REQUIRED", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Running dangerous action" },
			{ ts: 2000, type: "ask", ask: "command", text: "drop database production", approvalState: "USER_DECISION_REQUIRED" },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "active",
		})

		expect(result.historyItem.status).toBe("active")
		expect(result.historyItem.needsAttention).toBe(true)
	})

	it("preserves needsAttention: true on real pending decision regardless of chat reading", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Question for user" },
			{ ts: 2000, type: "ask", ask: "tool", text: "delete_file", approvalState: "USER_DECISION_REQUIRED" },
		]

		// Merely reading the chat does not add answers or substantive says
		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "active",
		})

		expect(result.historyItem.needsAttention).toBe(true)
	})

	it("preserves needsAttention: true and interrupted status when completion_result requires user decision with safety warning", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Preliminary verification report" },
			{ ts: 2000, type: "say", say: "completion_result", text: "Attempting completion", approvalState: "USER_DECISION_REQUIRED" },
			{ ts: 3000, type: "ask", ask: "completion_result", text: "", approvalState: "USER_DECISION_REQUIRED" },
			{
				ts: 4000,
				type: "say",
				say: "command_safety_warning",
				text: JSON.stringify({
					isSafe: false,
					riskLevel: "medium",
					reason: "Cannot complete task with 1 item(s) marked 'blocked' on the todo list without user approval.",
				}),
			},
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "interrupted",
		})

		expect(result.historyItem.status).toBe("interrupted")
		expect(result.historyItem.needsAttention).toBe(true)
	})

	it("clears needsAttention and marks completed when completion_result is answered and approved", async () => {
		const messages: ClineMessage[] = [
			{ ts: 1000, type: "say", say: "text", text: "Report" },
			{ ts: 2000, type: "say", say: "completion_result", text: "Done", approvalState: "AUTO_APPROVED" },
			{ ts: 3000, type: "ask", ask: "completion_result", text: "", approvalState: "AUTO_APPROVED", isAnswered: true },
		]

		const result = await taskMetadata({
			...baseOptions,
			messages,
			initialStatus: "active",
		})

		expect(result.historyItem.status).toBe("completed")
		expect(result.historyItem.needsAttention).toBe(false)
	})
})
