import { z } from "zod"
import { DynamicProvider, LocalProvider } from "./provider-settings.js"

/**
 * ReasoningEffort
 */

export const reasoningEfforts = ["low", "medium", "high"] as const

export const reasoningEffortsSchema = z.enum(reasoningEfforts)

export type ReasoningEffort = z.infer<typeof reasoningEffortsSchema>

/**
 * ReasoningEffortWithMinimal
 */

export const reasoningEffortWithMinimalSchema = z.union([reasoningEffortsSchema, z.literal("minimal")])

export type ReasoningEffortWithMinimal = z.infer<typeof reasoningEffortWithMinimalSchema>

/**
 * Extended Reasoning Effort (includes "none" and "minimal")
 * Note: "disable" is a UI/control value, not a value sent as effort
 */
export const reasoningEffortsExtended = ["none", "minimal", "low", "medium", "high", "xhigh"] as const

export const reasoningEffortExtendedSchema = z.enum(reasoningEffortsExtended)

export type ReasoningEffortExtended = z.infer<typeof reasoningEffortExtendedSchema>

/**
 * Reasoning Effort user setting (includes "disable")
 */
export const reasoningEffortSettingValues = ["disable", "none", "minimal", "low", "medium", "high", "xhigh"] as const
export const reasoningEffortSettingSchema = z.enum(reasoningEffortSettingValues)

/**
 * Verbosity
 */

export const verbosityLevels = ["low", "medium", "high"] as const

export const verbosityLevelsSchema = z.enum(verbosityLevels)

export type VerbosityLevel = z.infer<typeof verbosityLevelsSchema>

/**
 * Service tiers (OpenAI Responses API)
 */
export const serviceTiers = ["default", "flex", "priority"] as const
export const serviceTierSchema = z.enum(serviceTiers)
export type ServiceTier = z.infer<typeof serviceTierSchema>

/**
 * ModelParameter
 */

export const modelParameters = ["max_tokens", "temperature", "reasoning", "include_reasoning"] as const

export const modelParametersSchema = z.enum(modelParameters)

export type ModelParameter = z.infer<typeof modelParametersSchema>

export const isModelParameter = (value: string): value is ModelParameter =>
	modelParameters.includes(value as ModelParameter)

/**
 * ModelInfo
 */

export const modelInfoSchema = z.object({
	maxTokens: z.number().nullish(),
	maxThinkingTokens: z.number().nullish(),
	contextWindow: z.number(),
	supportsImages: z.boolean().optional(),
	supportsPromptCache: z.boolean(),
	// Optional default prompt cache retention policy for providers that support it.
	// When set to "24h", extended prompt caching will be requested; when omitted
	// or set to "in_memory", the default in‑memory cache is used.
	promptCacheRetention: z.enum(["in_memory", "24h"]).optional(),
	// Capability flag to indicate whether the model supports an output verbosity parameter
	supportsVerbosity: z.boolean().optional(),
	supportsReasoningBudget: z.boolean().optional(),
	// Capability flag to indicate whether the model supports simple on/off binary reasoning
	supportsReasoningBinary: z.boolean().optional(),
	// Capability flag to indicate whether the model supports temperature parameter
	supportsTemperature: z.boolean().optional(),
	defaultTemperature: z.number().optional(),
	requiredReasoningBudget: z.boolean().optional(),
	supportsReasoningEffort: z
		.union([z.boolean(), z.array(z.enum(["disable", "none", "minimal", "low", "medium", "high", "xhigh"]))])
		.optional(),
	reasoningEffortLevels: z
		.array(z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]))
		.optional(),
	requiredReasoningEffort: z.boolean().optional(),
	preserveReasoning: z.boolean().optional(),
	supportedParameters: z.array(modelParametersSchema).optional(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
	cacheWritesPrice: z.number().optional(),
	cacheReadsPrice: z.number().optional(),
	longContextPricing: z
		.object({
			thresholdTokens: z.number(),
			inputPriceMultiplier: z.number().optional(),
			outputPriceMultiplier: z.number().optional(),
			cacheWritesPriceMultiplier: z.number().optional(),
			cacheReadsPriceMultiplier: z.number().optional(),
			appliesToServiceTiers: z.array(serviceTierSchema).optional(),
		})
		.optional(),
	description: z.string().optional(),
	// Default effort value for models that support reasoning effort
	reasoningEffort: reasoningEffortExtendedSchema.optional(),
	minTokensPerCachePoint: z.number().optional(),
	maxCachePoints: z.number().optional(),
	cachableFields: z.array(z.string()).optional(),
	// Flag to indicate if the model is deprecated and should not be used
	deprecated: z.boolean().optional(),
	// Flag to indicate if the model should hide vendor/company identity in responses
	isStealthModel: z.boolean().optional(),
	// Flag to indicate if the model is free (no cost)
	isFree: z.boolean().optional(),
	// Exclude specific native tools from being available (only applies to native protocol)
	// These tools will be removed from the set of tools available to the model
	excludedTools: z.array(z.string()).optional(),
	// Include specific native tools (only applies to native protocol)
	// These tools will be added if they belong to an allowed group in the current mode
	// Cannot force-add tools from groups the mode doesn't allow
	includedTools: z.array(z.string()).optional(),
	/**
	 * Service tiers with pricing information.
	 * Each tier can have a name (for OpenAI service tiers) and pricing overrides.
	 * The top-level input/output/cache* fields represent the default/standard tier.
	 */
	tiers: z
		.array(
			z.object({
				name: serviceTierSchema.optional(), // Service tier name (flex, priority, etc.)
				contextWindow: z.number(),
				inputPrice: z.number().optional(),
				outputPrice: z.number().optional(),
				cacheWritesPrice: z.number().optional(),
				cacheReadsPrice: z.number().optional(),
			}),
		)
		.optional(),
})

