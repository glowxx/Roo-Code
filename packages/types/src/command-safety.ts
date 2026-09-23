import { z } from "zod"
import type { ProviderSettings } from "./provider-settings.js"
import type { ExtensionState } from "./vscode-extension-host.js"

export interface CommandSafetyConfig {
	enabled: boolean
	provider: string
	modelId: string
	apiKey?: string
	customPromptTemplate?: string
}

export const commandSafetyConfigSchema = z.object({
	enabled: z.boolean(),
	provider: z.string(),
	modelId: z.string(),
	apiKey: z.string().optional(),
	customPromptTemplate: z.string().optional(),
})

export const DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE = `Analyze the following command for potential security risks before execution:

Command: {{command}}

Evaluate whether this command is safe to run automatically.
Respond in JSON format with:
- "isSafe": boolean (true if safe to run automatically, false if dangerous or requires user review)
- "riskLevel": "safe" | "low" | "medium" | "high" | "critical"
- "reason": brief explanation`

export type CommandSafetyRiskLevel = "safe" | "low" | "medium" | "high" | "critical"

export interface SafetyEvaluationResult {
	isSafe: boolean
	riskLevel: CommandSafetyRiskLevel
	reason: string
}

/**
 * Resolves the appropriate API key for the safety provider.
 * Falls back to main profile API key if dedicated key is not set.
 */
export function resolveProviderApiKey(provider: string, apiConfig?: ProviderSettings): string | undefined {
	if (!apiConfig) {
		return undefined
	}

	const normalizedProvider = provider.toLowerCase().trim()

	switch (normalizedProvider) {
		case "openai":
			return apiConfig.openAiApiKey || (apiConfig.apiProvider === "openai" ? apiConfig.apiKey : undefined)
		case "anthropic":
			return apiConfig.apiKey || (apiConfig.apiProvider === "anthropic" ? apiConfig.apiKey : undefined)
		case "openrouter":
			return (
				apiConfig.openRouterApiKey || (apiConfig.apiProvider === "openrouter" ? apiConfig.apiKey : undefined)
			)
		case "gemini":
			return apiConfig.geminiApiKey || (apiConfig.apiProvider === "gemini" ? apiConfig.apiKey : undefined)
		case "xkiro":
			return (
				(apiConfig as Record<string, any>).xkiroApiKey ||
				apiConfig.openAiApiKey ||
				(apiConfig.apiProvider === "xkiro" ? apiConfig.apiKey : undefined)
			)
		default:
			if (apiConfig.apiProvider === provider && apiConfig.apiKey) {
				return apiConfig.apiKey
			}
			return undefined
	}
}

/**
 * Checks whether the command safety verification model is configured and ready.
 * Must have enabled === true, valid non-empty provider, valid non-empty modelId,
 * and a valid API key (either custom or inherited from the main profile).
 */
export function isSafetyModelConfigured(state?: Partial<ExtensionState> | null): boolean {
	if (!state || !state.commandSafetyConfig) {
		return false
	}

	const { enabled, provider, modelId, apiKey } = state.commandSafetyConfig

	if (!enabled) {
		return false
	}

	if (!provider || provider.trim() === "") {
		return false
	}

	if (!modelId || modelId.trim() === "") {
		return false
	}

	if (apiKey && apiKey.trim() !== "") {
		return true
	}

	const fallbackKey = resolveProviderApiKey(provider, state.apiConfiguration)
	return Boolean(fallbackKey && fallbackKey.trim() !== "")
}

/**
 * Standard inspection, diff, and read-only commands that are considered safe by default
 * and should not be blocked when execute auto-approval is enabled.
 */
export const DEFAULT_SAFE_COMMANDS: readonly string[] = [
	"git diff",
	"git status",
	"git log",
	"git show",
	"git branch",
	"git tag",
	"git rev-parse",
	"ls",
	"dir",
	"pwd",
]

/**
 * Execution boundary domains for nested and wrapped commands.
 */
export type ExecutionDomain =
	| "host"
	| "wsl"
	| "docker_exec"
	| "docker_run"
	| "compose_exec"
	| "ssh"
	| "subshell"

export type HostImpactRisk = "none" | "low" | "medium" | "high" | "critical"

export interface DockerMountInfo {
	source: string
	target: string
	isReadOnly: boolean
	isHostRootOrSystem: boolean
	isDockerSocket: boolean
}

export interface ExecutionTarget {
	type: "local" | "wsl" | "docker" | "ssh" | "unknown"
	name?: string
	classification?: "test-environment" | "development" | "production" | "unknown"
}

export interface HostImpactAssessment {
	isHostEscape: boolean
	highestRisk: HostImpactRisk
	reasons: string[]
	affectedHostPaths: string[]
	hostEscapingBinaries: string[]
	escapesBoundary: boolean
}

export interface ExecutionBoundary {
	host: {
		os: string
		shell?: string
	}
	target: ExecutionTarget
	outerCommand?: string
	innerCommand: string
	hostImpact: HostImpactAssessment
}

export interface CompactSafetyContext {
	taskGoal: string
	latestUserInstruction: string
	activeTodo?: {
		content: string
		status: "pending" | "in_progress" | "completed"
		stepIndex: number
		totalSteps: number
	}
	workspacePath: string
	commandCwd: string
	isWithinWorkspace: boolean
	taskMode?: string
	recentCommands?: string[]
	explicitConstraints?: string[]
}

