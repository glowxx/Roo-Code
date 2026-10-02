import { buildApiHandler } from "../index"
import { calculateApiCostOpenAI } from "../../shared/cost"

describe("xKiro standard pricing", () => {
	it("ignores legacy promo configuration without changing usage or catalog metadata", () => {
		const config = { apiProvider: "xkiro" as const, xkiroApiKey: "key", xkiroModelId: "openai/gpt-5" }
		const standard = buildApiHandler(config).getModel()
		const legacy = buildApiHandler({ ...config, ...{ xkiroDiscountMultiplier: 0.5 } }).getModel()
		expect(legacy).toEqual(standard)
		expect(calculateApiCostOpenAI(legacy.info, 1000, 200, 100, 300)).toMatchObject({
			totalInputTokens: 1000,
			totalOutputTokens: 200,
		})
	})

	it("resolves openai/gpt-6.1-sol with 1M context window and reasoning effort support", () => {
		const config = { apiProvider: "xkiro" as const, xkiroApiKey: "key", xkiroModelId: "openai/gpt-6.1-sol" }
		const model = buildApiHandler(config).getModel()
		expect(model.id).toBe("openai/gpt-6.1-sol")
		expect(model.info.contextWindow).toBe(1_000_000)
		expect(model.info.maxTokens).toBe(65_536)
		expect(model.info.supportsReasoningEffort).toBe(true)
		expect(model.info.preserveReasoning).toBe(true)
		expect(model.info.inputPrice).toBe(5.0)
		expect(model.info.outputPrice).toBe(30.0)
	})
})
