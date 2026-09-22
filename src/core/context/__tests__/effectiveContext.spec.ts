import { describe, it, expect } from "vitest"
import { optimizeEffectiveApiHistory } from "../effectiveContext"
import { ApiMessage } from "../../task-persistence/apiMessages"

describe("optimizeEffectiveApiHistory", () => {
	it("preserves immediate recent turns with 100% fidelity", () => {
		const largeOutput = "A".repeat(10000)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: "Do something",
				ts: 1,
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "execute_command",
						input: { command: "ls" },
					},
				],
				ts: 2,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: largeOutput,
					},
				],
				ts: 3,
			},
		]

		// With default recentMessagesPreserved (4), turn 3 is inside recent window and should NOT be truncated
		const result = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })
		expect(result.length).toBe(3)
		const lastMsg = result[2]
		expect(Array.isArray(lastMsg.content)).toBe(true)
		const block = (lastMsg.content as any[])[0]
		expect(block.content).toBe(largeOutput)
	})

	it("truncates large historical tool output (> 2KB) in older turns with structured metadata", () => {
		const largeTerminalOutput = "line 1: start\n" + "x".repeat(50000) + "\nline 100: finished with exit code 0"
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: "Run test suite",
				ts: 1,
			},
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "call_old", name: "execute_command", input: {} }],
				ts: 2,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_old",
						content: largeTerminalOutput,
					},
				],
				ts: 3,
			},
			// Recent turns (preserved)
			{ role: "assistant", content: "I see test passed.", ts: 4 },
			{ role: "user", content: "Now build", ts: 5 },
			{ role: "assistant", content: "Building...", ts: 6 },
			{ role: "user", content: "Done building", ts: 7 },
		]

		const result = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4, maxHistoricalToolBytes: 2048 })
		expect(result.length).toBe(7)

		// Historical message (index 2) should be truncated
		const oldToolMsg = result[2]
		const toolBlock = (oldToolMsg.content as any[])[0]
		expect(typeof toolBlock.content).toBe("string")
		expect(toolBlock.content).toContain("[Historical tool output truncated:")
		expect(toolBlock.content).toContain("(exit code: 0)")
		expect(toolBlock.content).toContain("Full output preserved in task storage/logs")
		expect(toolBlock.content.length).toBeLessThan(2000)

		// Original input messages must NOT be modified (immutability check)
		const originalToolBlock = (messages[2].content as any[])[0]
		expect(originalToolBlock.content).toBe(largeTerminalOutput)
	})

	it("truncates historical graphify skill documentation while preserving skill invocation notice", () => {
		const graphifySkillDoc = `# /graphify\nname: graphify\n## Usage\n` + "Documentation content ".repeat(1000)
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_skill",
						content: graphifySkillDoc,
					},
				],
				ts: 1,
			},
			{ role: "assistant", content: "Understood the graph", ts: 2 },
			{ role: "user", content: "Next step", ts: 3 },
			{ role: "assistant", content: "Working on it", ts: 4 },
		]

		const result = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })
		const skillMsg = result[0]
		const block = (skillMsg.content as any[])[0]
		expect(block.content).toContain("[Historical skill documentation truncated:")
		expect(block.content).toContain("Skill was loaded in this session")
		expect(block.content.length).toBeLessThan(1500)
	})

	it("prevents quadratic history token growth across 25 turns", () => {
		const messages: ApiMessage[] = []
		// Create 25 turns with 10 KB tool output in each turn
		for (let i = 0; i < 25; i++) {
			messages.push({
				role: "assistant",
				content: [{ type: "tool_use", id: `call_${i}`, name: "execute_command", input: {} }],
				ts: i * 2,
			})
			messages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: `call_${i}`,
						content: `Output for step ${i}\n` + "Data: ".repeat(1500) + `\nExit code 0`,
					},
				],
				ts: i * 2 + 1,
			})
		}

		// Raw size without optimization:
		const rawChars = JSON.stringify(messages).length
		// Optimized size:
		const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4, maxHistoricalToolBytes: 2048 })
		const optimizedChars = JSON.stringify(optimized).length

		// Raw size is ~25 * 9 KB ~ 225 KB
		// Optimized size keeps only last 4 messages in full, older 21 messages are truncated to ~800 bytes
		// Reduction should be > 60%
		const reductionPercent = ((rawChars - optimizedChars) / rawChars) * 100
		expect(reductionPercent).toBeGreaterThan(60)
	})
})