export const compactSafetyContextSchema = z.object({
	taskGoal: z.string(),
	latestUserInstruction: z.string(),
	activeTodo: z
		.object({
			content: z.string(),
			status: z.enum(["pending", "in_progress", "completed"]),
			stepIndex: z.number(),
			totalSteps: z.number(),
		})
		.optional(),
	workspacePath: z.string(),
	commandCwd: z.string(),
	isWithinWorkspace: z.boolean(),
	taskMode: z.string().optional(),
	recentCommands: z.array(z.string()).optional(),
	explicitConstraints: z.array(z.string()).optional(),
})

export type Stage2Decision = "ALLOW_AUTO_APPROVE" | "REQUIRE_MANUAL_APPROVAL" | "BLOCK_CRITICAL"

export const stage2DecisionSchema = z.enum([
	"ALLOW_AUTO_APPROVE",
	"REQUIRE_MANUAL_APPROVAL",
	"BLOCK_CRITICAL",
])

export interface Stage2AdjudicationResult {
	decision: Stage2Decision
	risk: CommandSafetyRiskLevel
	reason: string
	taskAlignment: boolean
	executionBoundary?: {
		host: string
		targetType: string
		target?: string
		hostImpact: boolean
	}
	criticalRiskDetected: boolean
}

export const stage2AdjudicationResultSchema = z.object({
	decision: stage2DecisionSchema,
	risk: z.string().transform((val) => {
		const lower = val.toLowerCase().trim()
		if (["safe", "low", "medium", "high", "critical"].includes(lower)) {
			return lower as CommandSafetyRiskLevel
		}
		return "high" as CommandSafetyRiskLevel
	}),
	reason: z.string(),
	taskAlignment: z.boolean().default(false),
	executionBoundary: z
		.object({
			host: z.string(),
			targetType: z.string(),
			target: z.string().optional(),
			hostImpact: z.boolean(),
		})
		.optional(),
	criticalRiskDetected: z.boolean().default(false),
})

export interface TwoStageSafetyResult {
	decision: "approve" | "ask" | "deny"
	stage1: SafetyEvaluationResult & {
		executionBoundary?: ExecutionBoundary
	}
	stage2?: Stage2AdjudicationResult
	finalReason: string
	auditLog: string
}

export type ApprovalActionType =
	| "execute_command"
	| "write_to_file"
	| "replace_file_content"
	| "delete_file"
	| "read_file"
	| "use_mcp_tool"
	| "access_mcp_resource"
	| "switch_mode"
	| "new_task"
	| "attempt_completion"

export type OrchestratorDecision = "ALLOW_AUTO" | "DENY_AND_REPLAN" | "HARD_BLOCK" | "MANUAL_APPROVAL"

export const orchestratorDecisionSchema = z.enum([
	"ALLOW_AUTO",
	"DENY_AND_REPLAN",
	"HARD_BLOCK",
	"MANUAL_APPROVAL",
])

export interface CompactApprovalContext {
	latestUserInstruction: string
	activeGoal: string
	currentStep?: string
	explicitConstraints?: string[]
	workspacePath: string
	isWithinWorkspace: boolean
	recentActionSignatures?: string[]
}

export const compactApprovalContextSchema = z.object({
	latestUserInstruction: z.string(),
	activeGoal: z.string(),
	currentStep: z.string().optional(),
	explicitConstraints: z.array(z.string()).optional(),
	workspacePath: z.string(),
	isWithinWorkspace: z.boolean(),
	recentActionSignatures: z.array(z.string()).optional(),
})

export interface UnifiedApprovalRequest {
	id: string
	taskId: string
	actionType: ApprovalActionType
	timestamp: number
	target: {
		command?: string
		cwd?: string
		filePath?: string
		diff?: string
		isOutsideWorkspace?: boolean
		isProtected?: boolean
		mcpServerName?: string
		mcpToolName?: string
		mcpArguments?: Record<string, unknown>
		subtaskMode?: string
		subtaskMessage?: string
		completionSummary?: string
	}
	executionBoundary?: ExecutionBoundary
	taskContext: CompactApprovalContext
	previousDenial?: {
		actionType: ApprovalActionType
		reason: string
		replanGuidance?: string
	}
}

export interface ApprovalDecisionResult {
	decision: OrchestratorDecision
	risk: CommandSafetyRiskLevel
	reason: string
	taskAligned: boolean
	hardBoundaryViolation?: boolean
	replanGuidance?: string | null
	auditLog: string
}

export const approvalDecisionResultSchema = z.object({
	decision: z.enum(["ALLOW_AUTO", "DENY_AND_REPLAN", "HARD_BLOCK"]),
	risk: z.string().transform((val) => {
		const lower = val.toLowerCase().trim()
		if (["safe", "low", "medium", "high", "critical"].includes(lower)) {
			return lower as CommandSafetyRiskLevel
		}
		return "high" as CommandSafetyRiskLevel
	}),
	reason: z.string(),
	taskAligned: z.boolean().default(false),
	hardBoundaryViolation: z.boolean().default(false),
	replanGuidance: z.string().nullable().optional(),
})

export interface DecisionLogEntry {
	id: string
	timestamp: number
	taskId: string
	actionType: ApprovalActionType
	target: string
	boundaryTarget?: string
	risk: CommandSafetyRiskLevel
	decision: OrchestratorDecision
	reason: string
	replanGuidance?: string | null
	evaluatorModel?: string
	fastPath: boolean
	latencyMs?: number
}


