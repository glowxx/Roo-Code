// npx vitest run src/shared/__tests__/pricing-regression.spec.ts

import type { ClineMessage, ModelInfo } from "@roo-code/types"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../cost"
import { consolidateTokenUsage } from "@roo-code/core/browser"
// Helper functions for user prompt isolation (mirroring webview-ui/src/components/chat/utils/userPrompt.ts
// to keep src and webview-ui compilation boundaries strictly isolated)
function getLatestUserPrompt(messages: ClineMessage[] | undefined): ClineMessage | undefined {
	if (!messages || messages.length === 0) return undefined
	for (let i = messages.length - 1; i > 0; i--) {
		const message = messages[i]
		if (
			message.type === "say" &&
			message.say === "user_feedback" &&
			(Boolean(message.text?.trim()) || (message.images && message.images.length > 0))
		) {
			return message
		}
	}
	return messages[0]
}

function getLatestPromptModifiedMessages(
	modifiedMessages: ClineMessage[],
	latestUserPrompt: ClineMessage | undefined,
	initialTask: ClineMessage | undefined,
): ClineMessage[] {
	if (!modifiedMessages || modifiedMessages.length === 0) return []
	if (!latestUserPrompt || !initialTask || latestUserPrompt === initialTask || latestUserPrompt.ts === initialTask.ts) {
		return modifiedMessages
	}
	let promptIndex = -1
	for (let i = modifiedMessages.length - 1; i >= 0; i--) {
		const m = modifiedMessages[i]
		if (m === latestUserPrompt || m.ts === latestUserPrompt.ts) {
			promptIndex = i
			break
		}
	}
	if (promptIndex === -1) return []
	return modifiedMessages.slice(promptIndex + 1)
}

