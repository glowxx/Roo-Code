import { useState, useMemo, useCallback, useRef, useEffect, useContext } from "react"
import { Check, ChevronsUpDown, Sparkles, Plus } from "lucide-react"

import {
	openAiNativeModels,
	anthropicModels,
	geminiModels,
	xkiroModels,
} from "@roo-code/types"

import { cn } from "@src/lib/utils"
import { Button, Input, Popover, PopoverAnchor, PopoverContent } from "@src/components/ui"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"

export const RECOMMENDED_AUDIT_MODELS: Record<string, string[]> = {
	openai: ["gpt-4o-mini"],
	anthropic: ["claude-3-5-haiku-20241022"],
	gemini: ["gemini-2.5-flash", "gemini-2.0-flash"],
	xkiro: ["deepseek/deepseek-chat", "google/gemini-2.5-flash", "openai/gpt-5-mini", "openai/gpt-4o-mini"],
	openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku", "google/gemini-2.5-flash"],
}

export const POPULAR_OPENROUTER_MODELS = [
	"openai/gpt-4o-mini",
	"anthropic/claude-3.5-haiku",
	"google/gemini-2.5-flash",
	"deepseek/deepseek-chat",
	"meta-llama/llama-3.3-70b-instruct",
	"qwen/qwen-2.5-coder-32b-instruct",
	"openai/gpt-4o",
	"anthropic/claude-3.7-sonnet",
]

export interface CommandSafetyModelComboboxProps {
	provider?: string
	value: string
	onChange: (value: string) => void
	placeholder?: string
	className?: string
	disabled?: boolean
	"data-testid"?: string
}

