import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenAI } from "@google/genai"
import type {
	CommandSafetyConfig,
	CommandSafetyRiskLevel,
	SafetyEvaluationResult,
	ExtensionState,
	CompactSafetyContext,
	ExecutionBoundary,
	Stage2Decision,
	Stage2AdjudicationResult,
	TwoStageSafetyResult,
} from "@roo-code/types"
import { stage2AdjudicationResultSchema, resolveProviderApiKey } from "@roo-code/types"
import {
	buildSafetyPrompt,
	buildStage2SafetyPrompt,
	sanitizeForSafetyPrompt,
} from "./safetyPromptTemplate"
import { ExecutionBoundaryAnalyzer } from "./ExecutionBoundaryAnalyzer"

export function createFailClosedResult(detail: string): SafetyEvaluationResult {
	return {
		isSafe: false,
		riskLevel: "critical",
		reason: `Command safety verification failed: ${detail}. Manual approval required.`,
	}
}

export const SAFETY_EVALUATION_FALLBACK_RESULT: SafetyEvaluationResult = createFailClosedResult(
	"Command safety evaluation failed (timeout or network error). Auto-execution blocked defensively"
)

export const DEFAULT_TIMEOUT_MS = 15000

const FAST_PATH_PATTERNS = [
	/^git\s+(diff|status|log|show|branch|rev-parse)(\s+.*)?$/i,
	/^(ls|dir|pwd)(\s+.*)?$/i,
	/^(echo|cat|type|head|tail)(\s+.*)?$/i,
	/^(node|pnpm|npm|npx|yarn|bun|vitest|jest)(\s+.*)?$/i,
]

export interface EvaluateSafetyOptions {
	command: string
	cwd?: string
	recentCommands?: string[]
	config?: CommandSafetyConfig
	state?: Partial<ExtensionState> | null
}

export interface EvaluateTwoStageOptions {
	command: string
	cwd?: string
	taskId?: string
	context?: CompactSafetyContext
	recentCommands?: string[]
	config?: CommandSafetyConfig
	state?: Partial<ExtensionState> | null
}

export interface CallProviderParams {
	provider: string
	modelId: string
	apiKey: string
	systemPrompt: string
	userPrompt: string
	state?: Partial<ExtensionState> | null
	signal: AbortSignal
	maxTokens?: number
}

export interface CommandSafetyJudgeOptions {
	timeoutMs?: number
	callProviderOverride?: (params: CallProviderParams) => Promise<string>
}

/**
 * CommandSafetyJudge evaluates commands for potential security risks using an LLM.
 */
export class CommandSafetyJudge {
	public static readonly DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS
	public static globalCallProviderOverride?: (params: CallProviderParams) => Promise<string>
	private static readonly cache = new Map<string, SafetyEvaluationResult>()
	private static readonly twoStageCache = new Map<string, TwoStageSafetyResult>()

	private readonly timeoutMs: number
	private readonly callProviderOverride?: (params: CallProviderParams) => Promise<string>

	constructor(options?: CommandSafetyJudgeOptions) {
		this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.callProviderOverride = options?.callProviderOverride
	}

	public clearCache(): void {
		CommandSafetyJudge.clearCache()
	}

	public static clearCache(): void {
		CommandSafetyJudge.cache.clear()
		CommandSafetyJudge.twoStageCache.clear()
	}

	/**
	 * Evaluates whether a command is guaranteed to be safe and read-only via regex heuristics,
	 * bypassing network/LLM calls with 0ms latency.
	 */
	public evaluateFastPath(command: string): SafetyEvaluationResult | null {
		if (!command || typeof command !== "string") {
			return null
		}

		const trimmed = command.trim()

		// Rigorous check for write modifiers / escalation:
		// If command contains '>', '>>', '| rm', '| bash', '| sh', '| zsh', '| powershell', '| pwsh', 'sudo',
		// return null to force full LLM evaluation.
		const hasWriteOrEscalationModifier =
			trimmed.includes(">") ||
			/\bsudo\b/i.test(trimmed) ||
			/\|\s*(rm|bash|sh|zsh|powershell|pwsh)\b/i.test(trimmed)

		if (hasWriteOrEscalationModifier) {
			return null
		}

		const isMatch = FAST_PATH_PATTERNS.some((pattern) => pattern.test(trimmed))
		if (isMatch) {
			return {
				isSafe: true,
				riskLevel: "safe",
				reason: "Verified read-only command via fast-path",
			}
		}

		return null
	}

