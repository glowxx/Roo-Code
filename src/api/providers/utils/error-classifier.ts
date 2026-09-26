/**
 * API Error Classification Utility
 *
 * Distinguishes between transient/retryable provider errors (e.g., 429 rate limits,
 * 502/503/504 gateway glitches, network drops) and deterministic client errors
 * (e.g., 400 bad request, 401/403 auth failures, 404 missing model) to prevent
 * expensive and futile token-wasting retry loops.
 */

export type ApiErrorCategory =
	| "cancelled"
	| "client_error"
	| "auth_error"
	| "not_found"
	| "rate_limit"
	| "server_error"
	| "gateway_error"
	| "network_error"
	| "context_length"
	| "stream_idle"
	| "unknown"

export interface ApiErrorClassification {
	category: ApiErrorCategory
	retryable: boolean
	maxRetries: number
	status?: number
	retryAfterSeconds?: number
	userMessage: string
	isDeterministic: boolean
}

/**
 * Extracts HTTP status code from various provider and SDK error formats.
 */
export function extractHttpStatusCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") {
		return undefined
	}

	const anyErr = error as any

	// Direct status / statusCode properties (OpenAI SDK, Axios, Fetch, Bedrock, etc.)
	if (typeof anyErr.status === "number" && anyErr.status >= 100 && anyErr.status < 600) {
		return anyErr.status
	}
	if (typeof anyErr.statusCode === "number" && anyErr.statusCode >= 100 && anyErr.statusCode < 600) {
		return anyErr.statusCode
	}
	if (typeof anyErr.response?.status === "number" && anyErr.response.status >= 100 && anyErr.response.status < 600) {
		return anyErr.response.status
	}
	if (
		typeof anyErr.$metadata?.httpStatusCode === "number" &&
		anyErr.$metadata.httpStatusCode >= 100 &&
		anyErr.$metadata.httpStatusCode < 600
	) {
		return anyErr.$metadata.httpStatusCode
	}
	if (typeof anyErr.error?.status === "number" && anyErr.error.status >= 100 && anyErr.error.status < 600) {
		return anyErr.error.status
	}

	// Status code embedded in message string
	const message = anyErr.message || String(error)
	const match = message.match(/\b([45]\d\d)\b/)
	if (match) {
		const parsed = parseInt(match[1], 10)
		if (!isNaN(parsed) && parsed >= 400 && parsed < 600) {
			return parsed
		}
	}

	// Canonical server error string check
	if (
		/server error occurred/i.test(message) ||
		/internal server error/i.test(message) ||
		/upstream error/i.test(message)
	) {
		return 500
	}

	return undefined
}

/**
 * Extracts retry-after delay in seconds from HTTP headers or error details.
 */
export function extractRetryAfterSeconds(error: unknown): number | undefined {
	if (!error || typeof error !== "object") {
		return undefined
	}

	const anyErr = error as any

	// Explicit retryAfter property
	if (typeof anyErr.retryAfter === "number" && anyErr.retryAfter > 0) {
		return Math.ceil(anyErr.retryAfter)
	}

	// Standard Retry-After header
	const rawHeader =
		anyErr.headers?.["retry-after"] ??
		anyErr.headers?.["Retry-After"] ??
		(typeof anyErr.headers?.get === "function" ? anyErr.headers.get("retry-after") : undefined) ??
		anyErr.response?.headers?.["retry-after"]

	if (typeof rawHeader === "number" && rawHeader > 0) {
		return Math.ceil(rawHeader)
	}

	if (typeof rawHeader === "string") {
		const parsedNum = parseFloat(rawHeader)
		if (!isNaN(parsedNum) && parsedNum > 0) {
			return Math.ceil(parsedNum)
		}
		const parsedDate = Date.parse(rawHeader)
		if (!isNaN(parsedDate)) {
			const diffSeconds = Math.ceil((parsedDate - Date.now()) / 1000)
			if (diffSeconds > 0) {
				return diffSeconds
			}
		}
	}

	// Google RPC RetryInfo
	if (Array.isArray(anyErr.errorDetails)) {
		const retryInfo = anyErr.errorDetails.find(
			(d: any) => d && d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
		)
		const delayStr = retryInfo?.retryDelay
		if (typeof delayStr === "string") {
			const match = delayStr.match(/^(\d+(?:\.\d+)?)s$/)
			if (match) {
				return Math.ceil(parseFloat(match[1]))
			}
		}
	}

	return undefined
}

/**
 * Classifies an API error into deterministic vs transient categories with bounded retries.
 */
