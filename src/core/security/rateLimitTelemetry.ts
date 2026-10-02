const retryAfterPattern = /^(?:\d+(?:\.\d+)?|[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT)$/
const numericLimitPattern = /^\d+(?:\.\d+)?(?:ms|s|m|h)?$/

export function safeRetryAfterHeader(value?: string | null): string | null {
	const trimmed = value?.trim()
	return trimmed && trimmed.length <= 64 && retryAfterPattern.test(trimmed) ? trimmed : null
}

export function safeRateLimitHeaders(headers?: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers || {}).filter(
			([name, value]) => name.startsWith("x-ratelimit-") && value.length <= 64 && numericLimitPattern.test(value),
		),
	)
}