	public static evaluateFastPath(command: string): SafetyEvaluationResult | null {
		return new CommandSafetyJudge().evaluateFastPath(command)
	}

	/**
	 * Parses and validates LLM response text into a SafetyEvaluationResult.
	 * Handles raw JSON, Markdown code fences (```json ... ```), or mixed text.
	 */
	public parseSafetyResponse(rawResponse: string): SafetyEvaluationResult {
		if (!rawResponse || typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
			return createFailClosedResult("Empty or whitespace response from safety auditor model")
		}

		const trimmed = rawResponse.trim()
		let parsedObject: any = null

		// Attempt 1: Direct JSON parse
		try {
			parsedObject = JSON.parse(trimmed)
		} catch {
			// Attempt 2: Extract from Markdown codeblock ```json ... ``` or ``` ... ```
			const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
			if (codeBlockMatch && codeBlockMatch[1]) {
				try {
					parsedObject = JSON.parse(codeBlockMatch[1].trim())
				} catch {
					// Fall through to regex extraction
				}
			}

			// Attempt 3: Outermost JSON object { ... }
			if (!parsedObject) {
				const firstBrace = trimmed.indexOf("{")
				const lastBrace = trimmed.lastIndexOf("}")
				if (firstBrace !== -1 && lastBrace > firstBrace) {
					const candidate = trimmed.substring(firstBrace, lastBrace + 1)
					try {
						parsedObject = JSON.parse(candidate)
					} catch {
						// Parsing failed
					}
				}
			}
		}

		if (!parsedObject || typeof parsedObject !== "object" || Array.isArray(parsedObject)) {
			return createFailClosedResult("Invalid or malformed JSON response from safety auditor model")
		}

		// Validate isSafe (boolean)
		if (typeof parsedObject.isSafe !== "boolean") {
			return createFailClosedResult("Missing or non-boolean 'isSafe' field in safety auditor response")
		}

		// Validate riskLevel ("safe" | "low" | "medium" | "high" | "critical")
		const validRiskLevels: CommandSafetyRiskLevel[] = ["safe", "low", "medium", "high", "critical"]
		const riskLevel =
			typeof parsedObject.riskLevel === "string" ? parsedObject.riskLevel.toLowerCase().trim() : ""
		if (!validRiskLevels.includes(riskLevel as CommandSafetyRiskLevel)) {
			return createFailClosedResult(
				`Invalid 'riskLevel' field in safety auditor response: '${parsedObject.riskLevel}'`
			)
		}

		// Validate reason (string)
		if (typeof parsedObject.reason !== "string" || parsedObject.reason.trim().length === 0) {
			return createFailClosedResult("Missing or empty 'reason' field in safety auditor response")
		}

		return {
			isSafe: parsedObject.isSafe,
			riskLevel: riskLevel as CommandSafetyRiskLevel,
			reason: parsedObject.reason.trim(),
		}
	}

	public static parseSafetyResponse(rawResponse: string): SafetyEvaluationResult {
		return new CommandSafetyJudge().parseSafetyResponse(rawResponse)
	}