export function classifyApiError(error: unknown): ApiErrorClassification {
	const status = extractHttpStatusCode(error)
	const retryAfterSeconds = extractRetryAfterSeconds(error)

	const anyErr = (error && typeof error === "object" ? error : {}) as any
	const message = anyErr.message || String(error)
	const code = anyErr.code || anyErr.error?.code || ""
	const type = anyErr.type || anyErr.error?.type || ""

	// 0. User Cancellation / AbortError (Deterministic - do not retry, do not treat as provider error)
	if (
		anyErr.name === "AbortError" ||
		code === "ABORT_ERR" ||
		/cancelled by user|aborted by user|request was aborted|the user aborted|operation aborted|user cancelled/i.test(message)
	) {
		return {
			category: "cancelled",
			retryable: false,
			maxRetries: 0,
			status: undefined,
			userMessage: "Request cancelled by user",
			isDeterministic: true,
		}
	}

	// 1. Context length / context window errors (handled specially by Roo auto-compaction)
	if (
		/context window|context length|prompt is too long|maximum context|token limit/i.test(message) ||
		code === "context_length_exceeded" ||
		code === "string_above_max_length"
	) {
		return {
			category: "context_length",
			retryable: false,
			maxRetries: 0,
			status: status ?? 400,
			userMessage: message,
			isDeterministic: true,
		}
	}

	// 2. Authentication & Authorization errors (Deterministic - fail fast)
	// 2. Authentication, Authorization & Billing errors (Deterministic - fail fast)
	if (
		status === 401 ||
		status === 402 ||
		status === 403 ||
		/unauthorized|invalid.?api.?key|forbidden|access denied|permission denied|authentication failed|insufficient balance|payment required|insufficient credits|credits depleted/i.test(
			message,
		) ||
		code === "invalid_api_key" ||
		code === "authentication_error" ||
		code === "insufficient_quota" ||
		code === "insufficient_balance"
	) {
		return {
			category: "auth_error",
			retryable: false,
			maxRetries: 0,
			status: status ?? (code === "insufficient_quota" || /insufficient|balance|credit/i.test(message) ? 402 : 401),
			userMessage: message,
			isDeterministic: true,
		}
	}

	// 3. Not Found (Model ID or endpoint does not exist - Deterministic - fail fast)
	if (
		status === 404 ||
		/model.*not found|model.*does not exist|endpoint.*not found|unknown model/i.test(message) ||
		code === "model_not_found"
	) {
		return {
			category: "not_found",
			retryable: false,
			maxRetries: 0,
			status: 404,
			userMessage: message,
			isDeterministic: true,
		}
	}

	// 4. Bad Request / Client Validation Error (Deterministic - retrying identical payload will always fail)
	if (
		status === 400 ||
		status === 422 ||
		/invalid_request|schema.*violation|unrecognized parameter|not supported by this model|unknown parameter/i.test(
			message,
		) ||
		code === "invalid_request_error" ||
		code === "unprocessable_entity"
	) {
		return {
			category: "client_error",
			retryable: false,
			maxRetries: 0,
			status: status ?? 400,
			userMessage: message,
			isDeterministic: true,
		}
	}

	// 5. Rate Limiting (Transient - retryable with backoff up to 3 times)
	if (
		status === 429 ||
		/rate limit|too many requests|resource exhausted|quota exceeded/i.test(message) ||
		code === "rate_limit_exceeded" ||
		type === "rate_limit_error"
	) {
		return {
			category: "rate_limit",
			retryable: true,
			maxRetries: 3,
			status: 429,
			retryAfterSeconds,
			userMessage: message,
			isDeterministic: false,
		}
	}

	// 6. Gateway / Proxy Errors (Transient - retryable with backoff up to 2 times)
	if (
		status === 502 ||
		status === 503 ||
		status === 504 ||
		code === "service_unavailable" ||
		/bad gateway|service unavailable|gateway timeout|upstream connect error|temporarily at capacity|at capacity|overloaded|server is overloaded/i.test(
			message,
		)
	) {
		return {
			category: "gateway_error",
			retryable: true,
			maxRetries: 2,
			status: status ?? 503,
			userMessage: message,
			isDeterministic: false,
		}
	}

	// 7. Internal Server Error (500)
	// Bounded retry: CLAMP TO AT MOST 1 RETRY to avoid burning tokens on repeating backend crashes
	if (status === 500 || /server error occurred|internal server error/i.test(message)) {
		return {
			category: "server_error",
			retryable: true,
			maxRetries: 1,
			status: 500,
			userMessage: message,
			isDeterministic: false,
		}
	}

	// 8. Stream Idle Timeout / Stalls (Transient - bounded recovery retry of up to 2 attempts)
	if (
		/stream idle timeout|no data received from provider|first chunk timeout|first-chunk timeout|reasoning stream timeout|stream no-progress timeout|heartbeat\/keep-alive frames but no content/i.test(
			message,
		)
	) {
		return {
			category: "stream_idle",
			retryable: true,
			maxRetries: 2,
			retryAfterSeconds: 3,
			status: undefined,
			userMessage: message,
			isDeterministic: false,
		}
	}

	// 9. Network Connection / Socket Errors (Transient - retryable up to 3 times)
	const networkCodes = [
		"ECONNRESET",
		"ETIMEDOUT",
		"ENOTFOUND",
		"ECONNREFUSED",
		"UND_ERR_SOCKET",
		"ERR_STREAM_PREMATURE_CLOSE",
	]
	if (
		networkCodes.includes(code) ||
		/connection reset|socket hang up|network error|econnreset|etimedout|premature close/i.test(message)
	) {
		return {
			category: "network_error",
			retryable: true,
			maxRetries: 3,
			status: undefined,
			userMessage: message,
			isDeterministic: false,
		}
	}

	// 9. Unknown / Unclassified
	// If 5xx, allow 1 retry; otherwise default to 1 bounded retry
	const is5xx = typeof status === "number" && status >= 500 && status < 600
	return {
		category: is5xx ? "server_error" : "unknown",
		retryable: true,
		maxRetries: 1,
		status,
		userMessage: message,
		isDeterministic: false,
	}
}
