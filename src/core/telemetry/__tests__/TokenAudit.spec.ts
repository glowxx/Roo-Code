import { describe, it, expect, beforeEach } from "vitest"
import {
	prepareTokenAuditRecord,
	formatTokenAuditLog,
	redactSecrets,
	estimateTokens,
	resetTokenAuditForTask,
	recordProviderUsage,
} from "../TokenAudit"

describe("TokenAudit", () => {
	beforeEach(() => {
		resetTokenAuditForTask("test-task-1")
	})

	it("redacts API keys and secrets", () => {
		const raw = "Using key sk-1234567890abcdef and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
		const redacted = redactSecrets(raw)
		expect(redacted).not.toContain("sk-1234567890abcdef")
		expect(redacted).toContain("sk-[REDACTED]")
		expect(redacted).toContain("Bearer [REDACTED]")
	})

	it("estimates tokens locally with zero external requests", () => {
		const text = "1234567890123456" // 16 chars -> ~4 tokens
		expect(estimateTokens(text)).toBe(4)
		expect(estimateTokens({ text: "1234" })).toBe(1)
	})

	it("prepares valid audit record with breakdown and cumulative tracking", () => {
		const record1 = prepareTokenAuditRecord({
			taskId: "test-task-1",
			requestId: "req-1",
			model: "gpt-5.6-terra",
			systemPrompt: "You are a helpful assistant",
			nativeTools: [{ name: "execute_command" }],
			messages: [
				{ role: "user", content: "Hello world" },
				{ role: "assistant", content: "Hi there!" },
			],
		})

		expect(record1.taskId).toBe("test-task-1")
		expect(record1.requestIndex).toBe(1)
		expect(record1.estimatedInputTokens).toBeGreaterThan(0)
		expect(record1.cumulativeInputTokens).toBe(record1.estimatedInputTokens)

		const formatted = formatTokenAuditLog(record1)
		expect(formatted).toContain("[TokenAudit]")
		expect(formatted).toContain("taskId=test-task-1")
		expect(formatted).toContain("estimatedInputTokens=")
		expect(formatted).toContain("cumulativeInputTokens=")

		// Second request should increment index and accumulate
		const record2 = prepareTokenAuditRecord({
			taskId: "test-task-1",
			requestId: "req-2",
			model: "gpt-5.6-terra",
			systemPrompt: "You are a helpful assistant",
			messages: [
				{ role: "user", content: "Hello world again" },
			],
		})

		expect(record2.requestIndex).toBe(2)
		expect(record2.cumulativeInputTokens).toBeGreaterThan(record1.cumulativeInputTokens)
	})

	it("updates cumulative counts when actual provider usage is received", () => {
		const record = prepareTokenAuditRecord({
			taskId: "test-task-1",
			requestId: "req-1",
			model: "gpt-5.6-terra",
			systemPrompt: "Prompt",
			messages: [{ role: "user", content: "User prompt" }],
		})

		recordProviderUsage("test-task-1", record, {
			inputTokens: 1500,
			outputTokens: 80,
			cacheReadTokens: 1200,
		})

		expect(record.providerInputTokens).toBe(1500)
		expect(record.providerCachedInputTokens).toBe(1200)
		expect(record.providerOutputTokens).toBe(80)
		expect(record.cumulativeInputTokens).toBe(1500)
		expect(record.cumulativeOutputTokens).toBe(80)
	})
})
