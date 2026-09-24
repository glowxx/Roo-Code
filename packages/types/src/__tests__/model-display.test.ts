import { describe, expect, it } from "vitest"
import { formatModelDisplayName, cleanModelDisplayName, formatModelToken, formatModelWords } from "../model-display.js"

describe("model-display", () => {
	describe("formatModelToken", () => {
		it("correctly handles known tech acronyms and family names", () => {
			expect(formatModelToken("gpt")).toBe("GPT")
			expect(formatModelToken("ai")).toBe("AI")
			expect(formatModelToken("llm")).toBe("LLM")
			expect(formatModelToken("api")).toBe("API")
			expect(formatModelToken("vl")).toBe("VL")
			expect(formatModelToken("dall-e")).toBe("DALL-E")
			expect(formatModelToken("deepseek")).toBe("DeepSeek")
			expect(formatModelToken("claude")).toBe("Claude")
			expect(formatModelToken("gemini")).toBe("Gemini")
			expect(formatModelToken("qwen")).toBe("Qwen")
			expect(formatModelToken("llama")).toBe("Llama")
		})

		it("formats parameters and release versions", () => {
			expect(formatModelToken("7b")).toBe("7B")
			expect(formatModelToken("70b")).toBe("70B")
			expect(formatModelToken("1m")).toBe("1M")
			expect(formatModelToken("r1")).toBe("R1")
			expect(formatModelToken("v3")).toBe("V3")
			expect(formatModelToken("o1")).toBe("o1")
			expect(formatModelToken("o3")).toBe("o3")
			expect(formatModelToken("x")).toBe("X")
			expect(formatModelToken("coder")).toBe("Coder")
			expect(formatModelToken("preview")).toBe("Preview")
		})
	})

	describe("formatModelDisplayName & cleanModelDisplayName required fixtures", () => {
		it("formats GPT-6 variants correctly without collision or hardcoding", () => {
			expect(formatModelDisplayName("openai/gpt-6-astra")).toBe("GPT-6 Astra")
			expect(formatModelDisplayName("openai/gpt-6-luna")).toBe("GPT-6 Luna")
			expect(formatModelDisplayName("openai/gpt-6-sol")).toBe("GPT-6 Sol")

			// Ensure they do NOT collapse to the same name
			const names = new Set([
				formatModelDisplayName("openai/gpt-6-astra"),
				formatModelDisplayName("openai/gpt-6-luna"),
				formatModelDisplayName("openai/gpt-6-sol"),
			])
			expect(names.size).toBe(3)
		})

		it("formats GPT-5.6 variants correctly preserving suffixes", () => {
			expect(formatModelDisplayName("openai/gpt-5.6-terra")).toBe("GPT-5.6 Terra")
			expect(formatModelDisplayName("openai/gpt-5.6-sol")).toBe("GPT-5.6 Sol")
			expect(formatModelDisplayName("openai/gpt-5.6-luna")).toBe("GPT-5.6 Luna")

			const names = new Set([
				formatModelDisplayName("openai/gpt-5.6-terra"),
				formatModelDisplayName("openai/gpt-5.6-sol"),
				formatModelDisplayName("openai/gpt-5.6-luna"),
			])
			expect(names.size).toBe(3)
		})

		it("formats unknown future models algorithmically without switch/case mappings", () => {
			expect(formatModelDisplayName("unknown-provider/gpt-6.1-nebula")).toBe("GPT-6.1 Nebula")
			expect(formatModelDisplayName("unknown-provider/gpt-7-orion")).toBe("GPT-7 Orion")
			expect(formatModelDisplayName("unknown-provider/model-x-coder-preview")).toBe("Model X Coder Preview")
			expect(formatModelDisplayName("future-vendor/gpt-8.2-supernova")).toBe("GPT-8.2 Supernova")
			expect(formatModelDisplayName("custom-lab/neural-flow-70b-v2")).toBe("Neural Flow 70B V2")
		})

		it("verifies cleanModelDisplayName alias has identical behavior", () => {
			expect(cleanModelDisplayName("openai/gpt-6-luna")).toBe("GPT-6 Luna")
			expect(cleanModelDisplayName("openai/gpt-6-sol")).toBe("GPT-6 Sol")
			expect(cleanModelDisplayName("unknown-provider/gpt-6.1-nebula")).toBe("GPT-6.1 Nebula")
			expect(cleanModelDisplayName("unknown-provider/model-x-coder-preview")).toBe("Model X Coder Preview")
		})

		it("handles established flagship models and canonical mappings", () => {
			expect(cleanModelDisplayName("deepseek/deepseek-chat")).toBe("DeepSeek V3")
			expect(cleanModelDisplayName("deepseek/deepseek-reasoner")).toBe("DeepSeek R1")
			expect(cleanModelDisplayName("anthropic/claude-3.7-sonnet")).toBe("Claude 3.7 Sonnet")
			expect(cleanModelDisplayName("anthropic/claude-4.5-sonnet")).toBe("Claude 4.5 Sonnet")
			expect(cleanModelDisplayName("anthropic/claude-sonnet-4-5")).toBe("Claude 4.5 Sonnet")
			expect(cleanModelDisplayName("openai/gpt-5")).toBe("GPT-5")
			expect(cleanModelDisplayName("openai/gpt-4.5-preview")).toBe("GPT-4.5 Preview")
			expect(cleanModelDisplayName("openai/gpt-4o")).toBe("GPT-4o")
			expect(cleanModelDisplayName("openai/gpt-4o-mini")).toBe("GPT-4o Mini")
			expect(cleanModelDisplayName("google/gemini-2.5-pro")).toBe("Gemini 2.5 Pro")
			expect(cleanModelDisplayName("google/gemini-3-pro")).toBe("Gemini 3 Pro")
			expect(cleanModelDisplayName("qwen/qwen-3-coder")).toBe("Qwen 3 Coder")
			expect(cleanModelDisplayName("openai/o1-mini")).toBe("o1-mini")
			expect(cleanModelDisplayName("openai/o3-mini")).toBe("o3-mini")
		})

		it("safely handles unusual / punctuation identifiers", () => {
			expect(cleanModelDisplayName("")).toBe("Select Model")
			expect(cleanModelDisplayName("   ")).toBe("Select Model")
			expect(cleanModelDisplayName("/")).toBe("/")
			expect(cleanModelDisplayName("vendor/")).toBe("vendor/")
			expect(cleanModelDisplayName(":")).toBe(":")
		})

		it("respects provider-supplied display names (Layer 1)", () => {
			expect(
				cleanModelDisplayName("openai/gpt-6-custom", {
					contextWindow: 1000000,
					supportsPromptCache: true,
					displayName: "Provider Custom Name",
				}),
			).toBe("Provider Custom Name")

			// Extracts display name from description pattern "Name (model-id)"
			expect(
				cleanModelDisplayName("openai/gpt-6-custom-id", {
					contextWindow: 1000000,
					supportsPromptCache: true,
					description: "Provider Extracted Name (openai/gpt-6-custom-id)",
				}),
			).toBe("Provider Extracted Name")
		})
	})
})
