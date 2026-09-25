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

	it("strips historical <environment_details> from older turns while preserving them in the active turn", () => {
		const envDetails = "<environment_details>\n# Current Time\n2026-09-22T23:25:43.275Z\n# Current Cost: $0.42\n</environment_details>"
		const messages: ApiMessage[] = [
			{
				role: "user",
				content: `Initial goal\n${envDetails}`,
				ts: 1,
			},
			{ role: "assistant", content: "Working on it", ts: 2 },
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "c1", content: "Result 1" },
					{ type: "text", text: envDetails },
				],
				ts: 3,
			},
			{ role: "assistant", content: "Next step", ts: 4 },
			// Active turn (within recentMessagesPreserved: 2)
			{ role: "assistant", content: "Almost done", ts: 5 },
			{
				role: "user",
				content: `Active instruction\n${envDetails}`,
				ts: 6,
			},
		]

		const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 2 })

		// Message 0 (historical): env details should be stripped to stub
		expect(typeof optimized[0].content).toBe("string")
		expect(optimized[0].content).toContain("Initial goal")
		expect(optimized[0].content).not.toContain("2026-09-22T23:25:43.275Z")
		expect(optimized[0].content).toContain("[Environment details omitted for previous turn]")

		// Message 2 (historical block array): env details text block stripped to stub
		const blocks = optimized[2].content as any[]
		expect(blocks[1].text).toContain("[Environment details omitted for previous turn]")
		expect(blocks[1].text).not.toContain("2026-09-22T23:25:43.275Z")

		// Message 5 (active turn): env details MUST be 100% preserved
		expect(optimized[5].content).toContain(envDetails)
	})

	it("applies Zone 2 cold archive micro-stubs for turns older than warm window", () => {
		const messages: ApiMessage[] = []
		// Create 12 turns (24 messages). With warmTurnsPreserved = 4 and recentMessagesPreserved = 4:
		// Zone 0: messages 20-23 (turns 11-12)
		// Zone 1: messages 12-19 (turns 7-10)
		// Zone 2: messages 0-11 (turns 1-6)
		for (let i = 0; i < 12; i++) {
			messages.push({
				role: "assistant",
				content: [
					{ type: "tool_use", id: `call_cmd_${i}`, name: "execute_command", input: { command: "test" } },
					{ type: "tool_use", id: `call_read_${i}`, name: "read_file", input: { path: `src/file_${i}.ts` } },
				],
				ts: i * 2,
			})
			messages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: `call_cmd_${i}`,
						content: "line 1\nline 2\n" + "x".repeat(3000) + "\nline 50\nexit code: 0",
					},
					{
						type: "tool_result",
						tool_use_id: `call_read_${i}`,
						content: Array.from({ length: 80 }, (_, idx) => `const line${idx} = ${idx};`).join("\n"),
					},
				],
				ts: i * 2 + 1,
			})
		}

		const optimized = optimizeEffectiveApiHistory(messages, {
			recentMessagesPreserved: 4,
			warmTurnsPreserved: 4,
		})

		// Message 1 is in Zone 2 (cold archive):
		const coldMsgBlocks = optimized[1].content as any[]
		// Ephemeral command should be reduced to micro-stub
		expect(coldMsgBlocks[0].content).toContain("[Historical tool output:")
		expect(coldMsgBlocks[0].content).toContain("(exit code: 0). Full output preserved in logs")
		expect(coldMsgBlocks[0].content.length).toBeLessThan(200)

		// Cold code read should be reduced to head/tail navigation stub
		expect(coldMsgBlocks[1].content).toContain("[Historical read_file output for 'src/file_0.ts' (cold turn):")
		expect(coldMsgBlocks[1].content).toContain("--- File Content (Head) ---")
		expect(coldMsgBlocks[1].content).toContain("--- File Content (Tail) ---")

		// Message 15 is in Zone 1 (warm):
		// Code read of 80 lines (< 20 KB) is preserved verbatim in warm memory
		const warmMsgBlocks = optimized[15].content as any[]
		expect(warmMsgBlocks[1].content).not.toContain("(cold turn)")
		expect(warmMsgBlocks[1].content).toContain("const line0 = 0;")
	})

	it("ephemeralizes using-agent-skills and general skill payloads in Zone 2", () => {
		const skillPayload =
			"---\nname: using-agent-skills\ndescription: Discovers and invokes agent skills.\n---\n" +
			"# Using Agent Skills\n\n" +
			"Detailed instructions... ".repeat(300)

		const messages: ApiMessage[] = [
			{ role: "user", content: skillPayload, ts: 1 },
			{ role: "assistant", content: [{ type: "text", text: "Turn 1" }], ts: 2 },
			{ role: "user", content: "Prompt 2", ts: 3 },
			{ role: "assistant", content: [{ type: "text", text: "Turn 2" }], ts: 4 },
			{ role: "user", content: "Prompt 3", ts: 5 },
			{ role: "assistant", content: [{ type: "text", text: "Turn 3" }], ts: 6 },
			{ role: "user", content: "Prompt 4", ts: 7 },
			{ role: "assistant", content: [{ type: "text", text: "Turn 4" }], ts: 8 },
			{ role: "user", content: "Recent prompt", ts: 9 },
			{ role: "assistant", content: [{ type: "text", text: "Recent reply" }], ts: 10 },
		]

		const optimized = optimizeEffectiveApiHistory(messages, {
			recentMessagesPreserved: 2,
			warmTurnsPreserved: 1, // messages 0-5 are in Zone 2
		})

		expect(typeof optimized[0].content).toBe("string")
		const text = optimized[0].content as string
		expect(text).toContain("[Skill instructions loaded in earlier turn")
		expect(text).toContain("Instructions active in session")
		expect(text).toContain("... [Remaining skill documentation omitted in historical turn] ...")
	})
})
