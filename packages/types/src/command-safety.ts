import { z } from "zod"
import type { ProviderSettings } from "./provider-settings.js"
import type { ExtensionState } from "./vscode-extension-host.js"

export interface CommandSafetyConfig {
	enabled: boolean
	provider: string
	modelId: string
	apiKey?: string
	customPromptTemplate?: string
}

export const commandSafetyConfigSchema = z.object({
	enabled: z.boolean(),
	provider: z.string(),
	modelId: z.string(),
	apiKey: z.string().optional(),
	customPromptTemplate: z.string().optional(),
})

export const DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE = `Analyze the following command for potential security risks before execution:

Command: {{command}}

Evaluate whether this command is safe to run automatically.
Respond in JSON format with:
- "isSafe": boolean (true if safe to run automatically, false if dangerous or requires user review)
- "riskLevel": "safe" | "low" | "medium" | "high" | "critical"
- "reason": brief explanation`

export type CommandSafetyRiskLevel = "safe" | "low" | "medium" | "high" | "critical"

export interface SafetyEvaluationResult {
	isSafe: boolean
	riskLevel: CommandSafetyRiskLevel
	reason: string
}

/**
 * Resolves the appropriate API key for the safety provider.
 * Falls back to main profile API key if dedicated key is not set.
 */
export function resolveProviderApiKey(provider: string, apiConfig?: ProviderSettings): string | undefined {
	if (!apiConfig) {
		return undefined
	}

	const normalizedProvider = provider.toLowerCase().trim()

	switch (normalizedProvider) {
		case "openai":
			return apiConfig.openAiApiKey || (apiConfig.apiProvider === "openai" ? apiConfig.apiKey : undefined)
		case "anthropic":
			return apiConfig.apiKey || (apiConfig.apiProvider === "anthropic" ? apiConfig.apiKey : undefined)
		case "openrouter":
			return (
				apiConfig.openRouterApiKey || (apiConfig.apiProvider === "openrouter" ? apiConfig.apiKey : undefined)
			)
		case "gemini":
			return apiConfig.geminiApiKey || (apiConfig.apiProvider === "gemini" ? apiConfig.apiKey : undefined)
		case "xkiro":
			return (
				(apiConfig as Record<string, any>).xkiroApiKey ||
				apiConfig.openAiApiKey ||
				(apiConfig.apiProvider === "xkiro" ? apiConfig.apiKey : undefined)
			)
		default:
			if (apiConfig.apiProvider === provider && apiConfig.apiKey) {
				return apiConfig.apiKey
			}
			return undefined
	}
}

/**
 * Checks whether the command safety verification model is configured and ready.
 * Must have enabled === true, valid non-empty provider, valid non-empty modelId,
 * and a valid API key (either custom or inherited from the main profile).
 */
export function isSafetyModelConfigured(state?: Partial<ExtensionState> | null): boolean {
	if (!state || !state.commandSafetyConfig) {
		return false
	}

	const { enabled, provider, modelId, apiKey } = state.commandSafetyConfig

	if (!enabled) {
		return false
	}

	if (!provider || provider.trim() === "") {
		return false
	}

	if (!modelId || modelId.trim() === "") {
		return false
	}

	if (apiKey && apiKey.trim() !== "") {
		return true
	}

	const fallbackKey = resolveProviderApiKey(provider, state.apiConfiguration)
	return Boolean(fallbackKey && fallbackKey.trim() !== "")
}
