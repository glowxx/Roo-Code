import { describe, it, expect } from "vitest"
import { optimizeEffectiveApiHistory, DEFAULT_MAX_READ_FILE_BYTES } from "../effectiveContext"
import { ApiMessage } from "../../task-persistence/apiMessages"

describe("Type-Aware Retention & Quality Preservation (SUBAGENT B AUDIT)", () => {
	it("preserves read_file source code across multiple intermediate turns preventing diff hallucination", () => {
		// Realistic scenario: 150 lines / ~5 KB source code file
		const originalSourceCode = `// src/services/billing.ts
import { PaymentGateway } from "./gateway"
import { TaxCalculator } from "./tax"
import { InvoiceGenerator } from "./invoice"

export class BillingService {
    private gateway: PaymentGateway
    private taxCalculator: TaxCalculator

    constructor(gateway: PaymentGateway, tax: TaxCalculator) {
        this.gateway = gateway
        this.taxCalculator = tax
    }

    // Critical middle function that the agent will edit later with apply_diff
    public async calculateTaxes(amount: number, region: string): Promise<number> {
        const rate = await this.taxCalculator.getRateForRegion(region)
        const totalTax = amount * rate
        return totalTax
    }

    public async processPayment(userId: string, amount: number): Promise<boolean> {
        const success = await this.gateway.charge(userId, amount)
        return success
    }
}
` + "// Padding line to reach realistic ~5KB size\n".repeat(100)

		const largeTestOutput = "PASS test/billing.test.ts\n" + "Log line: verbose test data...\n".repeat(400) + "Finished with exit code 0"
		const largeSearchOutput = "src/services/billing.ts\n" + "src/services/other.ts:42: const rate = 0.2\n".repeat(200)
		const largeTypecheckOutput = "TypeScript typecheck output...\n".repeat(150) + "exit code: 0"

		const messages: ApiMessage[] = [
			// Turn 1: User asks to fix billing service, agent reads file
			{
				role: "user",
				content: "Please update the tax calculation logic in src/services/billing.ts",
				ts: 1,
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_read_billing",
						name: "read_file",
						input: { path: "src/services/billing.ts" },
					},
				],
				ts: 2,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_read_billing",
						content: `File: src/services/billing.ts\n${originalSourceCode}`,
					},
				],
				ts: 3,
			},

			// Turn 2: Agent executes test suite (intermediate ephemeral operation)
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_cmd_test",
						name: "execute_command",
						input: { command: "npm test" },
					},
				],
				ts: 4,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_cmd_test",
						content: largeTestOutput,
					},
				],
				ts: 5,
			},

			// Turn 3: Agent searches for tax rates (intermediate ephemeral operation)
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_search_tax",
						name: "search_files",
						input: { path: "src", regex: "TAX_RATES" },
					},
				],
				ts: 6,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_search_tax",
						content: largeSearchOutput,
					},
				],
				ts: 7,
			},

			// Turn 4: Agent runs typecheck (intermediate ephemeral operation)
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_cmd_typecheck",
						name: "execute_command",
						input: { command: "npm run typecheck" },
					},
				],
				ts: 8,
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_cmd_typecheck",
						content: largeTypecheckOutput,
					},
				],
				ts: 9,
			},

			// Turn 5: Agent is now about to apply diff to billing.ts (active turn)
			{
				role: "assistant",
				content: "I have all information needed. Now applying diff to src/services/billing.ts...",
				ts: 10,
			},
			{
				role: "user",
				content: "Proceed.",
				ts: 11,
			},
		]

		// Run optimization with default options (recentMessagesPreserved = 4)
		// Turn 1 (indices 0, 1, 2) is 8 messages behind the tail, well outside recentMessagesPreserved!
		const optimized = optimizeEffectiveApiHistory(messages)

		// 1. Verify read_file output is 100% UNTOUCHED
		const billingResultMsg = optimized[2]
		const billingBlock = (billingResultMsg.content as any[])[0]
		expect(billingBlock.content).toBe(`File: src/services/billing.ts\n${originalSourceCode}`)

		// Crucial verification: The middle function that needs diff matching is verbatim intact!
		expect(billingBlock.content).toContain("public async calculateTaxes(amount: number, region: string): Promise<number>")
		expect(billingBlock.content).toContain("const totalTax = amount * rate")

		// 2. Verify intermediate ephemeral operations ARE aggressively truncated
		// Test output (index 4) should be truncated
		const testResultMsg = optimized[4]
		const testBlock = (testResultMsg.content as any[])[0]
		expect(testBlock.content).toContain("[Historical tool output truncated:")
		expect(testBlock.content).toContain("(exit code: 0)")
		expect(testBlock.content.length).toBeLessThan(2000)

		// Search output (index 6) should be truncated
		const searchResultMsg = optimized[6]
		const searchBlock = (searchResultMsg.content as any[])[0]
		expect(searchBlock.content).toContain("[Historical tool output truncated:")
		expect(searchBlock.content.length).toBeLessThan(2000)

		// 3. Verify total token savings while preserving code quality
		const rawChars = JSON.stringify(messages).length
		const optimizedChars = JSON.stringify(optimized).length
		expect(optimizedChars).toBeLessThan(rawChars)
	})

	it("preserves code files up to 20 KB (maxReadFileBytes) across older turns", () => {
		// 18 KB source file (~450 lines)
		const source18KB = "function test() {\n" + "    console.log('step');\n".repeat(450) + "}\n"
		expect(Buffer.byteLength(source18KB, "utf8")).toBeGreaterThan(10000)
		expect(Buffer.byteLength(source18KB, "utf8")).toBeLessThan(DEFAULT_MAX_READ_FILE_BYTES)

		const messages: ApiMessage[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "call_read", name: "read_file", input: { path: "large.ts" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_read", content: `File: large.ts\n${source18KB}` }] },
			// 4 subsequent messages to push it into historical window
			{ role: "assistant", content: "Step 1" },
			{ role: "user", content: "OK 1" },
			{ role: "assistant", content: "Step 2" },
			{ role: "user", content: "OK 2" },
		]

		const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })
		const readBlock = (optimized[1].content as any[])[0]
		// Under the old 2 KB limit, this 18 KB file would be destroyed!
		// Under Type-Aware Retention, it must be 100% preserved.
		expect(readBlock.content).toBe(`File: large.ts\n${source18KB}`)
	})

	it("gracefully truncates massive files (> 20 KB) with rich preview and offset/limit guidance", () => {
		// 35 KB file
		const massiveCode = "// Header lines 1-10\n" + "const val = 1234567890;\n".repeat(1500) + "// Tail lines\n"
		const byteLen = Buffer.byteLength(massiveCode, "utf8")
		expect(byteLen).toBeGreaterThan(30000)

		const messages: ApiMessage[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "call_big", name: "read_file", input: { path: "src/massive.ts" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_big", content: `File: src/massive.ts\n${massiveCode}` }] },
			{ role: "assistant", content: "A" },
			{ role: "user", content: "B" },
			{ role: "assistant", content: "C" },
			{ role: "user", content: "D" },
		]

		const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })
		const block = (optimized[1].content as any[])[0]
		expect(block.content).toContain("[Historical read_file output for 'src/massive.ts' partially truncated:")
		expect(block.content).toContain("To inspect intermediate lines, re-read with offset/limit.")
		expect(block.content).toContain("--- File Content (Head) ---")
		expect(block.content).toContain("--- File Content (Tail) ---")
		// Head preview contains 2048 bytes
		expect(block.content.length).toBeGreaterThan(4000)
		expect(block.content.length).toBeLessThan(10000)
	})

	it("preserves skill documentation up to 16 KB across turns", () => {
		const skill8KB = "Skill: graphify\n--- Skill Instructions ---\n" + "Rule: Always query graph first before editing.\n".repeat(160)
		const byteLen = Buffer.byteLength(skill8KB, "utf8")
		expect(byteLen).toBeGreaterThan(7000)
		expect(byteLen).toBeLessThan(16000)

		const messages: ApiMessage[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "call_skill", name: "skill", input: { skill: "graphify" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_skill", content: skill8KB }] },
			{ role: "assistant", content: "Got skill" },
			{ role: "user", content: "Next" },
			{ role: "assistant", content: "Working" },
			{ role: "user", content: "Done" },
		]

		const optimized = optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })
		const block = (optimized[1].content as any[])[0]
		// Skill is under 16 KB -> 100% preserved
		expect(block.content).toBe(skill8KB)
	})

	it("does NOT mutate original input messages (strict immutability)", () => {
		const originalTestOutput = "Test stdout: " + "X".repeat(5000)
		const messages: ApiMessage[] = [
			{ role: "assistant", content: [{ type: "tool_use", id: "c1", name: "execute_command", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: originalTestOutput }] },
			{ role: "assistant", content: "1" },
			{ role: "user", content: "2" },
			{ role: "assistant", content: "3" },
			{ role: "user", content: "4" },
		]

		optimizeEffectiveApiHistory(messages, { recentMessagesPreserved: 4 })

		// Original array content must remain unmodified
		const origBlock = (messages[1].content as any[])[0]
		expect(origBlock.content).toBe(originalTestOutput)
	})
})
