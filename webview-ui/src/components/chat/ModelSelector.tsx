import React, { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Check, X, Sparkles, Cpu, Settings2, Search, Brain, Zap, Bot, Server, Layers, ChevronDown, Pin, Plus, RefreshCw, Loader2, Code2, Eye } from "lucide-react"

import {
	type ProviderSettings,
	type ProviderName,
	type ModelInfo,
	modelSupportsReasoning,
	getModelContextWindow,
} from "@roo-code/types"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip, Button } from "@/components/ui"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { MODELS_BY_PROVIDER } from "@/components/settings/constants"
import { IconButton } from "./IconButton"

export interface ModelSelectorProps {
	disabled?: boolean
	triggerClassName?: string
	triggerTestId?: string
	currentConfigId?: string
	displayName?: string
	listApiConfigMeta?: Array<{ id: string; name: string; modelId?: string }>
	pinnedApiConfigs?: Record<string, boolean>
	togglePinnedApiConfig?: (id: string) => void
	lockApiConfigAcrossModes?: boolean
	onToggleLockApiConfig?: () => void
	onApiConfigChange?: (configId: string) => void
}

export interface ModelItem {
	id: string
	name: string
	contextWindow?: number
	isReasoning?: boolean
	isFast?: boolean
	isCoder?: boolean
	isVision?: boolean
	isFlagship?: boolean
	badge?: string
	description?: string
}

export type ModelCategory = "all" | "reasoning" | "fast" | "coder" | "vision" | "default"

export type ModelFamily = "claude" | "openai" | "deepseek" | "gemini" | "qwen" | "other"

export const extractModelFamily = (id: string): ModelFamily => {
	const lower = id.toLowerCase()
	if (lower.includes("claude") || lower.includes("anthropic")) return "claude"
	if (lower.includes("gpt") || lower.includes("openai") || /(?:^|[\/_\-])o[1-9](?:[\/_\-]|$)/i.test(lower)) return "openai"
	if (lower.includes("deepseek")) return "deepseek"
	if (lower.includes("gemini") || lower.includes("google")) return "gemini"
	if (lower.includes("qwen")) return "qwen"
	return "other"
}

