import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandSafetyJudge } from "../CommandSafetyJudge"

describe("approval transport", () => {
	afterEach(() => vi.unstubAllGlobals())

	it("exposes HTTP 429 and Retry-After after one request without hidden SDK retries", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: { message: "Rate limited", type: "rate_limit_error", code: "rate_limit_exceeded" },
					}),
					{
						status: 429,
						headers: {
							"content-type": "application/json",
							"retry-after": "1",
							"x-ratelimit-remaining": "0",
						},
					},
				),
		)
		vi.stubGlobal("fetch", fetchMock)
		const transportStart = vi.fn()
		const transportResponse = vi.fn()
		const judge = new CommandSafetyJudge()

		await expect(
			judge.callProviderDetails({
				provider: "xkiro",
				modelId: "qwen/qwen3.8-omni-flash:free",
				apiKey: "sanitized-test-key",
				managedRetry: true,
				systemPrompt: "Return JSON",
				userPrompt: "Approve this harmless action",
				signal: new AbortController().signal,
				onTransportStart: transportStart,
				onTransportResponse: transportResponse,
			}),
		).rejects.toMatchObject({ status: 429 })

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(transportStart).toHaveBeenCalledTimes(1)
		expect(transportResponse).toHaveBeenCalledWith(429, expect.any(Number), "1", {
			"x-ratelimit-remaining": "0",
		})
	})
})
