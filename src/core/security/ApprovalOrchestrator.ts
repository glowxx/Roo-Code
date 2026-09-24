import type {
	UnifiedApprovalRequest,
	ApprovalDecisionResult,
	CommandSafetyConfig,
	CommandSafetyRiskLevel,
	ProviderSettings,
	ExtensionState,
	DecisionLogEntry,
} from "@roo-code/types"
import {
	approvalDecisionResultSchema,
	completionJudgeResponseSchema,
	isSafetyModelConfigured,
	resolveProviderApiKey,
	VerifierFailureCategory,
} from "@roo-code/types"
import { CommandSafetyJudge, DEFAULT_TIMEOUT_MS } from "./CommandSafetyJudge"
import { ExecutionBoundaryAnalyzer } from "./ExecutionBoundaryAnalyzer"
import { containsDangerousSubstitution } from "../auto-approval/commands"
import {
	buildAutonomousApprovalPrompt,
	buildCompletionJudgePrompt,
	sanitizeForSafetyPrompt,
} from "./safetyPromptTemplate"
import { DecisionLogStore } from "./DecisionLogStore"

export interface ApprovalOrchestratorOptions {
	timeoutMs?: number
	judge?: CommandSafetyJudge
}

export function classifyVerifierError(error: any): VerifierFailureCategory {
	if (!error) return VerifierFailureCategory.OTHER_TRANSIENT
	const status = error.status || error.statusCode || error.response?.status
	const msg = (error.message || "").toLowerCase()

	if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("resource_exhausted")) {
		return VerifierFailureCategory.RATE_LIMIT
	}
	if (
		status === 402 ||
		msg.includes("quota") ||
		msg.includes("credits") ||
		msg.includes("insufficient_quota") ||
		msg.includes("billing") ||
		msg.includes("free quota") ||
		msg.includes("exceeded your current quota")
	) {
		return VerifierFailureCategory.FREE_QUOTA_EXHAUSTED
	}
	if (status === 401 || status === 403 || msg.includes("unauthorized") || msg.includes("invalid api key") || msg.includes("forbidden")) {
		return VerifierFailureCategory.AUTH
	}
	if (status === 404 || msg.includes("model not found") || msg.includes("does not exist") || msg.includes("invalid model")) {
		return VerifierFailureCategory.INVALID_MODEL
	}
	if (
		status === 502 ||
		status === 503 ||
		status === 504 ||
		status === 529 ||
		msg.includes("service unavailable") ||
		msg.includes("bad gateway") ||
		msg.includes("overloaded")
	) {
		return VerifierFailureCategory.MODEL_UNAVAILABLE
	}
	if (
		error.name === "AbortError" ||
		msg.includes("timed out") ||
		msg.includes("timeout") ||
		msg.includes("etimedout")
	) {
		return VerifierFailureCategory.TIMEOUT
	}
	if (
		msg.includes("econnrefused") ||
		msg.includes("enotfound") ||
		msg.includes("network") ||
		msg.includes("fetch failed")
	) {
		return VerifierFailureCategory.NETWORK
	}
	return VerifierFailureCategory.OTHER_TRANSIENT
}

export function isTransientVerifierError(category: VerifierFailureCategory): boolean {
	return (
		category === VerifierFailureCategory.RATE_LIMIT ||
		category === VerifierFailureCategory.MODEL_UNAVAILABLE ||
		category === VerifierFailureCategory.TIMEOUT ||
		category === VerifierFailureCategory.NETWORK ||
		category === VerifierFailureCategory.OTHER_TRANSIENT
	)
}

export interface VerifierCandidate {
	tier: "primary" | "secondary" | "worker_fallback"
	provider: string
	modelId: string
	apiKey: string
}

export class ApprovalOrchestrator {
	private readonly timeoutMs: number
	private readonly judge: CommandSafetyJudge

	constructor(options?: ApprovalOrchestratorOptions) {
		this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.judge = options?.judge ?? new CommandSafetyJudge({ timeoutMs: this.timeoutMs })
	}

