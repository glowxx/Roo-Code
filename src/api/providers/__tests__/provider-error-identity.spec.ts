import { describe, it, expect, vi } from "vitest"
import { buildApiHandler } from "../../index"
import { OpenAiHandler } from "../openai"
import { handleOpenAIError, handleProviderError } from "../utils/error-handler"
import { classifyApiError } from "../utils/error-classifier"

describe("Provider Error Identity & Classification", () => {
	it("xkiro + OpenAI-compatible + 503 -> error message says xKiro, not OpenAI", async () => {
		const handler = buildApiHandler({
			apiProvider: "xkiro",
			apiKey: "test-key",
			xkiroModelId: "qwen/qwen3.8-max",
		}) as OpenAiHandler

		const mockError = new Error("503 A server error occurred. Please try again.") as any
		mockError.status = 503
		mockError.code = "service_unavailable"
		;(handler as any).client = {
			chat: {
				completions: {
					create: vi.fn().mockRejectedValue(mockError),
				},
			},
		}

		await expect(async () => {
			for await (const _ of handler.createMessage("sys", [{ role: "user", content: "hi" }])) {
				// consume
			}
		}).rejects.toThrowError(/xKiro completion error: 503/)

		try {
			for await (const _ of handler.createMessage("sys", [{ role: "user", content: "hi" }])) {
				// consume
			}
		} catch (err: any) {
			expect(err.message).not.toContain("OpenAI")
			expect(err.message).toContain("xKiro completion error")
			expect(err.provider).toBe("xKiro")
			expect(err.protocol).toBe("openai-compatible")
			expect(err.status).toBe(503)
		}
	})

	it("openai provider + 503 -> error message says OpenAI", async () => {
		const handler = buildApiHandler({
			apiProvider: "openai",
			apiKey: "test-key",
			openAiModelId: "gpt-4o",
		}) as OpenAiHandler

		const mockError = new Error("503 A server error occurred. Please try again.") as any
		mockError.status = 503
		;(handler as any).client = {
			chat: {
				completions: {
					create: vi.fn().mockRejectedValue(mockError),
				},
			},
		}

		try {
			for await (const _ of handler.createMessage("sys", [{ role: "user", content: "hi" }])) {
				// consume
			}
		} catch (err: any) {
			expect(err.message).toContain("OpenAI completion error")
			expect(err.provider).toBe("OpenAI")
			expect(err.protocol).toBe("openai-compatible")
			expect(err.status).toBe(503)
		}
	})

	it("xkiro + 503 -> protocol=openai-compatible retained internally on error", () => {
		const upstreamError = {
			status: 503,
			message: "A server error occurred. Please try again.",
			error: {
				message: "A server error occurred. Please try again.",
				type: "server_error",
				code: "service_unavailable",
			},
		}

		const result = handleOpenAIError(upstreamError, "xKiro", {
			modelId: "qwen/qwen3.8-max",
			protocol: "openai-compatible",
		}) as any

		expect(result.provider).toBe("xKiro")
		expect(result.protocol).toBe("openai-compatible")
		expect(result.providerMeta).toMatchObject({
			provider: "xKiro",
			protocol: "openai-compatible",
			model: "qwen/qwen3.8-max",
			category: "gateway_error",
			retryable: true,
		})
	})

	it("xkiro service_unavailable -> retryable=true", () => {
		const err = {
			status: 503,
			code: "service_unavailable",
			message: "A server error occurred. Please try again.",
		}
		const classified = classifyApiError(err)
		expect(classified.category).toBe("gateway_error")
		expect(classified.retryable).toBe(true)
		expect(classified.maxRetries).toBe(2)
		expect(classified.isDeterministic).toBe(false)
	})

	it("402 Payment Required -> not treated as 503 (category: auth_error, retryable: false)", () => {
		const err = {
			status: 402,
			message: "Insufficient balance in account",
		}
		const classified = classifyApiError(err)
		expect(classified.category).toBe("auth_error")
		expect(classified.retryable).toBe(false)
		expect(classified.maxRetries).toBe(0)
		expect(classified.isDeterministic).toBe(true)

		const handled = handleProviderError(err, "xKiro") as any
		expect(handled.category).toBe("auth_error")
		expect(handled.retryable).toBe(false)
	})

	it("429 Rate Limit -> remains category: rate_limit, retryable: true", () => {
		const err = {
			status: 429,
			message: "Rate limit exceeded",
			headers: { "retry-after": "10" },
		}
		const classified = classifyApiError(err)
		expect(classified.category).toBe("rate_limit")
		expect(classified.retryable).toBe(true)
		expect(classified.maxRetries).toBe(3)
		expect(classified.retryAfterSeconds).toBe(10)
		expect(classified.isDeterministic).toBe(false)
	})
})