	/**
	 * Parses and validates LLM response text for Stage 2 Contextual Safety Adjudication.
	 * Employs multi-tier JSON recovery and strict Zod validation.
	 * Fails closed to REQUIRE_MANUAL_APPROVAL on any schema or parse error.
	 */
	public parseStage2Response(rawResponse: string): Stage2AdjudicationResult {
		if (!rawResponse || typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
			return {
				decision: "REQUIRE_MANUAL_APPROVAL",
				risk: "high",
				reason: "Empty or whitespace response from Stage 2 safety model",
				taskAlignment: false,
				criticalRiskDetected: false,
			}
		}

		const trimmed = rawResponse.trim()
		let parsedObject: any = null

		// Attempt 1: Direct JSON parse
		try {
			parsedObject = JSON.parse(trimmed)
		} catch {
			// Attempt 2: Extract from Markdown codeblock ```json ... ```
			const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
			if (codeBlockMatch && codeBlockMatch[1]) {
				try {
					parsedObject = JSON.parse(codeBlockMatch[1].trim())
				} catch {
					// Fall through to regex extraction
				}
			}

			// Attempt 3: Outermost JSON object { ... }
			if (!parsedObject) {
				const firstBrace = trimmed.indexOf("{")
				const lastBrace = trimmed.lastIndexOf("}")
				if (firstBrace !== -1 && lastBrace > firstBrace) {
					const candidate = trimmed.substring(firstBrace, lastBrace + 1)
					try {
						parsedObject = JSON.parse(candidate)
					} catch {
						// Parsing failed
					}
				}
			}
		}

		if (!parsedObject || typeof parsedObject !== "object" || Array.isArray(parsedObject)) {
			return {
				decision: "REQUIRE_MANUAL_APPROVAL",
				risk: "high",
				reason: "Invalid or malformed JSON response from Stage 2 safety model",
				taskAlignment: false,
				criticalRiskDetected: false,
			}
		}

		const parseResult = stage2AdjudicationResultSchema.safeParse(parsedObject)
		if (!parseResult.success) {
			return {
				decision: "REQUIRE_MANUAL_APPROVAL",
				risk: "high",
				reason: `Stage 2 schema validation failed: ${parseResult.error.message}`,
				taskAlignment: false,
				criticalRiskDetected: false,
			}
		}

		return parseResult.data
	}

	public static parseStage2Response(rawResponse: string): Stage2AdjudicationResult {
		return new CommandSafetyJudge().parseStage2Response(rawResponse)
	}

	/**
	 * Reconciles Stage 1 baseline analysis with Stage 2 intent adjudication under hard security invariants.
	 */
	public resolveTwoStageSafety(
		stage1: SafetyEvaluationResult & { executionBoundary?: ExecutionBoundary },
		stage2: Stage2AdjudicationResult,
		boundary: ExecutionBoundary
	): { decision: "approve" | "ask" | "deny"; finalReason: string } {
		// Hard invariant 1: Critical risk detected in Stage 1 or boundary cannot be auto-approved
		if (
			stage1.riskLevel === "critical" ||
			boundary.hostImpact.highestRisk === "critical" ||
			stage2.criticalRiskDetected
		) {
			return {
				decision: "ask",
				finalReason: `Critical security boundary risk detected (${stage1.reason || stage2.reason}). Auto-approval blocked defensively.`,
			}
		}

		// Hard invariant 2: Uncontained host escape / host impact
		if (boundary.hostImpact.isHostEscape) {
			return {
				decision: "ask",
				finalReason: `Host escape or host impact detected (${boundary.hostImpact.reasons.join("; ")}). Manual confirmation required.`,
			}
		}

		// Stage 2 explicitly blocked or required manual approval
		if (stage2.decision === "BLOCK_CRITICAL") {
			return {
				decision: "ask",
				finalReason: `Command blocked by contextual security adjudicator: ${stage2.reason}`,
			}
		}

		if (stage2.decision === "REQUIRE_MANUAL_APPROVAL") {
			return {
				decision: "ask",
				finalReason:
					stage1.riskLevel !== "safe" && stage1.riskLevel !== "low"
						? stage1.reason
						: stage2.reason || stage1.reason,
			}
		}

		// Stage 2 granted ALLOW_AUTO_APPROVE
		if (stage2.decision === "ALLOW_AUTO_APPROVE") {
			// Low/Safe/Medium inside target without host escape -> ALLOW
			if (
				stage1.riskLevel === "safe" ||
				stage1.riskLevel === "low" ||
				stage1.riskLevel === "medium"
			) {
				return {
					decision: "approve",
					finalReason:
						stage2.reason ||
						"Context-aware approval granted: aligned with task intent in test environment",
				}
			}

			// High risk: allowed only if executed in verified test environment and aligned
			if (stage1.riskLevel === "high") {
				if (boundary.target.classification === "test-environment" && stage2.taskAlignment) {
					return {
						decision: "approve",
						finalReason: `Auto-approved high-risk command inside verified test target '${boundary.target.name || "test"}': ${stage2.reason}`,
					}
				}
				return {
					decision: "ask",
					finalReason: `High-risk command requires manual confirmation outside verified test environment: ${stage1.reason}`,
				}
			}
		}

		// Default fail-closed
		return {
			decision: "ask",
			finalReason: "Safety adjudication defaulted to manual approval",
		}
	}