	public getVerifierCandidates(state?: Partial<ExtensionState> | null): VerifierCandidate[] {
		const candidates: VerifierCandidate[] = []
		const approvalConfig = state?.commandSafetyConfig
		if (!approvalConfig) return candidates

		// 1. Primary
		const primaryProvider = (approvalConfig.provider || "").toLowerCase().trim()
		const primaryModelId = (approvalConfig.modelId || "").trim()
		const primaryApiKey = approvalConfig.apiKey || resolveProviderApiKey(primaryProvider, state?.apiConfiguration) || ""
		if (primaryProvider && primaryModelId) {
			candidates.push({
				tier: "primary",
				provider: primaryProvider,
				modelId: primaryModelId,
				apiKey: primaryApiKey,
			})
		}

		// 2. Secondary (if configured)
		const secProvider = (approvalConfig.secondaryProvider || "").toLowerCase().trim()
		const secModelId = (approvalConfig.secondaryModelId || "").trim()
		const secApiKey = approvalConfig.secondaryApiKey || resolveProviderApiKey(secProvider, state?.apiConfiguration) || ""
		if (secProvider && secModelId) {
			candidates.push({
				tier: "secondary",
				provider: secProvider,
				modelId: secModelId,
				apiKey: secApiKey,
			})
		}

		// 3. Worker Fallback (only if explicit policy allows)
		if (approvalConfig.allowWorkerFallback && state?.apiConfiguration) {
			const workerProvider = (state.apiConfiguration.apiProvider || "").toLowerCase().trim()
			const workerModelId = (state.apiConfiguration.apiModelId || "").trim()
			const workerApiKey = resolveProviderApiKey(workerProvider, state.apiConfiguration) || state.apiConfiguration.apiKey || ""
			if (workerProvider && workerModelId) {
				candidates.push({
					tier: "worker_fallback",
					provider: workerProvider,
					modelId: workerModelId,
					apiKey: workerApiKey,
				})
			}
		}

		return candidates
	}

	public async executeWithFallback(params: {
		systemPrompt: string
		userPrompt: string
		state: Partial<ExtensionState>
		maxTokens?: number
	}): Promise<{
		rawResponse: string | null
		usedCandidate: VerifierCandidate | null
		lastError: Error | null
		lastCategory: VerifierFailureCategory
		attempts: number
	}> {
		const candidates = this.getVerifierCandidates(params.state)
		let totalAttempts = 0
		let lastError: Error | null = null
		let lastCategory: VerifierFailureCategory = VerifierFailureCategory.OTHER_TRANSIENT

		for (const candidate of candidates) {
			let systemPrompt = params.systemPrompt
			if (candidate.tier === "worker_fallback") {
				systemPrompt =
					"You are acting strictly as an independent external security auditor. Evaluate the following proposed action without reference to any previous reasoning. Provide an objective, unbiased verification assessment.\n\n" +
					systemPrompt
			}

			let candidateAttempts = 0
			const maxAttemptsForCandidate = 2

			while (candidateAttempts < maxAttemptsForCandidate) {
				candidateAttempts++
				totalAttempts++
				const currentTimeout = candidateAttempts === 1 ? this.timeoutMs : 30000
				const abortController = new AbortController()
				let timeoutId: NodeJS.Timeout | undefined

				const timeoutPromise = new Promise<never>((_, reject) => {
					timeoutId = setTimeout(() => {
						const timeoutError = new Error(`Approval AI evaluation timed out after ${currentTimeout}ms`)
						abortController.abort(timeoutError)
						reject(timeoutError)
					}, currentTimeout)
				})

				try {
					const callParams = {
						provider: candidate.provider,
						modelId: candidate.modelId,
						apiKey: candidate.apiKey,
						systemPrompt,
						userPrompt: params.userPrompt,
						state: params.state,
						signal: abortController.signal,
						maxTokens: params.maxTokens ?? 350,
					}

					const providerCall = CommandSafetyJudge.globalCallProviderOverride
						? CommandSafetyJudge.globalCallProviderOverride(callParams)
						: this.judge.callProvider(callParams)

					const rawResponse = await Promise.race([providerCall, timeoutPromise])
					if (timeoutId) clearTimeout(timeoutId)
					return {
						rawResponse,
						usedCandidate: candidate,
						lastError: null,
						lastCategory: VerifierFailureCategory.OTHER_TRANSIENT,
						attempts: totalAttempts,
					}
				} catch (error: any) {
					if (timeoutId) clearTimeout(timeoutId)
					lastError = error instanceof Error ? error : new Error(String(error))
					lastCategory = classifyVerifierError(lastError)

					if (!isTransientVerifierError(lastCategory)) {
						break
					}
				}
			}
		}

		return {
			rawResponse: null,
			usedCandidate: null,
			lastError,
			lastCategory,
			attempts: totalAttempts,
		}
	}

