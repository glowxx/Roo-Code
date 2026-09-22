import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import axios from "axios"

import {
	type ModelInfo,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
	getOpenAiModelInfo,
	getModelContextWindow,
	modelSupportsReasoning,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { TagMatcher } from "../../utils/tag-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { getApiRequestTimeout } from "./utils/timeout-config"
import { handleOpenAIError } from "./utils/openai-error-handler"

// TODO: Rename this to OpenAICompatibleHandler. Also, I think the
// `OpenAINativeHandler` can subclass from this, since it's obviously
// compatible with the OpenAI API. We can also rename it to `OpenAIHandler`.
export class OpenAiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected client: OpenAI
	private readonly providerName = "OpenAI"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.openAiBaseUrl || "https://api.openai.com/v1"
		const apiKey = this.options.openAiApiKey ?? "not-provided"
		const isAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)
		const urlHost = this._getUrlHost(this.options.openAiBaseUrl)
		const isAzureOpenAi = urlHost === "azure.com" || urlHost.endsWith(".azure.com") || options.openAiUseAzure

		const headers = {
			...DEFAULT_HEADERS,
			...(this.options.openAiHeaders || {}),
		}

		const timeout = getApiRequestTimeout()

		if (isAzureAiInference) {
			// Azure AI Inference Service (e.g., for DeepSeek) uses a different path structure
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				defaultQuery: { "api-version": this.options.azureApiVersion || "2024-05-01-preview" },
				timeout,
			})
		} else if (isAzureOpenAi) {
			// Azure API shape slightly differs from the core API shape:
			// https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
			this.client = new AzureOpenAI({
				baseURL,
				apiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
				defaultHeaders: headers,
				timeout,
			})
		} else {
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				timeout,
			})
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { info: modelInfo, reasoning } = this.getModel()
		const modelUrl = this.options.openAiBaseUrl ?? ""
		const modelId = this.options.openAiModelId ?? ""
		const enabledR1Format = this.options.openAiR1FormatEnabled ?? false
		const isAzureAiInference = this._isAzureAiInference(modelUrl)
		const deepseekReasoner = modelId.includes("deepseek-reasoner") || enabledR1Format

		if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) {
			yield* this.handleO3FamilyMessage(modelId, systemPrompt, messages, metadata)
			return
		}

		let systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}

		if (this.options.openAiStreamingEnabled ?? true) {
			let convertedMessages

			if (deepseekReasoner) {
				convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			} else {
				if (modelInfo.supportsPromptCache) {
					systemMessage = {
						role: "system",
						content: [
							{
								type: "text",
								text: systemPrompt,
								// @ts-ignore-next-line
								cache_control: { type: "ephemeral" },
							},
						],
					}
				}

				convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]

				// Do not inject Anthropic cache_control headers for native OpenAI / xKiro endpoints.
				// OpenAI uses automatic prefix caching; injecting and sliding ephemeral markers
				// mutates historical messages across turns and causes prefix cache misses.
				const isOpenRouter = this.options.openAiBaseUrl?.includes("openrouter.ai")
				if (isOpenRouter && modelInfo.supportsPromptCache) {
					// Note: the following logic is copied from openrouter:
					// Add cache_control to the last two user messages
					// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
					const lastTwoUserMessages = convertedMessages.filter((msg) => msg.role === "user").slice(-2)

					lastTwoUserMessages.forEach((msg) => {
						if (typeof msg.content === "string") {
							msg.content = [{ type: "text", text: msg.content }]
						}

						if (Array.isArray(msg.content)) {
							// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
							let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

							if (!lastTextPart) {
								lastTextPart = { type: "text", text: "..." }
								msg.content.push(lastTextPart)
							}

							// @ts-ignore-next-line
							lastTextPart["cache_control"] = { type: "ephemeral" }
						}
					})
				}
			}

			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				temperature: this.options.modelTemperature ?? (deepseekReasoner ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0),
				messages: convertedMessages,
				stream: true as const,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				...(reasoning && reasoning),
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const matcher = new TagMatcher(
				"think",
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			let lastUsage
			const activeToolCallIds = new Set<string>()

			for await (const chunk of stream) {
				const delta = chunk.choices?.[0]?.delta ?? {}
				const finishReason = chunk.choices?.[0]?.finish_reason

				if (delta.content) {
					for (const chunk of matcher.update(delta.content)) {
						yield chunk
					}
				}

				if ("reasoning_content" in delta && delta.reasoning_content) {
					yield {
						type: "reasoning",
						text: (delta.reasoning_content as string | undefined) || "",
					}
				}

				yield* this.processToolCalls(delta, finishReason, activeToolCallIds)

				if (chunk.usage) {
					lastUsage = chunk.usage
				}
			}

			for (const chunk of matcher.final()) {
				yield chunk
			}

			if (lastUsage) {
				yield this.processUsageMetrics(lastUsage, modelInfo)
			}
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: deepseekReasoner
					? convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
					: [systemMessage, ...convertToOpenAiMessages(messages)],
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					this._isAzureAiInference(modelUrl) ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const message = response.choices?.[0]?.message

			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}

			yield this.processUsageMetrics(response.usage, modelInfo)
		}
	}

	protected processUsageMetrics(usage: any, _modelInfo?: ModelInfo): ApiStreamUsageChunk {
		const inputDetails = usage?.prompt_tokens_details ?? usage?.input_tokens_details
		const cachedFromDetails = inputDetails?.cached_tokens
		const cacheReadTokens =
			usage?.cache_read_input_tokens ??
			usage?.cache_read_tokens ??
			usage?.cached_tokens ??
			cachedFromDetails ??
			undefined

		const cacheWriteTokens =
			usage?.cache_creation_input_tokens ??
			inputDetails?.cache_write_tokens ??
			undefined

		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens,
			cacheReadTokens,
		}
	}

	override getModel() {
		const id = this.options.openAiModelId ?? ""
		const cachedInfo = getCachedOpenAiModelInfo(id)
		const customInfo =
			this.options.openAiCustomModelInfo && Object.keys(this.options.openAiCustomModelInfo).length > 0
				? this.options.openAiCustomModelInfo
				: cachedInfo
		const info: ModelInfo = getOpenAiModelInfo(id, customInfo)
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const isAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)
			const model = this.getModel()
			const modelInfo = model.info

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: model.id,
				messages: [{ role: "user", content: prompt }],
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			return response.choices?.[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${this.providerName} completion error: ${error.message}`)
			}

			throw error
		}
	}

	private async *handleO3FamilyMessage(
		modelId: string,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelInfo = this.getModel().info
		const methodIsAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)

		if (this.options.openAiStreamingEnabled ?? true) {
			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				stream: true,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				reasoning_effort: ((this.options.reasoningEffort || modelInfo.reasoningEffort || "medium") as "low" | "medium" | "high" | undefined),
				temperature: undefined,
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			yield* this.handleStreamResponse(stream)
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				reasoning_effort: ((this.options.reasoningEffort || modelInfo.reasoningEffort || "medium") as "low" | "medium" | "high" | undefined),
				temperature: undefined,
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const message = response.choices?.[0]?.message
			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}
			yield this.processUsageMetrics(response.usage)
		}
	}

	private async *handleStreamResponse(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): ApiStream {
		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			const finishReason = chunk.choices?.[0]?.finish_reason

			if (delta) {
				if (delta.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				yield* this.processToolCalls(delta, finishReason, activeToolCallIds)
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	/**
	 * Helper generator to process tool calls from a stream chunk.
	 * Tracks active tool call IDs and yields tool_call_partial and tool_call_end events.
	 * @param delta - The delta object from the stream chunk
	 * @param finishReason - The finish_reason from the stream chunk
	 * @param activeToolCallIds - Set to track active tool call IDs (mutated in place)
	 */
	private *processToolCalls(
		delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined,
		finishReason: string | null | undefined,
		activeToolCallIds: Set<string>,
	): Generator<
		| { type: "tool_call_partial"; index: number; id?: string; name?: string; arguments?: string }
		| { type: "tool_call_end"; id: string }
	> {
		if (delta?.tool_calls) {
			for (const toolCall of delta.tool_calls) {
				if (toolCall.id) {
					activeToolCallIds.add(toolCall.id)
				}
				yield {
					type: "tool_call_partial",
					index: toolCall.index,
					id: toolCall.id,
					name: toolCall.function?.name,
					arguments: toolCall.function?.arguments,
				}
			}
		}

		// Emit tool_call_end events when finish_reason is "tool_calls"
		// This ensures tool calls are finalized even if the stream doesn't properly close
		if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
			for (const id of activeToolCallIds) {
				yield { type: "tool_call_end", id }
			}
			activeToolCallIds.clear()
		}
	}

	protected _getUrlHost(baseUrl?: string): string {
		try {
			return new URL(baseUrl ?? "").host
		} catch (error) {
			return ""
		}
	}

	private _isGrokXAI(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.includes("x.ai")
	}

	protected _isAzureAiInference(baseUrl?: string): boolean {
		const urlHost = this._getUrlHost(baseUrl)
		return urlHost.endsWith(".services.ai.azure.com")
	}

	/**
	 * Adds max_completion_tokens to the request body if needed based on provider configuration
	 * Note: max_tokens is deprecated in favor of max_completion_tokens as per OpenAI documentation
	 * O3 family models handle max_tokens separately in handleO3FamilyMessage
	 */
	protected addMaxTokensIfNeeded(
		requestOptions:
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		modelInfo: ModelInfo,
	): void {
		// Only add max_completion_tokens if includeMaxTokens is true
		if (this.options.includeMaxTokens === true) {
			// Use user-configured modelMaxTokens if available, otherwise fall back to model's default maxTokens
			// Using max_completion_tokens as max_tokens is deprecated
			requestOptions.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
		}
	}
}

export type ModelFamily = "claude" | "openai" | "deepseek" | "gemini" | "qwen" | "other"

export function extractModelFamily(id: string): ModelFamily {
	const lower = id.toLowerCase()
	if (lower.includes("claude") || lower.includes("anthropic")) return "claude"
	if (lower.includes("gpt") || lower.includes("openai") || /(?:^|[\/_\-])o[1-9](?:[\/_\-]|$)/i.test(lower)) return "openai"
	if (lower.includes("deepseek")) return "deepseek"
	if (lower.includes("gemini") || lower.includes("google")) return "gemini"
	if (lower.includes("qwen")) return "qwen"
	return "other"
}

export function extractModelVersion(id: string): number {
	const lower = id.toLowerCase()
	const family = extractModelFamily(id)

	if (family === "claude") {
		const match = lower.match(/claude-?(?:v)?(\d+)(?:[.\-_](\d+))?/)
		if (match) {
			const major = parseInt(match[1], 10)
			const minor = match[2] ? parseInt(match[2], 10) : 0
			return major + minor / 10
		}
	} else if (family === "openai") {
		const oMatch = lower.match(/(?:^|[\/_\-])o(\d+)(?:[.\-_](\d+))?/)
		if (oMatch) {
			const major = parseInt(oMatch[1], 10)
			const minor = oMatch[2] ? parseInt(oMatch[2], 10) : 0
			return major + minor / 10
		}
		const gptMatch = lower.match(/gpt-?(?:v)?(\d+)(?:[.\-_](\d+))?/)
		if (gptMatch) {
			const major = parseInt(gptMatch[1], 10)
			const minor = gptMatch[2] ? parseInt(gptMatch[2], 10) : 0
			return major + minor / 10
		}
	} else if (family === "deepseek") {
		const vMatch = lower.match(/deepseek-?(?:v)(\d+)(?:[.\-_](\d+))?/)
		if (vMatch) {
			const major = parseInt(vMatch[1], 10)
			const minor = vMatch[2] ? parseInt(vMatch[2], 10) : 0
			return major + minor / 10
		}
		const rMatch = lower.match(/deepseek-?(?:r)(\d+)(?:[.\-_](\d+))?/)
		if (rMatch) {
			const major = parseInt(rMatch[1], 10)
			const minor = rMatch[2] ? parseInt(rMatch[2], 10) : 0
			return major + minor / 10
		}
		if (lower.includes("chat")) return 3.0
		if (lower.includes("reasoner")) return 1.0
	} else if (family === "gemini") {
		const geminiMatch = lower.match(/gemini-?(?:v)?(\d+)(?:[.\-_](\d+))?/)
		if (geminiMatch) {
			const major = parseInt(geminiMatch[1], 10)
			const minor = geminiMatch[2] ? parseInt(geminiMatch[2], 10) : 0
			return major + minor / 10
		}
	} else if (family === "qwen") {
		const qwenMatch = lower.match(/qwen-?(?:v)?(\d+)(?:[.\-_](\d+))?/)
		if (qwenMatch) {
			const major = parseInt(qwenMatch[1], 10)
			const minor = qwenMatch[2] ? parseInt(qwenMatch[2], 10) : 0
			return major + minor / 10
		}
	}

	const genericMatch = lower.match(/(?:v)?(\d+)[.\-_](\d+)/)
	if (genericMatch) {
		return parseInt(genericMatch[1], 10) + parseInt(genericMatch[2], 10) / 10
	}
	const singleNum = lower.match(/(?:v|-)(\d+)(?:$|[^0-9])/)
	if (singleNum) {
		return parseInt(singleNum[1], 10)
	}

	return 0
}

export function getModelTierScore(id: string): number {
	const lower = id.toLowerCase()
	let score = 0
	if (lower.includes("opus")) score += 30
	else if (lower.includes("sonnet") || lower.includes("pro") || lower.includes("max")) score += 20
	else if (lower.includes("plus") || lower.includes("chat") || lower.includes("reasoner")) score += 15
	else if (lower.includes("mini") || lower.includes("flash") || lower.includes("haiku") || lower.includes("turbo") || lower.includes("lite")) score += 5
	else score += 10

	if (lower.includes("reason") || lower.includes("r1") || lower.includes("o1") || lower.includes("o3") || lower.includes("thinking")) {
		score += 5
	}
	return score
}

export function sortOpenAiModels(models: string[]): string[] {
	const getFamilyPriority = (family: ModelFamily): number => {
		switch (family) {
			case "claude":
				return 1
			case "openai":
				return 2
			case "deepseek":
				return 3
			case "gemini":
				return 4
			case "qwen":
				return 5
			default:
				return 6
		}
	}

	return [...models].sort((a, b) => {
		const famA = extractModelFamily(a)
		const famB = extractModelFamily(b)
		const prioA = getFamilyPriority(famA)
		const prioB = getFamilyPriority(famB)

		if (prioA !== prioB) return prioA - prioB

		if (famA !== "other") {
			// Inside same known family: sort descending by version
			const verA = extractModelVersion(a)
			const verB = extractModelVersion(b)
			if (verA !== verB) return verB - verA

			// Inside same version: sort descending by tier score
			const tierA = getModelTierScore(a)
			const tierB = getModelTierScore(b)
			if (tierA !== tierB) return tierB - tierA
		}

		// Tie-break alphabetically
		return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })
	})
}

export const openAiModelInfoCache = new Map<string, ModelInfo>()

export function getCachedOpenAiModelInfo(modelId: string): ModelInfo | undefined {
	return openAiModelInfoCache.get(modelId)
}

export function initializeOpenAiModelInfoCache(cachedInfos: Record<string, ModelInfo>): void {
	if (!cachedInfos || typeof cachedInfos !== "object") {
		return
	}
	for (const [id, info] of Object.entries(cachedInfos)) {
		if (id && info) {
			openAiModelInfoCache.set(id, info)
		}
	}
}

export function parseOpenAiModelInfo(rawItem: any): ModelInfo {
	const id = typeof rawItem === "string" ? rawItem : rawItem?.id || rawItem?.name || ""
	const contextLength =
		typeof rawItem?.context_length === "number"
			? rawItem.context_length
			: typeof rawItem?.max_context_length === "number"
				? rawItem.max_context_length
				: typeof rawItem?.context_window === "number"
					? rawItem.context_window
					: undefined

	const maxOutputTokens =
		typeof rawItem?.max_output_tokens === "number"
			? rawItem.max_output_tokens
			: typeof rawItem?.max_tokens === "number"
				? rawItem.max_tokens
				: undefined

	const resolvedContextWindow = getModelContextWindow(id, contextLength)

	const pricing = rawItem?.pricing
	let inputPrice: number | undefined
	let outputPrice: number | undefined
	let cacheReadsPrice: number | undefined
	let cacheWritesPrice: number | undefined

	if (pricing) {
		inputPrice = typeof pricing.input === "number" ? pricing.input : undefined
		outputPrice = typeof pricing.output === "number" ? pricing.output : undefined
		cacheReadsPrice = typeof pricing.cache_read === "number" ? pricing.cache_read : undefined
		cacheWritesPrice = typeof pricing.cache_write === "number" ? pricing.cache_write : undefined
	}

	const capabilities = rawItem?.capabilities
	const supportsImages = typeof capabilities?.vision === "boolean" ? capabilities.vision : true
	const supportsPromptCache = cacheReadsPrice !== undefined || cacheWritesPrice !== undefined || true
	const reasoningLevels = rawItem?.reasoning_efforts?.levels
	const supportsReasoningEffort =
		(Array.isArray(reasoningLevels) && reasoningLevels.length > 0) ||
		capabilities?.reasoning ||
		modelSupportsReasoning(id)
			? true
			: undefined

	return {
		maxTokens: maxOutputTokens ?? 8192,
		contextWindow: resolvedContextWindow,
		supportsImages,
		supportsPromptCache,
		inputPrice,
		outputPrice,
		cacheReadsPrice,
		cacheWritesPrice,
		description: rawItem?.display_name ? `${rawItem.display_name} (${id})` : undefined,
		...(supportsReasoningEffort !== undefined ? { supportsReasoningEffort } : {}),
	}
}

export async function getOpenAiModelsWithInfo(
	baseUrl?: string,
	apiKey?: string,
	openAiHeaders?: Record<string, string>,
): Promise<{ models: string[]; modelInfos: Record<string, ModelInfo> }> {
	try {
		if (!baseUrl) {
			return { models: [], modelInfos: {} }
		}

		// Trim whitespace from baseUrl to handle cases where users accidentally include spaces
		const trimmedBaseUrl = baseUrl.trim()

		if (!URL.canParse(trimmedBaseUrl)) {
			return { models: [], modelInfos: {} }
		}

		const config: Record<string, any> = {
			timeout: 10000,
		}
		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			"User-Agent": "Roo-Code-Desktop/1.0",
			...(openAiHeaders || {}),
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		if (Object.keys(headers).length > 0) {
			config["headers"] = headers
		}

		const response = await axios.get(`${trimmedBaseUrl}/models`, config)
		const rawData = response.data
		const rawList: any[] = Array.isArray(rawData)
			? rawData
			: Array.isArray(rawData?.data)
				? rawData.data
				: Array.isArray(rawData?.models)
					? rawData.models
					: []

		const modelInfos: Record<string, ModelInfo> = {}
		const extractedIds: string[] = []

		for (const item of rawList) {
			const id = (typeof item === "string" ? item : item?.id || item?.name || "").trim()
			if (id.length > 0) {
				extractedIds.push(id)
				if (typeof item === "object" && item !== null) {
					const parsedInfo = parseOpenAiModelInfo(item)
					modelInfos[id] = parsedInfo
					openAiModelInfoCache.set(id, parsedInfo)
				}
			}
		}

		const deduplicated = Array.from(new Set(extractedIds))
		return {
			models: sortOpenAiModels(deduplicated),
			modelInfos,
		}
	} catch (error) {
		return { models: [], modelInfos: {} }
	}
}

export async function getOpenAiModels(baseUrl?: string, apiKey?: string, openAiHeaders?: Record<string, string>) {
	const result = await getOpenAiModelsWithInfo(baseUrl, apiKey, openAiHeaders)
	return result.models
}
