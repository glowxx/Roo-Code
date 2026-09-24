import { describe, it, expect } from "vitest"
import {
	classifyApiError,
	extractHttpStatusCode,
	extractRetryAfterSeconds,
} from "../error-classifier"

describe("error-classifier", () => {
	describe("extractHttpStatusCode", () => {
		it("extracts status from direct status field", () => {
			expect(extractHttpStatusCode({ status: 500 })).toBe(500)
			expect(extractHttpStatusCode({ status: 429 })).toBe(429)
			expect(extractHttpStatusCode({ status: 400 })).toBe(400)
		})

		it("extracts statusCode from error object", () => {
			expect(extractHttpStatusCode({ statusCode: 503 })).toBe(503)
		})

		it("extracts status from nested response.status", () => {
			expect(extractHttpStatusCode({ response: { status: 502 } })).toBe(502)
		})

		it("extracts status from AWS $metadata.httpStatusCode", () => {
			expect(extractHttpStatusCode({ $metadata: { httpStatusCode: 403 } })).toBe(403)
		})

		it("extracts status from error.error.status", () => {
			expect(extractHttpStatusCode({ error: { status: 404 } })).toBe(404)
		})

		it("extracts status embedded in message string", () => {
			expect(extractHttpStatusCode(new Error("500 Internal Server Error"))).toBe(500)
			expect(extractHttpStatusCode(new Error("Request failed with status code 429"))).toBe(429)
		})

		it("infers 500 for canonical 'A server error occurred' message", () => {
			expect(extractHttpStatusCode(new Error("A server error occurred. Please try again."))).toBe(500)
			expect(extractHttpStatusCode({ message: "Internal server error occurred while processing" })).toBe(500)
		})

		it("returns undefined for unrecognized errors without status", () => {
			expect(extractHttpStatusCode(new Error("Something completely unknown"))).toBeUndefined()
			expect(extractHttpStatusCode(null)).toBeUndefined()
			expect(extractHttpStatusCode(123)).toBeUndefined()
		})
	})

	describe("extractRetryAfterSeconds", () => {
		it("extracts numeric retryAfter property", () => {
			expect(extractRetryAfterSeconds({ retryAfter: 15 })).toBe(15)
		})

		it("extracts from headers object (string seconds)", () => {
			expect(extractRetryAfterSeconds({ headers: { "retry-after": "30" } })).toBe(30)
			expect(extractRetryAfterSeconds({ headers: { "Retry-After": "45" } })).toBe(45)
		})

		it("extracts from headers with .get() method", () => {
			const headers = new Headers()
			headers.set("retry-after", "20")
			expect(extractRetryAfterSeconds({ headers })).toBe(20)
		})

		it("extracts from Google RPC RetryInfo errorDetails", () => {
			const error = {
				errorDetails: [
					{
						"@type": "type.googleapis.com/google.rpc.RetryInfo",
						retryDelay: "12s",
					},
				],
			}
			expect(extractRetryAfterSeconds(error)).toBe(12)
		})

		it("returns undefined if no retry-after info present", () => {
			expect(extractRetryAfterSeconds({})).toBeUndefined()
			expect(extractRetryAfterSeconds(new Error("foo"))).toBeUndefined()
		})
	})

	describe("classifyApiError", () => {
		it("classifies 400 Bad Request as non-retryable client_error", () => {
			const res = classifyApiError({ status: 400, message: "Invalid request payload schema" })
			expect(res.category).toBe("client_error")
			expect(res.retryable).toBe(false)
			expect(res.maxRetries).toBe(0)
			expect(res.isDeterministic).toBe(true)
		})

		it("classifies 401 Unauthorized as non-retryable auth_error", () => {
			const res = classifyApiError({ status: 401, message: "Invalid API Key provided" })
			expect(res.category).toBe("auth_error")
			expect(res.retryable).toBe(false)
			expect(res.maxRetries).toBe(0)
			expect(res.isDeterministic).toBe(true)
		})

		it("classifies 403 Forbidden as non-retryable auth_error", () => {
			const res = classifyApiError({ status: 403, message: "Access denied" })
			expect(res.category).toBe("auth_error")
			expect(res.retryable).toBe(false)
			expect(res.maxRetries).toBe(0)
			expect(res.isDeterministic).toBe(true)
		})

		it("classifies 404 Model Not Found as non-retryable not_found", () => {
			const res = classifyApiError({ status: 404, message: "The model `qwen-invalid` does not exist" })
			expect(res.category).toBe("not_found")
			expect(res.retryable).toBe(false)
			expect(res.maxRetries).toBe(0)
			expect(res.isDeterministic).toBe(true)
		})

		it("classifies 429 Rate Limit as retryable with up to 3 retries", () => {
			const res = classifyApiError({
				status: 429,
				message: "Rate limit exceeded",
				headers: { "retry-after": "5" },
			})
			expect(res.category).toBe("rate_limit")
			expect(res.retryable).toBe(true)
			expect(res.maxRetries).toBe(3)
			expect(res.retryAfterSeconds).toBe(5)
			expect(res.isDeterministic).toBe(false)
		})

		it("classifies 500 Internal Server Error as bounded retry with MAX 1 RETRY", () => {
			const res = classifyApiError(new Error("A server error occurred. Please try again."))
			expect(res.category).toBe("server_error")
			expect(res.retryable).toBe(true)
			expect(res.maxRetries).toBe(1)
			expect(res.status).toBe(500)
			expect(res.isDeterministic).toBe(false)
		})

		it("classifies 502/503/504 as gateway_error with max 2 retries", () => {
			const res = classifyApiError({ status: 503, message: "Service Unavailable" })
			expect(res.category).toBe("gateway_error")
			expect(res.retryable).toBe(true)
			expect(res.maxRetries).toBe(2)
			expect(res.isDeterministic).toBe(false)
		})

		it("classifies network socket errors (ECONNRESET) as network_error with max 3 retries", () => {
			const res = classifyApiError({ code: "ECONNRESET", message: "Connection reset by peer" })
			expect(res.category).toBe("network_error")
			expect(res.retryable).toBe(true)
			expect(res.maxRetries).toBe(3)
			expect(res.isDeterministic).toBe(false)
		})

		it("classifies stream idle timeout as stream_idle with bounded 1 retry", () => {
			const res = classifyApiError(new Error("Stream idle timeout: no data received from provider for 45 seconds"))
			expect(res.category).toBe("stream_idle")
			expect(res.retryable).toBe(true)
			expect(res.maxRetries).toBe(1)
			expect(res.isDeterministic).toBe(false)
		})

		it("preserves 503 Service Unavailable as gateway_error distinctly separate from stream_idle", () => {
			const res503 = classifyApiError({ status: 503, message: "Service Unavailable" })
			expect(res503.category).toBe("gateway_error")
			expect(res503.category).not.toBe("stream_idle")
			expect(res503.maxRetries).toBe(2)

			const resIdle = classifyApiError(new Error("no data received from provider for 75 seconds"))
			expect(resIdle.category).toBe("stream_idle")
			expect(resIdle.category).not.toBe("gateway_error")
			expect(resIdle.maxRetries).toBe(1)
		})

		it("classifies context length exceeded as non-retryable context_length", () => {
			const res = classifyApiError(new Error("prompt is too long: maximum context length exceeded"))
			expect(res.category).toBe("context_length")
			expect(res.retryable).toBe(false)
			expect(res.maxRetries).toBe(0)
			expect(res.isDeterministic).toBe(true)
		})
	})
})