	/**
	 * Validates the core architectural invariant:
	 * WORKER MODEL != APPROVAL AUTHORITY
	 *
	 * Returns false if the worker model and approval model are identical,
	 * preventing the worker from approving its own actions.
	 */
	public validateAuthoritySeparation(
		workerConfig?: ProviderSettings | null,
		approvalConfig?: CommandSafetyConfig | null
	): boolean {
		if (!approvalConfig || !approvalConfig.enabled) {
			return true
		}

		const workerModel = (workerConfig?.apiModelId || "").toLowerCase().trim()
		const approvalModel = (approvalConfig?.modelId || "").toLowerCase().trim()
		const workerProvider = (workerConfig?.apiProvider || "").toLowerCase().trim()
		const approvalProvider = (approvalConfig?.provider || "").toLowerCase().trim()

		if (
			workerModel &&
			approvalModel &&
			workerModel === approvalModel &&
			workerProvider &&
			approvalProvider &&
			workerProvider === approvalProvider
		) {
			return false
		}

		return true
	}

	/**
	 * Evaluates an approval request within the autonomous runtime.
	 *
	 * Decision Hierarchy:
	 * 1. Authority Separation Guard (Collusion Check) -> Fail-closed if worker == approval
	 * 2. Deterministic Fast-Path (0ms, 0 tokens) -> ALLOW_AUTO or HARD_BLOCK
	 * 3. Execution Boundary & Blast Radius Analysis -> HARD_BLOCK on uncontained host escapes
	 * 4. Contextual AI Adjudication (Independent Model) -> ALLOW_AUTO / DENY_AND_REPLAN / HARD_BLOCK
	 * 5. Fail-Closed Fallback -> MANUAL_APPROVAL (never fallback to worker model)
	 */
	public async evaluate(
		request: UnifiedApprovalRequest,
		state?: Partial<ExtensionState> | null
	): Promise<ApprovalDecisionResult> {
		const approvalConfig = state?.commandSafetyConfig
		const workerConfig = state?.apiConfiguration
		const taskId = request.taskId || "unknown"

		// 1. Anti-Collusion Check
		const isSeparated = this.validateAuthoritySeparation(workerConfig, approvalConfig)
		if (!isSeparated) {
			const reason = `AI Collusion Hazard: Configured Approval Authority model ('${approvalConfig?.modelId}') is identical to Worker Model. Self-approval is forbidden. Manual approval required.`
			const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=auto fastPath=true approvalModelCalled=false finalDecision=MANUAL_APPROVAL reason="${reason}"`
			const result: ApprovalDecisionResult = {
				decision: "MANUAL_APPROVAL",
				risk: "critical",
				reason,
				taskAligned: false,
				hardBoundaryViolation: true,
				auditLog,
			}
			this.recordDecision(request, result, approvalConfig?.modelId, true, state)
			return result
		}

		// 2. Command-specific Execution Boundary Analysis (intercept boundary escapes first)
		if (request.actionType === "execute_command" && request.target.command) {
			const boundaryResult = this.evaluateCommandBoundary(request)
			if (boundaryResult) {
				const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=auto fastPath=true approvalModelCalled=false finalDecision=${boundaryResult.decision} reason="${boundaryResult.reason}"`
				const result: ApprovalDecisionResult = {
					...boundaryResult,
					auditLog,
				}
				this.recordDecision(request, result, approvalConfig?.modelId, true, state)
				return result
			}
		}

		// 3. Deterministic Fast-Path Evaluation
		const fastPathResult = this.evaluateDeterministicFastPath(request)
		if (fastPathResult) {
			const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=auto fastPath=true approvalModelCalled=false finalDecision=${fastPathResult.decision} reason="${fastPathResult.reason}"`
			const result: ApprovalDecisionResult = {
				...fastPathResult,
				auditLog,
			}
			this.recordDecision(request, result, approvalConfig?.modelId, true, state)
			return result
		}

		// 4. Contextual AI Adjudication via Independent Approval Model
		const isConfigured = isSafetyModelConfigured(state)
		if (!isConfigured) {
			const reason =
				request.actionType === "attempt_completion"
					? "Approval Model is not configured or lacks API key to verify task completion criteria. Manual approval required."
					: "Approval Model is not configured or lacks API key. Manual approval required."
			const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=auto fastPath=false approvalModelCalled=false finalDecision=MANUAL_APPROVAL reason="${reason}"`
			const result: ApprovalDecisionResult = {
				decision: "MANUAL_APPROVAL",
				risk: "high",
				reason,
				taskAligned: false,
				auditLog,
			}
			this.recordDecision(request, result, undefined, false, state)
			return result
		}