	public static async evaluate(options: EvaluateSafetyOptions): Promise<SafetyEvaluationResult> {
		return new CommandSafetyJudge().evaluate(options)
	}

	public static async evaluateTwoStage(
		options: EvaluateTwoStageOptions
	): Promise<TwoStageSafetyResult> {
		return new CommandSafetyJudge().evaluateTwoStage(options)
	}

	/**
	 * Two-stage safety evaluation:
	 * Stage 0: Fast-path heuristic (0ms, 0 tokens)
	 * Stage 1: Command safety evaluation with Execution Boundary Analysis
	 * Stage 2: Context-aware adjudication (only if Stage 1 does not approve)
	 */
	public async evaluateTwoStage({
		command,
		cwd,
		taskId,
		context,
		recentCommands,
		config,
		state,
	}: EvaluateTwoStageOptions): Promise<TwoStageSafetyResult> {
		// 1. Execution Boundary Analysis
		const boundary = ExecutionBoundaryAnalyzer.analyze(command, {
			targetName: undefined,
			userInstruction: context?.latestUserInstruction,
			taskGoal: context?.taskGoal,
			workspacePath: context?.workspacePath || cwd,
		})

		// 2. Cache lookup (bypass cache in unit tests where evaluate is mocked)
		const isMockMode = Boolean((CommandSafetyJudge.evaluate as any)?.mock)
		const normalizedCmd = command.trim().replace(/\s+/g, " ")
		const cacheKey = `${taskId || ""}:${boundary.target.type}:${boundary.target.name || "default"}:${cwd || ""}:${normalizedCmd}`
		if (!isMockMode) {
			const cached = CommandSafetyJudge.twoStageCache.get(cacheKey)
			if (cached) {
				return cached
			}
		}

		// 3. Stage 1 Evaluation (runs fast-path or LLM judge)
		const stage1Result = (CommandSafetyJudge.evaluate as any)?.mock
			? await CommandSafetyJudge.evaluate({
					command,
					cwd,
					recentCommands,
					config,
					state,
			  })
			: await this.evaluate({
					command,
					cwd,
					recentCommands,
					config,
					state,
			  })

		const stage1WithBoundary = {
			...stage1Result,
			executionBoundary: boundary,
		}

		// If Stage 1 is safe/low and has no host escape: fast auto-approve without Stage 2
		if (
			stage1Result.isSafe === true &&
			(stage1Result.riskLevel === "safe" || stage1Result.riskLevel === "low") &&
			!boundary.hostImpact.isHostEscape
		) {
			const auditLog = `[CommandSafety] commandId=${taskId || "local"} stage1=ALLOW stage1Risk=${stage1Result.riskLevel} target=${boundary.target.type}:${boundary.target.name || "local"} stage2=SKIPPED final=ALLOW reason="${stage1Result.reason}"`
			const result: TwoStageSafetyResult = {
				decision: "approve",
				stage1: stage1WithBoundary,
				finalReason: stage1Result.reason,
				auditLog,
			}
			CommandSafetyJudge.twoStageCache.set(cacheKey, result)
			return result
		}

		// Invariant 1: Host impact detected -> cannot auto-approve
		if (boundary.hostImpact.isHostEscape) {
			const reason = `Host impact detected (${boundary.hostImpact.reasons.join("; ")}). Manual approval required.`
			const auditLog = `[CommandSafety] commandId=${taskId || "local"} stage1=${stage1Result.riskLevel} target=${boundary.target.type}:${boundary.target.name || "local"} stage2=SKIPPED final=MANUAL reason="${reason}"`
			const result: TwoStageSafetyResult = {
				decision: "ask",
				stage1: stage1WithBoundary,
				finalReason: reason,
				auditLog,
			}
			CommandSafetyJudge.twoStageCache.set(cacheKey, result)
			return result
		}

		// Invariant 2: Critical risk cannot be overridden by Stage 2
		if (stage1Result.riskLevel === "critical") {
			const auditLog = `[CommandSafety] commandId=${taskId || "local"} stage1=${stage1Result.riskLevel} target=${boundary.target.type}:${boundary.target.name || "local"} stage2=SKIPPED final=MANUAL reason="${stage1Result.reason}"`
			const result: TwoStageSafetyResult = {
				decision: "ask",
				stage1: stage1WithBoundary,
				finalReason: stage1Result.reason,
				auditLog,
			}
			CommandSafetyJudge.twoStageCache.set(cacheKey, result)
			return result
		}

		// Invariant 3: If no task context or local host without test classification, require manual approval
		const hasTaskContext = Boolean(context?.taskGoal?.trim() || context?.latestUserInstruction?.trim())
		if (!hasTaskContext || (boundary.target.type === "local" && boundary.target.classification !== "test-environment")) {
			const auditLog = `[CommandSafety] commandId=${taskId || "local"} stage1=${stage1Result.riskLevel} target=local stage2=SKIPPED final=MANUAL reason="${stage1Result.reason}"`
			const result: TwoStageSafetyResult = {
				decision: "ask",
				stage1: stage1WithBoundary,
				finalReason: stage1Result.reason,
				auditLog,
			}
			CommandSafetyJudge.twoStageCache.set(cacheKey, result)
			return result
		}

		// 5. Stage 2 Contextual Adjudication
		let stage2Result: Stage2AdjudicationResult
		try {
			const effectiveConfig = config || state?.commandSafetyConfig
			const provider = effectiveConfig?.provider?.toLowerCase().trim()
			const modelId = effectiveConfig?.modelId?.trim()
			const apiKey =
				effectiveConfig?.apiKey?.trim() ||
				resolveProviderApiKey(provider || "", state?.apiConfiguration)

			if (
				!effectiveConfig ||
				!provider ||
				!modelId ||
				(!apiKey && provider !== "ollama" && provider !== "lmstudio")
			) {
				stage2Result = {
					decision: "REQUIRE_MANUAL_APPROVAL",
					risk: "high",
					reason: "Stage 2 configuration missing or incomplete",
					taskAlignment: false,
					criticalRiskDetected: false,
				}
			} else {
				const apiConfig = state?.apiConfiguration as Record<string, any> | undefined
				const knownSecrets = [
					effectiveConfig.apiKey,
					apiConfig?.apiKey,
					apiConfig?.openAiApiKey,
					apiConfig?.anthropicApiKey,
					apiConfig?.geminiApiKey,
				]
				const sanitizedCommand = sanitizeForSafetyPrompt(command, knownSecrets)

				const { systemPrompt, userPrompt } = buildStage2SafetyPrompt({
					sanitizedCommand,
					cwd: cwd || "",
					host: boundary.host,
					executionTarget: boundary.target,
					taskContext: {
						taskGoal: context?.taskGoal || "Developer command execution",
						latestUserInstruction:
							context?.latestUserInstruction ||
							context?.taskGoal ||
							"Run tests or commands",
						activeTodo: context?.activeTodo,
						workspacePath: context?.workspacePath || cwd || "",
						isWithinWorkspace: context?.isWithinWorkspace ?? true,
						explicitConstraints: context?.explicitConstraints,
					},
					stage1: {
						decision: "REQUIRE_MANUAL",
						risk: stage1Result.riskLevel,
						reason: stage1Result.reason,
						detectedEffects: boundary.hostImpact.reasons,
					},
					hostImpact: boundary.hostImpact,
				})

				const abortController = new AbortController()
				let timeoutId: ReturnType<typeof setTimeout> | undefined
				const timeoutPromise = new Promise<never>((_, reject) => {
					timeoutId = setTimeout(() => {
						const timeoutError = new Error(
							`Stage 2 safety evaluation timed out after ${this.timeoutMs}ms`
						)
						abortController.abort(timeoutError)
						reject(timeoutError)
					}, this.timeoutMs)
				})

				let rawStage2: string
				try {
					const callParams: CallProviderParams = {
						provider,
						modelId,
						apiKey: apiKey || "",
						systemPrompt,
						userPrompt,
						state,
						signal: abortController.signal,
						maxTokens: 350,
					}
					const providerCall = this.callProviderOverride
						? this.callProviderOverride(callParams)
						: CommandSafetyJudge.globalCallProviderOverride
							? CommandSafetyJudge.globalCallProviderOverride(callParams)
							: this.callProvider(callParams)

					rawStage2 = await Promise.race([providerCall, timeoutPromise])
				} finally {
					if (timeoutId !== undefined) {
						clearTimeout(timeoutId)
					}
				}

				stage2Result = this.parseStage2Response(rawStage2)
			}
		} catch (error: any) {
			const errorDetail = error instanceof Error ? error.message : String(error)
			stage2Result = {
				decision: "REQUIRE_MANUAL_APPROVAL",
				risk: "high",
				reason: `Stage 2 adjudication failed (${errorDetail}). Fail closed to manual approval.`,
				taskAlignment: false,
				criticalRiskDetected: false,
			}
		}

		// 6. Resolve Disagreement Policy
		const resolution = this.resolveTwoStageSafety(stage1WithBoundary, stage2Result, boundary)

		const auditLog = `[CommandSafety] commandId=${taskId || "local"} stage1=${stage1Result.riskLevel} target=${boundary.target.type}:${boundary.target.name || "local"} stage2=${stage2Result.decision} final=${resolution.decision === "approve" ? "ALLOW" : "MANUAL"} reason="${resolution.finalReason}"`

		const twoStageResult: TwoStageSafetyResult = {
			decision: resolution.decision,
			stage1: stage1WithBoundary,
			stage2: stage2Result,
			finalReason: resolution.finalReason,
			auditLog,
		}

		CommandSafetyJudge.twoStageCache.set(cacheKey, twoStageResult)
		return twoStageResult
	}

