import { describe, it, expect, vi, beforeEach } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"
import type { ModelInfo } from "@roo-code/types"

import { BaseProvider } from "../../../api/providers/base-provider"
import { ApiMessage } from "../../task-persistence/apiMessages"
import {
	compactHistory,
	CONDENSING_SYSTEM_PROMPT,
	sanitizeRoleAlternation,
	STATE_HANDOFF_HEADER,
	STATE_HANDOFF_TEMPLATE,
	truncateHeavyOutputs,
	TERMINAL_OUTPUT_MAX_BYTES,
} from "../ContextCompactor"

class MockApiHandler extends BaseProvider {
	public lastSystemPrompt?: string
	public lastMessages?: Anthropic.Messages.MessageParam[]
	public summaryToReturn = `### CONTEXT COMPACTION HANDOFF
- **Primary Objective**: Initial objective is to build feature X.
- **Work Completed**: Modified src/index.ts and added tests.
- **Current State & Obstacles**: Ready for verification.
- **Next Immediate Actions**: Run test suite.
- **Critical Constraints**: Node v20.`
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
		// With sanitizeRoleAlternation, adjacent user messages (m0, summary, m4)
		// are merged into a single multi-block user message to prevent HTTP 400 errors.
		expect(result.newHistory).toHaveLength(4)

		const firstMsg = result.newHistory[0]
		expect(firstMsg.role).toBe("user")
		expect(firstMsg.isSummary).toBe(true)
		expect(Array.isArray(firstMsg.content)).toBe(true)

		const blocks = firstMsg.content as Anthropic.Messages.ContentBlockParam[]
		expect(blocks).toHaveLength(3) // m0 + summary + m4
		expect((blocks[0] as any).text).toContain("Initial objective: implement feature X")
		expect((blocks[1] as any).text).toContain("[Context Compacted Summary]")
		expect((blocks[1] as any).text).toContain("### CONTEXT COMPACTION HANDOFF")
		expect((blocks[1] as any).text).toContain("- **Primary Objective**:")
		expect((blocks[2] as any).text).toContain("Now do step 3")

		// Remaining messages strictly alternate roles
		expect(result.newHistory[1].role).toBe("assistant")
		expect(result.newHistory[1]).toEqual(messages[5])
		expect(result.newHistory[2].role).toBe("user")
		expect(result.newHistory[2]).toEqual(messages[6])
		expect(result.newHistory[3].role).toBe("assistant")
		expect(result.newHistory[3]).toEqual(messages[7])

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

	it("handles 4 messages by preserving 2 recent messages and compacting intermediate with sanitized alternation", async () => {
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

		// m0 (user), summary (user), and m2 (user) are merged into one user message
		expect(result.newHistory).toHaveLength(2)
		expect(result.newHistory[0].role).toBe("user")
		expect(result.newHistory[0].isSummary).toBe(true)
		const blocks = result.newHistory[0].content as Anthropic.Messages.ContentBlockParam[]
		expect(blocks).toHaveLength(3)
		expect((blocks[0] as any).text).toBe("Initial goal")
		expect((blocks[1] as any).text).toContain("[Context Compacted Summary]")
		expect((blocks[2] as any).text).toBe("Recent prompt")

		expect(result.newHistory[1].role).toBe("assistant")
		expect(result.newHistory[1]).toEqual(messages[3])
	})

