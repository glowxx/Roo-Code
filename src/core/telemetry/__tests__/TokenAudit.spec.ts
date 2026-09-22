import { describe, it, expect, beforeEach } from "vitest"
import {
	prepareTokenAuditRecord,
	recordRequestTiming,
	recordProviderUsage,
	formatTokenAuditLog,
	isTokenAuditEnabled,
	type TokenAuditRecord,
} from "../TokenAudit"

describe("TokenAudit Telemetry", () => {
	const originalEnv = process.env.ROO_TOKEN_AUDIT

	beforeEach(() => {
		process.env.ROO_TOKEN_AUDIT = "true"
	})

	it("correctly identifies if token audit is enabled", () => {
		process.env.ROO_TOKEN_AUDIT = "true"
		expect(isTokenAuditEnabled()).toBe(true)

		process.env.ROO_TOKEN_AUDIT = "false"
		expect(isTokenAuditEnabled()).toBe(false)

		delete process.env.ROO_TOKEN_AUDIT
		expect(isTokenAuditEnabled()).toBe(false)
	})

	it("prepares token audit record with retryNumber and timing fields", () => {
		const record = prepareTokenAuditRecord({
			taskId: "test-task-123",
			model: "openai/gpt-5.6-terra",
			systemPrompt: "You are a helpful assistant.",
			nativeTools: [],
			messages: [
				{
					role: "user",
					content: "Hello world",
				},
			],
			isRetry: true,
			retryNumber: 2,
			retryReason: "stream_timeout",
			compactionState: "compacting",
		})

		expect(record.taskId).toBe("test-task-123")
		expect(record.model).toBe("openai/gpt-5.6-terra")
		expect(record.isRetry).toBe(true)
		expect(record.retryNumber).toBe(2)
		expect(record.retryReason).toBe("stream_timeout")
		expect(record.compactionState).toBe("compacting")
		expect(record.estimatedInputTokens).toBeGreaterThan(0)
		expect(record.currentContextTokens).toBe(record.estimatedInputTokens)
	})

	it("records request timing metrics properly (both signatures)", () => {
		const record = prepareTokenAuditRecord({
			taskId: "test-task-timing",
			model: "openai/gpt-5.6-terra",
			systemPrompt: "system prompt",
			nativeTools: [],
			messages: [],
		})

		// Signature 1: (record, timing)
		recordRequestTiming(record, {
			timeToFirstChunkMs: 3500,
			lastChunkAgoMs: 150,
			requestDurationMs: 4200,
		})

		expect(record.timeToFirstChunkMs).toBe(3500)
		expect(record.lastChunkAgoMs).toBe(150)
		expect(record.requestDurationMs).toBe(4200)

		// Signature 2: (taskId, record, timing)
		recordRequestTiming("test-task-timing", record, {
			requestDurationMs: 5000,
		})
		expect(record.requestDurationMs).toBe(5000)
	})

	it("formats audit log with all required metrics without secrets", () => {
		const record = prepareTokenAuditRecord({
			taskId: "test-task-log",
			model: "openai/gpt-5.6-terra",
			systemPrompt: "Test system",
			nativeTools: [],
			messages: [{ role: "user", content: "Test message" }],
			isRetry: true,
			retryNumber: 1,
			retryReason: "retry",
		})

		recordRequestTiming(record, {
			timeToFirstChunkMs: 2100,
			requestDurationMs: 3400,
			lastChunkAgoMs: 50,
		})

		const formatted = formatTokenAuditLog(record)
		expect(formatted).toContain("taskId=test-task-log")
		expect(formatted).toContain("model=openai/gpt-5.6-terra")
		expect(formatted).toContain("retryNumber=1")
		expect(formatted).toContain("isRetry=true")
		expect(formatted).toContain("retryReason=retry")
		expect(formatted).toContain("timeToFirstChunkMs=2100")
		expect(formatted).toContain("requestDurationMs=3400")
		expect(formatted).toContain("lastChunkAgoMs=50")
		expect(formatted).toContain("currentContextTokens=")
		expect(formatted).toContain("cumulativeInputTokens=")
	})
})