export const CommandSafetyModelCombobox = ({
	provider = "openai",
	value,
	onChange,
	placeholder,
	className,
	disabled = false,
	"data-testid": dataTestId = "command-safety-model-id-input",
}: CommandSafetyModelComboboxProps) => {
	const { t } = useAppTranslation()
	const effectivePlaceholder = placeholder ?? t("settings:commandSafetyCombobox.placeholder")
	const [open, setOpen] = useState(false)
	const [inputValue, setInputValue] = useState(value || "")
	const [searchTerm, setSearchTerm] = useState("")
	const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)

	const containerRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	const extensionState = useContext(ExtensionStateContext)
	const openAiModelInfos = extensionState?.openAiModelInfos
	const openAiModels = extensionState?.openAiModels

	const normalizedProvider = (provider || "openai").toLowerCase()

	const { data: routerModels } = useRouterModels({
		provider: "openrouter",
		enabled: normalizedProvider === "openrouter",
	})

	// Sync inputValue with external value prop
	useEffect(() => {
		setInputValue(value || "")
	}, [value])

	// Collect models based on provider
	const allProviderModels = useMemo(() => {
		const modelsSet = new Set<string>()

		// Always ensure recommended models for this provider are present
		const rec = RECOMMENDED_AUDIT_MODELS[normalizedProvider] || []
		rec.forEach((m) => modelsSet.add(m))

		switch (normalizedProvider) {
			case "xkiro": {
				Object.keys(xkiroModels).forEach((m) => modelsSet.add(m))
				if (openAiModelInfos) {
					Object.keys(openAiModelInfos).forEach((m) => modelsSet.add(m))
				}
				if (openAiModels && Array.isArray(openAiModels)) {
					openAiModels.forEach((m) => {
						if (typeof m === "string" && m.trim()) {
							modelsSet.add(m.trim())
						}
					})
				}
				break
			}
			case "openai": {
				Object.keys(openAiNativeModels).forEach((m) => modelsSet.add(m))
				if (openAiModelInfos) {
					Object.keys(openAiModelInfos).forEach((m) => modelsSet.add(m))
				}
				if (openAiModels && Array.isArray(openAiModels)) {
					openAiModels.forEach((m) => {
						if (typeof m === "string" && m.trim()) {
							modelsSet.add(m.trim())
						}
					})
				}
				break
			}
			case "anthropic": {
				Object.keys(anthropicModels).forEach((m) => modelsSet.add(m))
				const dynamicAnthropic =
					(routerModels as any)?.anthropic || (extensionState?.routerModels as any)?.anthropic
				if (dynamicAnthropic) {
					Object.keys(dynamicAnthropic).forEach((m) => modelsSet.add(m))
				}
				break
			}
			case "gemini": {
				Object.keys(geminiModels).forEach((m) => modelsSet.add(m))
				const dynamicGemini =
					(routerModels as any)?.gemini || (extensionState?.routerModels as any)?.gemini
				if (dynamicGemini) {
					Object.keys(dynamicGemini).forEach((m) => modelsSet.add(m))
				}
				break
			}
			case "openrouter": {
				const orModels = routerModels?.openrouter || extensionState?.routerModels?.openrouter
				if (orModels && Object.keys(orModels).length > 0) {
					Object.keys(orModels).forEach((m) => modelsSet.add(m))
				} else {
					POPULAR_OPENROUTER_MODELS.forEach((m) => modelsSet.add(m))
				}
				break
			}
			default:
				break
		}

		return Array.from(modelsSet)
	}, [normalizedProvider, openAiModelInfos, openAiModels, routerModels, extensionState?.routerModels])

	const recommendedModels = useMemo(() => {
		return RECOMMENDED_AUDIT_MODELS[normalizedProvider] || []
	}, [normalizedProvider])

	const otherModels = useMemo(() => {
		const recSet = new Set(recommendedModels)
		return allProviderModels.filter((m) => !recSet.has(m)).sort((a, b) => a.localeCompare(b))
	}, [allProviderModels, recommendedModels])

	// Filter based on search term
	const filteredRecommended = useMemo(() => {
		if (!searchTerm.trim()) return recommendedModels
		const lower = searchTerm.toLowerCase().trim()
		return recommendedModels.filter((m) => m.toLowerCase().includes(lower))
	}, [recommendedModels, searchTerm])

	const filteredOther = useMemo(() => {
		if (!searchTerm.trim()) return otherModels
		const lower = searchTerm.toLowerCase().trim()
		return otherModels.filter((m) => m.toLowerCase().includes(lower))
	}, [otherModels, searchTerm])

	const trimmedSearch = searchTerm.trim()
	const hasExactMatch = useMemo(() => {
		if (!trimmedSearch) return true
		const lower = trimmedSearch.toLowerCase()
		return allProviderModels.some((m) => m.toLowerCase() === lower)
	}, [allProviderModels, trimmedSearch])

	const showCustomOption = !hasExactMatch && trimmedSearch.length > 0

	const allSelectableItems = useMemo(() => {
		const items = [...filteredRecommended, ...filteredOther]
		if (showCustomOption) {
			items.push(`__custom__:${trimmedSearch}`)
		}
		return items
	}, [filteredRecommended, filteredOther, showCustomOption, trimmedSearch])

	const handleSelect = useCallback(
		(modelId: string) => {
			setInputValue(modelId)
			setSearchTerm("")
			onChange(modelId)
			setOpen(false)
			setHighlightedIndex(-1)
		},
		[onChange],
	)

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const val = e.target.value
			setInputValue(val)
			setSearchTerm(val)
			onChange(val)
			setOpen(true)
			setHighlightedIndex(-1)
		},
		[onChange],
	)

	const handleFocus = useCallback(() => {
		setOpen(true)
		setSearchTerm("")
		setHighlightedIndex(-1)
	}, [])

	const handleToggle = useCallback(() => {
		setOpen((prev) => {
			if (!prev) {
				setSearchTerm("")
				setHighlightedIndex(-1)
			}
			return !prev
		})
		inputRef.current?.focus()
	}, [])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "ArrowDown") {
				e.preventDefault()
				if (!open) {
					setOpen(true)
					return
				}
				setHighlightedIndex((prev) => (prev < allSelectableItems.length - 1 ? prev + 1 : 0))
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				if (!open) {
					setOpen(true)
					return
				}
				setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : allSelectableItems.length - 1))
			} else if (e.key === "Enter") {
				e.preventDefault()
				if (open) {
					if (highlightedIndex >= 0 && highlightedIndex < allSelectableItems.length) {
						const item = allSelectableItems[highlightedIndex]
						if (item.startsWith("__custom__:")) {
							handleSelect(item.slice(11))
						} else {
							handleSelect(item)
						}
					} else if (inputValue.trim()) {
						handleSelect(inputValue.trim())
					} else {
						setOpen(false)
					}
				} else if (inputValue.trim()) {
					handleSelect(inputValue.trim())
				}
			} else if (e.key === "Escape") {
				if (open) {
					e.preventDefault()
					setOpen(false)
				}
			}
		},
		[open, highlightedIndex, allSelectableItems, handleSelect, inputValue],
	)

	useEscapeKey(open, () => setOpen(false))

	return (
		<div className={cn("relative w-full", className)} ref={containerRef}>
			<Popover open={open} onOpenChange={setOpen}>
				{PopoverAnchor ? (
					<PopoverAnchor asChild>
						<div className="relative flex items-center">
							<Input
								ref={inputRef}
								type="text"
								value={inputValue}
								onChange={handleInputChange}
								onFocus={handleFocus}
								onKeyDown={handleKeyDown}
								placeholder={effectivePlaceholder}
								className="w-full pr-8"
								data-testid={dataTestId}
								disabled={disabled}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="absolute right-0 h-full px-2 hover:bg-transparent text-vscode-foreground opacity-50 hover:opacity-100"
								onClick={handleToggle}
								tabIndex={-1}
								disabled={disabled}
								data-testid="command-safety-model-combobox-toggle">
								<ChevronsUpDown className="size-4" />
							</Button>
						</div>
					</PopoverAnchor>
				) : (
					<div className="relative flex items-center">
						<Input
							ref={inputRef}
							type="text"
							value={inputValue}
							onChange={handleInputChange}
							onFocus={handleFocus}
							onKeyDown={handleKeyDown}
							placeholder={effectivePlaceholder}
							className="w-full pr-8"
							data-testid={dataTestId}
							disabled={disabled}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="absolute right-0 h-full px-2 hover:bg-transparent text-vscode-foreground opacity-50 hover:opacity-100"
							onClick={handleToggle}
							tabIndex={-1}
							disabled={disabled}
							data-testid="command-safety-model-combobox-toggle">
							<ChevronsUpDown className="size-4" />
						</Button>
					</div>
				)}
				<PopoverContent
					className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[280px] max-h-[300px] overflow-y-auto bg-vscode-dropdown-background border border-vscode-dropdown-border text-vscode-dropdown-foreground shadow-lg"
					align="start"
					side="bottom"
					sideOffset={4}
					style={{
						width: containerRef.current?.offsetWidth ? `${containerRef.current.offsetWidth}px` : undefined,
					}}
					onOpenAutoFocus={(e) => e.preventDefault()}>
					<div className="py-1" data-testid="command-safety-model-combobox-list">
						{/* Recommended Audit Models Group */}
						{filteredRecommended.length > 0 && (
							<div>
								<div
									className="text-xs font-semibold px-2.5 py-1.5 text-vscode-descriptionForeground flex items-center gap-1.5"
									data-testid="command-safety-recommended-models-header">
									<Sparkles className="size-3.5 text-vscode-charts-yellow" />
									<span>{t("settings:commandSafetyCombobox.recommendedHeader")}</span>
								</div>
								{filteredRecommended.map((model, idx) => {
									const isHighlighted = highlightedIndex === idx
									const isSelected = model === value
									return (
										<div
											key={model}
											role="option"
											aria-selected={isSelected}
											data-testid={`command-safety-model-option-${model}`}
											onClick={() => handleSelect(model)}
											onMouseDown={(e) => e.preventDefault()}
											className={cn(
												"flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer select-none rounded-sm transition-colors",
												"hover:bg-vscode-list-hoverBackground text-vscode-foreground",
												isSelected &&
													"bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground",
												isHighlighted && !isSelected && "bg-vscode-list-hoverBackground",
											)}>
											<div className="flex items-center gap-1.5 truncate mr-2">
												<span className="font-mono text-xs truncate">{model}</span>
												<span className="text-[10px] px-1 py-0.2 rounded bg-vscode-badge-background text-vscode-badge-foreground shrink-0">
													{t("settings:commandSafetyCombobox.recommendedBadge")}
												</span>
											</div>
											{isSelected && <Check className="size-3.5 shrink-0 opacity-100" />}
										</div>
									)
								})}
							</div>
						)}

						{/* Other Models Group */}
						{filteredOther.length > 0 && (
							<div>
								{filteredRecommended.length > 0 && (
									<div className="text-xs font-semibold px-2.5 py-1.5 text-vscode-descriptionForeground mt-1 border-t border-vscode-dropdown-border/50">
										<span>{t("settings:commandSafetyCombobox.otherHeader")}</span>
									</div>
								)}
								{filteredOther.map((model, idx) => {
									const itemIndex = filteredRecommended.length + idx
									const isHighlighted = highlightedIndex === itemIndex
									const isSelected = model === value
									return (
										<div
											key={model}
											role="option"
											aria-selected={isSelected}
											data-testid={`command-safety-model-option-${model}`}
											onClick={() => handleSelect(model)}
											onMouseDown={(e) => e.preventDefault()}
											className={cn(
												"flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer select-none rounded-sm transition-colors",
												"hover:bg-vscode-list-hoverBackground text-vscode-foreground",
												isSelected &&
													"bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground",
												isHighlighted && !isSelected && "bg-vscode-list-hoverBackground",
											)}>
											<span className="font-mono text-xs truncate mr-2">{model}</span>
											{isSelected && <Check className="size-3.5 shrink-0 opacity-100" />}
										</div>
									)
								})}
							</div>
						)}

						{/* Custom Model Option */}
						{showCustomOption && (
							<div
								className="p-1 border-t border-vscode-dropdown-border/70"
								data-testid="command-safety-custom-model-option"
								onClick={() => handleSelect(trimmedSearch)}
								onMouseDown={(e) => e.preventDefault()}>
								<div
									role="option"
									className={cn(
										"flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-sm cursor-pointer select-none transition-colors",
										"hover:bg-vscode-list-hoverBackground text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground",
										highlightedIndex === allSelectableItems.length - 1 &&
											"bg-vscode-list-hoverBackground",
									)}>
									<Plus className="size-3.5 shrink-0" />
									<span className="truncate">
										{t("settings:commandSafetyCombobox.useCustomId")}{" "}
										<span className="font-semibold font-mono">&quot;{trimmedSearch}&quot;</span>
									</span>
								</div>
							</div>
						)}

						{/* Empty State */}
						{filteredRecommended.length === 0 && filteredOther.length === 0 && !showCustomOption && (
							<div className="py-3 px-2 text-center text-xs text-vscode-descriptionForeground">
								{t("settings:commandSafetyCombobox.noModels")}
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}
