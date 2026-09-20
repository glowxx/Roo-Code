import axios from "axios"

import { getRequestyModels } from "../requesty"

vi.mock("axios")
const mockedAxios = axios as typeof axios & {
	get: ReturnType<typeof vi.fn>
}

describe("getRequestyModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("fetches and parses models from standard { data: [...] } format", async () => {
		mockedAxios.get.mockResolvedValueOnce({
			data: {
				data: [
					{
						id: "anthropic/claude-3-5-sonnet",
						max_output_tokens: 8192,
						context_window: 200000,
						supports_caching: true,
						supports_vision: true,
						supports_reasoning: true,
						input_price: "0.000003",
						output_price: "0.000015",
						caching_price: "0.00000375",
						cached_price: "0.0000003",
						description: "Claude 3.5 Sonnet via Requesty",
					},
				],
			},
		})

		const models = await getRequestyModels("https://api.requesty.ai", "test-key")

		expect(mockedAxios.get).toHaveBeenCalledWith("https://api.requesty.ai/v1/models", {
			headers: {
				Authorization: "Bearer test-key",
			},
		})

		expect(models["anthropic/claude-3-5-sonnet"]).toEqual({
			maxTokens: 8192,
			contextWindow: 200000,
			supportsPromptCache: true,
			supportsImages: true,
			supportsReasoningBudget: true,
			supportsReasoningEffort: false,
			inputPrice: 3,
			outputPrice: 15,
			cacheWritesPrice: 3.75,
			cacheReadsPrice: 0.3,
			description: "Claude 3.5 Sonnet via Requesty",
		})
	})

	it("handles models when response is a root array [...]", async () => {
		mockedAxios.get.mockResolvedValueOnce({
			data: [
				{
					id: "openai/gpt-4o",
					max_output_tokens: 4096,
					context_window: 128000,
					supports_caching: false,
					supports_vision: true,
					supports_reasoning: true,
				},
			],
		})

		const models = await getRequestyModels()

		expect(models["openai/gpt-4o"]).toBeDefined()
		expect(models["openai/gpt-4o"].supportsReasoningEffort).toBe(true)
		expect(models["openai/gpt-4o"].supportsReasoningBudget).toBe(false)
	})

	it("handles models in { models: [...] } format", async () => {
		mockedAxios.get.mockResolvedValueOnce({
			data: {
				models: [
					{
						id: "google/gemini-2.5-pro",
						max_output_tokens: 8192,
						context_window: 1000000,
					},
				],
			},
		})

		const models = await getRequestyModels()

		expect(models["google/gemini-2.5-pro"]).toBeDefined()
		expect(models["google/gemini-2.5-pro"].contextWindow).toBe(1000000)
	})

	it("handles error response { error: string } gracefully without throwing rawModels is not iterable", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		mockedAxios.get.mockResolvedValueOnce({
			data: {
				error: "Unauthorized: Invalid API key",
			},
		})

		const models = await getRequestyModels("https://api.requesty.ai", "invalid-key")

		expect(models).toEqual({})
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error fetching Requesty models: Unauthorized: Invalid API key")
		consoleErrorSpy.mockRestore()
	})

	it("handles malformed/non-iterable response data gracefully without throwing", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		mockedAxios.get.mockResolvedValueOnce({
			data: {
				data: "not an array",
			},
		})

		const models = await getRequestyModels()

		expect(models).toEqual({})
		consoleErrorSpy.mockRestore()
	})

	it("skips invalid model entries in the array", async () => {
		mockedAxios.get.mockResolvedValueOnce({
			data: {
				data: [null, undefined, "invalid-item", { no_id: true }, { id: "valid-model", context_window: 32000 }],
			},
		})

		const models = await getRequestyModels()

		expect(Object.keys(models)).toEqual(["valid-model"])
		expect(models["valid-model"].contextWindow).toBe(32000)
	})

	it("handles network errors gracefully", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		mockedAxios.get.mockRejectedValueOnce(new Error("Connection timeout"))

		const models = await getRequestyModels()

		expect(models).toEqual({})
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error fetching Requesty models: Connection timeout")
		consoleErrorSpy.mockRestore()
	})
})
