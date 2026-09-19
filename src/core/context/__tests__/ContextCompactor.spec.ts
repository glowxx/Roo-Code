import { describe, it, expect, vi, beforeEach } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo } from "@roo-code/types"

import { BaseProvider } from "../../../api/providers/base-provider"
import { ApiMessage } from "../../task-persistence/apiMessages"
import { compactHistory, CONDENSING_SYSTEM_PROMPT } from "../ContextCompactor"

class MockApiHandler extends BaseProvider {
	public lastSystemPrompt?: string
	public lastMessages?: Anthropic.Messages.MessageParam[]
	public summaryToReturn = `### 1. Main Objective & Context
Initial objective is to build feature X.

### 2. Changes Made & Modified Files
Modified src/index.ts and added tests.

### 3. Key Architectural Decisions
Adopted clean modular pattern.

### 4. Next Steps & Current State
Ready for verification.`
	public shouldThrow = false

	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): any {
		this.lastSystemPrompt = systemPrompt
		this.lastMessages = messages

		if (this.shouldThrow) {
			throw new Error("API rate limit exceeded")
		}

		const summary = this.summaryToReturn
		return {
			async *[Symbol.asyncIterator]() {
				yield { type: "text", text: summary }
				yield { type: "usage", inputTokens: 120, outputTokens: 60, totalCost: 0.005 }
			},
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "mock-model",
			info: {
				contextWindow: 128000,
				maxTokens: 4096,
				supportsPromptCache: true,
				supportsImages: true,
				inputPrice: 0,
				outputPrice: 0,
				description: "Mock model for testing",
			},
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		let tokens = 0
		for (const block of content) {
			if (block.type === "text") {
				tokens += Math.ceil(block.text.length / 4)
			} else {
				tokens += 10
			}
		}
		return tokens
	}
}

