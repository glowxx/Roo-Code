import {
	ProviderName,
	ProviderSettings,
	getModelId,
	setModelId,
	modelSupportsReasoning,
	ModelInfo,
	stripModelTag,
	xkiroModels,
	resolveXkiroModelInfo,
	anthropicModels,
	deepSeekModels,
	geminiModels,
	bedrockModels,
	openAiNativeModels,
} from "@roo-code/types"

export interface ResolveTaskExecutionConfigInput {
	baseProviderSettings: ProviderSettings
	chatMetadata?: {
		chatModelId?: string
		chatProvider?: ProviderName | string
		chatReasoningEffort?: string
		executionModelId?: string
		executionProvider?: ProviderName | string
		executionReasoningEffort?: string
		apiConfigName?: string
	}
	lastManualModel?: {
		modelId?: string
		provider?: ProviderName | string
		reasoningEffort?: string
	}
	isNewChat?: boolean
	modelInfoResolver?: (modelId?: string) => ModelInfo | undefined
}

/**
 * Normalizes reasoning effort string according to target model capabilities.
 */
export function normalizeReasoningEffort(
	effort: string | undefined,
	modelInfo?: ModelInfo | null,
): { effort: string | undefined; enabled: boolean } {
	if (effort === undefined) {
		return { effort: undefined, enabled: false }
	}
	const lower = effort.toLowerCase()
	if (lower === "disable" || lower === "off" || lower === "none") {
		return { effort: "disable", enabled: false }
	}
	const rawAllowed =
		modelInfo?.reasoningEffortLevels ||
		(Array.isArray(modelInfo?.supportsReasoningEffort) ? modelInfo.supportsReasoningEffort : undefined)
	const allowedLevels =
		rawAllowed && Array.isArray(rawAllowed) && rawAllowed.length > 0
			? rawAllowed.map((l) => l.toLowerCase()).filter((l) => l !== "disable" && l !== "none")
			: undefined

	if (allowedLevels && allowedLevels.length > 0 && !allowedLevels.includes(lower)) {
		const fallback = allowedLevels.includes("medium") ? "medium" : allowedLevels[0]
		return { effort: fallback, enabled: true }
	}

	return { effort: lower, enabled: true }
}

/**
 * Default fallback resolver for known model catalogs when external cache is not available.
 */
export function defaultResolveModelInfo(
	modelId?: string,
	extraModelInfos?: Record<string, ModelInfo>,
): ModelInfo | undefined {
	if (!modelId) return undefined
	const stripped = stripModelTag(modelId)
	return (
		extraModelInfos?.[modelId] ||
		extraModelInfos?.[stripped] ||
		resolveXkiroModelInfo(modelId) ||
		(xkiroModels as Record<string, ModelInfo>)?.[modelId] ||
		(xkiroModels as Record<string, ModelInfo>)?.[stripped] ||
		(anthropicModels as Record<string, ModelInfo>)?.[modelId] ||
		(deepSeekModels as Record<string, ModelInfo>)?.[modelId] ||
		(geminiModels as Record<string, ModelInfo>)?.[modelId] ||
		(bedrockModels as Record<string, ModelInfo>)?.[modelId] ||
		(openAiNativeModels as Record<string, ModelInfo>)?.[modelId]
	)
}

/**
 * Pure function that resolves the immutable execution configuration for a task.
 *
 * Rules:
 * 1. Base provider credentials (API key, base URL, headers, timeouts) are cloned from baseProviderSettings.
 * 2. If chatMetadata contains chatProvider and chatModelId:
 *    - They are the absolute source of truth for this chat/task.
 *    - Existing chats NEVER fall back to lastManuallySelectedModel.
 *    - If a model is not found in the catalog, it does NOT silently fall back to another chat's model.
 * 3. If isNewChat === true and chatMetadata does NOT specify a chatModelId:
 *    - Fall back to lastManualModel (if set by user manual selection in a new/provisional chat).
 * 4. Reasoning effort is validated against the resolved model:
 *    - If the model does not support reasoning, reasoningEffort is cleared and enableReasoningEffort is set to false.
 *    - If the model supports reasoning, normalized effort is applied.
 */
export function resolveTaskExecutionConfig(input: ResolveTaskExecutionConfigInput): ProviderSettings {
	const { baseProviderSettings, chatMetadata, lastManualModel, isNewChat = false, modelInfoResolver } = input

	// 1. Deep clone base settings to prevent shared mutable state leaks
	const resolved: ProviderSettings = structuredClone(baseProviderSettings)

	// 2. Resolve provider
	let targetProvider: ProviderName
	if (!isNewChat && chatMetadata?.executionProvider) {
		targetProvider = chatMetadata.executionProvider as ProviderName
	} else if (chatMetadata?.chatProvider) {
		targetProvider = chatMetadata.chatProvider as ProviderName
	} else if (isNewChat && lastManualModel?.provider) {
		targetProvider = lastManualModel.provider as ProviderName
	} else {
		targetProvider = (resolved.apiProvider || "openrouter") as ProviderName
	}
	resolved.apiProvider = targetProvider

	// 3. Resolve model ID
	let targetModelId: string | undefined
	if (!isNewChat && chatMetadata?.executionModelId) {
		targetModelId = chatMetadata.executionModelId
	} else if (chatMetadata?.chatModelId) {
		targetModelId = chatMetadata.chatModelId
	} else if (isNewChat && lastManualModel?.modelId) {
		targetModelId = lastManualModel.modelId
	} else {
		targetModelId = getModelId(resolved)
	}

	if (targetModelId) {
		setModelId(resolved, targetProvider, targetModelId)
	}

	// 4. Resolve and validate reasoning effort
	const resolver = modelInfoResolver || defaultResolveModelInfo
	const targetModelInfo = targetModelId ? resolver(targetModelId) : undefined
	const supportsReasoning = targetModelId ? modelSupportsReasoning(targetModelId, targetModelInfo) : false

	let effortToConsider: string | undefined
	if (!isNewChat && chatMetadata && "executionReasoningEffort" in chatMetadata && chatMetadata.executionReasoningEffort !== undefined) {
		effortToConsider = chatMetadata.executionReasoningEffort
	} else if (chatMetadata && "chatReasoningEffort" in chatMetadata) {
		effortToConsider = chatMetadata.chatReasoningEffort
	} else if (isNewChat && lastManualModel?.reasoningEffort !== undefined) {
		effortToConsider = lastManualModel.reasoningEffort
	} else {
		effortToConsider = (resolved as any).reasoningEffort
	}

	if (!supportsReasoning) {
		delete (resolved as any).reasoningEffort
		resolved.enableReasoningEffort = false
	} else {
		const { effort, enabled } = normalizeReasoningEffort(effortToConsider, targetModelInfo)
		if (effort === undefined) {
			delete (resolved as any).reasoningEffort
			resolved.enableReasoningEffort = false
		} else if (effort === "disable") {
			;(resolved as any).reasoningEffort = "disable" as any
			resolved.enableReasoningEffort = false
		} else {
			;(resolved as any).reasoningEffort = effort as any
			resolved.enableReasoningEffort = enabled
		}
	}

	return resolved
}
