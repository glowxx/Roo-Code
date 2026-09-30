/** Account usage values returned by a provider. Monetary amounts retain the provider's decimal strings. */
export interface ProviderLimits {
	provider: string
	status: "supported" | "partial" | "unsupported" | "missing_auth" | "auth_error" | "error"
	source?: string
	fetchedAt?: number
	plan?: string
	windows?: Array<{
		kind: string
		windowSeconds?: number
		spentUsd?: string
		capUsd?: string
		remainingUsd?: string
		resetAt?: number
	}>
	freeTokens?: { usedToday?: number; limitPerDay?: number; remaining?: number }
	wallet?: { balanceUsd?: string; heldUsd?: string }
}
