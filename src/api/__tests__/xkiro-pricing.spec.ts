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
})