export type ModelInfo = z.infer<typeof modelInfoSchema>

export type ModelRecord = Record<string, ModelInfo>

export type RouterModels = Record<DynamicProvider | LocalProvider, ModelRecord>

/**
 * Calculates the context window for a given model ID with a deterministic hierarchy
 * for modern model families, respecting base context or provider overrides.
 *
 * Hierarchy:
 * 1. Claude / Anthropic family:
 *    - Always 200,000 tokens (claude, anthropic, sonnet, opus, haiku regardless of version 3.5, 3.7, 4, 5).
 *    - Provider / router baseContext > 200k cannot inflate Claude context window (explicit custom override takes precedence outside).
 * 2. 1M+ models (explicit patterns and known families):
 *    - Explicit '2m' pattern or Gemini 2M pro variants (1.5-pro, 2.0-pro, 3.0-pro, not flash/2.5) -> 2,000,000.
 *    - Explicit '1m' pattern, 'astra', 'gpt-6' or Gemini family (1.5, 2.0, 2.5, 3.0) -> 1,000,000.
 * 3. 512k explicit pattern -> 524,288.
 * 4. OpenAI o-series & GPT family:
 *    - o1, o3, o4, gpt-5 -> 200,000 (provider metadata > 200k like 400k takes precedence).
 *    - gpt-4o, gpt-4o-mini, gpt-4-turbo -> 128,000.
 * 5. DeepSeek family:
 *    - deepseek-chat, deepseek-reasoner (V3/R1) -> 128,000 by default, supporting 64,000 when specified by provider.
 * 6. Unclassified models from modern series (next, ultra, max, pro, flagship, pro-max, preview-flagship, v5, v6) -> minimum 200,000.
 * 7. Sane default fallback -> 128,000.
 *
 * Provider metadata / baseContext hierarchy:
 * - If baseContext is a valid number > 0:
 *   - For Claude: strictly 200,000 (never inflated by router/provider metadata).
 *   - For DeepSeek: supports 64,000 if provided, otherwise defaults to 128,000 (or higher if valid).
 *   - Generic 128k default should never suppress higher family/flagship limits.
 *   - Provider metadata greater than the determined limit takes precedence (except Claude).
 *   - Known family/flagship limits take precedence over lower baseContext values.
 *   - Real metadata for unclassified models (e.g. 32k, 64k) is preserved.
 */
