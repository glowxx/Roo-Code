import type { ModelInfo, ModelRecord } from "@roo-code/types"
import { fetchPoeModels, getModels } from "ai-sdk-provider-poe/code"

export async function getPoeModels(apiKey?: string, baseURL?: string): Promise<ModelRecord> {
	try {
		// fetchPoeModels populates the internal model store, then getModels()
		// returns only code-capable models with camelCase fields.
		await fetchPoeModels({ apiKey, baseURL })
		const poeModels = getModels()
		const models: ModelRecord = {}
		const modelsArray = Array.isArray(poeModels) ? poeModels : []

		for (const m of modelsArray) {
			if (!m || typeof m !== "object" || !m.id) {
				continue
			}
			// The library's applyReasoningFallbacks workaround sets
			// supportsReasoningEffort to boolean `true` for any model that
			// supports /v1/responses, even when the model has no actual
			// reasoning capability (e.g. Haiku 3/3.5). Only trust the value
			// when it is an explicit array of effort levels.
			const effort = Array.isArray(m.supportsReasoningEffort) ? m.supportsReasoningEffort : undefined
			const info: ModelInfo = {
				contextWindow: m.contextWindow,
				maxTokens: m.maxOutputTokens,
				supportsImages: m.supportsImages,
				supportsPromptCache: m.supportsPromptCache,
				...(m.supportsReasoningBudget && { supportsReasoningBudget: m.supportsReasoningBudget }),
				...(effort && {
					supportsReasoningEffort: effort as ModelInfo["supportsReasoningEffort"],
				}),
				...(m.pricing?.inputPerMillion != null && { inputPrice: m.pricing.inputPerMillion }),
				...(m.pricing?.outputPerMillion != null && { outputPrice: m.pricing.outputPerMillion }),
				...(m.pricing?.cacheReadPerMillion != null && { cacheReadsPrice: m.pricing.cacheReadPerMillion }),
				...(m.pricing?.cacheWritePerMillion != null && { cacheWritesPrice: m.pricing.cacheWritePerMillion }),
			}

			models[m.id] = info
		}

		return models
	} catch (error) {
		const status = (error as any)?.response?.status
		const statusStr = status ? ` (status: ${status})` : ""
		const msg = error instanceof Error ? error.message : String(error)
		console.error(`[Poe] Error fetching models${statusStr}: ${msg}`)
		return {}
	}
}
