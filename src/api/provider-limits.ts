import { createHash } from "crypto"
import axios from "axios"

import type { ProviderLimits, ProviderSettings } from "@roo-code/types"

type Request = (url: string, apiKey: string) => Promise<unknown>
type Clock = () => number

const object = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined
const string = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const number = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
const amount = (value: unknown): string | undefined =>
	typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? value : undefined

export function parseXkiroUsage(raw: unknown, fetchedAt: number): ProviderLimits {
	const data = object(raw)
	if (!data) throw new Error("Invalid usage response")
	const rawWindows = data.windows
	const windows = Array.isArray(rawWindows)
		? rawWindows.flatMap((item) => {
				const entry = object(item)
				if (!entry || !string(entry.kind)) return []
				const resetSeconds = number(entry.resets_in_sec)
				return [
					{
						kind: string(entry.kind)!,
						windowSeconds: number(entry.window_sec),
						spentUsd: amount(entry.spent_usd),
						capUsd: amount(entry.cap_usd),
						remainingUsd: amount(entry.remaining_usd),
						resetAt: resetSeconds === undefined ? undefined : fetchedAt + resetSeconds * 1000,
					},
				]
			})
		: undefined
	const rawFree = object(data.free_tokens)
	const freeTokens = rawFree && {
		usedToday: number(rawFree.used_today),
		limitPerDay: number(rawFree.limit_per_day),
		remaining: number(rawFree.remaining),
	}
	const rawWallet = object(data.wallet)
	const wallet = rawWallet && { balanceUsd: amount(rawWallet.balance_usd), heldUsd: amount(rawWallet.held_usd) }
	const hasData = Boolean(windows?.length || freeTokens || wallet)
	return {
		provider: "xkiro",
		status: hasData ? (windows?.length && freeTokens && wallet ? "supported" : "partial") : "partial",
		source: "GET /v1/usage",
		fetchedAt,
		plan: string(data.plan),
		windows,
		freeTokens: freeTokens || undefined,
		wallet: wallet || undefined,
	}
}

const defaultRequest: Request = async (url, apiKey) => {
	const response = await axios.get(url, {
		headers: { Authorization: `Bearer ${apiKey}` },
		timeout: 10_000,
		maxContentLength: 128 * 1024,
	})
	return response.data
}

/** Cache is scoped to the configured endpoint and a hash of its key; neither is sent to the webview. */
export function createProviderLimitsService(request: Request = defaultRequest, now: Clock = Date.now) {
	const cache = new Map<string, { value: ProviderLimits; at: number }>()
	const inFlight = new Map<string, Promise<ProviderLimits>>()
	return async (config: ProviderSettings, refresh = false): Promise<ProviderLimits> => {
		const provider = config.apiProvider || "xkiro"
		if (provider !== "xkiro") return { provider, status: "unsupported" }
		const apiKey = config.xkiroApiKey || config.apiKey || config.openAiApiKey
		if (!apiKey) return { provider, status: "missing_auth" }
		const baseUrl = (config.xkiroBaseUrl || config.openAiBaseUrl || "https://api.xkiro.com/v1").replace(/\/+$/, "")
		const cacheKey = createHash("sha256").update(`${baseUrl}\0${apiKey}`).digest("hex")
		const cached = cache.get(cacheKey)
		// A manual refresh can bypass the normal TTL, but repeated clicks stay bounded.
		if (cached && now() - cached.at < (refresh ? 10_000 : 60_000)) return cached.value
		const pending = inFlight.get(cacheKey)
		if (pending) return pending
		const promise: Promise<ProviderLimits> = (async () => {
			try {
				const value = parseXkiroUsage(await request(`${baseUrl}/usage`, apiKey), now())
				cache.set(cacheKey, { value, at: now() })
				if (cache.size > 8) cache.delete(cache.keys().next().value!)
				return value
			} catch (error) {
				const status = axios.isAxiosError(error) ? error.response?.status : undefined
				return { provider, status: status === 401 || status === 403 ? "auth_error" : "error" }
			} finally {
				inFlight.delete(cacheKey)
			}
		})()
		inFlight.set(cacheKey, promise)
		return promise
	}
}

export const getProviderLimits = createProviderLimitsService()