export function getModelContextWindow(modelId: string, baseContext?: number): number {
	const lower = (modelId || "").toLowerCase()

	// 1. Claude / Anthropic family: ALWAYS 200,000
	// Routers / providers reporting > 200k baseContext must not inflate Claude
	const isClaude =
		lower.includes("claude") ||
		lower.includes("anthropic") ||
		lower.includes("sonnet") ||
		lower.includes("opus") ||
		lower.includes("haiku")

	if (isClaude) {
		return 200_000
	}

	// 2. 1M+ models: exclusively models containing explicit patterns (1m, 2m, astra, gpt-6-astra)
	// or the Gemini family (gemini-1.5, gemini-2.0, gemini-2.5, gemini-3.0)
	const is2mPattern = /(?:^|[\/_\-.:])2m(?:[\/_\-.:]|$)/i.test(lower) || lower.includes("-2m") || lower.includes("_2m")
	const is1mPattern = /(?:^|[\/_\-.:])1m(?:[\/_\-.:]|$)/i.test(lower) || lower.includes("-1m") || lower.includes("_1m")
	const isAstraOrGpt6 = lower.includes("astra") || lower.includes("gpt-6")
	const isGemini = lower.includes("gemini")

	if (is2mPattern) {
		const limit = 2_000_000
		return typeof baseContext === "number" && baseContext > limit ? baseContext : limit
	}

	if (isGemini) {
		const isFlash = lower.includes("flash")
		const is25 = lower.includes("2.5")
		const isPro = lower.includes("pro")
		const isSpecific2MPro =
			lower.includes("1.5-pro") ||
			lower.includes("1.5.pro") ||
			lower.includes("2.0-pro") ||
			lower.includes("2.0.pro") ||
			lower.includes("3.0-pro") ||
			lower.includes("3.0.pro") ||
			lower.includes("3-pro") ||
			lower.includes("3.pro")

		const limit = !isFlash && !is25 && (isSpecific2MPro || isPro) ? 2_000_000 : 1_000_000
		return typeof baseContext === "number" && baseContext > limit ? baseContext : limit
	}

	if (is1mPattern || isAstraOrGpt6) {
		const limit = 1_000_000
		return typeof baseContext === "number" && baseContext > limit ? baseContext : limit
	}

	// 3. 512k pattern
	if (/(?:^|[\/_\-.:])512k(?:[\/_\-.:]|$)/i.test(lower) || lower.includes("-512k") || lower.includes("_512k")) {
		const limit = 524_288
		return typeof baseContext === "number" && baseContext > limit ? baseContext : limit
	}

	// 4. OpenAI o-series & GPT family
	const isOpenAi200k =
		lower.includes("gpt-5") ||
		/(?:^|[\/_\-.:])o[134](?:[\/_\-.:]|$)/i.test(lower) ||
		lower.includes("o1") ||
		lower.includes("o3") ||
		lower.includes("o4")

	if (isOpenAi200k) {
		const limit = 200_000
		if (typeof baseContext === "number" && baseContext > 0) {
			if (baseContext === 128_000) {
				return limit
			}
			if (baseContext > limit) {
				return baseContext
			}
			return limit
		}
		return limit
	}

	const isOpenAi128k = lower.includes("gpt-4o") || lower.includes("gpt-4-turbo")
	if (isOpenAi128k) {
		const limit = 128_000
		if (typeof baseContext === "number" && baseContext > 0) {
			if (baseContext > limit) {
				return baseContext
			}
			return baseContext
		}
		return limit
	}

	// 5. DeepSeek family: deepseek-chat, deepseek-reasoner (V3/R1) -> 64 000 / 128 000 (default 128k, supporting 64k)
	const isDeepSeek =
		lower.includes("deepseek-chat") ||
		lower.includes("deepseek-reasoner") ||
		lower.includes("deepseek-v3") ||
		lower.includes("deepseek-r1")

	if (isDeepSeek) {
		if (typeof baseContext === "number" && baseContext > 0) {
			if (baseContext === 64_000) {
				return 64_000
			}
			if (baseContext === 128_000) {
				return 128_000
			}
			if (baseContext > 128_000) {
				return baseContext
			}
			return baseContext
		}
		return 128_000
	}

	// 6. Unclassified models from modern flagship series
	const isFlagship =
		lower.includes("next") ||
		lower.includes("ultra") ||
		lower.includes("max") ||
		lower.includes("pro") ||
		lower.includes("flagship") ||
		lower.includes("pro-max") ||
		lower.includes("preview-flagship") ||
		lower.includes("v5") ||
		lower.includes("v6")

	const fallbackLimit = isFlagship ? 200_000 : 128_000

	if (typeof baseContext === "number" && baseContext > 0) {
		// Generic 128k default should never suppress higher family/flagship limits
		if (baseContext === 128_000) {
			return Math.max(baseContext, fallbackLimit)
		}

		// Provider metadata greater than the determined limit takes precedence
		if (baseContext > fallbackLimit) {
			return baseContext
		}

		// Real metadata from provider for unclassified models (e.g. 32k, 64k)
		return baseContext
	}

	return fallbackLimit
}

/**
 * Checks whether a model supports reasoning effort based on its ID and optional ModelInfo.
 * Automatically recognizes modern reasoning models like o1, o3, o4, gpt-5, reasoner, thinking models.
 */
export function modelSupportsReasoning(modelId: string, info?: ModelInfo | null): boolean {
	if (info?.supportsReasoningEffort || (info?.reasoningEffortLevels && info.reasoningEffortLevels.length > 0)) {
		return true
	}
	const lower = (modelId || "").toLowerCase()
	return (
		lower.includes("o1") ||
		lower.includes("o3") ||
		lower.includes("o4") ||
		lower.includes("gpt-5") ||
		lower.includes("gpt-6") ||
		lower.includes("astra") ||
		lower.includes("reasoner") ||
		lower.includes("thinking")
	)
}
