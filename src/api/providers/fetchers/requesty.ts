import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"
import { toRequestyServiceUrl } from "../../../shared/utils/requesty"

export async function getRequestyModels(baseUrl?: string, apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const resolvedBaseUrl = toRequestyServiceUrl(baseUrl)
		const modelsUrl = new URL("v1/models", resolvedBaseUrl)

		const response = await axios.get(modelsUrl.toString(), { headers })

		if (response.data?.error) {
			const errorMsg =
				typeof response.data.error === "string" ? response.data.error : JSON.stringify(response.data.error)
			console.error(`Error fetching Requesty models: ${errorMsg}`)
			return models
		}

		const rawModels = response.data?.data ?? response.data
		const modelsArray = Array.isArray(rawModels)
			? rawModels
			: Array.isArray(response.data?.data)
				? response.data.data
				: Array.isArray(response.data?.models)
					? response.data.models
					: []

		for (const rawModel of modelsArray) {
			if (!rawModel || typeof rawModel !== "object" || !rawModel.id) {
				continue
			}
			const reasoningBudget =
				rawModel.supports_reasoning &&
				(rawModel.id.includes("claude") ||
					rawModel.id.includes("coding/gemini-2.5") ||
					rawModel.id.includes("vertex/gemini-2.5"))
			const reasoningEffort =
				rawModel.supports_reasoning &&
				(rawModel.id.includes("openai") || rawModel.id.includes("google/gemini-2.5"))

			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_tokens,
				contextWindow: rawModel.context_window,
				supportsPromptCache: rawModel.supports_caching,
				supportsImages: rawModel.supports_vision,
				supportsReasoningBudget: reasoningBudget,
				supportsReasoningEffort: reasoningEffort,
				inputPrice: parseApiPrice(rawModel.input_price),
				outputPrice: parseApiPrice(rawModel.output_price),
				description: rawModel.description,
				cacheWritesPrice: parseApiPrice(rawModel.caching_price),
				cacheReadsPrice: parseApiPrice(rawModel.cached_price),
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		const status = (error as any)?.response?.status
		const statusStr = status ? ` (status: ${status})` : ""
		const msg = error instanceof Error ? error.message : String(error)
		console.error(`Error fetching Requesty models${statusStr}: ${msg}`)
	}

	return models
}
