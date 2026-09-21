import { HTMLAttributes, useCallback, useMemo } from "react"
import type { CommandSafetyConfig, ProviderSettings } from "@roo-code/types"
import { DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE, resolveProviderApiKey } from "@roo-code/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { ShieldCheck, RotateCcw, Check, AlertTriangle } from "lucide-react"

import { cn } from "@src/lib/utils"
import {
	Badge,
	Button,
	Input,
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@src/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { CommandSafetyModelCombobox } from "./CommandSafetyModelCombobox"

interface CommandSafetySettingsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
	apiConfiguration?: ProviderSettings
	commandSafetyConfig?: CommandSafetyConfig
	onChange: (config: CommandSafetyConfig) => void
}

const PROVIDER_NAMES: Record<string, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	openrouter: "OpenRouter",
	xkiro: "xKiro",
	gemini: "Google Gemini",
}

export const CommandSafetySettings = ({
	apiConfiguration,
	commandSafetyConfig,
	onChange,
	className,
	...props
}: CommandSafetySettingsProps) => {
	const { t } = useAppTranslation()

	const config: CommandSafetyConfig = useMemo(
		() =>
			commandSafetyConfig ?? {
				enabled: false,
				provider: "openai",
				modelId: "",
			},
		[commandSafetyConfig],
	)

	const updateField = useCallback(
		<K extends keyof CommandSafetyConfig>(field: K, value: CommandSafetyConfig[K]) => {
			onChange({
				...config,
				[field]: value,
			})
		},
		[config, onChange],
	)

	const currentProvider = config.provider || "openai"
	const inheritedApiKey = resolveProviderApiKey(currentProvider, apiConfiguration)
	const hasDedicatedApiKey = Boolean(config.apiKey && config.apiKey.trim().length > 0)
	const hasInheritedApiKey = Boolean(inheritedApiKey && inheritedApiKey.trim().length > 0)

	const providerDisplayName = PROVIDER_NAMES[currentProvider.toLowerCase()] || currentProvider

	return (
		<div className={cn("space-y-4", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<ShieldCheck className="size-5" />
					<span>{t("settings:commandSafety.title")}</span>
				</div>
			</SectionHeader>

			<Section>
				<div className="space-y-4">
					{/* Toggle: Enabled */}
					<SearchableSetting
						settingId="command-safety-enabled"
						section="autoApprove"
						label={t("settings:commandSafety.enabled")}>
						<VSCodeCheckbox
							checked={config.enabled}
							onChange={(e: any) => updateField("enabled", e.target.checked)}
							data-testid="command-safety-enabled-toggle">
							<span className="font-medium">{t("settings:commandSafety.enabledLabel")}</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:commandSafety.enabledDescription")}
						</div>
					</SearchableSetting>

					{/* Provider selector */}
					<SearchableSetting
						settingId="command-safety-provider"
						section="autoApprove"
						label={t("settings:commandSafety.providerLabel")}>
						<label className="block text-sm font-medium mb-1">{t("settings:commandSafety.providerLabel")}</label>
						<Select
							value={config.provider || "openai"}
							onValueChange={(value) => updateField("provider", value)}>
							<SelectTrigger className="w-full" data-testid="command-safety-provider-select">
								<SelectValue placeholder={t("settings:commandSafety.providerSelectPlaceholder")} />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									<SelectItem value="openai">OpenAI</SelectItem>
									<SelectItem value="anthropic">Anthropic</SelectItem>
									<SelectItem value="openrouter">OpenRouter</SelectItem>
									<SelectItem value="xkiro">xKiro</SelectItem>
									<SelectItem value="gemini">Google Gemini</SelectItem>
								</SelectGroup>
							</SelectContent>
						</Select>
					</SearchableSetting>

					{/* Model ID selector */}
					<SearchableSetting
						settingId="command-safety-model-id"
						section="autoApprove"
						label={t("settings:commandSafety.modelIdLabel")}>
						<label className="block text-sm font-medium mb-1">{t("settings:commandSafety.modelIdLabel")}</label>
						<CommandSafetyModelCombobox
							provider={config.provider || "openai"}
							value={config.modelId || ""}
							onChange={(modelId) => updateField("modelId", modelId)}
							placeholder={t("settings:commandSafety.modelIdPlaceholder")}
							data-testid="command-safety-model-id-input"
						/>
					</SearchableSetting>

					{/* Dedicated API Key */}
					<SearchableSetting
						settingId="command-safety-api-key"
						section="autoApprove"
						label={t("settings:commandSafety.apiKeyLabel")}>
						<div className="flex items-center justify-between mb-1">
							<label className="block text-sm font-medium">{t("settings:commandSafety.apiKeyLabel")}</label>
							{!hasDedicatedApiKey && hasInheritedApiKey && (
								<Badge
									variant="outline"
									className="flex items-center gap-1.5 text-xs text-green-500 border-green-500/30 bg-green-500/10 font-normal"
									data-testid="command-safety-inherited-badge">
									<Check className="size-3 text-green-500" />
									<span>{t("settings:commandSafety.apiKeyInheritedBadge", { provider: providerDisplayName })}</span>
								</Badge>
							)}
						</div>
						<Input
							type="password"
							value={config.apiKey || ""}
							onChange={(e) => updateField("apiKey", e.target.value)}
							placeholder={
								!hasDedicatedApiKey && hasInheritedApiKey
									? t("settings:commandSafety.apiKeyInheritedPlaceholder")
									: t("settings:commandSafety.apiKeyPlaceholder")
							}
							className="w-full"
							data-testid="command-safety-api-key-input"
						/>
						{!hasDedicatedApiKey && !hasInheritedApiKey && (
							<div
								className="flex items-center gap-1.5 text-amber-500 text-xs mt-1.5"
								data-testid="command-safety-api-key-warning">
								<AlertTriangle className="size-3.5 shrink-0" />
								<span>{t("settings:commandSafety.apiKeyWarning", { provider: providerDisplayName })}</span>
							</div>
						)}
						<div className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:commandSafety.apiKeyDescription")}
						</div>
					</SearchableSetting>

					{/* Custom Prompt Template */}
					<SearchableSetting
						settingId="command-safety-prompt-template"
						section="autoApprove"
						label={t("settings:commandSafety.promptTemplateLabel")}>
						<div className="flex items-center justify-between mb-1">
							<label className="text-sm font-medium">{t("settings:commandSafety.promptTemplateLabel")}</label>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() =>
									updateField("customPromptTemplate", DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE)
								}
								className="h-7 text-xs flex items-center gap-1"
								data-testid="command-safety-reset-prompt-button">
								<RotateCcw className="size-3" />
								<span>{t("settings:commandSafety.resetToDefault")}</span>
							</Button>
						</div>
						<Textarea
							value={
								config.customPromptTemplate !== undefined
									? config.customPromptTemplate
									: DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE
							}
							onChange={(e) => updateField("customPromptTemplate", e.target.value)}
							rows={6}
							className="font-mono text-xs w-full min-h-[120px]"
							data-testid="command-safety-prompt-template-textarea"
						/>
						<div className="text-vscode-descriptionForeground text-xs mt-1">
							{t("settings:commandSafety.promptTemplateDescription")}
						</div>
					</SearchableSetting>
				</div>
			</Section>
		</div>
	)
}
