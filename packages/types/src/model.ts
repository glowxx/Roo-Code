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
 * 1. Provider API metadata / baseContext: if baseContext is a valid number > 0 and NOT the generic
 *    fallback 128k (or if baseContext is greater than the family limit). If baseContext === 128_000
 *    and the model belongs to a higher-limit family (e.g. 200k, 1M, 2M), the family limit takes precedence!
 * 2. Static database of known model families:
 *    - gpt-5, o1, o3, o4, claude-3-5, claude-3.5, claude-3-7, claude-3.7, claude-3-opus, claude-3-sonnet, claude-3-haiku -> strictly 200,000 (200k).
 *    - gemini:
 *      * gemini-1.5-pro, gemini-2.0-pro, gemini-3.0-pro (and Pro variants not shared with Flash) -> strictly 2,000,000 (2M).
 *      * other gemini-1.5, gemini-2.0, gemini-2.5, gemini-3.0 (including Flash) -> strictly 1,000,000 (1M).
 *    - deepseek-chat, deepseek-reasoner (V3/R1) -> 128,000.
 * 3. Unclassified models suggesting next-gen flagship (flagship, opus, ultra, max, pro-max, preview-flagship, v5) -> minimum 200,000.
 * 4. Sane default fallback -> 128,000.
 */
export function getModelContextWindow(modelId: string, baseContext?: number): number {
	const lower = (modelId || "").toLowerCase()

	// 2. Static database of known model families
	let familyLimit: number | undefined

	if (lower.includes("gemini")) {
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

		if (!isFlash && !is25 && (isSpecific2MPro || isPro)) {
			familyLimit = 2_000_000
		} else {
			familyLimit = 1_000_000
		}
	} else if (
		lower.includes("gpt-5") ||
		lower.includes("o1") ||
		lower.includes("o3") ||
		lower.includes("o4") ||
		lower.includes("claude-3-5") ||
		lower.includes("claude-3.5") ||
		lower.includes("claude-3-7") ||
		lower.includes("claude-3.7") ||
		lower.includes("claude-3-opus") ||
		lower.includes("claude-3.opus") ||
		lower.includes("claude-3-sonnet") ||
		lower.includes("claude-3.sonnet") ||
		lower.includes("claude-3-haiku") ||
		lower.includes("claude-3.haiku")
	) {
		familyLimit = 200_000
	} else if (
		lower.includes("deepseek-chat") ||
		lower.includes("deepseek-reasoner") ||
		lower.includes("deepseek-v3") ||
		lower.includes("deepseek-r1")
	) {
		familyLimit = 128_000
	}

	// 3. New / unclassified models suggesting new-generation flagship
	let fallbackLimit = familyLimit
	if (fallbackLimit === undefined) {
		if (
			lower.includes("flagship") ||
			lower.includes("opus") ||
			lower.includes("ultra") ||
			lower.includes("max") ||
			lower.includes("pro-max") ||
			lower.includes("preview-flagship") ||
			lower.includes("v5")
		) {
			fallbackLimit = 200_000
		} else {
			// 4. Sane default fallback
			fallbackLimit = 128_000
		}
	}

	// 1. Deterministic hierarchy with provider metadata
	const hasValidBase = typeof baseContext === "number" && baseContext > 0

	if (hasValidBase) {
		// Generic 128k default should never suppress higher family/flagship limits
		if (baseContext === 128_000) {
			return Math.max(baseContext, fallbackLimit)
		}

		// Provider metadata greater than the determined limit (e.g. 400k for gpt-5 in xkiro, or custom 1M)
		if (baseContext > fallbackLimit) {
			return baseContext
		}

		// If the model belongs to a known family with higher limit, family limit takes precedence
		if (familyLimit !== undefined) {
			return Math.max(baseContext, familyLimit)
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
	if (info?.supportsReasoningEffort) {
		return true
	}
	const lower = (modelId || "").toLowerCase()
	return (
		lower.includes("o1") ||
		lower.includes("o3") ||
		lower.includes("o4") ||
		lower.includes("gpt-5") ||
		lower.includes("reasoner") ||
		lower.includes("thinking")
	)
}
