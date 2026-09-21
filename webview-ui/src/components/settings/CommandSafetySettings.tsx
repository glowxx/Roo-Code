import { HTMLAttributes, useCallback } from "react"
import type { CommandSafetyConfig } from "@roo-code/types"
import { DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE } from "@roo-code/types"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { ShieldCheck, RotateCcw } from "lucide-react"

import { cn } from "@src/lib/utils"
import {
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
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

interface CommandSafetySettingsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
	commandSafetyConfig?: CommandSafetyConfig
	onChange: (config: CommandSafetyConfig) => void
}

export const CommandSafetySettings = ({
	commandSafetyConfig,
	onChange,
	className,
	...props
}: CommandSafetySettingsProps) => {
	const config: CommandSafetyConfig = commandSafetyConfig ?? {
		enabled: false,
		provider: "openai",
		modelId: "",
	}

	const updateField = useCallback(
		<K extends keyof CommandSafetyConfig>(field: K, value: CommandSafetyConfig[K]) => {
			onChange({
				...config,
				[field]: value,
			})
		},
		[config, onChange],
	)

	return (
		<div className={cn("space-y-4", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<ShieldCheck className="size-5" />
					<span>Command Safety Guardrail (Weryfikator Bezpieczeństwa Poleceń)</span>
				</div>
			</SectionHeader>

			<Section>
				<div className="space-y-4">
					{/* Toggle: Enabled */}
					<SearchableSetting
						settingId="command-safety-enabled"
						section="autoApprove"
						label="Włącz weryfikator bezpieczeństwa poleceń (Command Safety Guardrail)">
						<VSCodeCheckbox
							checked={config.enabled}
							onChange={(e: any) => updateField("enabled", e.target.checked)}
							data-testid="command-safety-enabled-toggle">
							<span className="font-medium">Włącz weryfikator bezpieczeństwa (Enabled)</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-xs mt-1">
							Automatyczna weryfikacja bezpieczeństwa poleceń terminalowych za pomocą dedykowanego modelu LLM przed ich wykonaniem.
						</div>
					</SearchableSetting>

					{/* Provider selector */}
					<SearchableSetting
						settingId="command-safety-provider"
						section="autoApprove"
						label="Dostawca modelu bezpieczeństwa (Safety Model Provider)">
						<label className="block text-sm font-medium mb-1">Dostawca (Provider)</label>
						<Select
							value={config.provider || "openai"}
							onValueChange={(value) => updateField("provider", value)}>
							<SelectTrigger className="w-full" data-testid="command-safety-provider-select">
								<SelectValue placeholder="Wybierz dostawcę" />
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

					{/* Model ID input */}
					<SearchableSetting
						settingId="command-safety-model-id"
						section="autoApprove"
						label="ID Modelu Bezpieczeństwa (Model ID)">
						<label className="block text-sm font-medium mb-1">ID Modelu (Model ID)</label>
						<Input
							type="text"
							value={config.modelId || ""}
							onChange={(e) => updateField("modelId", e.target.value)}
							placeholder="np. gpt-4o-mini, claude-3-5-haiku-20241022"
							className="w-full"
							data-testid="command-safety-model-id-input"
						/>
					</SearchableSetting>

					{/* Dedicated API Key */}
					<SearchableSetting
						settingId="command-safety-api-key"
						section="autoApprove"
						label="Dedykowany Klucz API (Dedicated API Key)">
						<label className="block text-sm font-medium mb-1">Klucz API (Opcjonalny)</label>
						<Input
							type="password"
							value={config.apiKey || ""}
							onChange={(e) => updateField("apiKey", e.target.value)}
							placeholder="Klucz API (opcjonalnie)"
							className="w-full"
							data-testid="command-safety-api-key-input"
						/>
						<div className="text-vscode-descriptionForeground text-xs mt-1">
							Opcjonalny dedykowany klucz API. Jeśli pozostanie pusty, zostanie użyty klucz z głównej konfiguracji wybranego dostawcy.
						</div>
					</SearchableSetting>

					{/* Custom Prompt Template */}
					<SearchableSetting
						settingId="command-safety-prompt-template"
						section="autoApprove"
						label="Szablon Promptu (Custom Prompt Template)">
						<div className="flex items-center justify-between mb-1">
							<label className="text-sm font-medium">Szablon promptu weryfikacji</label>
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
								<span>Reset to Default</span>
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
							Szablon instrukcji weryfikującej polecenie. Użyj &#123;&#123;command&#125;&#125; jako zmiennej dla polecenia.
						</div>
					</SearchableSetting>
				</div>
			</Section>
		</div>
	)
}
