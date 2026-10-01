import type {
	CommandSafetyConfig,
	ExtensionState,
	ApprovalMode,
} from "@roo-code/types"
import { isSafetyModelConfigured, resolveProviderApiKey } from "@roo-code/types"

export interface EffectiveApprovalPolicy {
	approvalMode: ApprovalMode
	isAutonomousMode: boolean
	autoApprovalEnabled: boolean
	alwaysAllowExecute: boolean
	allowedCommands: string[]
	deniedCommands: string[]
	commandSafetyConfig: CommandSafetyConfig
	isSafetyModelConfigured: boolean
	effectiveVerifierProvider?: string
	effectiveVerifierModelId?: string
	hasVerifierApiKey: boolean
	failClosed: boolean
	activePolicyDescription: string
}

/**
 * Computes the unified, canonical effective approval policy for the current runtime.
 * Merges: defaults + globalState/settings + mode + safety model configuration.
 */
export function getEffectiveApprovalPolicy(
	state?: Partial<ExtensionState> | null,
	taskContext?: {
		latestUserInstruction?: string
		activeGoal?: string
		explicitConstraints?: string[]
	}
): EffectiveApprovalPolicy {
	const approvalMode: ApprovalMode = state?.approvalMode ?? "manual"
	const isAutonomousMode = approvalMode === "auto"
	const autoApprovalEnabled = Boolean(state?.autoApprovalEnabled)
	const alwaysAllowExecute = Boolean(state?.alwaysAllowExecute)
	const allowedCommands = state?.allowedCommands || []
	const deniedCommands = state?.deniedCommands || []
	const commandSafetyConfig: CommandSafetyConfig = state?.commandSafetyConfig || {
		enabled: false,
		provider: "openai",
		modelId: "",
	}
	const safetyModelConfigured = isSafetyModelConfigured(state)
	const effectiveVerifierProvider = commandSafetyConfig.enabled ? commandSafetyConfig.provider : undefined
	const effectiveVerifierModelId = commandSafetyConfig.enabled ? commandSafetyConfig.modelId : undefined
	const verifierApiKey = commandSafetyConfig.apiKey || resolveProviderApiKey(commandSafetyConfig.provider, state?.apiConfiguration)
	const hasVerifierApiKey = Boolean(verifierApiKey && verifierApiKey.trim() !== "")

	let activePolicyDescription: string
	if (isAutonomousMode) {
		activePolicyDescription = safetyModelConfigured
			? `Autonomous Mode (Auto-Approve with Independent AI Safety Guardrail [${commandSafetyConfig.provider}:${commandSafetyConfig.modelId}])`
			: `Autonomous Mode (Auto-Approve active, Safety Guardrail unconfigured -> fail-closed to manual approval for ambiguous actions)`
	} else if (alwaysAllowExecute) {
		activePolicyDescription = safetyModelConfigured
			? `Manual Mode with Execute Auto-Approve (AI Guardrail [${commandSafetyConfig.provider}:${commandSafetyConfig.modelId}] active)`
			: `Manual Mode with Execute Auto-Approve (Standard pattern allowlist/denylist)`
	} else {
		activePolicyDescription = "Manual Approval Required for all commands"
	}

	return {
		approvalMode,
		isAutonomousMode,
		autoApprovalEnabled,
		alwaysAllowExecute,
		allowedCommands,
		deniedCommands,
		commandSafetyConfig,
		isSafetyModelConfigured: safetyModelConfigured,
		effectiveVerifierProvider,
		effectiveVerifierModelId,
		hasVerifierApiKey,
		failClosed: true,
		activePolicyDescription,
	}
}
