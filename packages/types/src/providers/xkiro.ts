import type { ModelInfo } from "../model.js"

export type XKiroModelId =
	| "deepseek/deepseek-chat"
	| "deepseek/deepseek-reasoner"
	| "anthropic/claude-3.7-sonnet"
	| "anthropic/claude-3.5-sonnet"
	| "openai/gpt-5"
	| "openai/gpt-5-mini"
	| "openai/gpt-4o"
	| "openai/o1"
	| "openai/o3-mini"
	| "google/gemini-2.5-pro"
	| "google/gemini-2.5-flash"
	| "qwen/qwen-2.5-coder-32b"
	| (string & {})

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
		description: "xKiro DeepSeek-V3: Fast and powerful general-purpose model with free tokens.",
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
		description: "xKiro DeepSeek-R1: Advanced reasoning and Chain of Thought deduction.",
	},
	"anthropic/claude-3.7-sonnet": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		preserveReasoning: true,
		supportsReasoningEffort: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro Claude 3.7 Sonnet: Premier hybrid reasoning and coding model.",
	},
	"anthropic/claude-3.5-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro Claude 3.5 Sonnet: Industry standard for intelligent coding.",
	},
	"openai/gpt-5": {
		maxTokens: 128_000,
		contextWindow: 400_000,
		supportsImages: true,
		supportsPromptCache: true,
		preserveReasoning: true,
		supportsReasoningEffort: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro GPT-5: OpenAI flagship model with reasoning and 400k context window.",
	},
	"openai/gpt-5-mini": {
		maxTokens: 128_000,
		contextWindow: 400_000,
		supportsImages: true,
		supportsPromptCache: true,
		preserveReasoning: true,
		supportsReasoningEffort: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro GPT-5 Mini: Fast and cost-effective reasoning model with 400k context window.",
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
		description: "xKiro GPT-4o: Versatile flagship multimodal model from OpenAI.",
	},
	"openai/o1": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		preserveReasoning: true,
		supportsReasoningEffort: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro o1: Flagship reasoning model for complex engineering and math.",
	},
	"openai/o3-mini": {
		maxTokens: 100_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		preserveReasoning: true,
		supportsReasoningEffort: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro o3-mini: High-speed, cost-effective reasoning model.",
	},
	"google/gemini-2.5-pro": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		preserveReasoning: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro Gemini 2.5 Pro: Deep reasoning and 1M context window.",
	},
	"google/gemini-2.5-flash": {
		maxTokens: 65_536,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "xKiro Gemini 2.5 Flash: Ultra-fast multimodal model with 1M context.",
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
		description: "xKiro Qwen 2.5 Coder 32B: Open-weights coding powerhouse.",
	},
} as const satisfies Record<string, ModelInfo>