describe("ContextCompactor", () => {
	let mockApiHandler: MockApiHandler
	const taskId = "task-compactor-test"
	const systemPrompt = "System instructions for testing"

	beforeEach(() => {
		mockApiHandler = new MockApiHandler()
	})

	it("throws error if messages array has fewer than 4 messages", async () => {
		const shortMessages: ApiMessage[] = [
			{ role: "user", content: "Initial prompt", ts: 1000 },
			{ role: "assistant", content: [{ type: "text", text: "Hello" }], ts: 1001 },
		]

		await expect(
			compactHistory({
				messages: shortMessages,
				apiHandler: mockApiHandler,
				systemPrompt,
				taskId,
			}),
		).rejects.toThrow(/minimum 4 messages required/i)
	})

	it("compacts history correctly, preserving message 0 and recent exchanges", async () => {
		const longText = "This is a detailed step with lots of code and explanations. ".repeat(20)
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial objective: implement feature X with full test coverage and error handling.", ts: 1 },
			{ role: "assistant", content: [{ type: "text", text: `Step 1 completed: ${longText}` }], ts: 2 },
			{ role: "user", content: `Now do step 2: ${longText}`, ts: 3 },
			{ role: "assistant", content: [{ type: "text", text: `Step 2 completed: ${longText}` }], ts: 4 },
			{ role: "user", content: "Now do step 3", ts: 5 },
			{ role: "assistant", content: [{ type: "text", text: "Step 3 done" }], ts: 6 },
			{ role: "user", content: "Now do step 4", ts: 7 },
			{ role: "assistant", content: [{ type: "text", text: "Step 4 done" }], ts: 8 },
		]

		const result = await compactHistory({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt,
			taskId,
			preserveTurns: 2, // 2 exchanges = 4 messages (messages 4, 5, 6, 7 => indices 4..7)
		})

		// Preserved recent messages are indices 4, 5, 6, 7 (4 messages)
		// Message 0 is preserved as first message
		// Summary message is in index 1
		expect(result.newHistory).toHaveLength(6) // 1 (m0) + 1 (summary) + 4 (preserved)
		expect(result.newHistory[0]).toEqual(messages[0])

		const summaryMsg = result.newHistory[1]
		expect(summaryMsg.role).toBe("user")
		expect(summaryMsg.isSummary).toBe(true)
		expect(Array.isArray(summaryMsg.content)).toBe(true)
		expect((summaryMsg.content as any)[0].text).toContain("[Context Compacted Summary]")
		expect((summaryMsg.content as any)[0].text).toContain("### 1. Main Objective & Context")

		// Remaining messages are preserved
		expect(result.newHistory.slice(2)).toEqual(messages.slice(4))

		// Cost and tokens
		expect(result.cost).toBe(0.005)
		expect(result.previousTokens).toBeGreaterThan(0)
		expect(result.newTokens).toBeGreaterThan(0)
		expect(result.previousTokens).toBeGreaterThan(result.newTokens)
	})

	it("converts tool_use and tool_result blocks to text for intermediate messages", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial objective", ts: 1 },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "read_file",
						input: { path: "src/index.ts" },
					},
				],
				ts: 2,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: "file content here",
					},
				],
				ts: 3,
			},
			{ role: "assistant", content: [{ type: "text", text: "Tool response acknowledged" }], ts: 4 },
			{ role: "user", content: "Recent 1", ts: 5 },
			{ role: "assistant", content: [{ type: "text", text: "Recent 2" }], ts: 6 },
			{ role: "user", content: "Recent 3", ts: 7 },
			{ role: "assistant", content: [{ type: "text", text: "Recent 4" }], ts: 8 },
		]

		await compactHistory({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt,
			taskId,
		})

		expect(mockApiHandler.lastSystemPrompt).toBe(CONDENSING_SYSTEM_PROMPT)
		expect(mockApiHandler.lastMessages).toBeDefined()

		// Verify no tool_use or tool_result blocks exist in the summarization messages
		const allBlocks: any[] = mockApiHandler.lastMessages!.flatMap((m) =>
			Array.isArray(m.content) ? (m.content as any[]) : [{ type: "text", text: String(m.content) }],
		)

		for (const block of allBlocks) {
			expect(block.type).not.toBe("tool_use")
			expect(block.type).not.toBe("tool_result")
		}

		// Verify tool info converted to text
		const serialized = JSON.stringify(mockApiHandler.lastMessages)
		expect(serialized).toContain("[Tool Use: read_file]")
		expect(serialized).toContain("[Tool Result]")
	})

	it("supports customInstructions by appending to the request prompt", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial goal", ts: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Reply 1" }], ts: 2 },
			{ role: "user", content: "Prompt 2", ts: 3 },
			{ role: "assistant", content: [{ type: "text", text: "Reply 2" }], ts: 4 },
			{ role: "user", content: "Prompt 3", ts: 5 },
			{ role: "assistant", content: [{ type: "text", text: "Reply 3" }], ts: 6 },
		]

		await compactHistory({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt,
			taskId,
			customInstructions: "Focus especially on changes to the auth module.",
		})

		const serialized = JSON.stringify(mockApiHandler.lastMessages)
		expect(serialized).toContain("Focus especially on changes to the auth module.")
	})

	it("handles 4 messages by preserving 2 recent messages and compacting intermediate", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial goal", ts: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Intermediate step" }], ts: 2 },
			{ role: "user", content: "Recent prompt", ts: 3 },
			{ role: "assistant", content: [{ type: "text", text: "Recent reply" }], ts: 4 },
		]

		const result = await compactHistory({
			messages,
			apiHandler: mockApiHandler,
			systemPrompt,
			taskId,
		})

		expect(result.newHistory[0]).toEqual(messages[0])
		expect(result.newHistory[1].isSummary).toBe(true)
		expect(result.newHistory.slice(2)).toEqual([messages[2], messages[3]])
	})

	it("throws an error when the API call fails", async () => {
		mockApiHandler.shouldThrow = true

		const messages: ApiMessage[] = [
			{ role: "user", content: "Initial goal", ts: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Step 1" }], ts: 2 },
			{ role: "user", content: "Step 2", ts: 3 },
			{ role: "assistant", content: [{ type: "text", text: "Step 3" }], ts: 4 },
			{ role: "user", content: "Step 4", ts: 5 },
			{ role: "assistant", content: [{ type: "text", text: "Step 5" }], ts: 6 },
		]

		await expect(
			compactHistory({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt,
				taskId,
			}),
		).rejects.toThrow(/Context condensation LLM call failed/i)
	})

	it("times out if stream takes longer than 60 seconds", async () => {
		vi.useFakeTimers()
		try {
			mockApiHandler.createMessage = () => {
				return {
					async *[Symbol.asyncIterator]() {
						await new Promise(() => {}) // never resolves
					},
				} as any
			}

			const messages: ApiMessage[] = [
				{ role: "user", content: "Initial goal", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "Step 1" }], ts: 2 },
				{ role: "user", content: "Step 2", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Step 3" }], ts: 4 },
			]

			const assertionPromise = expect(
				compactHistory({
					messages,
					apiHandler: mockApiHandler,
					systemPrompt,
					taskId,
				}),
			).rejects.toThrow("Context condensation timed out after 60 seconds.")

			await vi.advanceTimersByTimeAsync(60_000)

			await assertionPromise
		} finally {
			vi.useRealTimers()
		}
	})
})