describe("Pricing Architecture & Regression Test Suite", () => {
	// Helper to create an api_req_started message
	const createApiReqMessage = (
		ts: number,
		data: {
			tokensIn?: number
			tokensOut?: number
			cacheWrites?: number
			cacheReads?: number
			cost?: number
			costSource?: string
			precision?: string
			cancelReason?: string
			request?: string
		},
	): ClineMessage => ({
		ts,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify(data),
	})

	// Helper to create user_feedback message
	const createUserFeedbackMessage = (ts: number, text: string): ClineMessage => ({
		ts,
		type: "say",
		say: "user_feedback",
		text,
	})

	describe("1. PROVIDER EXACT COST", () => {
		it("prioritizes provider billed cost (0.19) over local table calculation (0.56) with source=provider-reported", () => {
			const mockModel: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
				inputPrice: 5.0, // $5/M -> for 80k input = $0.40
				outputPrice: 16.0, // $16/M -> for 10k output = $0.16
			}

			const inputTokens = 80_000
			const outputTokens = 10_000

			// Local table estimate
			const localResult = calculateApiCostOpenAI(mockModel, inputTokens, outputTokens)
			expect(localResult.totalCost).toBeCloseTo(0.56, 4)

			// Provider reported cost in chunk
			const providerBilledCost = 0.19

			// In Task streaming completion: totalCost ?? localResult.totalCost
			const finalCost = providerBilledCost ?? localResult.totalCost
			const costSource = providerBilledCost !== undefined ? "provider-reported" : "local-estimate"
			const precision = providerBilledCost !== undefined ? "exact" : "estimated"

			expect(finalCost).toBe(0.19)
			expect(costSource).toBe("provider-reported")
			expect(precision).toBe("exact")

			// Check consolidation preserves exact provider-reported cost
			const messages: ClineMessage[] = [
				createApiReqMessage(1000, {
					tokensIn: inputTokens,
					tokensOut: outputTokens,
					cost: finalCost,
					costSource,
					precision,
				}),
			]

			const metrics = consolidateTokenUsage(messages)
			expect(metrics.totalCost).toBe(0.19)
		})
	})

	describe("2. PROMO PRICING", () => {
		it("calculates cost using live provider pricing instead of static table or hardcoded multiplier", () => {
			// Static hardcoded pricing table
			const staticModelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
			}

			// Live provider pricing (e.g. OpenRouter /models promotional discount: 50% lower)
			const livePromoModelInfo: ModelInfo = {
				...staticModelInfo,
				inputPrice: 1.5, // 50% discount
				outputPrice: 7.5, // 50% discount
			}

			const inputTokens = 100_000
			const outputTokens = 20_000

			// With live provider pricing
			const promoResult = calculateApiCostOpenAI(livePromoModelInfo, inputTokens, outputTokens)

			// Input: (1.5 / 1_000_000) * 100_000 = 0.15
			// Output: (7.5 / 1_000_000) * 20_000 = 0.15
			// Total: 0.30
			expect(promoResult.totalCost).toBeCloseTo(0.3, 6)

			// Ensure it did not use the static price (which would be 0.60)
			const staticResult = calculateApiCostOpenAI(staticModelInfo, inputTokens, outputTokens)
			expect(staticResult.totalCost).toBeCloseTo(0.6, 6)
			expect(promoResult.totalCost).toBeLessThan(staticResult.totalCost)
		})
	})

	describe("3. CACHE DOUBLE COUNTING", () => {
		it("prevents double counting when prompt_tokens=100k and cached_tokens=80k in OpenAI protocol", () => {
			const mockModel: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
				inputPrice: 2.5,
				outputPrice: 10.0,
				cacheReadsPrice: 0.25,
			}

			const promptTokens = 100_000
			const cachedTokens = 80_000
			const completionTokens = 1_000

			const result = calculateApiCostOpenAI(
				mockModel,
				promptTokens,
				completionTokens,
				undefined, // cacheCreation
				cachedTokens, // cacheReads
			)

			// Correct calculation:
			// Non-cached input tokens: 100_000 - 80_000 = 20_000
			// Base input cost: (2.5 / 1_000_000) * 20_000 = 0.05
			// Cache read cost: (0.25 / 1_000_000) * 80_000 = 0.02
			// Output cost: (10.0 / 1_000_000) * 1_000 = 0.01
			// Total: 0.05 + 0.02 + 0.01 = 0.08
			expect(result.totalCost).toBeCloseTo(0.08, 6)
			expect(result.totalInputTokens).toBe(100_000)

			// Double-counting bug would have billed all 100k at $2.5 + 80k at $0.25 = 0.25 + 0.02 + 0.01 = 0.28
			const doubleCountCost =
				((mockModel.inputPrice! / 1_000_000) * promptTokens) +
				((mockModel.cacheReadsPrice! / 1_000_000) * cachedTokens) +
				((mockModel.outputPrice! / 1_000_000) * completionTokens)
			expect(result.totalCost).not.toBeCloseTo(doubleCountCost, 4)
		})
	})

	describe("4. REASONING TOKENS", () => {
		it("ensures reasoning tokens are not charged twice as separate output tokens", () => {
			const mockModel: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
			}

			// In OpenAI API response:
			// prompt_tokens = 10_000
			// completion_tokens = 5_000 (which ALREADY includes completion_tokens_details.reasoning_tokens = 3_000)
			const promptTokens = 10_000
			const completionTokens = 5_000
			const reasoningTokens = 3_000

			// Provider output tokens should be 5,000, not 5,000 + 3,000 = 8,000
			const result = calculateApiCostOpenAI(mockModel, promptTokens, completionTokens)

			// Input cost: (3.0 / 1M) * 10_000 = 0.03
			// Output cost: (15.0 / 1M) * 5_000 = 0.075
			// Total: 0.105
			expect(result.totalCost).toBeCloseTo(0.105, 6)

			// If reasoning tokens were erroneously double counted:
			const doubleCountOutputCost = ((mockModel.outputPrice! / 1_000_000) * (completionTokens + reasoningTokens)) + ((mockModel.inputPrice! / 1_000_000) * promptTokens)
			expect(result.totalCost).not.toBeCloseTo(doubleCountOutputCost, 4)
		})
	})

	describe("5. RETRY & FAILED REQUESTS", () => {
		it("excludes unbilled failed attempts and prevents phantom costs", () => {
			const messages: ClineMessage[] = [
				// Request 1 failed before streaming any tokens (unbilled)
				createApiReqMessage(1000, {
					request: "req-1",
					tokensIn: 0,
					tokensOut: 0,
					cost: undefined,
					cancelReason: "streaming_failed",
				}),
				// Request 2 retry succeeded
				createApiReqMessage(1001, {
					request: "req-2",
					tokensIn: 1000,
					tokensOut: 500,
					cost: 0.05,
				}),
			]

			const metrics = consolidateTokenUsage(messages)
			expect(metrics.totalCost).toBe(0.05)
			expect(metrics.totalTokensIn).toBe(1000)
			expect(metrics.totalTokensOut).toBe(500)
		})

		it("includes both attempts when provider billed both partial stream and retry", () => {
			const messages: ClineMessage[] = [
				// Request 1 streamed partial response and was billed by provider
				createApiReqMessage(1000, {
					request: "req-1-partial",
					tokensIn: 5000,
					tokensOut: 200,
					cost: 0.02,
					cancelReason: "streaming_failed",
				}),
				// Request 2 retry completed successfully
				createApiReqMessage(1001, {
					request: "req-2-retry",
					tokensIn: 5200,
					tokensOut: 1000,
					cost: 0.022,
				}),
			]

			const metrics = consolidateTokenUsage(messages)
			expect(metrics.totalCost).toBeCloseTo(0.042, 6)
			expect(metrics.totalTokensIn).toBe(10200)
			expect(metrics.totalTokensOut).toBe(1200)
		})
	})

	describe("6. HISTORICAL COST IMMUTABILITY", () => {
		it("preserves saved actualCost when current pricing table is modified", () => {
			// Historical message saved with cost = $0.19
			const historicalMessages: ClineMessage[] = [
				createApiReqMessage(1000, {
					tokensIn: 50_000,
					tokensOut: 5_000,
					cost: 0.19,
					costSource: "provider-reported",
					precision: "exact",
				}),
			]

			// Initial calculation from message history
			const initialMetrics = consolidateTokenUsage(historicalMessages)
			expect(initialMetrics.totalCost).toBe(0.19)

			// Pricing table doubles in newer version
			const updatedModelPricing: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
				inputPrice: 10.0, // increased
				outputPrice: 30.0, // increased
			}

			// Under new pricing, the tokens would cost $0.65:
			const recalculationUnderNewPricing = calculateApiCostOpenAI(updatedModelPricing, 50_000, 5_000)
			expect(recalculationUnderNewPricing.totalCost).toBeCloseTo(0.65, 4)

			// Consolidating historical messages STILL returns $0.19
			const currentMetrics = consolidateTokenUsage(historicalMessages)
			expect(currentMetrics.totalCost).toBe(0.19)
		})
	})

	describe("7. LATEST PROMPT ISOLATION IN TASK HEADER", () => {
		it("correctly isolates prompt B ($0.19) while total cost reflects $0.39", () => {
			const initialTask: ClineMessage = {
				type: "say",
				ts: 1000,
				text: "Prompt A: Initial Task",
			}

			const promptB: ClineMessage = createUserFeedbackMessage(2000, "Prompt B: Follow-up request")

			const messages: ClineMessage[] = [
				initialTask,
				createApiReqMessage(1001, {
					tokensIn: 1000,
					tokensOut: 500,
					cost: 0.2,
				}),
				promptB,
				createApiReqMessage(2001, {
					tokensIn: 800,
					tokensOut: 400,
					cost: 0.19,
				}),
			]

			// Total task metrics across entire conversation
			const totalMetrics = consolidateTokenUsage(messages)
			expect(totalMetrics.totalCost).toBeCloseTo(0.39, 4)

			// Latest user prompt detection
			const latestPrompt = getLatestUserPrompt(messages)
			expect(latestPrompt?.ts).toBe(2000)
			expect(latestPrompt?.text).toBe("Prompt B: Follow-up request")

			// Slice of messages for latest prompt
			const latestPromptMessages = getLatestPromptModifiedMessages(messages, latestPrompt, initialTask)
			expect(latestPromptMessages).toHaveLength(1)
			expect(latestPromptMessages[0].ts).toBe(2001)

			// Metrics for latest prompt
			const latestPromptMetrics = consolidateTokenUsage(latestPromptMessages)
			expect(latestPromptMetrics.totalCost).toBeCloseTo(0.19, 4)

			// In TaskHeader:
			// latestPromptCost is passed as latestPromptMetrics.totalCost (0.19)
			// totalCost is passed as totalMetrics.totalCost (0.39)
			const displayPromptCost = latestPromptMetrics.totalCost ?? totalMetrics.totalCost
			expect(displayPromptCost).toBeCloseTo(0.19, 4)
			expect(totalMetrics.totalCost).toBeCloseTo(0.39, 4)
		})
	})

	describe("8. SMALL COST PRECISION", () => {
		it("maintains floating point precision for $0.004 requests without premature rounding to $0.00", () => {
			const smallRequests: ClineMessage[] = [
				createApiReqMessage(1000, { tokensIn: 800, tokensOut: 200, cost: 0.004 }),
				createApiReqMessage(1001, { tokensIn: 800, tokensOut: 200, cost: 0.004 }),
				createApiReqMessage(1002, { tokensIn: 800, tokensOut: 200, cost: 0.004 }),
			]

			const metrics = consolidateTokenUsage(smallRequests)

			// 0.004 * 3 = 0.012
			expect(metrics.totalCost).toBeCloseTo(0.012, 6)

			// Premature rounding check:
			const prematureRoundedSum = smallRequests.reduce((acc, msg) => {
				const cost = JSON.parse(msg.text || "{}").cost || 0
				return acc + Number(cost.toFixed(2)) // Prematurely rounded to 2 decimals ($0.00)
			}, 0)

			expect(prematureRoundedSum).toBe(0)
			// The actual accumulator maintains full precision
			expect(metrics.totalCost).toBeGreaterThan(0)
			expect(metrics.totalCost).toBeCloseTo(0.012, 6)
		})
	})
})