	describe("sanitizeRoleAlternation", () => {
		it("returns empty array for empty history", () => {
			expect(sanitizeRoleAlternation([])).toEqual([])
		})

		it("merges consecutive user messages into a single multi-block message", () => {
			const history: ApiMessage[] = [
				{ role: "user", content: "First user message", ts: 1 },
				{
					role: "user",
					content: [{ type: "text", text: "[Summary]" }],
					ts: 2,
					isSummary: true,
				},
				{ role: "user", content: "Third user message", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Assistant reply" }], ts: 4 },
			]

			const result = sanitizeRoleAlternation(history)
			expect(result).toHaveLength(2)
			expect(result[0].role).toBe("user")
			expect(result[0].isSummary).toBe(true)
			expect(result[0].content).toEqual([
				{ type: "text", text: "First user message" },
				{ type: "text", text: "[Summary]" },
				{ type: "text", text: "Third user message" },
			])
			expect(result[1].role).toBe("assistant")
		})

		it("leaves already alternating history unchanged", () => {
			const history: ApiMessage[] = [
				{ role: "user", content: "User 1" },
				{ role: "assistant", content: "Assistant 1" },
				{ role: "user", content: "User 2" },
				{ role: "assistant", content: "Assistant 2" },
			]

			const result = sanitizeRoleAlternation(history)
			expect(result).toHaveLength(4)
			expect(result[0].role).toBe("user")
			expect(result[1].role).toBe("assistant")
			expect(result[2].role).toBe("user")
			expect(result[3].role).toBe("assistant")
		})
	})

	describe("abortSignal support", () => {
		it("throws immediately if abortSignal is already aborted", async () => {
			const controller = new AbortController()
			controller.abort()

			const messages: ApiMessage[] = [
				{ role: "user", content: "Initial goal", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "Step 1" }], ts: 2 },
				{ role: "user", content: "Step 2", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Step 3" }], ts: 4 },
			]

			await expect(
				compactHistory({
					messages,
					apiHandler: mockApiHandler,
					systemPrompt,
					taskId,
					abortSignal: controller.signal,
				}),
			).rejects.toThrow("Context condensation was aborted.")
		})

		it("aborts stream when abortSignal fires mid-stream", async () => {
			const controller = new AbortController()

			mockApiHandler.createMessage = () => {
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Partial summary" }
						controller.abort()
						yield { type: "text", text: " More summary" }
					},
				} as any
			}

			const messages: ApiMessage[] = [
				{ role: "user", content: "Initial goal", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "Step 1" }], ts: 2 },
				{ role: "user", content: "Step 2", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Step 3" }], ts: 4 },
			]

			await expect(
				compactHistory({
					messages,
					apiHandler: mockApiHandler,
					systemPrompt,
					taskId,
					abortSignal: controller.signal,
				}),
			).rejects.toThrow("Context condensation was aborted.")
		})
	})

	describe("finish_reason verification", () => {
		it("throws error when model finish_reason is max_tokens", async () => {
			mockApiHandler.createMessage = () => {
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Truncated summary" }
						yield { type: "usage", finish_reason: "max_tokens" }
					},
				} as any
			}

			const messages: ApiMessage[] = [
				{ role: "user", content: "Initial goal", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "Step 1" }], ts: 2 },
				{ role: "user", content: "Step 2", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Step 3" }], ts: 4 },
			]

			await expect(
				compactHistory({
					messages,
					apiHandler: mockApiHandler,
					systemPrompt,
					taskId,
				}),
			).rejects.toThrow(/Context condensation incomplete: model output was truncated \(finish_reason: max_tokens\)/i)
		})

		it("throws error when model finish_reason is length", async () => {
			mockApiHandler.createMessage = () => {
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "text", text: "Truncated summary" }
						yield { type: "usage", finishReason: "length" }
					},
				} as any
			}

			const messages: ApiMessage[] = [
				{ role: "user", content: "Initial goal", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "Step 1" }], ts: 2 },
				{ role: "user", content: "Step 2", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Step 3" }], ts: 4 },
			]

			await expect(
				compactHistory({
					messages,
					apiHandler: mockApiHandler,
					systemPrompt,
					taskId,
				}),
			).rejects.toThrow(/Context condensation incomplete: model output was truncated \(finish_reason: length\)/i)
		})
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

	describe("Structured State Handoff (Memory Continuity Capsule)", () => {
		it("generates and validates structured ### CONTEXT COMPACTION HANDOFF block", async () => {
			expect(CONDENSING_SYSTEM_PROMPT).toContain("### CONTEXT COMPACTION HANDOFF")
			expect(CONDENSING_SYSTEM_PROMPT).toContain("- **Primary Objective**:")
			expect(CONDENSING_SYSTEM_PROMPT).toContain("- **Work Completed**:")
			expect(CONDENSING_SYSTEM_PROMPT).toContain("- **Current State & Obstacles**:")
			expect(CONDENSING_SYSTEM_PROMPT).toContain("- **Next Immediate Actions**:")
			expect(CONDENSING_SYSTEM_PROMPT).toContain("- **Critical Constraints**:")

			const messages: ApiMessage[] = [
				{ role: "user", content: "Primary user task: build feature Y", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "Working on step 1" }], ts: 2 },
				{ role: "user", content: "Continue to step 2", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Done with step 2" }], ts: 4 },
			]

			const result = await compactHistory({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt,
				taskId,
			})

			expect(result.summary).toContain("### CONTEXT COMPACTION HANDOFF")
			expect(result.summary).toContain("- **Primary Objective**:")
			expect(result.summary).toContain("- **Work Completed**:")
			expect(result.summary).toContain("- **Current State & Obstacles**:")
			expect(result.summary).toContain("- **Next Immediate Actions**:")
			expect(result.summary).toContain("- **Critical Constraints**:")

			// Verify synthetic message contains the handoff capsule
			const summaryBlock = (result.newHistory[0].content as any[]).find(
				(b) => typeof b.text === "string" && b.text.includes("### CONTEXT COMPACTION HANDOFF"),
			)
			expect(summaryBlock).toBeDefined()
			expect(summaryBlock.text).toContain("### CONTEXT COMPACTION HANDOFF")
			expect(summaryBlock.text).toContain("- **Primary Objective**:")
		})

		it("reduces heavy terminal outputs exceeding 2KB with concise reference markers", async () => {
			const heavyLineCount = 60
			const heavyOutput = "echo 'long terminal output line testing heavy output buffer'\n".repeat(heavyLineCount)
			const heavyBytes = Buffer.byteLength(heavyOutput, "utf8")
			expect(heavyBytes).toBeGreaterThan(TERMINAL_OUTPUT_MAX_BYTES)

			// Direct truncateHeavyOutputs tests
			const truncatedString = truncateHeavyOutputs(heavyOutput) as string
			expect(truncatedString).toBe(
				`[Command output truncated: ${heavyLineCount + 1} lines, ${heavyBytes} bytes - refer to previous logs if needed]`,
			)

			const truncatedToolResult = truncateHeavyOutputs([
				{
					type: "tool_result",
					tool_use_id: "tool-exec-1",
					content: heavyOutput,
				},
			]) as Anthropic.Messages.ContentBlockParam[]
			expect(truncatedToolResult[0]).toEqual({
				type: "tool_result",
				tool_use_id: "tool-exec-1",
				content: `[Command output truncated: ${heavyLineCount + 1} lines, ${heavyBytes} bytes - refer to previous logs if needed]`,
			})

			// Outputs under 2KB remain intact
			const shortOutput = "short command output under 2KB"
			expect(truncateHeavyOutputs(shortOutput)).toBe(shortOutput)

			// In compactHistory, intermediate heavy outputs are truncated before sending to summarizer
			const messages: ApiMessage[] = [
				{ role: "user", content: "Initial user task", ts: 1 },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "cmd-1",
							name: "execute_command",
							input: { command: "npm test" },
						},
					],
					ts: 2,
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "cmd-1",
							content: heavyOutput,
						},
					],
					ts: 3,
				},
				{ role: "assistant", content: [{ type: "text", text: "Tests processed" }], ts: 4 },
				{ role: "user", content: "Recent prompt 1", ts: 5 },
				{ role: "assistant", content: [{ type: "text", text: "Recent reply 1" }], ts: 6 },
				{ role: "user", content: "Recent prompt 2", ts: 7 },
				{ role: "assistant", content: [{ type: "text", text: "Recent reply 2" }], ts: 8 },
			]

			await compactHistory({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt,
				taskId,
				preserveTurns: 2,
			})

			const serialized = JSON.stringify(mockApiHandler.lastMessages)
			expect(serialized).toContain("[Command output truncated:")
			expect(serialized).not.toContain(heavyOutput)
		})

		it("preserves Message 0 and recent 2-3 turns intact with sanitized role alternation", async () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "Message 0: Initial user objective that must never be lost.", ts: 1 },
				{ role: "assistant", content: [{ type: "text", text: "Intermediate assistant turn 1" }], ts: 2 },
				{ role: "user", content: "Intermediate user turn 2", ts: 3 },
				{ role: "assistant", content: [{ type: "text", text: "Intermediate assistant turn 3" }], ts: 4 },
				{ role: "user", content: "Turn -2: User command", ts: 5 },
				{ role: "assistant", content: [{ type: "text", text: "Turn -2: Direct assistant result" }], ts: 6 },
				{ role: "user", content: "Turn -1: Final command", ts: 7 },
				{ role: "assistant", content: [{ type: "text", text: "Turn -1: Final direct result" }], ts: 8 },
			]

			const result = await compactHistory({
				messages,
				apiHandler: mockApiHandler,
				systemPrompt,
				taskId,
				preserveTurns: 2, // 2 exchanges = 4 messages (indices 4..7)
			})

			// First message in newHistory contains Message 0 content
			const firstMessage = result.newHistory[0]
			expect(firstMessage.role).toBe("user")
			const firstMessageBlocks = firstMessage.content as Anthropic.Messages.ContentBlockParam[]
			expect((firstMessageBlocks[0] as any).text).toBe(
				"Message 0: Initial user objective that must never be lost.",
			)

			// Synthetic state handoff is included in the merged first user message
			expect((firstMessageBlocks[1] as any).text).toContain("### CONTEXT COMPACTION HANDOFF")

			// Recent turns (last 2 exchanges) are preserved in order
			expect(result.newHistory[1].role).toBe("assistant")
			expect(result.newHistory[1]).toEqual(messages[5])
			expect(result.newHistory[2].role).toBe("user")
			expect(result.newHistory[2]).toEqual(messages[6])
			expect(result.newHistory[3].role).toBe("assistant")
			expect(result.newHistory[3]).toEqual(messages[7])

			// Verify strictly alternating roles
			for (let i = 1; i < result.newHistory.length; i++) {
				expect(result.newHistory[i].role).not.toBe(result.newHistory[i - 1].role)
			}
		})
	})
})
