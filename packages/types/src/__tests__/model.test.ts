import { describe, it, expect } from "vitest"
import { getModelContextWindow } from "../model.js"

describe("getModelContextWindow", () => {
	describe("Rule 1: Explicit size indicators and next-gen prefixes", () => {
		it("assigns 1M to gpt-6, astra, and 1m models", () => {
			expect(getModelContextWindow("gpt-6-astra")).toBe(1_000_000)
			expect(getModelContextWindow("openai/gpt-6-astra")).toBe(1_000_000)
			expect(getModelContextWindow("gpt-6")).toBe(1_000_000)
			expect(getModelContextWindow("gpt-6-mini")).toBe(1_000_000)
			expect(getModelContextWindow("custom-provider/astra-reasoner")).toBe(1_000_000)
			expect(getModelContextWindow("qwen3-coder-1m")).toBe(1_000_000)
			expect(getModelContextWindow("deepseek-v3-1m")).toBe(1_000_000)
		})

		it("assigns 2M to models with 2m pattern", () => {
			expect(getModelContextWindow("custom-model-2m")).toBe(2_000_000)
			expect(getModelContextWindow("openai/codex-2m-preview")).toBe(2_000_000)
		})

		it("assigns 524288 to models with 512k pattern", () => {
			expect(getModelContextWindow("custom-model-512k")).toBe(524_288)
			expect(getModelContextWindow("open-weights-512k-context")).toBe(524_288)
		})
	})

	describe("Rule 2: Known model families", () => {
		it("assigns 200k to gpt-5, o1, o3, o4 models", () => {
			expect(getModelContextWindow("gpt-5")).toBe(200_000)
			expect(getModelContextWindow("openai/gpt-5")).toBe(200_000)
			expect(getModelContextWindow("openai/o1")).toBe(200_000)
			expect(getModelContextWindow("openai/o1-mini")).toBe(200_000)
			expect(getModelContextWindow("openai/o3-mini")).toBe(200_000)
			expect(getModelContextWindow("openai/o4-preview")).toBe(200_000)
		})

		it("assigns 200k to Claude 3.5, 3.7, Opus, Sonnet, Haiku models", () => {
			expect(getModelContextWindow("claude-3-5-sonnet")).toBe(200_000)
			expect(getModelContextWindow("claude-3.5-sonnet")).toBe(200_000)
			expect(getModelContextWindow("claude-3-7-sonnet")).toBe(200_000)
			expect(getModelContextWindow("claude-3.7-sonnet")).toBe(200_000)
			expect(getModelContextWindow("claude-3-opus-20240229")).toBe(200_000)
			expect(getModelContextWindow("claude-3-haiku-20240307")).toBe(200_000)
			expect(getModelContextWindow("anthropic/claude-3.7-sonnet")).toBe(200_000)
		})

		it("assigns 2M to Gemini Pro variants not shared with Flash", () => {
			expect(getModelContextWindow("gemini-1.5-pro")).toBe(2_000_000)
			expect(getModelContextWindow("gemini-2.0-pro-exp")).toBe(2_000_000)
			expect(getModelContextWindow("gemini-3.0-pro")).toBe(2_000_000)
			expect(getModelContextWindow("google/gemini-1.5-pro")).toBe(2_000_000)
		})

		it("assigns 1M to Gemini Flash and 2.5 models", () => {
			expect(getModelContextWindow("gemini-1.5-flash")).toBe(1_000_000)
			expect(getModelContextWindow("gemini-2.0-flash")).toBe(1_000_000)
			expect(getModelContextWindow("gemini-2.5-flash")).toBe(1_000_000)
			expect(getModelContextWindow("gemini-2.5-pro")).toBe(1_000_000)
			expect(getModelContextWindow("google/gemini-custom-experimental")).toBe(1_000_000)
		})

		it("assigns 128k to gpt-4o, gpt-4o-mini, gpt-4-turbo models", () => {
			expect(getModelContextWindow("gpt-4o")).toBe(128_000)
			expect(getModelContextWindow("openai/gpt-4o")).toBe(128_000)
			expect(getModelContextWindow("gpt-4o-mini")).toBe(128_000)
			expect(getModelContextWindow("openai/gpt-4o-mini")).toBe(128_000)
			expect(getModelContextWindow("gpt-4-turbo")).toBe(128_000)
			expect(getModelContextWindow("openai/gpt-4-turbo")).toBe(128_000)
		})

		it("assigns 128k to DeepSeek Chat and Reasoner by default, supporting 64k when specified", () => {
			expect(getModelContextWindow("deepseek-chat")).toBe(128_000)
			expect(getModelContextWindow("deepseek-reasoner")).toBe(128_000)
			expect(getModelContextWindow("deepseek/deepseek-chat")).toBe(128_000)
			expect(getModelContextWindow("deepseek/deepseek-reasoner")).toBe(128_000)
			expect(getModelContextWindow("deepseek-chat", 64_000)).toBe(64_000)
			expect(getModelContextWindow("deepseek-reasoner", 64_000)).toBe(64_000)
			expect(getModelContextWindow("deepseek/deepseek-chat", 64_000)).toBe(64_000)
			expect(getModelContextWindow("deepseek/deepseek-reasoner", 64_000)).toBe(64_000)
		})
	})

	describe("Rule 3: Unclassified next-gen flagship models", () => {
		it("assigns minimum 200k to unclassified models with modern series keywords", () => {
			expect(getModelContextWindow("custom-provider/ultra-llm")).toBe(200_000)
			expect(getModelContextWindow("new-coder-max")).toBe(200_000)
			expect(getModelContextWindow("super-model-pro-max")).toBe(200_000)
			expect(getModelContextWindow("experimental-v5")).toBe(200_000)
			expect(getModelContextWindow("experimental-v6")).toBe(200_000)
			expect(getModelContextWindow("cool-model-flagship")).toBe(200_000)
			expect(getModelContextWindow("some-next-model")).toBe(200_000)
			expect(getModelContextWindow("acme-model-pro")).toBe(200_000)
		})
	})

	describe("Rule 4: Sane default fallback", () => {
		it("assigns 128k fallback to unclassified models without flagship keywords", () => {
			expect(getModelContextWindow("unknown-model-xyz")).toBe(128_000)
			expect(getModelContextWindow("custom-org/small-chat")).toBe(128_000)
		})
	})

	describe("Rule 1: Provider metadata / baseContext hierarchy", () => {
		it("prevents generic 128k default from suppressing 200k/1M/2M family limits", () => {
			expect(getModelContextWindow("claude-3.7-sonnet", 128_000)).toBe(200_000)
			expect(getModelContextWindow("gpt-5", 128_000)).toBe(200_000)
			expect(getModelContextWindow("gemini-2.5-flash", 128_000)).toBe(1_000_000)
			expect(getModelContextWindow("gemini-1.5-pro", 128_000)).toBe(2_000_000)
			expect(getModelContextWindow("openai/o3-mini", 128_000)).toBe(200_000)
		})

		it("allows provider metadata greater than family limit to take precedence for non-Claude models", () => {
			expect(getModelContextWindow("openai/gpt-5", 400_000)).toBe(400_000)
		})

		it("keeps Claude family strictly at 200k even if provider metadata reports higher baseContext", () => {
			expect(getModelContextWindow("claude-3.7-sonnet", 1_000_000)).toBe(200_000)
			expect(getModelContextWindow("anthropic/claude-3.5-sonnet", 1_000_000)).toBe(200_000)
			expect(getModelContextWindow("claude-sonnet-4", 1_000_000)).toBe(200_000)
			expect(getModelContextWindow("claude-opus-4", 2_000_000)).toBe(200_000)
		})

		it("preserves real metadata from provider for unclassified models", () => {
			expect(getModelContextWindow("custom-model", 32_000)).toBe(32_000)
			expect(getModelContextWindow("custom-model", 64_000)).toBe(64_000)
		})
	})
})
