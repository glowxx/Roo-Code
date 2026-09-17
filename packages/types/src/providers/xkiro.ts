import type { ModelInfo } from "../model.js"

export type XKiroModelId =
	| "deepseek/deepseek-chat"
	| "deepseek/deepseek-reasoner"
	| "anthropic/claude-3.7-sonnet"
	| "openai/gpt-4o"
	| "google/gemini-2.5-pro"
	| "qwen/qwen-2.5-coder-32b"

export const xkiroDefaultModelId: XKiroModelId = "deepseek/deepseek-chat"

export const xkiroModels = {
	"deepseek/deepseek-chat": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro DeepSeek-V3: Szybki i wydajny model ogólnego przeznaczenia z darmowymi tokenami.",
	},
	"deepseek/deepseek-reasoner": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		preserveReasoning: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro DeepSeek-R1: Model rozumowania i dedukcji logicznej (Chain of Thought).",
	},
	"anthropic/claude-3.7-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro Claude 3.7 Sonnet: Najwyższa jakość kodowania i wnioskowania.",
	},
	"openai/gpt-4o": {
		maxTokens: 4096,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro GPT-4o: Wszechstronny flagowy model OpenAI.",
	},
	"google/gemini-2.5-pro": {
		maxTokens: 8192,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro Google Gemini 2.5 Pro z 1M kontekstu.",
	},
	"qwen/qwen-2.5-coder-32b": {
		maxTokens: 8192,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro Qwen 2.5 Coder 32B zoptymalizowany pod programowanie.",
	},
} as const satisfies Record<XKiroModelId, ModelInfo>
