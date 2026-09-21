import { useEffect } from "react"
import { Checkbox } from "vscrui"

import {
	type ProviderSettings,
	type ModelInfo,
} from "@roo-code/types"

import {
	DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
	DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS,
	GEMINI_25_PRO_MIN_THINKING_TOKENS,
} from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Slider } from "@src/components/ui"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"

interface ThinkingBudgetProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
	modelInfo?: ModelInfo
}

export const ThinkingBudget = ({ apiConfiguration, setApiConfigurationField, modelInfo }: ThinkingBudgetProps) => {
	const { t } = useAppTranslation()
	const { id: selectedModelId } = useSelectedModel(apiConfiguration)

	// Check if this is a Gemini 2.5 Pro model
	const isGemini25Pro = selectedModelId && selectedModelId.includes("gemini-2.5-pro")
	const minThinkingTokens = isGemini25Pro ? GEMINI_25_PRO_MIN_THINKING_TOKENS : 1024

	// Check model capabilities
	const isReasoningSupported = !!modelInfo && modelInfo.supportsReasoningBinary
	const isReasoningBudgetSupported = !!modelInfo && modelInfo.supportsReasoningBudget
	const isReasoningBudgetRequired = !!modelInfo && modelInfo.requiredReasoningBudget

	const enableReasoningEffort = apiConfiguration.enableReasoningEffort
	const customMaxOutputTokens = apiConfiguration.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	const customMaxThinkingTokens =
		apiConfiguration.modelMaxThinkingTokens || DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS

	// Dynamically expand or shrink the max thinking budget based on the custom
	// max output tokens so that there's always a 20% buffer.
	const modelMaxThinkingTokens = modelInfo?.maxThinkingTokens
		? Math.min(modelInfo.maxThinkingTokens, Math.floor(0.8 * customMaxOutputTokens))
		: Math.floor(0.8 * customMaxOutputTokens)

	// If the custom max thinking tokens are going to exceed it's limit due
	// to the custom max output tokens being reduced then we need to shrink it
	// appropriately.
	useEffect(() => {
		if (isReasoningBudgetSupported && customMaxThinkingTokens > modelMaxThinkingTokens) {
			setApiConfigurationField("modelMaxThinkingTokens", modelMaxThinkingTokens, false)
		}
	}, [isReasoningBudgetSupported, customMaxThinkingTokens, modelMaxThinkingTokens, setApiConfigurationField])

	if (!modelInfo) {
		return null
	}

	// Models with supportsReasoningBinary (binary reasoning) show a simple on/off toggle
	if (isReasoningSupported) {
		return (
			<div className="flex flex-col gap-1">
				<Checkbox
					checked={enableReasoningEffort}
					onChange={(checked: boolean) =>
						setApiConfigurationField("enableReasoningEffort", checked === true)
					}>
					{t("settings:providers.useReasoning")}
				</Checkbox>
			</div>
		)
	}

	if (isReasoningBudgetSupported && !!modelInfo.maxTokens) {
		return (
			<>
				{!isReasoningBudgetRequired && (
					<div className="flex flex-col gap-1">
						<Checkbox
							checked={enableReasoningEffort}
							onChange={(checked: boolean) =>
								setApiConfigurationField("enableReasoningEffort", checked === true)
							}>
							{t("settings:providers.useReasoning")}
						</Checkbox>
					</div>
				)}
				{(isReasoningBudgetRequired || enableReasoningEffort) && (
					<>
						<div className="flex flex-col gap-1">
							<div className="font-medium">{t("settings:thinkingBudget.maxTokens")}</div>
							<div className="flex items-center gap-1">
								<Slider
									min={8192}
									max={Math.max(
										modelInfo.maxTokens || 8192,
										customMaxOutputTokens,
										DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS,
									)}
									step={1024}
									value={[customMaxOutputTokens]}
									onValueChange={([value]) => setApiConfigurationField("modelMaxTokens", value)}
								/>
								<div className="w-12 text-sm text-center">{customMaxOutputTokens}</div>
							</div>
						</div>
						<div className="flex flex-col gap-1">
							<div className="font-medium">{t("settings:thinkingBudget.maxThinkingTokens")}</div>
							<div className="flex items-center gap-1" data-testid="reasoning-budget">
								<Slider
									min={minThinkingTokens}
									max={modelMaxThinkingTokens}
									step={minThinkingTokens === 128 ? 128 : 1024}
									value={[customMaxThinkingTokens]}
									onValueChange={([value]) => setApiConfigurationField("modelMaxThinkingTokens", value)}
								/>
								<div className="w-12 text-sm text-center">{customMaxThinkingTokens}</div>
							</div>
						</div>
					</>
				)}
			</>
		)
	}

	return null
}
