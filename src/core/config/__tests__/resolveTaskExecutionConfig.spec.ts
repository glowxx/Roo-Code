import { describe, it, expect } from "vitest"
import { ProviderSettings } from "@roo-code/types"
import { resolveTaskExecutionConfig, normalizeReasoningEffort } from "../resolveTaskExecutionConfig"

describe("resolveTaskExecutionConfig", () => {
	const baseSettings: ProviderSettings = {
		apiProvider: "xkiro",
		xkiroApiKey: "mock-key",
		xkiroBaseUrl: "https://api.xkiro.com/v1",
		xkiroModelId: "qwen/qwen3.8-max:free",
		openAiModelId: "qwen/qwen3.8-max:free",
		apiModelId: "qwen/qwen3.8-max:free",
		reasoningEffort: "high",
		enableReasoningEffort: true,
	}

	it("resolves Chat A execution config with GPT-6.1 Sol when base config has Qwen", () => {
		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: baseSettings,
			chatMetadata: {
				chatModelId: "openai/gpt-6.1-sol",
				chatProvider: "xkiro",
				chatReasoningEffort: "high",
				apiConfigName: "default",
			},
			lastManualModel: {
				modelId: "qwen/qwen3.8-max:free",
				provider: "xkiro",
				reasoningEffort: "high",
			},
			isNewChat: false,
		})

		expect(resolved.apiProvider).toBe("xkiro")
		expect(resolved.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(resolved.openAiModelId).toBe("openai/gpt-6.1-sol")
		expect(resolved.apiModelId).toBe("openai/gpt-6.1-sol")
		expect(resolved.xkiroApiKey).toBe("mock-key")
	})

	it("resolves Chat B execution config with Qwen independently", () => {
		const gptBaseSettings: ProviderSettings = {
			...baseSettings,
			xkiroModelId: "openai/gpt-6.1-sol",
			openAiModelId: "openai/gpt-6.1-sol",
			apiModelId: "openai/gpt-6.1-sol",
		}

		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: gptBaseSettings,
			chatMetadata: {
				chatModelId: "qwen/qwen3.8-max:free",
				chatProvider: "xkiro",
				chatReasoningEffort: "high",
			},
			isNewChat: false,
		})

		expect(resolved.apiProvider).toBe("xkiro")
		expect(resolved.xkiroModelId).toBe("qwen/qwen3.8-max:free")
		expect(resolved.openAiModelId).toBe("qwen/qwen3.8-max:free")
	})

	it("existing chat completely ignores lastManualModel fallback", () => {
		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: baseSettings,
			chatMetadata: {
				chatModelId: "openai/gpt-6.1-sol",
				chatProvider: "xkiro",
			},
			lastManualModel: {
				modelId: "other-vendor/other-model",
				provider: "openrouter",
			},
			isNewChat: false,
		})

		expect(resolved.apiProvider).toBe("xkiro")
		expect(resolved.xkiroModelId).toBe("openai/gpt-6.1-sol")
	})

	it("new chat adopts lastManualModel if user picked one manually", () => {
		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: baseSettings,
			lastManualModel: {
				modelId: "openai/gpt-6.1-sol",
				provider: "xkiro",
				reasoningEffort: "medium",
			},
			isNewChat: true,
		})

		expect(resolved.apiProvider).toBe("xkiro")
		expect(resolved.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(resolved.reasoningEffort).toBe("medium")
	})

	it("deep-clones config to prevent shared reference mutation", () => {
		const mutableSettings = { ...baseSettings }
		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: mutableSettings,
			chatMetadata: {
				chatModelId: "openai/gpt-6.1-sol",
				chatProvider: "xkiro",
			},
			isNewChat: false,
		})

		// Mutate original settings
		mutableSettings.xkiroModelId = "polluted-model"
		mutableSettings.apiModelId = "polluted-model"

		expect(resolved.xkiroModelId).toBe("openai/gpt-6.1-sol")
		expect(resolved.apiModelId).toBe("openai/gpt-6.1-sol")
	})

	it("clears reasoning effort for models that do not support reasoning", () => {
		const resolved = resolveTaskExecutionConfig({
			baseProviderSettings: baseSettings,
			chatMetadata: {
				chatModelId: "claude-3-haiku-20240307",
				chatProvider: "anthropic",
				chatReasoningEffort: "high",
			},
			isNewChat: false,
		})

		expect(resolved.reasoningEffort).toBeUndefined()
		expect(resolved.enableReasoningEffort).toBe(false)
	})

	it("normalizes reasoning effort correctly", () => {
		expect(normalizeReasoningEffort("disable")).toEqual({ effort: "disable", enabled: false })
		expect(normalizeReasoningEffort("off")).toEqual({ effort: "disable", enabled: false })
		expect(normalizeReasoningEffort("none")).toEqual({ effort: "disable", enabled: false })
		expect(normalizeReasoningEffort("high")).toEqual({ effort: "high", enabled: true })
		expect(normalizeReasoningEffort(undefined)).toEqual({ effort: undefined, enabled: false })
	})
})
