import React, { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Check, X, Sparkles, Cpu, Settings2, Search } from "lucide-react"

import type { ProviderSettings, ProviderName, ModelInfo } from "@roo-code/types"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { MODELS_BY_PROVIDER } from "@/components/settings/constants"

interface ModelSelectorProps {
	disabled?: boolean
	triggerClassName?: string
}

interface ModelItem {
	id: string
	name: string
	contextWindow?: number
	isReasoning?: boolean
	badge?: string
	description?: string
}

export const cleanModelDisplayName = (modelId: string, modelInfo?: ModelInfo): string => {
	if (!modelId) return "Wybierz model"

	const lower = modelId.toLowerCase()

	// Special-cased friendly names for popular models
	if (lower.includes("deepseek-reasoner") || lower.includes("deepseek-r1")) return "DeepSeek R1"
	if (lower.includes("deepseek/deepseek-chat") || lower.includes("deepseek-chat") || lower.includes("deepseek-v3"))
		return "DeepSeek V3"
	if (lower.includes("claude-3-7-sonnet") || lower.includes("claude-3.7-sonnet")) return "Claude 3.7 Sonnet"
	if (lower.includes("claude-3-5-sonnet") || lower.includes("claude-3.5-sonnet")) return "Claude 3.5 Sonnet"
	if (lower.includes("claude-3-5-haiku") || lower.includes("claude-3.5-haiku")) return "Claude 3.5 Haiku"
	if (lower.includes("gpt-4o-mini")) return "GPT-4o Mini"
	if (lower.includes("gpt-4o")) return "GPT-4o"
	if (lower.includes("o3-mini")) return "o3-mini"
	if (lower.includes("gemini-2.5-pro")) return "Gemini 2.5 Pro"
	if (lower.includes("gemini-2.5-flash")) return "Gemini 2.5 Flash"
	if (lower.includes("gemini-2.0-flash")) return "Gemini 2.0 Flash"
	if (lower.includes("qwen-2.5-coder") || lower.includes("qwen/qwen-2.5-coder")) return "Qwen 2.5 Coder"
	if (lower.includes("llama-3.1") || lower.includes("llama3.1")) return "Llama 3.1"

	// Fallback to description if short or stripped ID
	if (modelInfo?.description && modelInfo.description.length < 25) {
		return modelInfo.description
	}

	const parts = modelId.split("/")
	const lastPart = parts[parts.length - 1]
	return lastPart.split(":")[0]
}

const formatContextWindow = (tokens?: number): string | null => {
	if (!tokens) return null
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
	return `${tokens}`
}

