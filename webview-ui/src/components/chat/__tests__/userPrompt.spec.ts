import { describe, it, expect } from "vitest"
import type { ClineMessage } from "@roo-code/types"
import { getLatestUserPrompt } from "../utils/userPrompt"

describe("getLatestUserPrompt", () => {
	const initialTask: ClineMessage = {
		type: "say",
		say: "text",
		ts: 1000,
		text: "Initial Prompt A",
	}

	it("returns initial prompt A when no user feedback exists", () => {
		const messages: ClineMessage[] = [
			initialTask,
			{ type: "say", say: "api_req_started", ts: 1001, text: "{}" },
			{ type: "say", say: "text", ts: 1002, text: "Assistant response" },
		]

		const result = getLatestUserPrompt(messages)
		expect(result).toBeDefined()
		expect(result?.text).toBe("Initial Prompt A")
		expect(result?.ts).toBe(1000)
	})

	it("returns user feedback C when sequence is A -> assistant -> B -> assistant -> C", () => {
		const messages: ClineMessage[] = [
			initialTask,
			{ type: "say", say: "text", ts: 1001, text: "Assistant response 1" },
			{ type: "say", say: "user_feedback", ts: 1002, text: "Feedback B" },
			{ type: "say", say: "text", ts: 1003, text: "Assistant response 2" },
			{ type: "say", say: "user_feedback", ts: 1004, text: "Feedback C" },
			{ type: "say", say: "text", ts: 1005, text: "Assistant response 3" },
		]

		const result = getLatestUserPrompt(messages)
		expect(result).toBeDefined()
		expect(result?.text).toBe("Feedback C")
		expect(result?.ts).toBe(1004)
	})

	it("falls back to feedback B after feedback C is removed from messages array", () => {
		const messagesAfterDeletion: ClineMessage[] = [
			initialTask,
			{ type: "say", say: "text", ts: 1001, text: "Assistant response 1" },
			{ type: "say", say: "user_feedback", ts: 1002, text: "Feedback B" },
			{ type: "say", say: "text", ts: 1003, text: "Assistant response 2" },
		]

		const result = getLatestUserPrompt(messagesAfterDeletion)
		expect(result).toBeDefined()
		expect(result?.text).toBe("Feedback B")
		expect(result?.ts).toBe(1002)
	})

	it("falls back to initial prompt A when all user feedback messages are removed", () => {
		const messagesOnlyInitial: ClineMessage[] = [
			initialTask,
			{ type: "say", say: "text", ts: 1001, text: "Assistant response 1" },
		]

		const result = getLatestUserPrompt(messagesOnlyInitial)
		expect(result).toBeDefined()
		expect(result?.text).toBe("Initial Prompt A")
		expect(result?.ts).toBe(1000)
	})

	it("ignores empty or whitespace-only feedback messages and finds previous valid prompt", () => {
		const messages: ClineMessage[] = [
			initialTask,
			{ type: "say", say: "user_feedback", ts: 1002, text: "Feedback B" },
			{ type: "say", say: "user_feedback", ts: 1004, text: "   " },
		]

		const result = getLatestUserPrompt(messages)
		expect(result).toBeDefined()
		expect(result?.text).toBe("Feedback B")
		expect(result?.ts).toBe(1002)
	})

	it("recognizes user feedback with images even when text is empty", () => {
		const messages: ClineMessage[] = [
			initialTask,
			{ type: "say", say: "user_feedback", ts: 1002, text: "", images: ["data:image/png;base64,..."] },
		]

		const result = getLatestUserPrompt(messages)
		expect(result).toBeDefined()
		expect(result?.ts).toBe(1002)
		expect(result?.images).toHaveLength(1)
	})

	it("ignores internal messages, command outputs, diffs, and tool results", () => {
		const messages: ClineMessage[] = [
			initialTask,
			{ type: "say", say: "user_feedback", ts: 1002, text: "Valid User Prompt" },
			{ type: "say", say: "user_feedback_diff", ts: 1003, text: '{"diff": "..."}' },
			{ type: "say", say: "command_output", ts: 1004, text: "npm test output" },
			{ type: "say", say: "tool", ts: 1005, text: "tool result" },
			{ type: "say", say: "error", ts: 1006, text: "Error message" },
			{ type: "ask", ask: "followup", ts: 1007, text: "Can you clarify?" },
		]

		const result = getLatestUserPrompt(messages)
		expect(result).toBeDefined()
		expect(result?.text).toBe("Valid User Prompt")
		expect(result?.ts).toBe(1002)
	})

	it("returns undefined when messages is empty or undefined", () => {
		expect(getLatestUserPrompt([])).toBeUndefined()
		expect(getLatestUserPrompt(undefined)).toBeUndefined()
	})
})