		if (request.actionType === "attempt_completion") {
			return await this.evaluateCompletionWithApprovalAi(request, state!)
		}

		return await this.evaluateWithApprovalAi(request, state!)
	}

	/**
	 * Fast-path heuristic evaluation (0ms, 0 tokens).
	 */
	private evaluateDeterministicFastPath(
		request: UnifiedApprovalRequest
	): Omit<ApprovalDecisionResult, "auditLog"> | null {
		const { actionType, target } = request

		// Attempt completion deterministic gates
		if (actionType === "attempt_completion") {
			// Gate 1: Check unresolved denial state
			if (target.unresolvedDenialState) {
				return {
					decision: "CONTINUE_WORK",
					risk: "high",
					reason: `Cannot complete task: previous action was rejected by safety policy (${target.unresolvedDenialState.reason}) and no safe alternative was executed.`,
					taskAligned: false,
					replanGuidance: target.unresolvedDenialState.replanGuidance,
					unresolvedItems: [
						{
							type: "unresolved_safety_denial",
							content: `Rejected action: ${target.unresolvedDenialState.actionType} (${target.unresolvedDenialState.reason})`,
							guidance: target.unresolvedDenialState.replanGuidance || "Execute a safe alternative first.",
						},
					],
				}
			}

			// Gate 2: Check in-flight background terminals / running tests
			if (target.activeTerminalsCount && target.activeTerminalsCount > 0) {
				return {
					decision: "CONTINUE_WORK",
					risk: "medium",
					reason: `Cannot complete task: ${target.activeTerminalsCount} background terminal process(es) or tests are still executing.`,
					taskAligned: false,
					unresolvedItems: [
						{
							type: "active_process",
							content: `${target.activeTerminalsCount} terminal process(es) still active`,
							guidance: "Wait for background execution/tests to finish.",
						},
					],
				}
			}

			// Gate 3: Check in_progress TODOs
			const inProgress = target.todoListSnapshot?.filter((t) => t.status === "in_progress") || []
			if (inProgress.length > 0) {
				return {
					decision: "CONTINUE_WORK",
					risk: "medium",
					reason: `Cannot complete task with ${inProgress.length} item(s) marked 'in_progress' on the todo list.`,
					taskAligned: false,
					unresolvedItems: inProgress.map((t) => ({
						type: "in_progress_todo",
						content: t.content,
						guidance: "Finish this in-progress item before attempting completion.",
					})),
				}
			}

			// Gate 4: Check pending TODOs
			const pending = target.todoListSnapshot?.filter((t) => t.status === "pending") || []
			if (pending.length > 0) {
				return {
					decision: "CONTINUE_WORK",
					risk: "medium",
					reason: `Task still contains ${pending.length} pending item(s) on the todo list.`,
					taskAligned: false,
					unresolvedItems: pending.map((t) => ({
						type: "pending_todo",
						content: t.content,
						guidance: "Complete pending item or update todo list if no longer applicable.",
					})),
				}
			}

			// Gate 5: If there are explicit completion criteria, delegate to AI Completion Judge
			if (target.completionCriteria && target.completionCriteria.length > 0) {
				return null // Delegate to independent AI Completion Judge
			}

			// If no open work, no pending/in-progress todos, no running terminals, and no explicit criteria
			return {
				decision: "ALLOW_AUTO",
				risk: "safe",
				reason: "All required work and todos resolved.",
				taskAligned: true,
			}
		}

		// Read-only file inspection inside workspace is guaranteed safe
		if (
			actionType === "read_file" &&
			!target.isOutsideWorkspace
		) {
			return {
				decision: "ALLOW_AUTO",
				risk: "safe",
				reason: "Routine read-only inspection in active workspace",
				taskAligned: true,
			}
		}

		// Safe mode switches and subtasks
		if (actionType === "switch_mode" || actionType === "new_task") {
			return {
				decision: "ALLOW_AUTO",
				risk: "safe",
				reason: "Internal workflow transition",
				taskAligned: true,
			}
		}

		// File modifications
		if (actionType === "write_to_file" || actionType === "replace_file_content") {
			// Hard-block writes to protected files (rules, configs, keys)
			if (target.isProtected) {
				return {
					decision: "HARD_BLOCK",
					risk: "critical",
					reason: "Target file is protected by safety policy (configuration, instructions, or credentials).",
					taskAligned: false,
					hardBoundaryViolation: true,
					replanGuidance: "Do not attempt to modify protected project configuration or agent rules files. Work within project source code.",
				}
			}

			// Hard-block writes outside workspace in autonomous mode
			if (target.isOutsideWorkspace) {
				return {
					decision: "HARD_BLOCK",
					risk: "high",
					reason: "Target path is outside the active workspace directory.",
					taskAligned: false,
					hardBoundaryViolation: true,
					replanGuidance: "Restrict all file modifications to the current workspace root.",
				}
			}

			// Normal scoped writes within workspace are safe for autonomous work
			return {
				decision: "ALLOW_AUTO",
				risk: "low",
				reason: "File modification scoped within active workspace",
				taskAligned: true,
			}
		}

		// Command fast-paths
		if (actionType === "execute_command" && target.command) {
			const cmd = target.command.trim()

			// Block dangerous parameter expansions immediately
			if (containsDangerousSubstitution(cmd)) {
				return {
					decision: "HARD_BLOCK",
					risk: "critical",
					reason: "Command contains dangerous parameter substitution or code injection patterns.",
					taskAligned: false,
					hardBoundaryViolation: true,
					replanGuidance: "Use simple standard command arguments without dangerous parameter expansions.",
				}
			}

			// Check standard safe read-only/build commands
			const fastPath = CommandSafetyJudge.evaluateFastPath(cmd)
			if (fastPath && fastPath.isSafe) {
				return {
					decision: "ALLOW_AUTO",
					risk: fastPath.riskLevel,
					reason: fastPath.reason,
					taskAligned: true,
				}
			}
		}

		return null
	}

	/**
	 * Decomposes command execution boundaries and checks for host escapes.
	 */
	private evaluateCommandBoundary(
		request: UnifiedApprovalRequest
	): Omit<ApprovalDecisionResult, "auditLog"> | null {
		const cmd = request.target.command || ""
		const boundary = ExecutionBoundaryAnalyzer.analyze(cmd, {
			userInstruction: request.taskContext.latestUserInstruction,
			taskGoal: request.taskContext.activeGoal,
			workspacePath: request.taskContext.workspacePath,
		})

		request.executionBoundary = boundary

		// Invariant: Uncontained host impact or boundary escape -> DENY_AND_REPLAN or HARD_BLOCK
		if (boundary.hostImpact.isHostEscape) {
			const reasons = boundary.hostImpact.reasons.join("; ")
			return {
				decision: "DENY_AND_REPLAN",
				risk: (boundary.hostImpact.highestRisk === "none" ? "low" : boundary.hostImpact.highestRisk) as CommandSafetyRiskLevel,
				reason: `Command attempts Windows host modification or escape from guest sandbox (${reasons}).`,
				taskAligned: false,
				hardBoundaryViolation: true,
				replanGuidance: "Confine operations strictly inside the guest environment filesystem. Do not access host mounts (/mnt/c) or execute host binaries.",
			}
		}

		return null
	}

	/**
	 * Evaluates complex or context-dependent actions using the independent Approval Model.
	 */
	private async evaluateWithApprovalAi(
		request: UnifiedApprovalRequest,
		state: Partial<ExtensionState>
	): Promise<ApprovalDecisionResult> {
		const approvalConfig = state.commandSafetyConfig!
		const provider = approvalConfig.provider.toLowerCase().trim()
		const modelId = approvalConfig.modelId.trim()
		const apiKey = approvalConfig.apiKey || resolveProviderApiKey(provider, state.apiConfiguration) || ""
		const taskId = request.taskId || "unknown"

		// Extract known secrets for redaction
		const knownSecrets = [
			apiKey,
			state.apiConfiguration?.apiKey,
			state.apiConfiguration?.openAiApiKey,
			state.apiConfiguration?.geminiApiKey,
			state.apiConfiguration?.openRouterApiKey,
		]

		const sanitizedTarget = this.sanitizeTarget(request.target, knownSecrets)

		const { systemPrompt, userPrompt } = buildAutonomousApprovalPrompt({
			actionType: request.actionType,
			target: sanitizedTarget,
			executionBoundary: request.executionBoundary as any,
			taskContext: {
				latestUserInstruction: sanitizeForSafetyPrompt(request.taskContext.latestUserInstruction, knownSecrets),
				activeGoal: sanitizeForSafetyPrompt(request.taskContext.activeGoal, knownSecrets),
				currentStep: request.taskContext.currentStep
					? sanitizeForSafetyPrompt(request.taskContext.currentStep, knownSecrets)
					: undefined,
				explicitConstraints: request.taskContext.explicitConstraints?.map((c) =>
					sanitizeForSafetyPrompt(c, knownSecrets)
				),
				workspacePath: request.taskContext.workspacePath,
				isWithinWorkspace: request.taskContext.isWithinWorkspace,
			},
			stage1Risk: request.executionBoundary?.hostImpact.highestRisk,
			stage1Reason: request.executionBoundary?.hostImpact.reasons.join("; "),
			previousDenial: request.previousDenial,
		})

		const execResult = await this.executeWithFallback({
			systemPrompt,
			userPrompt,
			state,
			maxTokens: 350,
		})

		if (execResult.rawResponse !== null && execResult.usedCandidate) {
			const parsed = this.parseApprovalResponse(execResult.rawResponse)
			const retryText = execResult.attempts > 1 ? ` retry=true attempt=${execResult.attempts}` : ""
			const tierText = execResult.usedCandidate.tier !== "primary" ? ` tier=${execResult.usedCandidate.tier}` : ""
			const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=${state.approvalMode} fastPath=false approvalModelCalled=true approvalModel=${execResult.usedCandidate.modelId}${tierText}${retryText} finalDecision=${parsed.decision} reason="${parsed.reason}"`

			const result: ApprovalDecisionResult = {
				...parsed,
				approvalAttemptCount: execResult.attempts,
				auditLog,
			}

			this.recordDecision(request, result, execResult.usedCandidate.modelId, false, state)
			return result
		}

		// Infrastructure failure across all candidate models
		const errorMsg = execResult.lastError ? execResult.lastError.message : "Unknown infrastructure failure"
		const reason = `Verification model unavailable (${execResult.lastCategory}: ${errorMsg}). Fail closed to manual approval.`
		const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=${state.approvalMode} fastPath=false approvalModelCalled=true attempt=${execResult.attempts} infrastructureFailure=true verifierUnavailable=true verifierCategory=${execResult.lastCategory} finalDecision=MANUAL_APPROVAL reason="${reason}"`

		const result: ApprovalDecisionResult = {
			decision: "MANUAL_APPROVAL",
			risk: "high",
			reason,
			taskAligned: false,
			infrastructureFailure: true,
			verifierUnavailable: true,
			verifierFailureCategory: execResult.lastCategory,
			approvalAttemptCount: execResult.attempts,
			auditLog,
		}

		this.recordDecision(request, result, "none", false, state)
		return result
	}

	/**
	 * Parses and validates the structured response from the Approval Authority model.
	 * Fails closed to MANUAL_APPROVAL on parse error or schema invalidity.
	 */
	public parseApprovalResponse(rawResponse: string): Omit<ApprovalDecisionResult, "auditLog"> {
		if (!rawResponse || typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
			return {
				decision: "MANUAL_APPROVAL",
				risk: "high",
				reason: "Empty response from Approval Authority model. Fail closed to manual approval.",
				taskAligned: false,
			}
		}

		const trimmed = rawResponse.trim()
		let parsedObject: any = null

		// Attempt 1: Direct JSON parse
		try {
			parsedObject = JSON.parse(trimmed)
		} catch {
			// Attempt 2: Code block regex
			const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
			if (match && match[1]) {
				try {
					parsedObject = JSON.parse(match[1].trim())
				} catch {}
			}

			// Attempt 3: Outermost braces
			if (!parsedObject) {
				const start = trimmed.indexOf("{")
				const end = trimmed.lastIndexOf("}")
				if (start !== -1 && end > start) {
					try {
						parsedObject = JSON.parse(trimmed.substring(start, end + 1))
					} catch {}
				}
			}
		}

		if (!parsedObject || typeof parsedObject !== "object" || Array.isArray(parsedObject)) {
			return {
				decision: "MANUAL_APPROVAL",
				risk: "high",
				reason: "Malformed JSON response from Approval Authority model. Fail closed to manual approval.",
				taskAligned: false,
			}
		}

		const validated = approvalDecisionResultSchema.safeParse(parsedObject)
		if (!validated.success) {
			return {
				decision: "MANUAL_APPROVAL",
				risk: "high",
				reason: `Approval response schema validation failed (${validated.error.issues.map((i) => i.message).join(", ")}). Fail closed.`,
				taskAligned: false,
			}
		}

		return {
			decision: validated.data.decision,
			risk: validated.data.risk,
			reason: validated.data.reason,
			taskAligned: validated.data.taskAligned,
			boundary: (parsedObject as any).boundary || validated.data.boundary,
			hostImpact: typeof (parsedObject as any).hostImpact === "boolean" ? (parsedObject as any).hostImpact : validated.data.hostImpact,
			hardBoundaryViolation: validated.data.hardBoundaryViolation,
			replanGuidance: validated.data.replanGuidance,
		}
	}

	/**
	 * Evaluates attempt_completion with the independent Completion Judge (Approval Model).
	 * Enforces Worker Model != Completion Authority invariant and fails closed.
	 */
	private async evaluateCompletionWithApprovalAi(
		request: UnifiedApprovalRequest,
		state: Partial<ExtensionState>
	): Promise<ApprovalDecisionResult> {
		const approvalConfig = state.commandSafetyConfig!
		const provider = approvalConfig.provider.toLowerCase().trim()
		const modelId = approvalConfig.modelId.trim()
		const apiKey = approvalConfig.apiKey || resolveProviderApiKey(provider, state.apiConfiguration) || ""
		const taskId = request.taskId || "unknown"

		const knownSecrets = [
			apiKey,
			state.apiConfiguration?.apiKey,
			state.apiConfiguration?.openAiApiKey,
			state.apiConfiguration?.geminiApiKey,
			state.apiConfiguration?.openRouterApiKey,
		]

		const { systemPrompt, userPrompt } = buildCompletionJudgePrompt({
			latestUserInstruction: sanitizeForSafetyPrompt(request.taskContext.latestUserInstruction, knownSecrets),
			activeGoal: sanitizeForSafetyPrompt(request.taskContext.activeGoal, knownSecrets),
			completionCriteria: (request.target.completionCriteria || []).map((c) =>
				sanitizeForSafetyPrompt(c, knownSecrets)
			),
			todoList: request.target.todoListSnapshot || [],
			finalResponseSummary: request.target.completionResult
				? sanitizeForSafetyPrompt(request.target.completionResult, knownSecrets)
				: request.target.completionSummary
					? sanitizeForSafetyPrompt(request.target.completionSummary, knownSecrets)
					: undefined,
		})

		const execResult = await this.executeWithFallback({
			systemPrompt,
			userPrompt,
			state,
			maxTokens: 400,
		})

		if (execResult.rawResponse !== null && execResult.usedCandidate) {
			const parsed = this.parseCompletionJudgeResponse(execResult.rawResponse)
			const mappedDecision = parsed.decision === "ALLOW_COMPLETION" ? "ALLOW_AUTO" : "CONTINUE_WORK"
			const retryText = execResult.attempts > 1 ? ` retry=true attempt=${execResult.attempts}` : ""
			const tierText = execResult.usedCandidate.tier !== "primary" ? ` tier=${execResult.usedCandidate.tier}` : ""
			const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=attempt_completion mode=auto fastPath=false approvalModelCalled=true approvalModel=${execResult.usedCandidate.modelId}${tierText}${retryText} finalDecision=${mappedDecision} reason="${parsed.reason}"`

			const result: ApprovalDecisionResult = {
				decision: mappedDecision,
				risk: mappedDecision === "ALLOW_AUTO" ? "safe" : "medium",
				reason: parsed.reason,
				taskAligned: mappedDecision === "ALLOW_AUTO",
				unresolvedItems: parsed.unresolvedItems,
				missingCriteria: parsed.missingCriteria,
				replanGuidance: parsed.guidance,
				approvalAttemptCount: execResult.attempts,
				auditLog,
			}

			this.recordDecision(request, result, execResult.usedCandidate.modelId, false, state)
			return result
		}

		const errorMsg = execResult.lastError ? execResult.lastError.message : "Unknown error"
		const reason = `Completion Judge adjudication failed (${execResult.lastCategory}: ${errorMsg}). Fail closed to manual approval.`
		const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=attempt_completion mode=auto fastPath=false approvalModelCalled=true attempt=${execResult.attempts} infrastructureFailure=true verifierUnavailable=true verifierCategory=${execResult.lastCategory} finalDecision=MANUAL_APPROVAL reason="${reason}"`

		const result: ApprovalDecisionResult = {
			decision: "MANUAL_APPROVAL",
			risk: "high",
			reason,
			taskAligned: false,
			infrastructureFailure: true,
			verifierUnavailable: true,
			verifierFailureCategory: execResult.lastCategory,
			approvalAttemptCount: execResult.attempts,
			auditLog,
		}

		this.recordDecision(request, result, "none", false, state)
		return result
	}

	/**
	 * Parses structured JSON response from the Completion Judge.
	 */
	public parseCompletionJudgeResponse(rawResponse: string): {
		decision: "ALLOW_COMPLETION" | "CONTINUE_WORK"
		reason: string
		unresolvedItems: Array<{ type: string; content: string; guidance?: string }>
		missingCriteria: string[]
		guidance?: string
	} {
		if (!rawResponse || typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
			throw new Error("Empty response from Completion Judge model")
		}

		const trimmed = rawResponse.trim()
		let parsedObject: any = null

		try {
			parsedObject = JSON.parse(trimmed)
		} catch {
			const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
			if (match && match[1]) {
				try {
					parsedObject = JSON.parse(match[1].trim())
				} catch {}
			}
			if (!parsedObject) {
				const start = trimmed.indexOf("{")
				const end = trimmed.lastIndexOf("}")
				if (start !== -1 && end > start) {
					try {
						parsedObject = JSON.parse(trimmed.substring(start, end + 1))
					} catch {}
				}
			}
		}

		if (!parsedObject || typeof parsedObject !== "object" || Array.isArray(parsedObject)) {
			throw new Error("Malformed JSON response from Completion Judge model")
		}

		const validated = completionJudgeResponseSchema.safeParse(parsedObject)
		if (!validated.success) {
			throw new Error(
				`Completion response validation failed: ${validated.error.issues.map((i) => i.message).join(", ")}`
			)
		}

		return validated.data
	}

	private sanitizeTarget(
		target: Record<string, unknown>,
		knownSecrets: (string | undefined)[]
	): Record<string, unknown> {
		const sanitized: Record<string, unknown> = {}
		for (const [key, val] of Object.entries(target)) {
			if (typeof val === "string") {
				sanitized[key] = sanitizeForSafetyPrompt(val, knownSecrets)
			} else {
				sanitized[key] = val
			}
		}
		return sanitized
	}

	private recordDecision(
		request: UnifiedApprovalRequest,
		result: ApprovalDecisionResult,
		modelId?: string,
		fastPath: boolean = false,
		state?: Partial<ExtensionState> | null
	): void {
		const knownSecrets = [
			state?.commandSafetyConfig?.apiKey,
			state?.apiConfiguration?.apiKey,
			state?.apiConfiguration?.openAiApiKey,
			state?.apiConfiguration?.geminiApiKey,
			state?.apiConfiguration?.openRouterApiKey,
		]

		const entry: DecisionLogEntry = {
			id: request.id,
			timestamp: request.timestamp || Date.now(),
			taskId: request.taskId,
			actionType: request.actionType,
			target:
				request.target.command ||
				request.target.filePath ||
				request.target.mcpToolName ||
				request.target.completionSummary ||
				request.target.completionResult ||
				request.actionType,
			boundaryTarget: request.executionBoundary?.target.name || request.executionBoundary?.target.type || "local",
			risk: result.risk,
			decision: result.decision,
			reason: result.reason,
			replanGuidance: result.replanGuidance,
			evaluatorModel: fastPath ? "deterministic-policy" : modelId || "unknown",
			fastPath,
			taskGoal: request.taskContext.activeGoal,
			currentStep: request.taskContext.currentStep,
			environment: request.executionBoundary?.targetEnvironment || request.executionBoundary?.target.type || "local",
			boundary: result.boundary || (request.executionBoundary?.target.type === "wsl" ? "wsl-guest" : "local"),
			hostImpact: result.hostImpact ?? request.executionBoundary?.hostFilesystemAccess ?? false,
			approvalAttempts: result.approvalAttemptCount || 1,
			retry: Boolean((result.approvalAttemptCount || 1) > 1),
			infrastructureFailure: result.infrastructureFailure || false,
		}

		DecisionLogStore.getInstance().addEntry(entry, knownSecrets.filter(Boolean) as string[])
	}
}