export const ModelSelector = ({ disabled = false, triggerClassName = "" }: ModelSelectorProps) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)
	const [searchQuery, setSearchQuery] = useState("")
	const searchInputRef = useRef<HTMLInputElement>(null)
	const portalContainer = useRooPortal("roo-portal")

	const { apiConfiguration, currentApiConfigName, setApiConfiguration, routerModels } = useExtensionState()

	const { id: activeModelId, info: activeModelInfo } = useSelectedModel(apiConfiguration)
	const activeProvider = (apiConfiguration?.apiProvider || "xkiro") as ProviderName

	// Friendly name for the currently selected model
	const activeDisplayName = useMemo(() => {
		return cleanModelDisplayName(activeModelId, activeModelInfo)
	}, [activeModelId, activeModelInfo])

	// Available models for the current provider
	const availableModels = useMemo<ModelItem[]>(() => {
		const result: ModelItem[] = []
		const seenIds = new Set<string>()

		// 1. Static models from MODELS_BY_PROVIDER (xkiro, anthropic, gemini, etc.)
		const staticMap = MODELS_BY_PROVIDER[activeProvider]
		if (staticMap) {
			Object.entries(staticMap).forEach(([id, info]) => {
				seenIds.add(id)
				const isReasoning = !!(
					info.maxThinkingTokens ||
					id.toLowerCase().includes("reasoner") ||
					id.toLowerCase().includes("r1")
				)
				result.push({
					id,
					name: cleanModelDisplayName(id, info),
					contextWindow: info.contextWindow,
					isReasoning,
					badge: isReasoning ? "R1 / Thinking" : undefined,
					description: info.description,
				})
			})
		}

		// 2. OpenRouter dynamic models
		if (activeProvider === "openrouter") {
			const orModels = routerModels?.openrouter
			if (orModels && Object.keys(orModels).length > 0) {
				Object.entries(orModels).forEach(([id, info]) => {
					if (!seenIds.has(id)) {
						seenIds.add(id)
						const isReasoning = !!(
							info.maxThinkingTokens ||
							id.toLowerCase().includes("reasoner") ||
							id.toLowerCase().includes("r1")
						)
						result.push({
							id,
							name: cleanModelDisplayName(id, info),
							contextWindow: info.contextWindow,
							isReasoning,
							badge: isReasoning ? "Thinking" : undefined,
							description: info.description,
						})
					}
				})
			} else {
				// Sane popular presets for OpenRouter if dynamic list is not ready yet
				const orPresets = [
					{ id: "deepseek/deepseek-chat", name: "DeepSeek V3", isReasoning: false },
					{ id: "deepseek/deepseek-r1", name: "DeepSeek R1", isReasoning: true },
					{ id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", isReasoning: false },
					{ id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", isReasoning: false },
					{ id: "openai/gpt-4o", name: "GPT-4o", isReasoning: false },
					{ id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", isReasoning: false },
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
				{ id: "gpt-4o", name: "GPT-4o", isReasoning: false },
				{ id: "gpt-4o-mini", name: "GPT-4o Mini", isReasoning: false },
				{ id: "o3-mini", name: "o3-mini", isReasoning: true },
				{ id: "deepseek-chat", name: "DeepSeek V3", isReasoning: false },
				{ id: "deepseek-reasoner", name: "DeepSeek R1", isReasoning: true },
			]
			openaiPresets.forEach((p) => {
				if (!seenIds.has(p.id)) {
					seenIds.add(p.id)
					result.push(p)
				}
			})
		}

		// 4. Ollama presets
		if (activeProvider === "ollama") {
			const ollamaPresets = [
				{ id: "llama3.1", name: "Llama 3.1", isReasoning: false },
				{ id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", isReasoning: false },
				{ id: "deepseek-r1:8b", name: "DeepSeek R1 8B", isReasoning: true },
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
			result.unshift({
				id: activeModelId,
				name: cleanModelDisplayName(activeModelId, activeModelInfo),
				contextWindow: activeModelInfo?.contextWindow,
				isReasoning: activeModelId.toLowerCase().includes("reasoner") || activeModelId.toLowerCase().includes("r1"),
			})
		}

		return result
	}, [activeProvider, routerModels, activeModelId, activeModelInfo])

	// Filter models by search query
	const filteredModels = useMemo(() => {
		if (!searchQuery.trim()) return availableModels
		const q = searchQuery.toLowerCase()
		return availableModels.filter(
			(m) =>
				m.name.toLowerCase().includes(q) ||
				m.id.toLowerCase().includes(q) ||
				(m.description && m.description.toLowerCase().includes(q)),
		)
	}, [availableModels, searchQuery])

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

			// Clear model-specific reasoning overrides
			delete updatedConfig.reasoningEffort
			delete updatedConfig.modelMaxTokens
			delete updatedConfig.modelMaxThinkingTokens

			// Update state locally immediately
			setApiConfiguration(updatedConfig)

			// Persist via engine
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentApiConfigName || "default",
				apiConfiguration: updatedConfig,
			})

			setOpen(false)
			setSearchQuery("")
		},
		[apiConfiguration, currentApiConfigName, setApiConfiguration],
	)

	const handleOpenSettings = useCallback(() => {
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

	return (
		<Popover open={open} onOpenChange={setOpen} data-testid="model-selector-root">
			<StandardTooltip content={`${t("chat:selectModel")}: ${activeDisplayName} (${currentProviderLabel})`}>
				<PopoverTrigger
					disabled={disabled}
					data-testid="model-selector-trigger"
					className={cn(
						"inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 text-xs",
						"bg-transparent border border-[rgba(255,255,255,0.08)] rounded-md text-vscode-foreground",
						"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "opacity-90 hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)] cursor-pointer",
						triggerClassName,
					)}>
					<Sparkles className="w-3.5 h-3.5 text-[#a78bfa] flex-shrink-0" />
					<span className="truncate font-medium">{activeDisplayName}</span>
				</PopoverTrigger>
			</StandardTooltip>

			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden w-[310px] bg-vscode-dropdown-background border border-vscode-dropdown-border shadow-xl">
				<div className="flex flex-col w-full">
					{/* Header with Provider Badge */}
					<div className="flex items-center justify-between px-3 py-2 border-b border-vscode-dropdown-border bg-vscode-dropdown-background">
						<div className="flex items-center gap-1.5">
							<Cpu className="w-3.5 h-3.5 text-[#a78bfa]" />
							<span className="text-xs font-semibold text-vscode-foreground">
								{t("chat:modelSelector.title")}
							</span>
						</div>
						<span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[rgba(167,139,250,0.12)] text-[#a78bfa] border border-[rgba(167,139,250,0.25)]">
							{currentProviderLabel}
						</span>
					</div>

					{/* Search Bar if multiple models */}
					{availableModels.length > 5 && (
						<div className="relative px-2 py-1.5 border-b border-vscode-dropdown-border">
							<div className="relative flex items-center">
								<Search className="absolute left-2 w-3.5 h-3.5 text-vscode-descriptionForeground opacity-60 pointer-events-none" />
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
										<X className="w-3.5 h-3.5" />
									</button>
								)}
							</div>
						</div>
					)}

					{/* Models List */}
					<div className="max-h-[280px] overflow-y-auto py-1">
						{filteredModels.length === 0 ? (
							<div className="py-4 px-3 text-center text-xs text-vscode-descriptionForeground">
								{t("chat:modelSelector.noResults")}
							</div>
						) : (
							filteredModels.map((m) => {
								const isSelected = m.id === activeModelId
								const ctxStr = formatContextWindow(m.contextWindow)

								return (
									<div
										key={m.id}
										onClick={() => handleSelectModel(m.id)}
										className={cn(
											"px-3 py-2 text-xs cursor-pointer flex items-center justify-between gap-2 group transition-colors",
											"hover:bg-vscode-list-hoverBackground",
											isSelected
												? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground font-medium"
												: "text-vscode-foreground",
										)}>
										<div className="flex flex-col min-w-0 flex-1">
											<div className="flex items-center gap-1.5">
												<span className="truncate">{m.name}</span>
												{m.badge && (
													<span className="text-[9.5px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 font-semibold border border-amber-500/30">
														{m.badge}
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
													<Check className="w-3.5 h-3.5" />
												</div>
											) : (
												<div className="size-4" />
											)}
										</div>
									</div>
								)
							})
						)}
					</div>

					{/* Footer with settings shortcut */}
					<div className="px-2 py-1.5 border-t border-vscode-dropdown-border bg-vscode-dropdown-background flex items-center justify-between">
						<button
							onClick={handleOpenSettings}
							className="flex items-center gap-1.5 text-[11px] text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors p-1 rounded hover:bg-[rgba(255,255,255,0.05)] w-full justify-start cursor-pointer">
							<Settings2 className="w-3.5 h-3.5" />
							<span>{t("chat:modelSelector.configureMore")}</span>
						</button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}