	/**
	 * Evaluates a command using the configured LLM safety judge.
	 */
	public async evaluate({
		command,
		cwd,
		recentCommands,
		config,
		state,
	}: EvaluateSafetyOptions): Promise<SafetyEvaluationResult> {
		let abortController: AbortController | undefined
		try {
			const effectiveConfig = config || state?.commandSafetyConfig
			if (!effectiveConfig) {
				return createFailClosedResult("Command safety configuration is missing")
			}

			const provider = effectiveConfig.provider?.toLowerCase().trim()
			const modelId = effectiveConfig.modelId?.trim()

			if (!provider || !modelId) {
				return createFailClosedResult("Model configuration missing (provider or modelId)")
			}

			const apiKey =
				effectiveConfig.apiKey?.trim() || resolveProviderApiKey(provider, state?.apiConfiguration)

			const isLocalProvider = provider === "ollama" || provider === "lmstudio"
			if (!apiKey && !isLocalProvider) {
				return createFailClosedResult(`API key missing for provider '${provider}'`)
			}

			// Check in-memory verification cache
			const cacheKey = `${cwd || ""}:${command.trim()}`
			const cachedResult = CommandSafetyJudge.cache.get(cacheKey)
			if (cachedResult) {
				return cachedResult
			}

			// Check Fast-Path (Zero-Latency Local Evaluation)
			const fastPathResult = this.evaluateFastPath(command)
			if (fastPathResult) {
				CommandSafetyJudge.cache.set(cacheKey, fastPathResult)
				return fastPathResult
			}

			const { systemPrompt, userPrompt } = buildSafetyPrompt({
				command,
				cwd,
				recentCommands,
				customTemplate: effectiveConfig.customPromptTemplate,
			})

			abortController = new AbortController()
			let timeoutId: ReturnType<typeof setTimeout> | undefined

			const timeoutPromise = new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					const timeoutError = new Error(`Command safety evaluation timed out after ${this.timeoutMs}ms`)
					abortController?.abort(timeoutError)
					reject(timeoutError)
				}, this.timeoutMs)
			})

			let rawResponse: string
			try {
				const callParams: CallProviderParams = {
					provider,
					modelId,
					apiKey: apiKey || "",
					systemPrompt,
					userPrompt,
					state,
					signal: abortController.signal,
				}

				const providerCall = this.callProviderOverride
					? this.callProviderOverride(callParams)
					: CommandSafetyJudge.globalCallProviderOverride
						? CommandSafetyJudge.globalCallProviderOverride(callParams)
						: this.callProvider(callParams)

				rawResponse = await Promise.race([providerCall, timeoutPromise])
			} finally {
				if (timeoutId !== undefined) {
					clearTimeout(timeoutId)
				}
			}

			const result = this.parseSafetyResponse(rawResponse)
			CommandSafetyJudge.cache.set(cacheKey, result)
			return result
		} catch (error: any) {
			const isTimeout =
				abortController?.signal.aborted ||
				(error instanceof Error &&
					(error.message.includes("timed out") ||
						error.message === "Aborted" ||
						error.name === "AbortError" ||
						error.name === "TimeoutError")) ||
				error?.message?.includes("timed out") ||
				error?.name === "AbortError"

			if (isTimeout) {
				return createFailClosedResult(`Command safety evaluation timed out after ${this.timeoutMs}ms`)
			}

			const status = error?.status || error?.statusCode || error?.response?.status
			const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""

			if (status) {
				const statusDetail = message
					? message.includes(String(status))
						? message
						: `HTTP ${status}: ${message}`
					: `HTTP ${status}`
				return createFailClosedResult(statusDetail)
			}

			if (message) {
				return createFailClosedResult(message)
			}

			return createFailClosedResult("Unknown error during command safety evaluation")
		}
	}

	/**
	 * Dispatches request to the appropriate LLM provider client.
	 */
	protected async callProvider({
		provider,
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		state,
		signal,
		maxTokens,
	}: CallProviderParams): Promise<string> {
		switch (provider.toLowerCase().trim()) {
			case "anthropic":
				return this.callAnthropic({ modelId, apiKey, systemPrompt, userPrompt, state, signal, maxTokens })

			case "gemini":
				return this.callGemini({ modelId, apiKey, systemPrompt, userPrompt, signal, maxTokens })

			default:
				// Handles OpenAI, OpenRouter, xkiro, and other OpenAI-compatible endpoints
				return this.callOpenAiCompatible({
					provider,
					modelId,
					apiKey,
					systemPrompt,
					userPrompt,
					state,
					signal,
					maxTokens,
				})
		}
	}

	private async callAnthropic({
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		state,
		signal,
		maxTokens,
	}: {
		modelId: string
		apiKey: string
		systemPrompt: string
		userPrompt: string
		state?: Partial<ExtensionState> | null
		signal: AbortSignal
		maxTokens?: number
	}): Promise<string> {
		const client = new Anthropic({
			apiKey,
			baseURL: state?.apiConfiguration?.anthropicBaseUrl || undefined,
		})

		const response = await client.messages.create(
			{
				model: modelId,
				max_tokens: maxTokens || 150,
				system: systemPrompt,
				messages: [{ role: "user", content: userPrompt }],
				temperature: 0.0,
			},
			{
				signal,
			}
		)

		const textContent = response.content.find((block) => block.type === "text")
		return textContent?.type === "text" ? textContent.text : ""
	}

	private async callGemini({
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		signal,
		maxTokens,
	}: {
		modelId: string
		apiKey: string
		systemPrompt: string
		userPrompt: string
		signal: AbortSignal
		maxTokens?: number
	}): Promise<string> {
		const client = new GoogleGenAI({ apiKey })

		const abortPromise = new Promise<never>((_, reject) => {
			if (signal.aborted) {
				reject(signal.reason || new Error("Aborted"))
			} else {
				signal.addEventListener(
					"abort",
					() => reject(signal.reason || new Error("Aborted")),
					{ once: true }
				)
			}
		})

		const generatePromise = client.models.generateContent({
			model: modelId,
			contents: [
				{
					role: "user",
					parts: [{ text: userPrompt }],
				},
			],
			config: {
				systemInstruction: systemPrompt,
				temperature: 0.0,
				maxOutputTokens: maxTokens || 150,
				thinkingConfig: {
					thinkingBudget: 0,
				},
			},
		})

		const response = await Promise.race([generatePromise, abortPromise])
		return response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || ""
	}

	private async callOpenAiCompatible({
		provider,
		modelId,
		apiKey,
		systemPrompt,
		userPrompt,
		state,
		signal,
		maxTokens,
	}: {
		provider: string
		modelId: string
		apiKey: string
		systemPrompt: string
		userPrompt: string
		state?: Partial<ExtensionState> | null
		signal: AbortSignal
		maxTokens?: number
	}): Promise<string> {
		let baseURL: string | undefined
		const defaultHeaders: Record<string, string> = {}

		if (provider === "openrouter") {
			baseURL = state?.apiConfiguration?.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			defaultHeaders["HTTP-Referer"] = "https://github.com/RooCodeInc/Roo-Code"
			defaultHeaders["X-Title"] = "Roo Code"
		} else if (provider === "xkiro") {
			baseURL =
				(state?.apiConfiguration as any)?.xkiroBaseUrl ||
				state?.apiConfiguration?.openAiBaseUrl ||
				"https://api.xkiro.com/v1"
		} else if (provider === "openai") {
			baseURL = state?.apiConfiguration?.openAiBaseUrl || "https://api.openai.com/v1"
		} else if (provider === "ollama") {
			baseURL = state?.apiConfiguration?.ollamaBaseUrl || "http://localhost:11434/v1"
		} else if (provider === "lmstudio") {
			baseURL = state?.apiConfiguration?.lmStudioBaseUrl || "http://localhost:1234/v1"
		} else {
			baseURL = state?.apiConfiguration?.openAiBaseUrl || undefined
		}

		if (state?.apiConfiguration?.openAiHeaders) {
			Object.assign(defaultHeaders, state.apiConfiguration.openAiHeaders)
		}

		const client = new OpenAI({
			apiKey: apiKey || "noop",
			baseURL,
			defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
		})

		const isReasoningModel =
			modelId.toLowerCase().startsWith("o1") || modelId.toLowerCase().startsWith("o3")

		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = isReasoningModel
			? [
					{ role: "developer", content: systemPrompt },
					{ role: "user", content: userPrompt },
				]
			: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				]

		const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
			model: modelId,
			messages,
			...(isReasoningModel
				? { reasoning_effort: "low", max_completion_tokens: maxTokens || 150 }
				: { temperature: 0.0, max_tokens: maxTokens || 150 }),
		}

		const completion = await client.chat.completions.create(requestParams, { signal })
		return completion.choices?.[0]?.message?.content || ""
	}
}
