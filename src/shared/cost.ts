import type { CostPrecision, CostSource, ModelInfo, ServiceTier } from "@roo-code/types"

export interface ApiCostResult {
	totalInputTokens: number
	totalOutputTokens: number
	totalCost: number
	costSource?: CostSource
	precision?: CostPrecision
}

export interface CostCalculationOptions {
	serviceTier?: ServiceTier
	discountMultiplier?: number
	costSource?: CostSource
	precision?: CostPrecision
}

function applyDiscountMultiplier(modelInfo: ModelInfo, discountMultiplier?: number): ModelInfo {
	if (discountMultiplier === undefined || discountMultiplier === 1) {
		return modelInfo
	}
	return {
		...modelInfo,
		inputPrice: modelInfo.inputPrice !== undefined ? modelInfo.inputPrice * discountMultiplier : undefined,
		outputPrice: modelInfo.outputPrice !== undefined ? modelInfo.outputPrice * discountMultiplier : undefined,
		cacheWritesPrice:
			modelInfo.cacheWritesPrice !== undefined ? modelInfo.cacheWritesPrice * discountMultiplier : undefined,
		cacheReadsPrice:
			modelInfo.cacheReadsPrice !== undefined ? modelInfo.cacheReadsPrice * discountMultiplier : undefined,
	}
}

function applyLongContextPricing(modelInfo: ModelInfo, totalInputTokens: number, serviceTier?: ServiceTier): ModelInfo {
	const pricing = modelInfo.longContextPricing
	if (!pricing || totalInputTokens <= pricing.thresholdTokens) {
		return modelInfo
	}

	const effectiveServiceTier = serviceTier ?? "default"
	if (pricing.appliesToServiceTiers && !pricing.appliesToServiceTiers.includes(effectiveServiceTier)) {
		return modelInfo
	}

	return {
		...modelInfo,
		inputPrice:
			modelInfo.inputPrice !== undefined && pricing.inputPriceMultiplier !== undefined
				? modelInfo.inputPrice * pricing.inputPriceMultiplier
				: modelInfo.inputPrice,
		outputPrice:
			modelInfo.outputPrice !== undefined && pricing.outputPriceMultiplier !== undefined
				? modelInfo.outputPrice * pricing.outputPriceMultiplier
				: modelInfo.outputPrice,
		cacheWritesPrice:
			modelInfo.cacheWritesPrice !== undefined && pricing.cacheWritesPriceMultiplier !== undefined
				? modelInfo.cacheWritesPrice * pricing.cacheWritesPriceMultiplier
				: modelInfo.cacheWritesPrice,
		cacheReadsPrice:
			modelInfo.cacheReadsPrice !== undefined && pricing.cacheReadsPriceMultiplier !== undefined
				? modelInfo.cacheReadsPrice * pricing.cacheReadsPriceMultiplier
				: modelInfo.cacheReadsPrice,
	}
}

function calculateApiCostInternal(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens: number,
	cacheReadInputTokens: number,
	totalInputTokens: number,
	totalOutputTokens: number,
	costSource?: CostSource,
	precision?: CostPrecision,
): ApiCostResult {
	const cacheWritesCost = ((modelInfo.cacheWritesPrice || 0) / 1_000_000) * cacheCreationInputTokens
	const cacheReadsCost = ((modelInfo.cacheReadsPrice || 0) / 1_000_000) * cacheReadInputTokens
	const baseInputCost = ((modelInfo.inputPrice || 0) / 1_000_000) * inputTokens
	const outputCost = ((modelInfo.outputPrice || 0) / 1_000_000) * outputTokens
	const totalCost = cacheWritesCost + cacheReadsCost + baseInputCost + outputCost

	return {
		totalInputTokens,
		totalOutputTokens,
		totalCost,
		costSource,
		precision,
	}
}

// For Anthropic compliant usage, the input tokens count does NOT include the
// cached tokens.
export function calculateApiCostAnthropic(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	options?: CostCalculationOptions,
): ApiCostResult {
	const cacheCreation = cacheCreationInputTokens || 0
	const cacheRead = cacheReadInputTokens || 0

	// For Anthropic: inputTokens does NOT include cached tokens
	// Total input = base input + cache creation + cache reads
	const totalInputTokens = inputTokens + cacheCreation + cacheRead

	let effectiveModelInfo = modelInfo
	if (options?.discountMultiplier !== undefined && options.discountMultiplier !== 1) {
		effectiveModelInfo = applyDiscountMultiplier(effectiveModelInfo, options.discountMultiplier)
	}

	return calculateApiCostInternal(
		effectiveModelInfo,
		inputTokens,
		outputTokens,
		cacheCreation,
		cacheRead,
		totalInputTokens,
		outputTokens,
		options?.costSource,
		options?.precision,
	)
}

// For OpenAI compliant usage, the input tokens count INCLUDES the cached tokens.
export function calculateApiCostOpenAI(
	modelInfo: ModelInfo,
	inputTokens: number,
	outputTokens: number,
	cacheCreationInputTokens?: number,
	cacheReadInputTokens?: number,
	serviceTierOrOptions?: ServiceTier | CostCalculationOptions,
): ApiCostResult {
	let serviceTier: ServiceTier | undefined
	let discountMultiplier: number | undefined
	let costSource: CostSource | undefined
	let precision: CostPrecision | undefined

	if (typeof serviceTierOrOptions === "object" && serviceTierOrOptions !== null) {
		serviceTier = serviceTierOrOptions.serviceTier
		discountMultiplier = serviceTierOrOptions.discountMultiplier
		costSource = serviceTierOrOptions.costSource
		precision = serviceTierOrOptions.precision
	} else if (typeof serviceTierOrOptions === "string") {
		serviceTier = serviceTierOrOptions
	}

	const cacheCreationInputTokensNum = cacheCreationInputTokens || 0
	const cacheReadInputTokensNum = cacheReadInputTokens || 0
	const nonCachedInputTokens = Math.max(0, inputTokens - cacheCreationInputTokensNum - cacheReadInputTokensNum)
	let effectiveModelInfo = applyLongContextPricing(modelInfo, inputTokens, serviceTier)
	if (discountMultiplier !== undefined && discountMultiplier !== 1) {
		effectiveModelInfo = applyDiscountMultiplier(effectiveModelInfo, discountMultiplier)
	}

	// For OpenAI: inputTokens ALREADY includes all tokens (cached + non-cached)
	// So we pass the original inputTokens as the total
	return calculateApiCostInternal(
		effectiveModelInfo,
		nonCachedInputTokens,
		outputTokens,
		cacheCreationInputTokensNum,
		cacheReadInputTokensNum,
		inputTokens,
		outputTokens,
		costSource,
		precision,
	)
}

export const parseApiPrice = (price: any) => (price ? parseFloat(price) * 1_000_000 : undefined)
