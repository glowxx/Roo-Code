import type { ModelInfo } from "./model.js"

/**
 * Formats a single model token with intelligent casing:
 * - Specific brand/tech acronyms: GPT, AI, LLM, API, VL, DALL-E, etc.
 * - Hardware / model sizes: 7B, 8B, 14B, 32B, 70B, 1M, 2M, etc.
 * - Known release/version tags: R1, R2, V1, V2, V3, etc.
 * - OpenAI o-series tokens: o1, o3, o4
 * - Single letters: X, V, R
 * - Established family/brand casing: DeepSeek, Claude, Gemini, Qwen, Llama, Mistral
 * - Default: Capitalize first character
 */
export function formatModelToken(token: string): string {
	if (!token) return ""
	const lower = token.toLowerCase()

	// Pure numbers and version numbers (e.g. "4", "3.5", "20250219")
	if (/^[0-9]+(?:\.[0-9]+)?$/.test(token)) {
		return token
	}

	// Well-known uppercase acronyms
	if (lower === "gpt") return "GPT"
	if (lower === "ai") return "AI"
	if (lower === "llm") return "LLM"
	if (lower === "api") return "API"
	if (lower === "vl") return "VL"
	if (lower === "oss") return "OSS"
	if (lower === "dall-e" || lower === "dalle") return "DALL-E"

	// Provider / family names with established casing
	if (lower === "deepseek") return "DeepSeek"
	if (lower === "claude") return "Claude"
	if (lower === "gemini") return "Gemini"
	if (lower === "qwen") return "Qwen"
	if (lower === "llama") return "Llama"
	if (lower === "mistral") return "Mistral"
	if (lower === "codestral") return "Codestral"
	if (lower === "openai") return "OpenAI"
	if (lower === "anthropic") return "Anthropic"

	// Parameter sizes (e.g. 7b, 8b, 14b, 32b, 70b, 1m, 2m)
	if (/^[0-9]+[bm]$/i.test(token)) {
		return token.toUpperCase()
	}

	// Release / version tags (e.g. v1, v2, v3, r1, r2, r3)
	if (/^[vr][0-9]+(?:\.[0-9]+)?$/i.test(token)) {
		return token.toUpperCase()
	}

	// OpenAI o-series tokens (e.g. o1, o3, o4)
	if (/^o[0-9]+$/i.test(token)) {
		return token.toLowerCase()
	}

	// Single letter tokens (e.g. "Model X")
	if (token.length === 1) {
		return token.toUpperCase()
	}

	// Default: Capitalize first letter, lowercase rest
	return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

/**
 * Splits a phrase on hyphens, underscores, or spaces and formats each token.
 */
export function formatModelWords(text: string): string {
	if (!text) return ""
	return text
		.split(/[-_\s]+/)
		.filter((t) => t.length > 0)
		.map(formatModelToken)
		.join(" ")
}

/**
 * Canonical display names for models whose technical ID differs completely
 * from their user-facing marketing name (e.g. deepseek-chat -> DeepSeek V3).
 */
const CANONICAL_MODEL_NAMES: Record<string, string> = {
	"deepseek/deepseek-chat": "DeepSeek V3",
	"deepseek-chat": "DeepSeek V3",
	"deepseek/deepseek-reasoner": "DeepSeek R1",
	"deepseek-reasoner": "DeepSeek R1",
	"deepseek/deepseek-r1": "DeepSeek R1",
	"deepseek-r1": "DeepSeek R1",
	"deepseek/deepseek-v3": "DeepSeek V3",
	"deepseek-v3": "DeepSeek V3",
	"deepseek/deepseek-r2": "DeepSeek R2",
	"deepseek-r2": "DeepSeek R2",
	"deepseek/deepseek-v4": "DeepSeek V4",
	"deepseek-v4": "DeepSeek V4",
	"openai/gpt-4o": "GPT-4o",
	"gpt-4o": "GPT-4o",
	"openai/gpt-4o-mini": "GPT-4o Mini",
	"gpt-4o-mini": "GPT-4o Mini",
	"openai/o1": "o1",
	"o1": "o1",
	"openai/o1-mini": "o1-mini",
	"o1-mini": "o1-mini",
	"openai/o1-preview": "o1-preview",
	"o1-preview": "o1-preview",
	"openai/o3": "o3",
	"o3": "o3",
	"openai/o3-mini": "o3-mini",
	"o3-mini": "o3-mini",
	"openai/o4": "o4",
	"o4": "o4",
	"openai/o4-mini": "o4-mini",
	"o4-mini": "o4-mini",
}

/**
 * Formats a model ID into a user-friendly display name using a 3-tier hierarchy:
 * 1. Provider-supplied display name (from /models API or ModelInfo.displayName)
 * 2. Canonical Roo metadata for specific models with non-standard IDs (e.g. deepseek-chat -> DeepSeek V3)
 * 3. Future-proof generic algorithmic formatter based on model ID
 */
export function formatModelDisplayName(modelId: string, modelInfo?: ModelInfo): string {
	if (!modelId || !modelId.trim()) {
		return "Select Model"
	}

	const trimmed = modelId.trim()

	// Safe fallback for punctuation-only or trailing slash identifiers (e.g. "/", ":", "vendor/")
	if (trimmed === "/" || trimmed === ":" || /^[a-zA-Z0-9_-]+\/$/.test(trimmed)) {
		return trimmed
	}

	// --------------------------------------------------------------------------
	// 1. Provider-supplied display name
	// --------------------------------------------------------------------------
	const providerDisplayName =
		typeof modelInfo?.displayName === "string" && modelInfo.displayName.trim().length > 0
			? modelInfo.displayName.trim()
			: undefined

	if (providerDisplayName && providerDisplayName !== trimmed && !providerDisplayName.includes("/")) {
		return providerDisplayName
	}

	// Check if description has provider display name in "Name (id)" pattern
	if (modelInfo?.description) {
		const match = modelInfo.description.match(/^(.+?)\s*\([a-zA-Z0-9_\-./:]+\)$/)
		if (match && match[1]) {
			const candidate = match[1].trim()
			if (candidate && candidate !== trimmed && candidate.length < 50 && !candidate.includes("/")) {
				return candidate
			}
		}
	}

	const lower = trimmed.toLowerCase()

	// --------------------------------------------------------------------------
	// 2. Canonical Roo metadata for specific models with non-standard IDs
	// --------------------------------------------------------------------------
	if (CANONICAL_MODEL_NAMES[lower]) {
		return CANONICAL_MODEL_NAMES[lower]
	}

	// Check without provider prefix in canonical list
	const segments = trimmed.split("/")
	const rawModelPart = segments[segments.length - 1]?.trim() || trimmed
	const modelPartLower = rawModelPart.toLowerCase()

	if (CANONICAL_MODEL_NAMES[modelPartLower]) {
		return CANONICAL_MODEL_NAMES[modelPartLower]
	}

	// Strip common container/tag suffixes (e.g. :latest)
	const modelPart = rawModelPart.replace(/:latest$/i, "")

	// --------------------------------------------------------------------------
	// 3. Algorithmic formatters for major families & generic models
	// --------------------------------------------------------------------------

	// Pattern 3.1: GPT models: gpt-[version](-[variant])?
	// e.g. gpt-6-astra -> GPT-6 Astra
	//      gpt-6-luna  -> GPT-6 Luna
	//      gpt-6-sol   -> GPT-6 Sol
	//      gpt-5.6-terra -> GPT-5.6 Terra
	//      gpt-6.1-nebula -> GPT-6.1 Nebula
	//      gpt-7-orion -> GPT-7 Orion
	//      gpt-4.5-preview -> GPT-4.5 Preview
	//      gpt-4-5-preview -> GPT-4.5 Preview
	//      gpt-5-mini -> GPT-5 Mini
	//      gpt-5 -> GPT-5
	const gptMatch = modelPart.match(/^(?:chat)?gpt[-_]?([0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?)(?:[-_](.+))?$/i)
	if (gptMatch && gptMatch[1]) {
		const rawVersion = gptMatch[1]
		const rawVariant = gptMatch[2]
		const cleanVersion = rawVersion.replace(/[-_]/, ".")
		if (rawVariant) {
			const formattedVariant = formatModelWords(rawVariant)
			return `GPT-${cleanVersion} ${formattedVariant}`
		}
		return `GPT-${cleanVersion}`
	}

	// Pattern 3.2: Claude models: claude-[version](-[variant])? or claude-[variant]-[version]
	// e.g. claude-3-7-sonnet -> Claude 3.7 Sonnet
	//      claude-4.5-sonnet -> Claude 4.5 Sonnet
	//      claude-sonnet-4-5 -> Claude 4.5 Sonnet
	//      claude-3-5-haiku -> Claude 3.5 Haiku
	//      claude-3-opus -> Claude 3 Opus
	const claudeInvertedMatch = modelPart.match(/^claude[-_](sonnet|opus|haiku)[-_]?([0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?)$/i)
	if (claudeInvertedMatch && claudeInvertedMatch[1] && claudeInvertedMatch[2]) {
		const variant = formatModelWords(claudeInvertedMatch[1])
		const version = claudeInvertedMatch[2].replace(/[-_]/, ".")
		return `Claude ${version} ${variant}`
	}

	const claudeMatch = modelPart.match(/^claude[-_]?(?:v)?([0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?)(?:[-_](.+))?$/i)
	if (claudeMatch && claudeMatch[1]) {
		const version = claudeMatch[1].replace(/[-_]/, ".")
		const variant = claudeMatch[2] ? formatModelWords(claudeMatch[2]) : undefined
		return variant ? `Claude ${version} ${variant}` : `Claude ${version}`
	}

	// Pattern 3.3: Gemini models: gemini-[version](-[variant])?
	// e.g. gemini-2.5-pro -> Gemini 2.5 Pro
	//      gemini-3-pro -> Gemini 3 Pro
	//      gemini-2.0-flash -> Gemini 2.0 Flash
	const geminiMatch = modelPart.match(/^gemini[-_]?(?:v)?([0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?)(?:[-_](.+))?$/i)
	if (geminiMatch && geminiMatch[1]) {
		const version = geminiMatch[1].replace(/[-_]/, ".")
		const variant = geminiMatch[2] ? formatModelWords(geminiMatch[2]) : undefined
		return variant ? `Gemini ${version} ${variant}` : `Gemini ${version}`
	}

	// Pattern 3.4: Qwen models: qwen-[version](-[variant])?
	// e.g. qwen-3-coder -> Qwen 3 Coder
	//      qwen-2.5-coder -> Qwen 2.5 Coder
	const qwenMatch = modelPart.match(/^qwen[-_]?(?:v)?([0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?)(?:[-_](.+))?$/i)
	if (qwenMatch && qwenMatch[1]) {
		const version = qwenMatch[1].replace(/[-_]/, ".")
		const variant = qwenMatch[2] ? formatModelWords(qwenMatch[2]) : undefined
		return variant ? `Qwen ${version} ${variant}` : `Qwen ${version}`
	}

	// Pattern 3.5: Llama models: llama-[version](-[variant])?
	// e.g. llama-3.1 -> Llama 3.1
	//      llama-3.3 -> Llama 3.3
	const llamaMatch = modelPart.match(/^(?:meta[-_])?llama[-_]?(?:v)?([0-9]+(?:\.[0-9]+)?(?:-[0-9]+)?)(?:[-_](.+))?$/i)
	if (llamaMatch && llamaMatch[1]) {
		const version = llamaMatch[1].replace(/[-_]/, ".")
		const variant = llamaMatch[2] ? formatModelWords(llamaMatch[2]) : undefined
		return variant ? `Llama ${version} ${variant}` : `Llama ${version}`
	}

	// Pattern 3.6: OpenAI o-series models: o1, o3, o4, etc.
	const oSeriesMatch = modelPart.match(/^(o[0-9]+)(?:[-_](.+))?$/i)
	if (oSeriesMatch && oSeriesMatch[1]) {
		const oName = oSeriesMatch[1].toLowerCase()
		const variant = oSeriesMatch[2] ? formatModelWords(oSeriesMatch[2]) : undefined
		return variant ? `${oName} ${variant}` : oName
	}

	// Pattern 3.7: Generic algorithmic formatter
	// e.g. unknown-provider/model-x-coder-preview -> Model X Coder Preview
	//      vendor/cool-engine-v2 -> Cool Engine V2
	const formattedGeneric = formatModelWords(modelPart)
	if (formattedGeneric.length > 0) {
		return formattedGeneric
	}

	// Final fallback to raw model ID
	return rawModelPart || trimmed
}

export const cleanModelDisplayName = formatModelDisplayName
