import { describe, it, expect, beforeEach } from "vitest"
import fs from "fs"
import path from "path"
import {
	type ModelInfo,
	type ProviderSettings,
	getModelContextWindow,
	getOpenAiModelInfo,
	stripModelTag,
} from "@roo-code/types"
import {
	parseOpenAiModelInfo,
	openAiModelInfoCache,
	initializeOpenAiModelInfoCache,
	getCachedOpenAiModelInfo,
	OpenAiHandler,
} from "../openai"
import { buildApiHandler } from "../../index"
import { calculateApiCostOpenAI } from "../../../shared/cost"
import { Task } from "../../../core/task/Task"

describe("Model Metadata Pipeline Forensic Audit & Verification", () => {
	let rawModelsData: any[] = []

	beforeEach(() => {
		openAiModelInfoCache.clear()

		// Load live xKiro models saved from https://api.xkiro.com/v1/models
		const rootPath = path.resolve(process.cwd(), "..", "xkiro_models.json")
		const localPath = path.resolve(process.cwd(), "xkiro_models.json")
		const filePath = fs.existsSync(localPath) ? localPath : rootPath
		if (fs.existsSync(filePath)) {
			const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"))
			rawModelsData = parsed.data || []
		}
	})

	describe("FAZA 2: CONTEXT FIX VERIFICATION", () => {
		it("verifies 1,000,000 context across all layers for qwen/qwen3.8-max and qwen/qwen3.8-max:free", () => {
			const freeRaw = rawModelsData.find((m) => m.id === "qwen/qwen3.8-max:free")
			const paidRaw = rawModelsData.find((m) => m.id === "qwen/qwen3.8-max")

			expect(freeRaw).toBeDefined()
			expect(paidRaw).toBeDefined()

			// 1. RAW PROVIDER
			expect(freeRaw.context_length).toBe(1_000_000)
			expect(paidRaw.context_length).toBe(1_000_000)
			expect(freeRaw.max_output_tokens).toBe(65_536)
			expect(paidRaw.max_output_tokens).toBe(65_536)

			// 2. PARSED
			const freeParsed = parseOpenAiModelInfo(freeRaw)
			const paidParsed = parseOpenAiModelInfo(paidRaw)
			expect(freeParsed.contextWindow).toBe(1_000_000)
			expect(paidParsed.contextWindow).toBe(1_000_000)
			expect(freeParsed.maxTokens).toBe(65_536)
			expect(paidParsed.maxTokens).toBe(65_536)

			// 3. CACHED
			openAiModelInfoCache.set("qwen/qwen3.8-max:free", freeParsed)
			openAiModelInfoCache.set("qwen/qwen3.8-max", paidParsed)
			expect(getCachedOpenAiModelInfo("qwen/qwen3.8-max:free")?.contextWindow).toBe(1_000_000)
			expect(getCachedOpenAiModelInfo("qwen/qwen3.8-max")?.contextWindow).toBe(1_000_000)

			// 4. RESOLVED in buildApiHandler & OpenAiHandler
			const configFree: ProviderSettings = {
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max:free",
			}
			const handlerFree = buildApiHandler(configFree) as OpenAiHandler
			const resolvedFree = handlerFree.getModel()

			expect(resolvedFree.info.contextWindow).toBe(1_000_000)
			expect(resolvedFree.info.maxTokens).toBe(65_536)
			expect(resolvedFree.info.isFree).toBe(true)

			const configPaid: ProviderSettings = {
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max",
			}
			const handlerPaid = buildApiHandler(configPaid) as OpenAiHandler
			const resolvedPaid = handlerPaid.getModel()

			expect(resolvedPaid.info.contextWindow).toBe(1_000_000)
			expect(resolvedPaid.info.maxTokens).toBe(65_536)

			// 5. ACAC THRESHOLD CALCULATION
			// ACAC threshold = contextWindow * Task.AUTO_COMPACT_THRESHOLD (0.85)
			const acacThreshold = resolvedFree.info.contextWindow * Task.AUTO_COMPACT_THRESHOLD
			expect(acacThreshold).toBe(850_000)

			// 6. UI TOKEN DISTRIBUTION (142.2k used / 1.0M context window)
			const usedTokens = 142_200
			const contextWindow = resolvedFree.info.contextWindow
			const percentage = Math.round((usedTokens / contextWindow) * 100)
			expect(percentage).toBe(14) // ~14%, NOT 142.2k / 200k (which would be 71%)
		})
	})

	describe("FAZA 3: VERIFY COST & PAID PRICING", () => {
		it("verifies free model qwen/qwen3.8-max:free has 0 pricing and $0.00 cost", () => {
			const freeRaw = rawModelsData.find((m) => m.id === "qwen/qwen3.8-max:free")
			const freeParsed = parseOpenAiModelInfo(freeRaw)
			openAiModelInfoCache.set("qwen/qwen3.8-max:free", freeParsed)

			const handler = buildApiHandler({
				apiProvider: "xkiro",
				xkiroModelId: "qwen/qwen3.8-max:free",
			}) as OpenAiHandler
			const model = handler.getModel()

			expect(model.info.inputPrice).toBe(0)
			expect(model.info.outputPrice).toBe(0)
			expect(model.info.isFree).toBe(true)

			const costResult = calculateApiCostOpenAI(model.info, 5000, 1000)
			expect(costResult.totalCost).toBe(0)
		})

		it("verifies paid models calculate non-zero cost matching live provider pricing", () => {
			// Populate cache from raw models
			for (const raw of rawModelsData) {
				const parsed = parseOpenAiModelInfo(raw)
				openAiModelInfoCache.set(raw.id, parsed)
			}

			const testCases = [
				{
					id: "qwen/qwen3.8-max",
					expectedInputPrice: 2,
					expectedOutputPrice: 6,
					inputTokens: 10_000,
					outputTokens: 2_000,
					// expected: (2/1M)*10000 + (6/1M)*2000 = 0.02 + 0.012 = 0.032
					expectedCost: 0.032,
				},
				{
					id: "openai/gpt-5.6-terra",
					expectedInputPrice: 1,
					expectedOutputPrice: 6,
					inputTokens: 20_000,
					outputTokens: 1_000,
					// expected: (1/1M)*20000 + (6/1M)*1000 = 0.02 + 0.006 = 0.026
					expectedCost: 0.026,
				},
				{
					id: "openai/gpt-5.5",
					expectedInputPrice: 5,
					expectedOutputPrice: 30,
					inputTokens: 5_000,
					outputTokens: 500,
					// expected: (5/1M)*5000 + (30/1M)*500 = 0.025 + 0.015 = 0.040
					expectedCost: 0.04,
				},
			]

			for (const tc of testCases) {
				const handler = buildApiHandler({
					apiProvider: "xkiro",
					xkiroModelId: tc.id,
				}) as OpenAiHandler
				const model = handler.getModel()

				expect(model.info.inputPrice).toBe(tc.expectedInputPrice)
				expect(model.info.outputPrice).toBe(tc.expectedOutputPrice)

				const costResult = calculateApiCostOpenAI(model.info, tc.inputTokens, tc.outputTokens)
				expect(costResult.totalCost).toBeCloseTo(tc.expectedCost, 5)
				expect(costResult.totalCost).toBeGreaterThan(0)
			}
		})
	})

	describe("FAZA 3: MODEL SWITCH TEST (CRITICAL REPRODUCER)", () => {
		it("preserves correct live pricing across sequential model switches without leaking zero pricing", () => {
			for (const raw of rawModelsData) {
				const parsed = parseOpenAiModelInfo(raw)
				openAiModelInfoCache.set(raw.id, parsed)
			}

			const sequence = [
				{
					id: "openai/gpt-5.6-terra",
					expectedInputPrice: 1,
					expectedOutputPrice: 6,
					expectedContext: 1_000_000,
					isFree: false,
				},
				{
					id: "qwen/qwen3.8-max:free",
					expectedInputPrice: 0,
					expectedOutputPrice: 0,
					expectedContext: 1_000_000,
					isFree: true,
				},
				{
					id: "qwen/qwen3.8-max",
					expectedInputPrice: 2,
					expectedOutputPrice: 6,
					expectedContext: 1_000_000,
					isFree: false,
				},
				{
					id: "openai/gpt-5.4",
					expectedInputPrice: 2.5,
					expectedOutputPrice: 15,
					expectedContext: 1_000_000,
					isFree: false,
				},
				{
					id: "openai/gpt-5.6-terra",
					expectedInputPrice: 1,
					expectedOutputPrice: 6,
					expectedContext: 1_000_000,
					isFree: false,
				},
			]

			let currentConfig: ProviderSettings = {
				apiProvider: "xkiro",
				xkiroModelId: sequence[0].id,
			}

			for (let step = 0; step < sequence.length; step++) {
				const target = sequence[step]
				currentConfig = {
					...currentConfig,
					xkiroModelId: target.id,
				}

				const handler = buildApiHandler(currentConfig) as OpenAiHandler
				const model = handler.getModel()

				expect(model.id).toBe(target.id)
				expect(model.info.contextWindow).toBe(target.expectedContext)
				expect(model.info.inputPrice).toBe(target.expectedInputPrice)
				expect(model.info.outputPrice).toBe(target.expectedOutputPrice)

				if (target.isFree) {
					expect(model.info.isFree).toBe(true)
				} else {
					expect(model.info.isFree).toBeFalsy()
					// Paid model must NEVER calculate to $0
					const costResult = calculateApiCostOpenAI(model.info, 1000, 500)
					expect(costResult.totalCost).toBeGreaterThan(0)
				}
			}
		})

		it("ensures stale synthetic custom model info with 0/0 pricing does not override live pricing", () => {
			for (const raw of rawModelsData) {
				openAiModelInfoCache.set(raw.id, parseOpenAiModelInfo(raw))
			}

			// Simulating the old bug where openAiCustomModelInfo exists with 0/0 prices
			const contaminatedConfig: ProviderSettings = {
				apiProvider: "xkiro",
				xkiroModelId: "openai/gpt-5.6-terra",
				openAiCustomModelInfo: {
					contextWindow: 128_000,
					maxTokens: 8192,
					inputPrice: 0,
					outputPrice: 0,
					supportsImages: true,
					supportsPromptCache: false,
				},
			}

			const handler = buildApiHandler(contaminatedConfig) as OpenAiHandler
			const model = handler.getModel()

			// Live provider metadata MUST win over stale custom info
			expect(model.info.inputPrice).toBe(1)
			expect(model.info.outputPrice).toBe(6)
			expect(model.info.contextWindow).toBe(1_000_000)

			const costResult = calculateApiCostOpenAI(model.info, 10_000, 1_000)
			expect(costResult.totalCost).toBeCloseTo(0.016, 5)
			expect(costResult.totalCost).toBeGreaterThan(0)
		})
	})

	describe("FAZA 4: FUTURE UNKNOWN MODEL FIXTURE", () => {
		it("resolves dynamic metadata from provider for completely unknown future vendor model", () => {
			const futureRaw = {
				id: "futurevendor/model-z-next",
				display_name: "Future Vendor Z Next",
				context_length: 2_000_000,
				max_output_tokens: 100_000,
				pricing: {
					currency: "USD",
					unit: "per_1m_tokens",
					input: 0.7,
					output: 3.5,
				},
				capabilities: {
					vision: true,
					tools: true,
				},
			}

			const parsed = parseOpenAiModelInfo(futureRaw)
			expect(parsed.contextWindow).toBe(2_000_000)
			expect(parsed.maxTokens).toBe(100_000)
			expect(parsed.inputPrice).toBe(0.7)
			expect(parsed.outputPrice).toBe(3.5)

			openAiModelInfoCache.set(futureRaw.id, parsed)

			const handler = buildApiHandler({
				apiProvider: "xkiro",
				xkiroModelId: "futurevendor/model-z-next",
			}) as OpenAiHandler
			const model = handler.getModel()

			expect(model.info.contextWindow).toBe(2_000_000)
			expect(model.info.maxTokens).toBe(100_000)
			expect(model.info.inputPrice).toBe(0.7)
			expect(model.info.outputPrice).toBe(3.5)

			const costResult = calculateApiCostOpenAI(model.info, 100_000, 10_000)
			// (0.7 / 1M) * 100k + (3.5 / 1M) * 10k = 0.07 + 0.035 = 0.105
			expect(costResult.totalCost).toBeCloseTo(0.105, 5)
		})
	})

	describe("FAZA 5: REAL EXPLICIT CUSTOM MODEL", () => {
		it("honors user-defined explicit custom model when model is not in provider catalog", () => {
			const customConfig: ProviderSettings = {
				apiProvider: "xkiro",
				xkiroModelId: "company/internal-coder",
				openAiCustomModelInfo: {
					contextWindow: 320_000,
					maxTokens: 16_384,
					inputPrice: 0.4,
					outputPrice: 1.2,
					supportsImages: false,
					supportsPromptCache: false,
				},
			}

			const handler = buildApiHandler(customConfig) as OpenAiHandler
			const model = handler.getModel()

			expect(model.id).toBe("company/internal-coder")
			expect(model.info.contextWindow).toBe(320_000)
			expect(model.info.maxTokens).toBe(16_384)
			expect(model.info.inputPrice).toBe(0.4)
			expect(model.info.outputPrice).toBe(1.2)

			const costResult = calculateApiCostOpenAI(model.info, 50_000, 10_000)
			// (0.4 / 1M) * 50k + (1.2 / 1M) * 10k = 0.02 + 0.012 = 0.032
			expect(costResult.totalCost).toBeCloseTo(0.032, 5)
		})
	})

	describe("FAZA 6: FULL XKIRO CATALOG METADATA SANITY AUDIT", () => {
		it("audits all 125 models and verifies field matches against resolved model info", () => {
			// Populate live cache
			for (const raw of rawModelsData) {
				openAiModelInfoCache.set(raw.id, parseOpenAiModelInfo(raw))
			}

			let totalAudited = 0
			const mismatches: Array<{ model: string; field: string; provider: any; resolved: any }> = []

			for (const raw of rawModelsData) {
				totalAudited++
				const handler = buildApiHandler({
					apiProvider: "xkiro",
					xkiroModelId: raw.id,
				}) as OpenAiHandler
				const resolved = handler.getModel().info

				// Compare pricing
				const rawPricing = raw.pricing || {}
				const expectedInputPrice = raw.id.toLowerCase().endsWith(":free") ? 0 : rawPricing.input
				const expectedOutputPrice = raw.id.toLowerCase().endsWith(":free") ? 0 : rawPricing.output

				if (expectedInputPrice !== undefined && resolved.inputPrice !== expectedInputPrice) {
					mismatches.push({
						model: raw.id,
						field: "inputPrice",
						provider: expectedInputPrice,
						resolved: resolved.inputPrice,
					})
				}
				if (expectedOutputPrice !== undefined && resolved.outputPrice !== expectedOutputPrice) {
					mismatches.push({
						model: raw.id,
						field: "outputPrice",
						provider: expectedOutputPrice,
						resolved: resolved.outputPrice,
					})
				}

				// Compare maxTokens
				if (raw.max_output_tokens && resolved.maxTokens !== raw.max_output_tokens) {
					mismatches.push({
						model: raw.id,
						field: "maxOutputTokens",
						provider: raw.max_output_tokens,
						resolved: resolved.maxTokens,
					})
				}

				// Compare contextWindow
				// Note: getModelContextWindow applies family heuristics.
				// Let's record contextWindow mismatches where live provider context differed from resolved
				if (raw.context_length && resolved.contextWindow !== raw.context_length) {
					mismatches.push({
						model: raw.id,
						field: "contextWindow",
						provider: raw.context_length,
						resolved: resolved.contextWindow,
					})
				}
			}

			expect(totalAudited).toBe(125)
			// Pricing and maxTokens should have 0 mismatches across the entire catalog!
			const pricingMismatches = mismatches.filter((m) => m.field === "inputPrice" || m.field === "outputPrice")
			const maxTokensMismatches = mismatches.filter((m) => m.field === "maxOutputTokens")

			expect(pricingMismatches).toHaveLength(0)
			expect(maxTokensMismatches).toHaveLength(0)

			console.log(`[Audit Summary] Audited ${totalAudited} xKiro models.`)
			console.log(`[Audit Summary] Pricing mismatches: ${pricingMismatches.length}`)
			console.log(`[Audit Summary] Max tokens mismatches: ${maxTokensMismatches.length}`)
			console.log(`[Audit Summary] Context window mismatches due to static heuristic: ${mismatches.filter((m) => m.field === "contextWindow").length}`)
		})
	})
})