export const extractModelVersion = (id: string): number => {
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

export const getModelTierScore = (id: string): number => {
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

export const compareModels = (a: ModelItem, b: ModelItem): number => {
	const getFamilyPriority = (fam: ModelFamily): number => {
		switch (fam) {
			case "claude": return 1
			case "openai": return 2
			case "deepseek": return 3
			case "gemini": return 4
			case "qwen": return 5
			default: return 6
		}
	}

	const famA = extractModelFamily(a.id)
	const famB = extractModelFamily(b.id)
	const prioA = getFamilyPriority(famA)
	const prioB = getFamilyPriority(famB)

	if (prioA !== prioB) return prioA - prioB

	if (famA !== "other") {
		// Inside same known family: sort descending by version
		const verA = extractModelVersion(a.id)
		const verB = extractModelVersion(b.id)
		if (verA !== verB) return verB - verA

		// Inside same version: sort descending by tier score
		const tierA = getModelTierScore(a.id)
		const tierB = getModelTierScore(b.id)
		if (tierA !== tierB) return tierB - tierA
	}

	return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
}

export const promoteDynamicFlagships = (models: ModelItem[]): Set<string> => {
	const flagshipIds = new Set<string>()
	const families: ModelFamily[] = ["claude", "openai", "deepseek", "gemini", "qwen"]

	const familyModels = new Map<ModelFamily, ModelItem[]>()
	for (const f of families) familyModels.set(f, [])

	for (const m of models) {
		const fam = extractModelFamily(m.id)
		if (familyModels.has(fam)) {
			familyModels.get(fam)!.push(m)
		}
	}

	for (const list of familyModels.values()) {
		list.sort(compareModels)
	}

	const candidates: string[] = []

	// 1. Claude: top 1
	const claudeList = familyModels.get("claude") || []
	if (claudeList.length > 0) candidates.push(claudeList[0].id)

	// 2. OpenAI: top general
	const openaiList = familyModels.get("openai") || []
	const openaiGeneral = openaiList.find((m) => !m.isReasoning)
	const openaiReasoning = openaiList.find((m) => m.isReasoning)
	if (openaiGeneral) candidates.push(openaiGeneral.id)

	// 3. DeepSeek: top reasoning + top chat
	const dsList = familyModels.get("deepseek") || []
	const dsReasoning = dsList.find((m) => m.isReasoning)
	const dsChat = dsList.find((m) => !m.isReasoning)
	if (dsReasoning) candidates.push(dsReasoning.id)
	if (dsChat && dsChat.id !== dsReasoning?.id) candidates.push(dsChat.id)

	// 4. Gemini: top model
	const geminiList = familyModels.get("gemini") || []
	if (geminiList.length > 0) candidates.push(geminiList[0].id)

	// 5. Qwen: top model (prefer coder)
	const qwenList = familyModels.get("qwen") || []
	const qwenCoder = qwenList.find((m) => m.isCoder) || qwenList[0]
	if (qwenCoder) candidates.push(qwenCoder.id)

	// 6. Secondary OpenAI reasoning if available
	if (openaiReasoning && openaiReasoning.id !== openaiGeneral?.id) candidates.push(openaiReasoning.id)

	// Deduplicate and cap at 8 models so all 5 major families have their flagships represented
	const finalCandidates = Array.from(new Set(candidates)).slice(0, 8)
	finalCandidates.forEach((id) => flagshipIds.add(id))

	return flagshipIds
}

export const isReasoningModel = (id: string, info?: ModelInfo): boolean => {
	const lower = (id || "").toLowerCase()
	return !!(
		info?.supportsReasoningEffort ||
		info?.supportsReasoningBudget ||
		info?.maxThinkingTokens ||
		info?.reasoningEffort ||
		modelSupportsReasoning(id, info) ||
		lower.includes("reasoner") ||
		lower.includes("reasoning") ||
		lower.includes("thinking") ||
		lower.includes("thought") ||
		lower.includes("gpt-5") ||
		/(?:^|[\/_\-])r[1-9](?:[\/_\-]|$)/i.test(lower) ||
		/(?:^|[\/_\-])o[1-9](?:[\/_\-]|$)/i.test(lower) ||
		lower.includes("claude-3-7") ||
		lower.includes("claude-3.7")
	)
}

export const cleanModelDisplayName = (modelId: string, modelInfo?: ModelInfo): string => {
	if (!modelId) return "Select Model"

	const lower = modelId.toLowerCase()

	// Special-cased friendly names for popular / flagship models
	// DeepSeek
	if (lower.includes("deepseek-reasoner") || lower.includes("deepseek-r1")) return "DeepSeek R1"
	if (lower.includes("deepseek/deepseek-chat") || lower.includes("deepseek-chat") || lower.includes("deepseek-v3"))
		return "DeepSeek V3"
	if (lower.includes("deepseek-r2")) return "DeepSeek R2"
	if (lower.includes("deepseek-v4")) return "DeepSeek V4"

	// Claude (Anthropic)
	if (lower.includes("claude-4-5-sonnet") || lower.includes("claude-4.5-sonnet")) return "Claude 4.5 Sonnet"
	if (lower.includes("claude-4-5-opus") || lower.includes("claude-4.5-opus")) return "Claude 4.5 Opus"
	if (lower.includes("claude-4-sonnet") || lower.includes("claude-4.0-sonnet")) return "Claude 4 Sonnet"
	if (lower.includes("claude-4-opus")) return "Claude 4 Opus"
	if (lower.includes("claude-5-sonnet") || lower.includes("claude-5.0-sonnet")) return "Claude 5 Sonnet"
	if (lower.includes("claude-5")) return "Claude 5"
	if (lower.includes("claude-3-7-sonnet") || lower.includes("claude-3.7-sonnet")) return "Claude 3.7 Sonnet"
	if (lower.includes("claude-3-5-sonnet") || lower.includes("claude-3.5-sonnet")) return "Claude 3.5 Sonnet"
	if (lower.includes("claude-3-5-haiku") || lower.includes("claude-3.5-haiku")) return "Claude 3.5 Haiku"
	if (lower.includes("claude-3-opus")) return "Claude 3 Opus"

	// OpenAI
	if (lower.includes("gpt-5-turbo")) return "GPT-5 Turbo"
	if (lower.includes("gpt-5-mini") || lower.includes("gpt-5.4-mini") || lower.includes("gpt-5.1-mini")) return "GPT-5 Mini"
	if (lower.includes("gpt-5-nano") || lower.includes("gpt-5.4-nano")) return "GPT-5 Nano"
	if (lower.includes("gpt-5.1-codex-max")) return "GPT-5.1 Codex Max"
	if (lower.includes("gpt-5.4")) return "GPT-5.4"
	if (lower.includes("gpt-5.2")) return "GPT-5.2"
	if (lower.includes("gpt-5")) return "GPT-5"
	if (lower.includes("gpt-4-5-preview") || lower.includes("gpt-4.5-preview") || lower.includes("gpt-4.5")) return "GPT-4.5 Preview"
	if (lower.includes("gpt-4o-mini")) return "GPT-4o Mini"
	if (lower.includes("gpt-4o")) return "GPT-4o"
	if (lower.includes("o4-mini")) return "o4-mini"
	if (lower.includes("o4")) return "o4"
	if (lower.includes("o3-mini")) return "o3-mini"
	if (lower.includes("o3")) return "o3"
	if (lower.includes("o1-preview")) return "o1-preview"
	if (lower.includes("o1-mini")) return "o1-mini"
	if (lower.includes("o1")) return "o1"

	// Gemini (Google)
	if (lower.includes("gemini-3-pro")) return "Gemini 3 Pro"
	if (lower.includes("gemini-3-flash")) return "Gemini 3 Flash"
	if (lower.includes("gemini-2.5-pro")) return "Gemini 2.5 Pro"
	if (lower.includes("gemini-2.5-flash")) return "Gemini 2.5 Flash"
	if (lower.includes("gemini-2.0-flash")) return "Gemini 2.0 Flash"
	if (lower.includes("gemini-1.5-pro")) return "Gemini 1.5 Pro"

	// Qwen
	if (lower.includes("qwen-3-coder")) return "Qwen 3 Coder"
	if (lower.includes("qwen-2.5-coder") || lower.includes("qwen/qwen-2.5-coder")) return "Qwen 2.5 Coder"
	if (lower.includes("llama-3.1") || lower.includes("llama3.1")) return "Llama 3.1"
	if (lower.includes("llama-3.3") || lower.includes("llama3.3")) return "Llama 3.3"

	// Fallback to description if short or stripped ID
	if (modelInfo?.description && modelInfo.description.length < 25) {
		return modelInfo.description
	}

	const parts = modelId.split("/")
	const lastPart = parts[parts.length - 1]
	const cleaned = lastPart.split(":")[0]?.trim()
	return cleaned || modelId.trim() || "Select Model"
}

export const sanitizeCustomModelId = (rawModelId: string): string => {
	if (!rawModelId) return ""

	// Sanitize: strip whitespace, newlines, and special characters (#, ?, &)
	let sanitized = rawModelId.replace(/[\s\r\n\t#?&]+/g, "")
	if (!sanitized) return ""

	// Apply encodeURIComponent for URL fragments/segments (preserving path delimiters / and :)
	try {
		sanitized = sanitized
			.split("/")
			.map((segment) =>
				segment
					.split(":")
					.map((part) => encodeURIComponent(decodeURIComponent(part)))
					.join(":"),
			)
			.join("/")
	} catch {
		sanitized = sanitized
			.split("/")
			.map((segment) =>
				segment
					.split(":")
					.map((part) => encodeURIComponent(part))
					.join(":"),
			)
			.join("/")
	}

	return sanitized
}

export const formatContextWindow = (tokens?: number): string | null => {
	if (!tokens) return null
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
	return `${tokens}`
}

const ProviderIcon = ({ provider, className }: { provider: string; className?: string }) => {
	switch (provider) {
		case "xkiro":
			return <Sparkles className={cn("size-3.5 text-[#a78bfa] flex-shrink-0", className)} />
		case "anthropic":
			return <Brain className={cn("size-3.5 text-[#f97316] flex-shrink-0", className)} />
		case "gemini":
			return <Sparkles className={cn("size-3.5 text-[#38bdf8] flex-shrink-0", className)} />
		case "deepseek":
			return <Cpu className={cn("size-3.5 text-[#3b82f6] flex-shrink-0", className)} />
		case "openrouter":
			return <Layers className={cn("size-3.5 text-[#818cf8] flex-shrink-0", className)} />
		case "openai":
		case "openai-native":
			return <Bot className={cn("size-3.5 text-[#10b981] flex-shrink-0", className)} />
		case "ollama":
		case "lmstudio":
			return <Server className={cn("size-3.5 text-[#f59e0b] flex-shrink-0", className)} />
		default:
			return <Sparkles className={cn("size-3.5 text-[#a78bfa] flex-shrink-0", className)} />
	}
}

export const ModelSelector = ({
	disabled = false,
	triggerClassName = "",
	triggerTestId,
	currentConfigId: propCurrentConfigId,
	displayName: propDisplayName,
	listApiConfigMeta: propListApiConfigMeta,
	pinnedApiConfigs: propPinnedApiConfigs,
	togglePinnedApiConfig: propTogglePinnedApiConfig,
	lockApiConfigAcrossModes: propLockApiConfigAcrossModes,
	onToggleLockApiConfig,
	onApiConfigChange,
}: ModelSelectorProps) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const [customModelInput, setCustomModelInput] = useState("")
	const [selectedCategory, setSelectedCategory] = useState<ModelCategory>("all")
	const searchInputRef = useRef<HTMLInputElement>(null)
	const portalContainer = useRooPortal("roo-portal")

	const [isRefreshingModels, setIsRefreshingModels] = useState(false)

	const {
		apiConfiguration,
		currentApiConfigName: extCurrentApiConfigName,
		setApiConfiguration,
		routerModels,
		openAiModels,
		listApiConfigMeta: extListApiConfigMeta,
		pinnedApiConfigs: extPinnedApiConfigs,
		togglePinnedApiConfig: extTogglePinnedApiConfig,
		lockApiConfigAcrossModes: extLockApiConfigAcrossModes,
	} = useExtensionState()

	useEffect(() => {
		const handleIncoming = (event: MessageEvent) => {
			if (event.data?.type === "openAiModels" || event.data?.type === "testConnectionResult") {
				setIsRefreshingModels(false)
			}
		}
		window.addEventListener("message", handleIncoming)
		return () => window.removeEventListener("message", handleIncoming)
	}, [])

	const effectiveListApiConfigMeta = propListApiConfigMeta ?? extListApiConfigMeta ?? []
	const effectivePinnedApiConfigs = propPinnedApiConfigs ?? extPinnedApiConfigs ?? {}
	const effectiveTogglePinnedApiConfig = propTogglePinnedApiConfig ?? extTogglePinnedApiConfig
	const effectiveLockApiConfigAcrossModes = propLockApiConfigAcrossModes ?? extLockApiConfigAcrossModes ?? false
	const effectiveProfileName = propDisplayName || extCurrentApiConfigName || "default"
	const activeConfigId =
		propCurrentConfigId ||
		effectiveListApiConfigMeta.find((c) => c.name === effectiveProfileName)?.id ||
		""

	const { id: activeModelId, info: activeModelInfo } = useSelectedModel(apiConfiguration)
	const activeProvider = (apiConfiguration?.apiProvider || "xkiro") as ProviderName

	const handleRefreshModels = useCallback(() => {
		setIsRefreshingModels(true)
		const isXkiro = activeProvider === "xkiro"
		vscode.postMessage({
			type: "requestOpenAiModels",
			values: {
				provider: activeProvider,
				baseUrl: isXkiro
					? (apiConfiguration?.xkiroBaseUrl || "https://api.xkiro.com/v1")
					: apiConfiguration?.openAiBaseUrl,
				apiKey: isXkiro
					? (apiConfiguration?.xkiroApiKey || apiConfiguration?.apiKey)
					: (apiConfiguration?.openAiApiKey || apiConfiguration?.apiKey),
			},
		})
		setTimeout(() => setIsRefreshingModels(false), 10000)
	}, [activeProvider, apiConfiguration])

	// Silent background auto-fetch on mount / provider change when models list is uninitialized
	const autoFetchedProvidersRef = useRef<Set<string>>(new Set())
	useEffect(() => {
		const isTargetProvider = activeProvider === "xkiro" || activeProvider === "openai"
		if (!isTargetProvider) return

		const hasNoModels = !openAiModels || openAiModels.length === 0
		const apiKey =
			activeProvider === "xkiro"
				? (apiConfiguration?.xkiroApiKey || apiConfiguration?.apiKey)
				: (apiConfiguration?.openAiApiKey || apiConfiguration?.apiKey)

		if (hasNoModels && apiKey && !autoFetchedProvidersRef.current.has(activeProvider)) {
			autoFetchedProvidersRef.current.add(activeProvider)
			const baseUrl =
				activeProvider === "xkiro"
					? (apiConfiguration?.xkiroBaseUrl || "https://api.xkiro.com/v1")
					: apiConfiguration?.openAiBaseUrl

			vscode.postMessage({
				type: "requestOpenAiModels",
				values: {
					provider: activeProvider,
					baseUrl,
					apiKey,
				},
			})
		}
	}, [activeProvider, openAiModels, apiConfiguration])

	// Friendly name for the currently selected model
	const activeDisplayName = useMemo(() => {
		return cleanModelDisplayName(activeModelId, activeModelInfo)
	}, [activeModelId, activeModelInfo])

	// Check if the selected model supports reasoning
	const activeModelSupportsReasoning = useMemo(() => {
		return (
			!!activeModelInfo?.supportsReasoningEffort ||
			!!activeModelInfo?.supportsReasoningBudget ||
			!!activeModelInfo?.maxThinkingTokens ||
			modelSupportsReasoning(activeModelId, activeModelInfo) ||
			isReasoningModel(activeModelId, activeModelInfo)
		)
	}, [activeModelInfo, activeModelId])

	// Current reasoning effort state
	const currentEffort: "Off" | "Low" | "Medium" | "High" = useMemo(() => {
		if (
			apiConfiguration?.enableReasoningEffort === false ||
			apiConfiguration?.reasoningEffort === "disable"
		) {
			return "Off"
		}
		const effort = (apiConfiguration?.reasoningEffort || activeModelInfo?.reasoningEffort)?.toLowerCase()
		if (effort === "low" || effort === "minimal") return "Low"
		if (effort === "medium") return "Medium"
		if (effort === "high" || effort === "xhigh") return "High"
		if (apiConfiguration?.enableReasoningEffort === true) return "Medium"
		if (activeModelInfo?.requiredReasoningEffort) return "Medium"
		if (effort === "none") return "Off"
		if (activeModelInfo?.supportsReasoningEffort || modelSupportsReasoning(activeModelId, activeModelInfo)) return "Medium"
		return "Off"
	}, [apiConfiguration?.enableReasoningEffort, apiConfiguration?.reasoningEffort, activeModelInfo, activeModelId])

	// Switch reasoning effort
	const handleSelectEffort = useCallback(
		(effort: "Off" | "Low" | "Medium" | "High") => {
			const updatedConfig: ProviderSettings = {
				...apiConfiguration,
				...(effort === "Off"
					? { reasoningEffort: "disable" as any, enableReasoningEffort: false }
					: { reasoningEffort: effort.toLowerCase() as any, enableReasoningEffort: true }),
			}

			setApiConfiguration(updatedConfig)

			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: extCurrentApiConfigName || "default",
				apiConfiguration: updatedConfig,
			})
		},
		[apiConfiguration, extCurrentApiConfigName, setApiConfiguration],
	)

	// Available models for the current provider
	const availableModels = useMemo<ModelItem[]>(() => {
		const result: ModelItem[] = []
		const seenIds = new Set<string>()

		const isFastModel = (id: string, isReasoning: boolean) => {
			if (isReasoning) return false
			const lower = id.toLowerCase()
			return (
				lower.includes("flash") ||
				lower.includes("mini") ||
				lower.includes("haiku") ||
				lower.includes("turbo") ||
				lower.includes("lite") ||
				lower.includes("fast") ||
				lower.includes("8b") ||
				lower.includes("7b")
			)
		}

		const isCoderModel = (id: string) => {
			const lower = id.toLowerCase()
			return lower.includes("coder") || lower.includes("code") || lower.includes("dev")
		}

		const isVisionModel = (id: string) => {
			const lower = id.toLowerCase()
			return lower.includes("vision") || lower.includes("vl") || lower.includes("omni") || lower.includes("multimodal")
		}

		// 1. Static models from MODELS_BY_PROVIDER
		const staticMap = MODELS_BY_PROVIDER[activeProvider]
		if (staticMap) {
			Object.entries(staticMap).forEach(([id, info]) => {
				seenIds.add(id)
				const isReasoning = isReasoningModel(id, info)
				const isFast = isFastModel(id, isReasoning)
				const isCoder = isCoderModel(id)
				const isVision = isVisionModel(id)
				result.push({
					id,
					name: cleanModelDisplayName(id, info),
					contextWindow: info.contextWindow,
					isReasoning,
					isFast,
					isCoder,
					isVision,
					badge: isReasoning ? "Reasoning" : isFast ? "Fast" : isCoder ? "Coder" : isVision ? "Vision" : undefined,
					description: info.description,
				})
			})
		}

		// 1.5. Dynamic models for xKiro & OpenAI-compatible
		if (activeProvider === "xkiro" || activeProvider === "openai") {
			if (openAiModels && openAiModels.length > 0) {
				openAiModels.forEach((id) => {
					if (!seenIds.has(id)) {
						seenIds.add(id)
						const isReasoning = isReasoningModel(id)
						const isFast = isFastModel(id, isReasoning)
						const isCoder = isCoderModel(id)
						const isVision = isVisionModel(id)

						const badge = isReasoning
							? "Reasoning"
							: isFast
								? "Fast"
								: isCoder
									? "Coder"
									: isVision
										? "Vision"
										: undefined

						result.push({
							id,
							name: cleanModelDisplayName(id),
							isReasoning,
							isFast,
							isCoder,
							isVision,
							badge,
						})
					}
				})
			}
		}

		// 1.6. Explicit xKiro presets
		if (activeProvider === "xkiro") {
			const xkiroPresets = [
				{ id: "deepseek/deepseek-chat", name: "DeepSeek V3", isReasoning: false, isFast: false, isFlagship: true, contextWindow: 128000, description: "xKiro DeepSeek-V3: Fast and powerful general-purpose model with free tokens." },
				{ id: "deepseek/deepseek-reasoner", name: "DeepSeek R1", isReasoning: true, isFast: false, isFlagship: true, badge: "Reasoning", contextWindow: 128000, description: "xKiro DeepSeek-R1: Advanced reasoning and Chain of Thought deduction." },
				{ id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", isReasoning: true, isFast: false, isFlagship: true, badge: "Reasoning", contextWindow: 200000, description: "xKiro Claude 3.7 Sonnet: Premier hybrid reasoning and coding model." },
				{ id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", isReasoning: false, isFast: false, contextWindow: 200000, description: "xKiro Claude 3.5 Sonnet: Industry standard for intelligent coding." },
				{ id: "openai/gpt-5", name: "GPT-5", isReasoning: true, isFast: false, isFlagship: true, badge: "Reasoning", contextWindow: 400000, description: "xKiro GPT-5: OpenAI flagship model with reasoning and 400k context window." },
				{ id: "openai/gpt-5-mini", name: "GPT-5 Mini", isReasoning: true, isFast: false, isFlagship: false, badge: "Reasoning", contextWindow: 400000, description: "xKiro GPT-5 Mini: Fast, low-cost reasoning model with 400k context window." },
				{ id: "openai/gpt-4o", name: "GPT-4o", isReasoning: false, isFast: false, isFlagship: true, contextWindow: 128000, description: "xKiro GPT-4o: Versatile flagship multimodal model from OpenAI." },
				{ id: "openai/o3-mini", name: "o3-mini", isReasoning: true, isFast: false, badge: "Reasoning", contextWindow: 200000, description: "xKiro o3-mini: High-speed reasoning model." },
				{ id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", isReasoning: false, isFast: false, isFlagship: true, contextWindow: 1000000, description: "xKiro Gemini 2.5 Pro: Next-generation reasoning with 1M context window." },
				{ id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", isReasoning: false, isFast: true, badge: "Fast", contextWindow: 1000000, description: "xKiro Gemini 2.5 Flash: Ultra-fast and lightweight with 1M context window." },
				{ id: "qwen/qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B", isReasoning: false, isFast: true, isCoder: true, isFlagship: true, badge: "Coder", contextWindow: 128000, description: "xKiro Qwen 2.5 Coder: Leading open coding model." },
			]
			xkiroPresets.forEach((p) => {
				const existing = result.find((r) => r.id === p.id)
				if (existing) {
					if (!existing.description) existing.description = p.description
					if (!existing.contextWindow) existing.contextWindow = getModelContextWindow(p.id, p.contextWindow)
				} else {
					seenIds.add(p.id)
					result.push({
						...p,
						contextWindow: getModelContextWindow(p.id, p.contextWindow),
					})
				}
			})
		}

		// 2. OpenRouter dynamic models
		if (activeProvider === "openrouter") {
			const orModels = routerModels?.openrouter
			if (orModels && Object.keys(orModels).length > 0) {
				Object.entries(orModels).forEach(([id, info]) => {
					if (!seenIds.has(id)) {
						seenIds.add(id)
						const isReasoning = isReasoningModel(id, info)
						const isFast = isFastModel(id, isReasoning)
						const isCoder = isCoderModel(id)
						const isVision = isVisionModel(id)
						result.push({
							id,
							name: cleanModelDisplayName(id, info),
							contextWindow: info.contextWindow,
							isReasoning,
							isFast,
							isCoder,
							isVision,
							badge: isReasoning ? "Reasoning" : isFast ? "Fast" : isCoder ? "Coder" : isVision ? "Vision" : undefined,
							description: info.description,
						})
					}
				})
			} else {
				const orPresets = [
					{ id: "deepseek/deepseek-chat", name: "DeepSeek V3", isReasoning: false, isFast: false },
					{ id: "deepseek/deepseek-r1", name: "DeepSeek R1", isReasoning: true, isFast: false, badge: "Reasoning" },
					{ id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", isReasoning: false, isFast: false },
					{ id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", isReasoning: false, isFast: false },
					{ id: "openai/gpt-4o", name: "GPT-4o", isReasoning: false, isFast: false },
					{ id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", isReasoning: false, isFast: false },
				]
				orPresets.forEach((p) => {
					if (!seenIds.has(p.id)) {
						seenIds.add(p.id)
						result.push(p)
					}
				})
			}
		}

		// 3. OpenAI Compatible presets
		if (activeProvider === "openai") {
			const openaiPresets = [
				{ id: "gpt-4o", name: "GPT-4o", isReasoning: false, isFast: false },
				{ id: "gpt-4o-mini", name: "GPT-4o Mini", isReasoning: false, isFast: true, badge: "Fast" },
				{ id: "o3-mini", name: "o3-mini", isReasoning: true, isFast: false, badge: "Reasoning" },
				{ id: "deepseek-chat", name: "DeepSeek V3", isReasoning: false, isFast: false },
				{ id: "deepseek-reasoner", name: "DeepSeek R1", isReasoning: true, isFast: false, badge: "Reasoning" },
			]
			openaiPresets.forEach((p) => {
				const existing = result.find((r) => r.id === p.id)
				if (!existing) {
					seenIds.add(p.id)
					result.push(p)
				}
			})
		}

		// 4. Ollama presets
		if (activeProvider === "ollama") {
			const ollamaPresets = [
				{ id: "llama3.1", name: "Llama 3.1", isReasoning: false, isFast: false },
				{ id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", isReasoning: false, isFast: true, isCoder: true, badge: "Fast" },
				{ id: "deepseek-r1:8b", name: "DeepSeek R1 8B", isReasoning: true, isFast: false, badge: "Reasoning" },
			]
			ollamaPresets.forEach((p) => {
				if (!seenIds.has(p.id)) {
					seenIds.add(p.id)
					result.push(p)
				}
			})
		}

		// 5. Ensure current active model is present if not already in list
		if (activeModelId && !seenIds.has(activeModelId)) {
			const isReasoning = isReasoningModel(activeModelId, activeModelInfo)
			const isFast = isFastModel(activeModelId, isReasoning)
			const isCoder = isCoderModel(activeModelId)
			const isVision = isVisionModel(activeModelId)
			result.unshift({
				id: activeModelId,
				name: cleanModelDisplayName(activeModelId, activeModelInfo),
				contextWindow: activeModelInfo?.contextWindow,
				isReasoning,
				isFast,
				isCoder,
				isVision,
				badge: isReasoning ? "Reasoning" : isFast ? "Fast" : isCoder ? "Coder" : isVision ? "Vision" : undefined,
			})
		}

		// 6. Dynamic Flagship Promotion
		const flagshipIds = promoteDynamicFlagships(result)
		result.forEach((m) => {
			m.isFlagship = m.isFlagship || flagshipIds.has(m.id)
		})

		// 7. Hierarchical sort: family priority + generation descending
		result.sort(compareModels)

		return result
	}, [activeProvider, routerModels, openAiModels, activeModelId, activeModelInfo])

	// Filter models by category and search query
	const filteredModels = useMemo(() => {
		let list = availableModels

		if (selectedCategory === "reasoning") {
			list = list.filter((m) => m.isReasoning)
		} else if (selectedCategory === "fast") {
			list = list.filter((m) => m.isFast)
		} else if (selectedCategory === "coder") {
			list = list.filter((m) => m.isCoder)
		} else if (selectedCategory === "vision") {
			list = list.filter((m) => m.isVision)
		} else if (selectedCategory === "default") {
			list = list.filter((m) => !m.isReasoning && !m.isFast && !m.isCoder && !m.isVision)
		}

		if (!searchQuery.trim()) return list
		const q = searchQuery.toLowerCase().trim()
		return list.filter(
			(m) =>
				m.name.toLowerCase().includes(q) ||
				m.id.toLowerCase().includes(q) ||
				(m.description && m.description.toLowerCase().includes(q)),
		)
	}, [availableModels, selectedCategory, searchQuery])

	// Category counts for tags
	const categoryCounts = useMemo(() => {
		let reasoning = 0
		let fast = 0
		let coder = 0
		let vision = 0
		let general = 0

		availableModels.forEach((m) => {
			if (m.isReasoning) reasoning++
			else if (m.isFast) fast++
			else if (m.isCoder) coder++
			else if (m.isVision) vision++
			else general++
		})

		return {
			all: availableModels.length,
			reasoning,
			fast,
			coder,
			vision,
			default: general,
		}
	}, [availableModels])

	// Separate flagship/recommended models and other models
	const { flagshipModels, allOtherModels } = useMemo(() => {
		const flagship: ModelItem[] = []
		const other: ModelItem[] = []

		filteredModels.forEach((m) => {
			if (m.isFlagship) {
				flagship.push(m)
			} else {
				other.push(m)
			}
		})

		return { flagshipModels: flagship, allOtherModels: other }
	}, [filteredModels])

	// Switch model
	const handleSelectModel = useCallback(
		(modelId: string) => {
			const provider = (apiConfiguration?.apiProvider || "xkiro") as ProviderName
			const updatedConfig: ProviderSettings = {
				...apiConfiguration,
				apiModelId: modelId,
			}

			if (provider === "xkiro") {
				updatedConfig.xkiroModelId = modelId
				updatedConfig.openAiModelId = modelId
			} else if (provider === "openrouter") {
				updatedConfig.openRouterModelId = modelId
			} else if (provider === "openai" || provider === "openai-native") {
				updatedConfig.openAiModelId = modelId
			} else if (provider === "ollama") {
				updatedConfig.ollamaModelId = modelId
			} else if (provider === "lmstudio") {
				updatedConfig.lmStudioModelId = modelId
			} else if (provider === "litellm") {
				updatedConfig.litellmModelId = modelId
			} else if (provider === "requesty") {
				updatedConfig.requestyModelId = modelId
			} else if (provider === "unbound") {
				updatedConfig.unboundModelId = modelId
			}

			// Stop unconditional clearing of reasoningEffort when switching models!
			// Check if target model supports reasoning; only delete reasoningEffort if it does not.
			const targetModelInfo =
				MODELS_BY_PROVIDER[provider]?.[modelId] ||
				(provider === "openrouter" ? routerModels?.openrouter?.[modelId] : undefined)
			const targetModelItem = availableModels.find((m) => m.id === modelId)
			const targetSupportsReasoning =
				!!targetModelInfo?.supportsReasoningEffort ||
				!!targetModelInfo?.supportsReasoningBudget ||
				!!targetModelInfo?.maxThinkingTokens ||
				!!targetModelItem?.isReasoning ||
				isReasoningModel(modelId, targetModelInfo)

			if (!targetSupportsReasoning) {
				delete updatedConfig.reasoningEffort
			}
			delete updatedConfig.modelMaxTokens
			delete updatedConfig.modelMaxThinkingTokens

			// Update state locally immediately
			setApiConfiguration(updatedConfig)

			// Persist via engine
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: extCurrentApiConfigName || "default",
				apiConfiguration: updatedConfig,
			})

			setOpen(false)
			setSearchQuery("")
		},
		[apiConfiguration, extCurrentApiConfigName, setApiConfiguration, availableModels, routerModels],
	)

	// Select custom model with sanitization
	const handleSelectCustomModel = useCallback(
		(rawModelId: string) => {
			const sanitized = sanitizeCustomModelId(rawModelId)
			if (!sanitized) return
			handleSelectModel(sanitized)
		},
		[handleSelectModel],
	)

	// Switch API profile
	const handleSelectApiProfile = useCallback(
		(configId: string) => {
			if (onApiConfigChange) {
				onApiConfigChange(configId)
			} else {
				const selected = effectiveListApiConfigMeta.find((c) => c.id === configId)
				if (selected) {
					vscode.postMessage({
						type: "loadApiConfiguration",
						text: selected.name,
					})
				}
			}
			setOpen(false)
			setSearchQuery("")
		},
		[onApiConfigChange, effectiveListApiConfigMeta],
	)

	// Toggle lock across modes
	const handleToggleLock = useCallback(() => {
		if (onToggleLockApiConfig) {
			onToggleLockApiConfig()
		} else {
			vscode.postMessage({
				type: "lockApiConfigAcrossModes",
				bool: !effectiveLockApiConfigAcrossModes,
			})
		}
	}, [onToggleLockApiConfig, effectiveLockApiConfigAcrossModes])

	// Toggle pinned config
	const handleTogglePin = useCallback(
		(configId: string, e: React.MouseEvent) => {
			e.stopPropagation()
			if (effectiveTogglePinnedApiConfig) {
				effectiveTogglePinnedApiConfig(configId)
			}
			vscode.postMessage({ type: "toggleApiConfigPin", text: configId })
		},
		[effectiveTogglePinnedApiConfig],
	)

	const handleOpenSettings = useCallback(() => {
		window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "providers" } }, "*")
		vscode.postMessage({ type: "switchTab", tab: "settings" })
		setOpen(false)
	}, [])

	useEffect(() => {
		if (open && availableModels.length > 5 && searchInputRef.current) {
			searchInputRef.current.focus()
		}
	}, [open, availableModels.length])

	const providerDisplayNames: Record<string, string> = {
		xkiro: "xKiro",
		openrouter: "OpenRouter",
		anthropic: "Anthropic",
		gemini: "Gemini",
		deepseek: "DeepSeek",
		"openai-native": "OpenAI",
		openai: "OpenAI Compatible",
		ollama: "Ollama",
		lmstudio: "LM Studio",
		moonshot: "Moonshot",
		mistral: "Mistral",
		"qwen-code": "Qwen Code",
		vertex: "GCP Vertex",
		bedrock: "AWS Bedrock",
	}

	const currentProviderLabel = providerDisplayNames[activeProvider] || activeProvider

	// Separate pinned and unpinned API configs
	const { pinnedConfigs, unpinnedConfigs } = useMemo(() => {
		const pinned = effectiveListApiConfigMeta.filter((config) => effectivePinnedApiConfigs?.[config.id])
		const unpinned = effectiveListApiConfigMeta.filter((config) => !effectivePinnedApiConfigs?.[config.id])
		return { pinnedConfigs: pinned, unpinnedConfigs: unpinned }
	}, [effectiveListApiConfigMeta, effectivePinnedApiConfigs])

	return (
		<Popover open={open} onOpenChange={setOpen} data-testid="model-selector-root">
			<StandardTooltip
				content={`${activeDisplayName} · ${
					effectiveProfileName === "default" ? currentProviderLabel : `${effectiveProfileName} (${currentProviderLabel})`
				}`}>
				<PopoverTrigger
					disabled={disabled}
					data-testid={triggerTestId || "model-selector-trigger"}
					className={cn(
						"h-8 min-w-0 inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 text-xs",
						"bg-transparent border border-border/40 rounded-md text-vscode-foreground",
						"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "opacity-90 hover:opacity-100 hover:bg-vscode-toolbar-hoverBackground/60 hover:border-border/70 cursor-pointer",
						triggerClassName,
					)}>
					<ProviderIcon provider={activeProvider} />
					<span className="truncate font-medium">{activeDisplayName}</span>
					<span className="opacity-40 select-none text-[11px]">·</span>
					<span className="truncate text-vscode-descriptionForeground opacity-80">
						{effectiveProfileName === "default" ? currentProviderLabel : effectiveProfileName}
					</span>
					<ChevronDown className="size-3 text-vscode-descriptionForeground opacity-60 flex-shrink-0 -mr-0.5" />
				</PopoverTrigger>
			</StandardTooltip>

			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden w-[330px] bg-vscode-dropdown-background border border-vscode-dropdown-border shadow-xl">
				<div className="flex flex-col w-full">
					{/* Header: Provider Badge & Search */}
					<div className="p-2 border-b border-vscode-dropdown-border/60 bg-vscode-dropdown-background space-y-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-1.5">
								<ProviderIcon provider={activeProvider} />
								<span className="text-xs font-semibold text-vscode-foreground">
									{t("chat:modelSelector.title") || "Model & API Profile"}
								</span>
							</div>
							<div className="flex items-center gap-1.5">
								{(activeProvider === "xkiro" || activeProvider === "openai") && (
									<StandardTooltip content="Refresh available models">
										<button
											data-testid="refresh-models-button"
											aria-label="Refresh models"
											onClick={handleRefreshModels}
											disabled={isRefreshingModels}
											className={cn(
												"flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors cursor-pointer",
												"bg-vscode-button-secondaryBackground/40 hover:bg-vscode-button-secondaryBackground text-vscode-foreground",
												isRefreshingModels && "opacity-70 cursor-wait",
											)}>
											<RefreshCw className={cn("size-2.5", isRefreshingModels && "animate-spin")} />
											<span>{isRefreshingModels ? "Syncing..." : "Refresh"}</span>
										</button>
									</StandardTooltip>
								)}
								<span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[rgba(167,139,250,0.12)] text-[#a78bfa] border border-[rgba(167,139,250,0.25)]">
									{currentProviderLabel}
								</span>
							</div>
						</div>

						{/* Reasoning Effort Control (shown prominently at top before search) */}
						{activeModelSupportsReasoning && (
							<div
								data-testid="reasoning-effort-section"
								className="px-2 py-1.5 rounded bg-vscode-input-background/70 border border-vscode-input-border/60 flex items-center justify-between gap-2 shadow-xs">
								<div className="flex items-center gap-1.5 flex-shrink-0">
									<Brain className="size-3.5 text-amber-400 flex-shrink-0" />
									<span className="text-[11px] font-semibold text-vscode-foreground">Reasoning</span>
								</div>
								<div className="flex items-center p-0.5 bg-vscode-input-background rounded border border-vscode-input-border/50 gap-0.5 flex-1 max-w-[190px]">
									{(["Off", "Low", "Medium", "High"] as const).map((effort) => {
										const isSelected = currentEffort === effort
										return (
											<button
												key={effort}
												type="button"
												data-testid={`reasoning-effort-pill-${effort.toLowerCase()}`}
												onClick={(e) => {
													e.stopPropagation()
													handleSelectEffort(effort)
												}}
												className={cn(
													"flex-1 py-0.5 text-[10.5px] rounded transition-all cursor-pointer text-center font-medium select-none",
													isSelected
														? effort === "Off"
															? "bg-vscode-button-secondaryBackground text-vscode-foreground font-semibold shadow-xs"
															: "bg-amber-500/25 text-amber-300 font-semibold border border-amber-500/40 shadow-xs"
														: "text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-toolbar-hoverBackground/40 border border-transparent",
												)}>
												{effort}
											</button>
										)
									})}
								</div>
							</div>
						)}

						{/* Search Bar */}
						<div className="relative flex items-center">
							<Search className="absolute left-2 size-3.5 text-vscode-descriptionForeground opacity-60 pointer-events-none" />
							<input
								ref={searchInputRef}
								aria-label={t("chat:modelSelector.searchPlaceholder")}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder={t("chat:modelSelector.searchPlaceholder")}
								className="w-full h-7 pl-7 pr-7 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
							/>
							{searchQuery && (
								<button
									onClick={() => setSearchQuery("")}
									className="absolute right-1.5 p-0.5 text-vscode-descriptionForeground hover:text-vscode-foreground">
									<X className="size-3.5" />
								</button>
							)}
						</div>

						{/* Category Filter Chips */}
						<div className="flex items-center gap-1 pt-0.5 flex-wrap">
							{(
								[
									{ key: "all" as const, label: "All", count: categoryCounts.all, icon: undefined },
									{ key: "reasoning" as const, label: "Reasoning", count: categoryCounts.reasoning, icon: Brain },
									{ key: "fast" as const, label: "Fast", count: categoryCounts.fast, icon: Zap },
									{ key: "coder" as const, label: "Coder", count: categoryCounts.coder, icon: Code2 },
									{ key: "vision" as const, label: "Vision", count: categoryCounts.vision, icon: Eye },
									{ key: "default" as const, label: "Default", count: categoryCounts.default, icon: undefined },
								]
							).map((cat) => {
								if (cat.key !== "all" && cat.count === 0) return null
								const isCatActive = selectedCategory === cat.key
								const Icon = cat.icon
								return (
									<button
										key={cat.key}
										onClick={() => setSelectedCategory(cat.key)}
										className={cn(
											"h-5 px-1.5 text-[10.5px] rounded flex items-center gap-1 transition-colors cursor-pointer",
											isCatActive
												? "bg-vscode-badge-background text-vscode-badge-foreground font-medium"
												: "bg-vscode-input-background/60 text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-input-background",
										)}>
										{Icon && <Icon className="size-2.5" />}
										<span>{cat.label}</span>
									</button>
								)
							})}
						</div>
					</div>

					{/* SECTION 1: Models List */}
					<div className="max-h-[250px] overflow-y-auto py-1 space-y-2">
						{filteredModels.length === 0 ? (
							searchQuery.trim() ? (
								<div
									onClick={() => handleSelectCustomModel(searchQuery.trim())}
									className="px-2.5 py-2 text-xs cursor-pointer flex items-center gap-2 rounded-md transition-colors mx-1 hover:bg-vscode-list-hoverBackground text-vscode-textLink-foreground">
									<Plus className="size-3.5 flex-shrink-0" />
									<span className="truncate">Use custom model "{searchQuery.trim()}"</span>
								</div>
							) : (
								<div className="py-4 px-3 text-center text-xs text-vscode-descriptionForeground">
									{t("chat:modelSelector.noResults")}
								</div>
							)
						) : (
							<>
								{/* 1. Recommended / Flagship Section */}
								{flagshipModels.length > 0 && (
									<div>
										<div className="px-2.5 py-1 text-[10px] font-bold text-vscode-descriptionForeground uppercase tracking-wider flex items-center justify-between">
											<div className="flex items-center gap-1">
												<Sparkles className="size-3 text-[#a78bfa]" />
												<span>Recommended / Flagship</span>
											</div>
											<span className="text-[9.5px] opacity-70 font-normal">
												{flagshipModels.length} models
											</span>
										</div>
										<div className="space-y-0.5">
											{flagshipModels.map((m) => {
												const isSelected = m.id === activeModelId
												const ctxStr = formatContextWindow(m.contextWindow)

												return (
													<div
														key={m.id}
														onClick={() => handleSelectModel(m.id)}
														className={cn(
															"px-2.5 py-1.5 text-xs cursor-pointer flex items-center justify-between gap-2 rounded-md transition-colors mx-1",
															"hover:bg-vscode-list-hoverBackground",
															isSelected
																? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground font-medium"
																: "text-vscode-foreground",
														)}>
														<div className="flex flex-col min-w-0 flex-1">
															<div className="flex items-center gap-1.5">
																<span className="truncate font-medium">{m.name}</span>
																{m.isReasoning && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/30">
																		Reasoning
																	</span>
																)}
																{m.isFast && !m.isReasoning && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30">
																		Fast
																	</span>
																)}
																{m.isCoder && !m.isReasoning && !m.isFast && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-blue-500/15 text-blue-400 font-semibold border border-blue-500/30">
																		Coder
																	</span>
																)}
																{m.isVision && !m.isReasoning && !m.isFast && !m.isCoder && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-purple-500/15 text-purple-400 font-semibold border border-purple-500/30">
																		Vision
																	</span>
																)}
															</div>
															<div className="flex items-center gap-1.5 text-[10.5px] text-vscode-descriptionForeground opacity-75 mt-0.5 truncate">
																<span className="truncate">{m.id}</span>
																{ctxStr && (
																	<>
																		<span>·</span>
																		<span>{ctxStr} ctx</span>
																	</>
																)}
															</div>
														</div>

														<div className="flex items-center flex-shrink-0">
															{isSelected ? (
																<div className="size-4 flex items-center justify-center text-vscode-focusBorder">
																	<Check className="size-3.5" />
																</div>
															) : (
																<div className="size-4" />
															)}
														</div>
													</div>
												)
											})}
										</div>
									</div>
								)}

								{/* 2. All Available Models Section */}
								{allOtherModels.length > 0 && (
									<div>
										<div className="px-2.5 py-1 text-[10px] font-bold text-vscode-descriptionForeground uppercase tracking-wider flex items-center justify-between">
											<div className="flex items-center gap-1">
												<Layers className="size-3 text-vscode-descriptionForeground" />
												<span>
													{flagshipModels.length > 0
														? `All Available Models (${availableModels.length})`
														: `All Models (${filteredModels.length})`}
												</span>
											</div>
										</div>
										<div className="space-y-0.5">
											{allOtherModels.map((m) => {
												const isSelected = m.id === activeModelId
												const ctxStr = formatContextWindow(m.contextWindow)

												return (
													<div
														key={m.id}
														onClick={() => handleSelectModel(m.id)}
														className={cn(
															"px-2.5 py-1.5 text-xs cursor-pointer flex items-center justify-between gap-2 rounded-md transition-colors mx-1",
															"hover:bg-vscode-list-hoverBackground",
															isSelected
																? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground font-medium"
																: "text-vscode-foreground",
														)}>
														<div className="flex flex-col min-w-0 flex-1">
															<div className="flex items-center gap-1.5">
																<span className="truncate font-medium">{m.name}</span>
																{m.isReasoning && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/30">
																		Reasoning
																	</span>
																)}
																{m.isFast && !m.isReasoning && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30">
																		Fast
																	</span>
																)}
																{m.isCoder && !m.isReasoning && !m.isFast && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-blue-500/15 text-blue-400 font-semibold border border-blue-500/30">
																		Coder
																	</span>
																)}
																{m.isVision && !m.isReasoning && !m.isFast && !m.isCoder && (
																	<span className="text-[9.5px] px-1 py-0.2 rounded bg-purple-500/15 text-purple-400 font-semibold border border-purple-500/30">
																		Vision
																	</span>
																)}
															</div>
															<div className="flex items-center gap-1.5 text-[10.5px] text-vscode-descriptionForeground opacity-75 mt-0.5 truncate">
																<span className="truncate">{m.id}</span>
																{ctxStr && (
																	<>
																		<span>·</span>
																		<span>{ctxStr} ctx</span>
																	</>
																)}
															</div>
														</div>

														<div className="flex items-center flex-shrink-0">
															{isSelected ? (
																<div className="size-4 flex items-center justify-center text-vscode-focusBorder">
																	<Check className="size-3.5" />
																</div>
															) : (
																<div className="size-4" />
															)}
														</div>
													</div>
												)
											})}
										</div>
									</div>
								)}

								{/* Fallback if no split occurred */}
								{flagshipModels.length === 0 && allOtherModels.length === 0 && (
									<div className="space-y-0.5">
										{filteredModels.map((m) => {
											const isSelected = m.id === activeModelId
											const ctxStr = formatContextWindow(m.contextWindow)

											return (
												<div
													key={m.id}
													onClick={() => handleSelectModel(m.id)}
													className={cn(
														"px-2.5 py-1.5 text-xs cursor-pointer flex items-center justify-between gap-2 rounded-md transition-colors mx-1",
														"hover:bg-vscode-list-hoverBackground",
														isSelected
															? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground font-medium"
															: "text-vscode-foreground",
													)}>
													<div className="flex flex-col min-w-0 flex-1">
														<div className="flex items-center gap-1.5">
															<span className="truncate font-medium">{m.name}</span>
															{m.isReasoning && (
																<span className="text-[9.5px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/30">
																	Reasoning
																</span>
															)}
															{m.isFast && !m.isReasoning && (
																<span className="text-[9.5px] px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/30">
																	Fast
																</span>
															)}
															{m.isCoder && !m.isReasoning && !m.isFast && (
																<span className="text-[9.5px] px-1 py-0.2 rounded bg-blue-500/15 text-blue-400 font-semibold border border-blue-500/30">
																	Coder
																</span>
															)}
															{m.isVision && !m.isReasoning && !m.isFast && !m.isCoder && (
																<span className="text-[9.5px] px-1 py-0.2 rounded bg-purple-500/15 text-purple-400 font-semibold border border-purple-500/30">
																	Vision
																</span>
															)}
														</div>
														<div className="flex items-center gap-1.5 text-[10.5px] text-vscode-descriptionForeground opacity-75 mt-0.5 truncate">
															<span className="truncate">{m.id}</span>
															{ctxStr && (
																<>
																	<span>·</span>
																	<span>{ctxStr} ctx</span>
																</>
															)}
														</div>
													</div>

													<div className="flex items-center flex-shrink-0">
														{isSelected ? (
															<div className="size-4 flex items-center justify-center text-vscode-focusBorder">
																<Check className="size-3.5" />
															</div>
														) : (
															<div className="size-4" />
														)}
													</div>
												</div>
											)
										})}
									</div>
								)}

								{searchQuery.trim() &&
									!filteredModels.some(
										(m) => m.id.toLowerCase() === searchQuery.trim().toLowerCase(),
									) && (
										<div
											onClick={() => handleSelectCustomModel(searchQuery.trim())}
											className="px-2.5 py-1.5 text-xs cursor-pointer flex items-center gap-2 rounded-md transition-colors mx-1 border-t border-vscode-dropdown-border/30 hover:bg-vscode-list-hoverBackground text-vscode-textLink-foreground">
											<Plus className="size-3.5 flex-shrink-0" />
											<span className="truncate">Use custom model "{searchQuery.trim()}"</span>
										</div>
									)}
							</>
						)}
					</div>

					{/* Models List Footer: Stats */}
					{(activeProvider === "xkiro" || activeProvider === "openai") && (
						<div className="px-2.5 py-1 border-t border-vscode-dropdown-border/40 bg-vscode-dropdown-background/40 flex items-center justify-between text-[10.5px] text-vscode-descriptionForeground">
							<span>
								{openAiModels && openAiModels.length > 0
									? `${availableModels.length} models discovered`
									: "Standard presets loaded"}
							</span>
						</div>
					)}

					{/* Custom Model ID Input */}
					<div className="p-2 border-t border-vscode-dropdown-border/60 bg-vscode-dropdown-background/60">
						<form
							onSubmit={(e) => {
								e.preventDefault()
								if (customModelInput.trim()) {
									handleSelectCustomModel(customModelInput.trim())
									setCustomModelInput("")
								}
							}}
							className="flex items-center gap-1.5">
							<input
								type="text"
								value={customModelInput}
								onChange={(e) => setCustomModelInput(e.target.value)}
								placeholder="Enter custom model ID..."
								className="flex-1 h-6 px-2 text-[11px] bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder"
							/>
							<Button
								type="submit"
								disabled={!customModelInput.trim()}
								size="sm"
								className="h-6 px-2 text-[11px] py-0 font-medium cursor-pointer">
								Set
							</Button>
						</form>
					</div>

					{/* SECTION 2: API Profiles Section */}
					{effectiveListApiConfigMeta.length > 0 && (
						<div className="border-t border-vscode-dropdown-border/60 bg-vscode-dropdown-background/40">
							<div className="flex items-center justify-between px-3 py-1.5 border-b border-vscode-dropdown-border/40">
								<span className="text-[10px] font-bold text-vscode-descriptionForeground uppercase tracking-wider">
									{t("prompts:apiConfiguration.title") || "API Profiles"}
								</span>
								<div className="flex items-center gap-1.5">
									{activeProvider !== "xkiro" && (
										<button
											onClick={() => {
												const updatedConfig: ProviderSettings = {
													...apiConfiguration,
													apiProvider: "xkiro",
													apiModelId: "deepseek/deepseek-chat",
													xkiroModelId: "deepseek/deepseek-chat",
													xkiroBaseUrl: apiConfiguration?.xkiroBaseUrl || "https://api.xkiro.com/v1",
												}
												setApiConfiguration(updatedConfig)
												vscode.postMessage({
													type: "upsertApiConfiguration",
													text: extCurrentApiConfigName || "default",
													apiConfiguration: updatedConfig,
												})
											}}
											className="text-[10px] text-[#a78bfa] hover:underline font-medium cursor-pointer">
											Switch to xKiro
										</button>
									)}
									<span className="text-[10px] text-vscode-descriptionForeground opacity-75 truncate max-w-[120px]">
										{effectiveProfileName}
									</span>
								</div>
							</div>

							<div className="max-h-[140px] overflow-y-auto py-1">
								{/* Pinned configs */}
								{pinnedConfigs.map((config) => {
									const isCurrent = config.id === activeConfigId
									return (
										<div
											key={config.id}
											onClick={() => handleSelectApiProfile(config.id)}
											className={cn(
												"px-2.5 py-1 text-xs cursor-pointer flex items-center justify-between group rounded-md mx-1",
												"hover:bg-vscode-list-hoverBackground",
												isCurrent &&
													"bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground",
											)}>
											<div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
												<span className="truncate font-medium">{config.name}</span>
												{config.modelId && (
													<span className="text-vscode-descriptionForeground opacity-60 text-[10.5px] truncate">
														({config.modelId})
													</span>
												)}
											</div>
											<div className="flex items-center gap-1 flex-shrink-0">
												{isCurrent && (
													<div className="size-4 flex items-center justify-center text-vscode-focusBorder">
														<Check className="size-3" />
													</div>
												)}
												<StandardTooltip content={t("chat:unpin")}>
													<Button
														variant="ghost"
														size="icon"
														tabIndex={-1}
														onClick={(e) => handleTogglePin(config.id, e)}
														className="size-4 flex items-center justify-center p-0">
														<Pin className="size-2.5 text-vscode-focusBorder" />
													</Button>
												</StandardTooltip>
											</div>
										</div>
									)
								})}

								{/* Unpinned configs */}
								{unpinnedConfigs.map((config) => {
									const isCurrent = config.id === activeConfigId
									return (
										<div
											key={config.id}
											onClick={() => handleSelectApiProfile(config.id)}
											className={cn(
												"px-2.5 py-1 text-xs cursor-pointer flex items-center justify-between group rounded-md mx-1",
												"hover:bg-vscode-list-hoverBackground",
												isCurrent &&
													"bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground",
											)}>
											<div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
												<span className="truncate font-medium">{config.name}</span>
												{config.modelId && (
													<span className="text-vscode-descriptionForeground opacity-60 text-[10.5px] truncate">
														({config.modelId})
													</span>
												)}
											</div>
											<div className="flex items-center gap-1 flex-shrink-0">
												{isCurrent && (
													<div className="size-4 flex items-center justify-center text-vscode-focusBorder">
														<Check className="size-3" />
													</div>
												)}
												<StandardTooltip content={t("chat:pin")}>
													<Button
														variant="ghost"
														size="icon"
														tabIndex={-1}
														onClick={(e) => handleTogglePin(config.id, e)}
														className="size-4 flex items-center justify-center p-0 opacity-0 group-hover:opacity-100">
														<Pin className="size-2.5 opacity-50" />
													</Button>
												</StandardTooltip>
											</div>
										</div>
									)
								})}
							</div>
						</div>
					)}

					{/* Footer: Lock toggle & Settings shortcut */}
					<div className="px-2.5 py-1.5 border-t border-vscode-dropdown-border/60 bg-vscode-dropdown-background flex items-center justify-between">
						<div className="flex items-center gap-1">
							<IconButton
								iconClass={effectiveLockApiConfigAcrossModes ? "codicon-lock" : "codicon-unlock"}
								title={
									effectiveLockApiConfigAcrossModes
										? t("chat:unlockApiConfigAcrossModes")
										: t("chat:lockApiConfigAcrossModes")
								}
								className={effectiveLockApiConfigAcrossModes ? "text-vscode-focusBorder" : "opacity-60"}
								onClick={handleToggleLock}
							/>
						</div>
						<button
							onClick={handleOpenSettings}
							className="flex items-center gap-1.5 text-[11px] text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors px-1.5 py-1 rounded hover:bg-vscode-toolbar-hoverBackground/60 cursor-pointer">
							<Settings2 className="size-3.5" />
							<span>{t("chat:modelSelector.configureMore") || "Settings"}</span>
						</button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
