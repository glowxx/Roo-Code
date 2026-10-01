import axios from "axios"
import type { ProviderSettings } from "@roo-code/types"
import { describe, expect, it, vi } from "vitest"

import { createProviderLimitsService, parseXkiroUsage } from "../provider-limits"

const config = { apiProvider: "xkiro", xkiroApiKey: "private-secret" } as ProviderSettings
const usage = {
	plan: "pro",
	windows: [
		{
			kind: "daily",
			window_sec: 86400,
			spent_usd: "1.25",
			cap_usd: "5.00",
			remaining_usd: "3.75",
			resets_in_sec: 300,
		},
	],
	free_tokens: { used_today: 20, limit_per_day: 100, remaining: 80 },
	wallet: { balance_usd: "12.00", held_usd: "0.50" },
}

describe("provider limits", () => {
	it("uses only provider-reported values, including reset time", () => {
		const result = parseXkiroUsage(usage, 1_000)
		expect(result).toMatchObject({
			status: "supported",
			plan: "pro",
			windows: [{ remainingUsd: "3.75", resetAt: 301_000 }],
			freeTokens: { remaining: 80 },
			wallet: { balanceUsd: "12.00" },
		})
		expect(JSON.stringify(result)).not.toContain("private-secret")
	})

	it("leaves absent values absent for partial responses", () => {
		const result = parseXkiroUsage({ windows: [{ kind: "daily", spent_usd: "1.25" }] }, 1_000)
		expect(result.status).toBe("partial")
		expect(result.windows?.[0]).toMatchObject({ spentUsd: "1.25" })
		expect(result.windows?.[0].capUsd).toBeUndefined()
		expect(result.freeTokens).toBeUndefined()
	})

	it("parses free_tokens resetAt when resets_in_sec is reported", () => {
		const result = parseXkiroUsage(
			{
				free_tokens: { used_today: 10, limit_per_day: 100, remaining: 90, resets_in_sec: 1800 },
			},
			10_000,
		)
		expect(result.freeTokens?.resetAt).toBe(10_000 + 1800 * 1000)
	})

	it("derives next midnight UTC for free_tokens resetAt when provider reports daily window without seconds", () => {
		const fetchedAt = new Date("2026-03-31T14:30:00Z").getTime()
		const result = parseXkiroUsage(
			{
				free_tokens: { used_today: 10, limit_per_day: 100, remaining: 90 },
			},
			fetchedAt,
		)
		const expectedMidnight = new Date("2026-04-01T00:00:00Z").getTime()
		expect(result.freeTokens?.resetAt).toBe(expectedMidnight)
	})

	it("does not request unsupported providers or missing credentials", async () => {
		const request = vi.fn().mockResolvedValue(usage)
		const get = createProviderLimitsService(request)
		expect(await get({ apiProvider: "openai" } as ProviderSettings)).toMatchObject({ status: "unsupported" })
		expect(await get({ apiProvider: "xkiro" } as ProviderSettings)).toMatchObject({ status: "missing_auth" })
		expect(request).not.toHaveBeenCalled()
	})

	it("caches, bounds refresh, and scopes results to account key", async () => {
		let time = 1_000
		const request = vi.fn().mockResolvedValue(usage)
		const get = createProviderLimitsService(request, () => time)
		await get(config)
		await get(config)
		await get(config, true)
		expect(request).toHaveBeenCalledTimes(1)
		time += 11_000
		await get(config, true)
		expect(request).toHaveBeenCalledTimes(2)
		await get({ ...config, xkiroApiKey: "other-account" })
		expect(request).toHaveBeenCalledTimes(3)
	})

	it("returns safe errors without disclosing credentials", async () => {
		const request = vi.fn().mockRejectedValue(new Error("private-secret"))
		const get = createProviderLimitsService(request)
		const result = await get(config)
		expect(result).toEqual({ provider: "xkiro", status: "error" })
		expect(JSON.stringify(result)).not.toContain("private-secret")
	})

	it("distinguishes authorization errors", async () => {
		const error = new axios.AxiosError("unauthorized", "ERR_BAD_RESPONSE", undefined, undefined, {
			status: 401,
			data: {},
			statusText: "Unauthorized",
			headers: {},
			config: { headers: new axios.AxiosHeaders() },
		})
		const get = createProviderLimitsService(vi.fn().mockRejectedValue(error))
		expect(await get(config)).toEqual({ provider: "xkiro", status: "auth_error" })
	})
})
