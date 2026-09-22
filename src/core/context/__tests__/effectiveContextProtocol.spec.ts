import { describe, it, expect } from "vitest"
import { optimizeEffectiveApiHistory } from "../effectiveContext"
import { ApiMessage } from "../../task-persistence/apiMessages"
import { convertToOpenAiMessages } from "../../../api/transform/openai-format"
import { sanitizeRoleAlternation } from "../ContextCompactor"

describe("optimizeEffectiveApiHistory Protocol & Semantic Integrity", () => {
	describe("1. Preservation Window & Cutoff Integrity", () => {
		it("preserves exactly the last 4 messages untouched when recentMessagesPreserved = 4", () => {
			const hugePayload = "X".repeat(20000)
			const messages: ApiMessage[] = [
				// Turn 1 (Historical: index 0, 1)
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_hist_1", name: "execute_command", input: { command: "ls" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call_hist_1", content: hugePayload }],
				},
				// Turn 2 (Historical: index 2, 3)
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_hist_2", name: "execute_command", input: { command: "pwd" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call_hist_2", content: hugePayload }],
				},
				// Turn 3 (Recent: index 4, 5)
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_recent_1", name: "execute_command", input: { command: "cat" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call_recent_1", content: hugePayload }],
				},
				// Turn 4 (Recent: index 6, 7)
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_recent_2", name: "execute_command", input: { command: "git status" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call_recent_2", content: hugePayload }],
				},
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })

			expect(optimized).toHaveLength(8)

			// Historical turns (indices 0-3)
			// Assistant messages are never modified
			expect(optimized[0]).toEqual(messages[0])
			expect(optimized[2]).toEqual(messages[2])

			// User tool results in historical turns must be truncated
			const hist1 = (optimized[1].content as any[])[0]
			expect(hist1.content).toContain("[Historical tool output truncated:")
			expect(hist1.content.length).toBeLessThan(hugePayload.length)

			const hist2 = (optimized[3].content as any[])[0]
			expect(hist2.content).toContain("[Historical tool output truncated:")
			expect(hist2.content.length).toBeLessThan(hugePayload.length)

			// Recent turns (indices 4-7) must remain 100% identical byte-for-byte
			expect(optimized[4]).toEqual(messages[4])
			expect(optimized[5]).toEqual(messages[5])
			expect(optimized[6]).toEqual(messages[6])
			expect(optimized[7]).toEqual(messages[7])
		})

		it("leaves all messages untouched when total message count is <= recentMessagesPreserved", () => {
			const hugePayload = "A".repeat(10000)
			const messages: ApiMessage[] = [
				{ role: "user", content: "Initial task goal" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "c1", name: "execute_command", input: {} }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "c1", content: hugePayload }],
				},
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })
			expect(optimized).toHaveLength(3)
			expect(optimized).toEqual(messages)
		})
	})

	describe("2. Tool Protocol Pairing & ID Invariance", () => {
		it("never breaks tool_use <-> tool_result pairing or changes tool_use_id", () => {
			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Reading files" },
						{ type: "tool_use", id: "tool_u123_abc", name: "read_file", input: { path: "main.ts" } },
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool_u123_abc",
							content: "const a = 1;\n".repeat(2500), // ~32 KB, exceeds 20 KB read_file limit
						},
					],
				},
				// 4 recent messages
				{ role: "assistant", content: "Analyzed file." },
				{ role: "user", content: "Next step please." },
				{ role: "assistant", content: "Starting step." },
				{ role: "user", content: "Done." },
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })

			// Check assistant tool_use
			const astContent = optimized[0].content as any[]
			expect(astContent[1].type).toBe("tool_use")
			expect(astContent[1].id).toBe("tool_u123_abc")

			// Check user tool_result
			const userContent = optimized[1].content as any[]
			expect(userContent[0].type).toBe("tool_result")
			expect(userContent[0].tool_use_id).toBe("tool_u123_abc")
			expect(userContent[0].content).toContain("truncated")
		})
	})

	describe("3. Parallel Tool Calls Handling", () => {
		it("preserves exact count, order, and IDs of parallel tool calls and responses", () => {
			const parallelMessages: ApiMessage[] = [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Running 3 tools in parallel" },
						{ type: "tool_use", id: "call_p1", name: "execute_command", input: { command: "test1" } },
						{ type: "tool_use", id: "call_p2", name: "execute_command", input: { command: "test2" } },
						{ type: "tool_use", id: "call_p3", name: "execute_command", input: { command: "test3" } },
					],
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "call_p1", content: "Short result 1" },
						{ type: "tool_result", tool_use_id: "call_p2", content: "Huge test output\n".repeat(500) },
						{ type: "tool_result", tool_use_id: "call_p3", content: "Short result 3" },
					],
				},
				// 4 recent messages to push above into history
				{ role: "assistant", content: "Parallel tools finished." },
				{ role: "user", content: "Great." },
				{ role: "assistant", content: "Next." },
				{ role: "user", content: "All done." },
			]

			const optimized = optimizeEffectiveApiHistory(parallelMessages, { recentMessagesPreserved: 4 })
			const userMsg = optimized[1]
			const blocks = userMsg.content as any[]

			expect(blocks).toHaveLength(3)
			expect(blocks[0].tool_use_id).toBe("call_p1")
			expect(blocks[0].content).toBe("Short result 1")

			expect(blocks[1].tool_use_id).toBe("call_p2")
			expect(blocks[1].content).toContain("[Historical tool output truncated:")

			expect(blocks[2].tool_use_id).toBe("call_p3")
			expect(blocks[2].content).toBe("Short result 3")

			// Verify OpenAI compatibility
			const openAiMsgs = convertToOpenAiMessages(optimized as any)
			const toolResponses = openAiMsgs.filter((m) => m.role === "tool") as any[]
			expect(toolResponses).toHaveLength(3)
			expect(toolResponses[0].tool_call_id).toBe("call_p1")
			expect(toolResponses[1].tool_call_id).toBe("call_p2")
			expect(toolResponses[2].tool_call_id).toBe("call_p3")
		})
	})

	describe("4. Tool Result Error Semantics (is_error: true)", () => {
		it("preserves is_error: true flag, exit code metadata, and error tail output", () => {
			const errorLog =
				"Starting build...\n" +
				"Processing modules...\n".repeat(100) +
				"ERROR in src/index.ts: SyntaxError: Unexpected token\n" +
				"Command failed with exit code 1"

			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_err", name: "execute_command", input: { command: "npm run build" } }],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_err",
							is_error: true,
							content: errorLog,
						},
					],
				},
				{ role: "assistant", content: "Build failed." },
				{ role: "user", content: "Fix it." },
				{ role: "assistant", content: "Fixing..." },
				{ role: "user", content: "Checking." },
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })
			const toolResult = (optimized[1].content as any[])[0]

			expect(toolResult.is_error).toBe(true)
			expect(toolResult.tool_use_id).toBe("call_err")
			expect(toolResult.content).toContain("(exit code: 1)")
			expect(toolResult.content).toContain("SyntaxError: Unexpected token")
		})
	})

	describe("5. Nested Content Blocks in tool_result", () => {
		it("truncates nested text blocks while preserving image blocks untouched", () => {
			const largeText = "Diagnostic text log:\n".repeat(300)
			const mockImageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

			const messages: ApiMessage[] = [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call_browser", name: "browser_action", input: { action: "screenshot" } }],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_browser",
							content: [
								{ type: "text", text: largeText },
								{
									type: "image",
									source: {
										type: "base64",
										media_type: "image/png",
										data: mockImageData,
									},
								},
							],
						},
					],
				},
				{ role: "assistant", content: "Screenshot taken." },
				{ role: "user", content: "Analyze it." },
				{ role: "assistant", content: "Analyzing." },
				{ role: "user", content: "Complete." },
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })
			const toolResult = (optimized[1].content as any[])[0]

			expect(Array.isArray(toolResult.content)).toBe(true)
			const [textBlock, imageBlock] = toolResult.content

			expect(textBlock.type).toBe("text")
			expect(textBlock.text).toContain("[Historical tool output truncated:")
			expect(textBlock.text.length).toBeLessThan(largeText.length)

			expect(imageBlock.type).toBe("image")
			expect(imageBlock.source.data).toBe(mockImageData)
		})
	})

	describe("6. Pure User Messages Protection (No tool_result)", () => {
		it("never truncates or mislabels historical plain text user messages (string content)", () => {
			const largeUserPrompt = "Please implement a full OAuth2 server with the following detailed specs:\n".repeat(80)

			const messages: ApiMessage[] = [
				{ role: "user", content: largeUserPrompt },
				{ role: "assistant", content: "I understand the requirements." },
				{ role: "user", content: "Proceed." },
				{ role: "assistant", content: "Working..." },
				{ role: "user", content: "Done." },
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })

			// Message 0 is historical (older than 2 recent messages)
			expect(optimized[0].role).toBe("user")
			expect(optimized[0].content).toBe(largeUserPrompt)
			expect(optimized[0].content).not.toContain("[Historical tool output truncated:")
		})

		it("never truncates historical user messages structured as array of text blocks without tool_result", () => {
			const largeText = "Spec document:\n".repeat(100)

			const messages: ApiMessage[] = [
				{
					role: "user",
					content: [{ type: "text", text: largeText }],
				},
				{ role: "assistant", content: "Got it." },
				{ role: "user", content: "Continue." },
				{ role: "assistant", content: "Done." },
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })
			const userBlock = (optimized[0].content as any[])[0]
			expect(userBlock.type).toBe("text")
			expect(userBlock.text).toBe(largeText)
		})
	})

	describe("7. Summary & Truncation Marker Protection", () => {
		it("never truncates or corrupts summary messages (isSummary: true)", () => {
			const largeSummary = "### CONTEXT COMPACTION HANDOFF\n" + "- Completed auth refactor\n".repeat(150)

			const messages: ApiMessage[] = [
				{
					role: "user",
					content: largeSummary,
					isSummary: true,
					condenseId: "cond-999",
				},
				{ role: "assistant", content: "Summary acknowledged." },
				{ role: "user", content: "Continue." },
				{ role: "assistant", content: "Working." },
				{ role: "user", content: "Done." },
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })
			expect(optimized[0].isSummary).toBe(true)
			expect(optimized[0].content).toBe(largeSummary)
			expect(optimized[0].content).not.toContain("truncated")
		})

		it("never touches truncation marker messages (isTruncationMarker: true)", () => {
			const markerContent = "[Sliding window truncation: 10 messages hidden]"
			const messages: ApiMessage[] = [
				{
					role: "user",
					content: markerContent,
					isTruncationMarker: true,
					truncationId: "trunc-1",
				},
				{ role: "assistant", content: "Ok." },
				{ role: "user", content: "Next." },
				{ role: "assistant", content: "Done." },
			]

			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })
			expect(optimized[0].isTruncationMarker).toBe(true)
			expect(optimized[0].content).toBe(markerContent)
		})
	})

	describe("8. Empty Content Edge Cases", () => {
		it("gracefully handles empty strings, empty arrays, and undefined content", () => {
			const messages: ApiMessage[] = [
				{ role: "user", content: "" },
				{ role: "user", content: [] },
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "empty_call", content: "" },
						{ type: "tool_result", tool_use_id: "empty_call_arr", content: [] },
					],
				},
				{ role: "assistant", content: "Replying." },
				{ role: "user", content: "Done." },
			]

			expect(() => optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })).not.toThrow()
			const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })
			expect(optimized[0].content).toBe("")
			expect(optimized[1].content).toEqual([])
			const blocks = optimized[2].content as any[]
			expect(blocks[0].content).toBe("")
			expect(blocks[1].content).toEqual([])
		})
	})

	describe("9. Compaction & Role Alternation Integration", () => {
		it("maintains valid alternating message sequence when combined with compactHistory sanitization", () => {
			const initialUserPrompt: ApiMessage = {
				role: "user",
				content: "Build full web server",
			}
			const summaryMessage: ApiMessage = {
				role: "user",
				content: [{ type: "text", text: "### CONTEXT COMPACTION HANDOFF\n- Server setup initialized" }],
				isSummary: true,
			}
			const preservedTurns: ApiMessage[] = [
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "t1", name: "execute_command", input: { command: "npm test" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "t1", content: "PASS test/server.spec.ts" }],
				},
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "t2", name: "execute_command", input: { command: "npm run start" } }],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "t2", content: "Server listening on port 3000" }],
				},
			]

			const compactedHistory = sanitizeRoleAlternation([initialUserPrompt, summaryMessage, ...preservedTurns])
			const optimized = optimizeEffectiveApiHistory(compactedHistory, { recentMessagesPreserved: 4 })

			// Sequence must strictly alternate: user -> assistant -> user -> assistant -> user
			expect(optimized[0].role).toBe("user")
			expect(optimized[1].role).toBe("assistant")
			expect(optimized[2].role).toBe("user")
			expect(optimized[3].role).toBe("assistant")
			expect(optimized[4].role).toBe("user")

			// Ensure valid OpenAI conversion
			const openAiMsgs = convertToOpenAiMessages(optimized as any)
			expect(openAiMsgs.length).toBeGreaterThanOrEqual(5)
		})
	})
})
