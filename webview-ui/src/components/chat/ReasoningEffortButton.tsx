import React, { useState, useMemo, useCallback } from "react"
import { Brain, ChevronDown, Check } from "lucide-react"

import {
	type ProviderSettings,
	type ModelInfo,
	modelSupportsReasoning,
} from "@roo-code/types"

import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"
import { isReasoningModel } from "./ModelSelector"

export type ReasoningEffortLevel = "Off" | "Low" | "Medium" | "High" | "Minimal" | "XHigh" | string

export interface ReasoningEffortButtonProps {
	disabled?: boolean
	className?: string
	modelId?: string
	modelInfo?: ModelInfo
}

export const formatEffortLabel = (level: string): string => {
	const lower = level.toLowerCase()
	if (lower === "off") return "Off"
	if (lower === "none") return "None"
	if (lower === "minimal") return "Minimal"
	if (lower === "low") return "Low"
	if (lower === "medium") return "Medium"
	if (lower === "high") return "High"
	if (lower === "xhigh") return "XHigh"
	return level.charAt(0).toUpperCase() + level.slice(1)
}

const DEFAULT_EFFORT_OPTIONS: readonly string[] = ["Off", "Low", "Medium", "High"]

export const ReasoningEffortButton: React.FC<ReasoningEffortButtonProps> = ({
	disabled = false,
	className,
	modelId: propModelId,
	modelInfo: propModelInfo,
}) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)
	const portalContainer = useRooPortal("roo-portal")

	const getEffortLabel = useCallback(
		(level: string) => {
			const lower = level.toLowerCase()
			switch (lower) {
				case "off":
					return t("chat:effort.off")
				case "minimal":
					return t("chat:effort.minimal")
				case "low":
					return t("chat:effort.low")
				case "medium":
					return t("chat:effort.medium")
				case "high":
					return t("chat:effort.high")
				case "xhigh":
					return t("chat:effort.xhigh")
				default:
					return level
			}
		},
		[t],
	)

	const {
		apiConfiguration,
		currentApiConfigName,
		setApiConfiguration,
	} = useExtensionState()

	const selectedModel = useSelectedModel(apiConfiguration)
	const activeModelId = propModelId ?? selectedModel?.id ?? ""
	const activeModelInfo = propModelInfo ?? selectedModel?.info

	// Check if the selected model supports reasoning
	const activeModelSupportsReasoning = useMemo(() => {
		const supportsEffort =
			activeModelInfo?.supportsReasoningEffort !== undefined &&
			activeModelInfo?.supportsReasoningEffort !== false
		const hasLevels =
			Array.isArray(activeModelInfo?.reasoningEffortLevels) &&
			activeModelInfo.reasoningEffortLevels.length > 0

		return !!(
			supportsEffort ||
			hasLevels ||
			activeModelInfo?.supportsReasoningBudget ||
			activeModelInfo?.maxThinkingTokens ||
			modelSupportsReasoning(activeModelId, activeModelInfo) ||
			isReasoningModel(activeModelId, activeModelInfo)
		)
	}, [activeModelInfo, activeModelId])

	// Dynamically determine available effort options
	const effortOptions = useMemo<string[]>(() => {
		const rawLevels =
			activeModelInfo?.reasoningEffortLevels ||
			(Array.isArray(activeModelInfo?.supportsReasoningEffort)
				? activeModelInfo.supportsReasoningEffort
				: undefined)

		if (rawLevels && Array.isArray(rawLevels) && rawLevels.length > 0) {
			const positiveLevels = rawLevels
				.filter((lvl) => lvl !== "disable" && lvl !== "none")
				.map((lvl) => formatEffortLabel(lvl))
			return ["Off", ...positiveLevels]
		}

		return [...DEFAULT_EFFORT_OPTIONS]
	}, [activeModelInfo?.reasoningEffortLevels, activeModelInfo?.supportsReasoningEffort])

	// Current reasoning effort state
	const currentEffort: string = useMemo(() => {
		if (
			apiConfiguration?.enableReasoningEffort === false ||
			apiConfiguration?.reasoningEffort === "disable"
		) {
			return "Off"
		}
		const effort = (apiConfiguration?.reasoningEffort || activeModelInfo?.reasoningEffort)?.toLowerCase()
		if (effort === "none") return "Off"

		if (effort) {
			const match = effortOptions.find((opt) => opt.toLowerCase() === effort)
			if (match) return match
			if (effort === "minimal" && effortOptions.includes("Minimal")) return "Minimal"
			if (effort === "low" && effortOptions.includes("Low")) return "Low"
			if (effort === "medium" && effortOptions.includes("Medium")) return "Medium"
			if (effort === "high" && effortOptions.includes("High")) return "High"
			if (effort === "xhigh" && effortOptions.includes("XHigh")) return "XHigh"
		}

		if (
			apiConfiguration?.enableReasoningEffort === true ||
			activeModelInfo?.requiredReasoningEffort ||
			activeModelInfo?.supportsReasoningEffort ||
			modelSupportsReasoning(activeModelId, activeModelInfo)
		) {
			return effortOptions.includes("Medium") ? "Medium" : effortOptions[1] || "Off"
		}

		return "Off"
	}, [
		apiConfiguration?.enableReasoningEffort,
		apiConfiguration?.reasoningEffort,
		activeModelInfo,
		activeModelId,
		effortOptions,
	])

	// Switch reasoning effort
	const handleSelectEffort = useCallback(
		(effort: string) => {
			const isOff = effort.toLowerCase() === "off" || effort.toLowerCase() === "disable"
			const updatedConfig: ProviderSettings = {
				...apiConfiguration,
				...(isOff
					? { reasoningEffort: "disable" as any, enableReasoningEffort: false }
					: { reasoningEffort: effort.toLowerCase() as any, enableReasoningEffort: true }),
			}

			setApiConfiguration(updatedConfig)

			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentApiConfigName || "default",
				apiConfiguration: updatedConfig,
			})
		},
		[apiConfiguration, currentApiConfigName, setApiConfiguration],
	)

	// If the model does not support reasoning, hide the button to save toolbar space
	if (!activeModelSupportsReasoning) {
		return null
	}

	return (
		<Popover open={open} onOpenChange={setOpen} data-testid="reasoning-effort-root">
			<StandardTooltip content={t("chat:effort.tooltip", { level: getEffortLabel(currentEffort) })}>
				<PopoverTrigger
					disabled={disabled}
					data-testid="reasoning-effort-trigger"
					className={cn(
						"h-8 w-auto inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs shrink-0",
						"border border-border/40 rounded-md text-vscode-foreground",
						"transition-all duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "opacity-90 hover:opacity-100 hover:bg-vscode-toolbar-hoverBackground/60 hover:border-border/70 cursor-pointer",
						className,
					)}>
					<Brain className="size-3.5 text-amber-400 flex-shrink-0" />
					<span className="font-medium">{t("chat:effort.label", { level: getEffortLabel(currentEffort) })}</span>
					<ChevronDown className="size-3 text-vscode-descriptionForeground opacity-60 flex-shrink-0 -mr-0.5" />
				</PopoverTrigger>
			</StandardTooltip>

			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-1.5 overflow-hidden w-[160px] bg-vscode-dropdown-background border border-vscode-dropdown-border shadow-xl rounded-md"
				data-testid="reasoning-effort-popover">
				<div className="flex flex-col gap-0.5" data-testid="reasoning-effort-section">
					<div className="px-2 py-1 text-[11px] font-semibold text-vscode-descriptionForeground flex items-center gap-1.5 border-b border-vscode-dropdown-border/50 pb-1 mb-0.5 select-none">
						<Brain className="size-3.5 text-amber-400 flex-shrink-0" />
						<span>{t("chat:effort.title")}</span>
					</div>
					{effortOptions.map((effort) => {
						const isSelected = currentEffort.toLowerCase() === effort.toLowerCase()
						return (
							<button
								key={effort}
								type="button"
								data-testid={`reasoning-effort-pill-${effort.toLowerCase()}`}
								onClick={(e) => {
									e.stopPropagation()
									handleSelectEffort(effort)
									setOpen(false)
								}}
								className={cn(
									"w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded transition-all cursor-pointer text-left font-medium select-none",
									isSelected
										? effort === "Off"
											? "bg-vscode-button-secondaryBackground text-vscode-foreground font-semibold shadow-xs"
											: "bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/35 shadow-xs"
										: "text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-toolbar-hoverBackground/60 border border-transparent",
								)}>
								<span>{getEffortLabel(effort)}</span>
								{isSelected && <Check className="size-3.5 text-current flex-shrink-0" />}
							</button>
						)
					})}
				</div>
			</PopoverContent>
		</Popover>
	)
}
