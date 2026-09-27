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
import { CommandSafetyJudge, DEFAULT_TIMEOUT_MS, type ProviderCallDetails } from "./CommandSafetyJudge"
import { ExecutionBoundaryAnalyzer } from "./ExecutionBoundaryAnalyzer"
import { containsDangerousSubstitution } from "../auto-approval/commands"
import {
	buildAutonomousApprovalPrompt,
	buildCompletionJudgePrompt,
	sanitizeForSafetyPrompt,
} from "./safetyPromptTemplate"
import { DecisionLogStore } from "./DecisionLogStore"
import { ProviderRequestCoordinator } from "../../api/coordination/ProviderRequestCoordinator"
import { RequestPriority, RequestTicket } from "../../api/coordination/types"
import { safeExtractJson, type SafeJsonExtractResult } from "./SafeJsonExtractor"

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
		this.timeoutMs = options?.timeoutMs ?? 25000
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
		responseFormat?: "json_object" | "text"
		validateResponse?: (raw: string) => boolean
	}): Promise<{
		rawResponse: string | null
		usedCandidate: VerifierCandidate | null
		lastError: Error | null
		lastCategory: VerifierFailureCategory
		attempts: number
		callDetails?: ProviderCallDetails | null
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

				const coordinator = ProviderRequestCoordinator.getInstance()
				const providerKey = coordinator.deriveProviderKey(candidate.provider, candidate.apiKey)
				let ticket: RequestTicket | undefined

				try {
					ticket = await coordinator.acquireTicket({
						providerKey,
						priority: RequestPriority.VERIFIER,
						abortSignal: abortController.signal,
					})

					const isRetry = candidateAttempts > 1
					const effectivePrompt =
						isRetry && lastCategory === VerifierFailureCategory.APPROVAL_RESPONSE_INVALID
							? `${params.userPrompt}\n\n[CRITICAL CORRECTION FOR PREVIOUS RESPONSE]\nYour previous output could not be parsed: invalid schema or formatting.\nYou MUST output ONLY a valid, single JSON object adhering strictly to the schema. Do NOT include markdown code blocks, do NOT include explanations outside JSON, and do NOT truncate the output.`
							: params.userPrompt

					const callParams = {
						provider: candidate.provider,
						modelId: candidate.modelId,
						apiKey: candidate.apiKey,
						systemPrompt,
						userPrompt: effectivePrompt,
						state: params.state,
						signal: abortController.signal,
						maxTokens: isRetry ? (params.maxTokens ?? 350) * 2 : (params.maxTokens ?? 350),
						responseFormat: params.responseFormat,
					}

					const providerCall = CommandSafetyJudge.globalCallProviderOverride
						? CommandSafetyJudge.globalCallProviderOverride(callParams)
						: typeof (this.judge as any).callProviderDetails === "function"
							? this.judge.callProviderDetails(callParams)
							: this.judge.callProvider(callParams)

					const callRes = await Promise.race([providerCall, timeoutPromise])
					const callDetails: ProviderCallDetails = typeof callRes === "string" ? { text: callRes } : callRes
					const rawResponse = callDetails.text

					if (params.validateResponse && !params.validateResponse(rawResponse)) {
						if (timeoutId) clearTimeout(timeoutId)
						lastError = new Error(`Approval response failed schema or JSON extraction`)
						lastCategory = VerifierFailureCategory.APPROVAL_RESPONSE_INVALID
						continue
					}

					coordinator.reportSuccess(providerKey)
					if (timeoutId) clearTimeout(timeoutId)
					return {
						rawResponse,
						usedCandidate: candidate,
						lastError: null,
						lastCategory: VerifierFailureCategory.OTHER_TRANSIENT,
						attempts: totalAttempts,
						callDetails,
					}
				} catch (error: any) {
					if (timeoutId) clearTimeout(timeoutId)
					lastError = error instanceof Error ? error : new Error(String(error))
					lastCategory = classifyVerifierError(lastError)
					if (lastCategory === VerifierFailureCategory.RATE_LIMIT) {
						coordinator.reportRateLimit(providerKey, 5)
					}

					if (!isTransientVerifierError(lastCategory)) {
						break
					}
				} finally {
					ticket?.release()
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
			const hasNoModifyConstraint = (request.taskContext.explicitConstraints || []).some((c) =>
				/nie\s+modyfikuj|do\s+not\s+modify|don't\s+modify|read-only|tylko\s+do\s+odczytu/i.test(c)
			)
			const isReadOnlyOrReportScope =
				/stop.*without\s+modifying|keep.*read-only|report.*blocker|tylko\s+raport|nie\s+modyfikuj|zgł[oó]ś\s+blocker|zglos\s+blocker|zaraportuj|tylko\s+audyt|tylko\s+inspekcja|zako[nń]cz\s+bez\s+zmian/i.test(
					request.taskContext.latestUserInstruction || ""
				) ||
				/stop.*without\s+modifying|keep.*read-only|report.*blocker|tylko\s+raport|nie\s+modyfikuj|zgł[oó]ś\s+blocker|zglos\s+blocker|zaraportuj|tylko\s+audyt|tylko\s+inspekcja|zako[nń]cz\s+bez\s+zmian/i.test(
					request.taskContext.activeGoal || ""
				)

			// Gate 1: Check unresolved denial state
			if (target.unresolvedDenialState) {
				const isDenialCausedByReadOnly =
					(hasNoModifyConstraint || isReadOnlyOrReportScope) &&
					(target.unresolvedDenialState.actionType === "write_to_file" ||
						target.unresolvedDenialState.actionType === "replace_file_content" ||
						target.unresolvedDenialState.actionType === "delete_file")

				if (!isDenialCausedByReadOnly) {
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

			// Gate 3: Check in_progress TODOs (ignore blocked or cancelled items)
			const inProgress = (target.todoListSnapshot || []).filter(
				(t) => t.status === "in_progress"
			)
			const actionableInProgress = inProgress.filter((t) => {
				const isCodeModification = /implement|edit|modify|fix|polish|write|patch|create\s+file|delete/i.test(t.content)
				if ((hasNoModifyConstraint || isReadOnlyOrReportScope) && isCodeModification) {
					return false
				}
				return true
			})

			if (actionableInProgress.length > 0) {
				return {
					decision: "CONTINUE_WORK",
					risk: "medium",
					reason: `Cannot complete task with ${actionableInProgress.length} item(s) marked 'in_progress' on the todo list.`,
					taskAligned: false,
					unresolvedItems: actionableInProgress.map((t) => ({
						type: "in_progress_todo",
						content: t.content,
						guidance: "Finish this in-progress item, or if blocked by constraints/dependencies, use update_todo_list to mark it [!] (blocked).",
					})),
				}
			}

			// Gate 4: Check pending TODOs (ignore blocked or cancelled items)
			const pending = (target.todoListSnapshot || []).filter(
				(t) => t.status === "pending"
			)
			const actionablePending = pending.filter((t) => {
				const isCodeModification = /implement|edit|modify|fix|polish|write|patch|create\s+file|delete/i.test(t.content)
				if ((hasNoModifyConstraint || isReadOnlyOrReportScope) && isCodeModification) {
					return false
				}
				return true
			})

			if (actionablePending.length > 0) {
				return {
					decision: "CONTINUE_WORK",
					risk: "medium",
					reason: `Task still contains ${actionablePending.length} pending item(s) on the todo list.`,
					taskAligned: false,
					unresolvedItems: actionablePending.map((t) => ({
						type: "pending_todo",
						content: t.content,
						guidance: "Complete pending item, or update todo list to [!] (blocked) / [c] (cancelled) if no longer applicable.",
					})),
				}
			}

			// Gate 4b: Check blocked TODOs (Invariant: BLOCKED != COMPLETED)
			// Under standard user instruction, blocked items MUST NOT auto-complete as ALLOW_AUTO.
			// They require user decision / approval (MANUAL_APPROVAL).
			// Exception (Case 1): Scope changed to read-only/stop/report where mutating items are non-blocking.
			const blocked = (target.todoListSnapshot || []).filter(
				(t) => t.status === "blocked"
			)
			const actionableBlocked = blocked.filter((t) => {
				const isCodeModification = /implement|edit|modify|fix|polish|write|patch|create\s+file|delete/i.test(t.content)
				if ((hasNoModifyConstraint || isReadOnlyOrReportScope) && isCodeModification) {
					return false
				}
				return true
			})

			if (actionableBlocked.length > 0) {
				return {
					decision: "MANUAL_APPROVAL",
					risk: "medium",
					reason: `Cannot complete task with ${actionableBlocked.length} item(s) marked 'blocked' on the todo list without user approval.`,
					taskAligned: false,
					unresolvedItems: actionableBlocked.map((t) => ({
						type: "blocked_todo",
						content: t.content,
						guidance: "Review blocked item with user or request explicit approval to proceed.",
					})),
				}
			}

			// Gate 4c: Check cancelled TODOs (unauthorized worker cancellations)
			// Worker cannot unilaterally cancel items to bypass completion without user authorization.
			const cancelled = (target.todoListSnapshot || []).filter(
				(t) => t.status === "cancelled"
			)
			const isCancellationAuthorized =
				hasNoModifyConstraint ||
				isReadOnlyOrReportScope ||
				/cancel|omit|skip|drop|abort|ignore|remove\s+requirement|pomi[nń]|anuluj|porzu[cć]|zignoruj|odrzu[cć]|nie\s+rób|zrezygnuj/i.test(
					request.taskContext?.latestUserInstruction || ""
				)

			const actionableCancelled = isCancellationAuthorized
				? []
				: cancelled.filter((t) => {
					const isCodeModification = /implement|edit|modify|fix|polish|write|patch|create\s+file|delete/i.test(t.content)
					if ((hasNoModifyConstraint || isReadOnlyOrReportScope) && isCodeModification) {
						return false
					}
					return true
				})

			if (actionableCancelled.length > 0) {
				return {
					decision: "CONTINUE_WORK",
					risk: "medium",
					reason: `Worker cannot cancel todo items without user authorization (${actionableCancelled.length} item(s) cancelled).`,
					taskAligned: false,
					unresolvedItems: actionableCancelled.map((t) => ({
						type: "cancelled_todo",
						content: t.content,
						guidance: "Resume cancelled work, or obtain user confirmation before dropping required tasks.",
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

		// Safe mode switches, subtasks, and internal todo list updates
		if (actionType === "switch_mode" || actionType === "new_task" || actionType === "update_todo_list") {
			return {
				decision: "ALLOW_AUTO",
				risk: "safe",
				reason: "Internal workflow transition",
				taskAligned: true,
			}
		}

		// File modifications
		if (actionType === "write_to_file" || actionType === "replace_file_content" || actionType === "delete_file") {
			// Check explicit negative constraint on modifying code
			const hasNoModifyConstraint = (request.taskContext.explicitConstraints || []).some((c) =>
				/nie\s+modyfikuj|do\s+not\s+modify|don't\s+modify|read-only|tylko\s+do\s+odczytu/i.test(c)
			)
			if (hasNoModifyConstraint) {
				return {
					decision: "DENY_AND_REPLAN",
					risk: "medium",
					reason: "The current task is strictly read-only by user constraint ('DO NOT modify code'). Modifying source files is forbidden.",
					taskAligned: false,
					hardBoundaryViolation: false,
					isUserConstraintViolation: true,
					violatedConstraint: "DO NOT modify code (READ-ONLY)",
					replanGuidance: "The current task is explicitly read-only. Do not modify source code or attempt to make failing tests pass by editing implementation. Continue the review using read-only inspection or test runs only.",
				}
			}

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

			// Check git operations (commit, add, push)
			if (/^git\s+(commit|add|push)/i.test(cmd)) {
				const explicitConstraints = request.taskContext.explicitConstraints || []
				const latestInstruction = request.taskContext.latestUserInstruction || ""
				const activeGoal = request.taskContext.activeGoal || ""

				// 1. Check affirmative user override in latest user instruction
				const hasAffirmativeOverride =
					/(?:proceed\s+with|tak|yes|potwierdzam|confirm|allow|permit|go\s+ahead|approved?|możesz|you\s+can|you\s+may).*(?:commit|add|staging)/i.test(
						latestInstruction
					)

				// 2. Extract scoped permissions and prohibitions
				const scopedAllows: string[] = []
				const scopedDenies: string[] = []

				for (const c of explicitConstraints) {
					const allowMatch = c.match(/(?:ALLOWED\s+to\s+commit|commit\s+wyłącznie|masz\s+pozwolenie\s+na:\s*commit\s+wyłącznie|możesz\s+commitować)\s*(.+)/i)
					if (allowMatch && allowMatch[1]) {
						scopedAllows.push(...allowMatch[1].split(/[\s,;/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))
					}
					const denyMatch = c.match(/(?:DO\s+NOT\s+commit(?:\s+changes)?(?:\s+to)?|nie\s+commituj(?:\s+zmian)?)\s*(.+)/i)
					if (denyMatch && denyMatch[1]) {
						const rawScope = denyMatch[1].replace(/\(nie\s+commituj\)/i, "").trim()
						if (rawScope && !/^(changes|kodu|files)?$/i.test(rawScope)) {
							scopedDenies.push(...rawScope.split(/[\s,;/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))
						}
					}
				}

				// Also inspect prompt text for scoped rules if not in explicitConstraints
				const promptText = `${latestInstruction}\n${activeGoal}`
				const promptAllowMatch = promptText.match(/(?:commit\s+wyłącznie|masz\s+pozwolenie\s+na:\s*commit\s+wyłącznie|you\s+(?:may|can)\s+commit\s+only)\s*([^\n.;]+)/i)
				if (promptAllowMatch && promptAllowMatch[1]) {
					scopedAllows.push(...promptAllowMatch[1].split(/[\s,;/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))
				}
				const promptDenyMatch = promptText.match(/(?:nie\s+commituj\s+zmian|do\s+not\s+commit\s+changes\s+to)\s*([^\n.;]+)/i)
				if (promptDenyMatch && promptDenyMatch[1]) {
					scopedDenies.push(...promptDenyMatch[1].split(/[\s,;/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))
				}

				// Parse target paths from git command (e.g., git add -- velune-website/)
				// Parse target paths from git command without stripping hyphens inside folder names (e.g. velune-website/)
				const rawTokens = cmd
					.replace(/"[^"]*"/g, "")
					.replace(/'[^']*'/g, "")
					.trim()
					.split(/\s+/)
					.filter(Boolean)

				const pathArgs = rawTokens.filter(
					(t) => !t.startsWith("-") && !["git", "add", "commit", "push"].includes(t.toLowerCase())
				)

				const isGlobalAdd = rawTokens.some((p) => p === "." || p === "-A" || p === "--all")

				// Check if any targeted path touches a prohibited scope
				const touchesForbiddenScope = scopedDenies.find((deniedScope) =>
					pathArgs.some((p) => p.toLowerCase().includes(deniedScope))
				)

				if (touchesForbiddenScope) {
					return {
						decision: "DENY_AND_REPLAN",
						risk: "medium",
						reason: `The user explicitly forbade staging or committing files in scope '${touchesForbiddenScope}'.`,
						taskAligned: false,
						hardBoundaryViolation: false,
						isUserConstraintViolation: true,
						violatedConstraint: `security/licensing/backend (${touchesForbiddenScope})`,
						replanGuidance: `Do not stage or commit files in forbidden scope '${touchesForbiddenScope}'. Only work within authorized scopes.`,
					}
				}

				if (isGlobalAdd && scopedDenies.length > 0) {
					return {
						decision: "DENY_AND_REPLAN",
						risk: "medium",
						reason: "Cannot stage all files globally with 'git add .' when prohibited scopes exist. Stage only the allowed scope.",
						taskAligned: false,
						hardBoundaryViolation: false,
						isUserConstraintViolation: true,
						violatedConstraint: "scoped commit policy",
						replanGuidance: `Stage only the specifically authorized scope (${scopedAllows.join(", ") || "explicit directory"}) rather than all files.`,
					}
				}

				// Check if the target explicitly matches an allowed scope
				const matchesAllowedScope = scopedAllows.length > 0 && scopedAllows.some((allowedScope) =>
					pathArgs.some((p) => p.toLowerCase().includes(allowedScope))
				)

				if (matchesAllowedScope || hasAffirmativeOverride) {
					return {
						decision: "ALLOW_AUTO",
						risk: "low",
						reason: `Git operation scoped to authorized path (${pathArgs.join(", ") || "authorized scope"}) per user instruction.`,
						taskAligned: true,
					}
				}

				// Generic negative commit constraint (blanket ban)
				const hasNoCommitConstraint = explicitConstraints.some((c) =>
					/nie\s+commituj|do\s+not\s+commit|don't\s+commit|no\s+commits?/i.test(c)
				)
				if (hasNoCommitConstraint) {
					return {
						decision: "DENY_AND_REPLAN",
						risk: "medium",
						reason: "The user explicitly forbade git commits/modifications ('NIE commituj'). Staging or committing code is forbidden.",
						taskAligned: false,
						hardBoundaryViolation: false,
						isUserConstraintViolation: true,
						violatedConstraint: "NIE commituj",
						replanGuidance: "Do not stage or commit files. Keep changes unstaged or work strictly read-only per user instructions.",
					}
				}
			}

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
			validateResponse: (raw: string) => safeExtractJson(raw, approvalDecisionResultSchema).success,
		})

		if (execResult.rawResponse !== null && execResult.usedCandidate) {
			const extraction = safeExtractJson(execResult.rawResponse, approvalDecisionResultSchema)
			if (extraction.success && extraction.data) {
				const parsed = extraction.data
				const retryText = execResult.attempts > 1 ? ` retry=true attempt=${execResult.attempts}` : ""
				const tierText = execResult.usedCandidate.tier !== "primary" ? ` tier=${execResult.usedCandidate.tier}` : ""
				const extractionNote = extraction.category !== "VALID_JSON" ? ` jsonCategory=${extraction.category}` : ""
				const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=${state.approvalMode} fastPath=false approvalModelCalled=true approvalModel=${execResult.usedCandidate.modelId}${tierText}${retryText}${extractionNote} finalDecision=${parsed.decision} reason="${parsed.reason}"`

				const result: ApprovalDecisionResult = {
					decision: parsed.decision,
					risk: parsed.risk as CommandSafetyRiskLevel,
					reason: parsed.reason,
					taskAligned: parsed.taskAligned ?? false,
					boundary: parsed.boundary ?? undefined,
					hostImpact: parsed.hostImpact ?? undefined,
					hardBoundaryViolation: parsed.hardBoundaryViolation ?? false,
					isUserConstraintViolation: parsed.isUserConstraintViolation ?? undefined,
					violatedConstraint: parsed.violatedConstraint ?? undefined,
					replanGuidance: parsed.replanGuidance ?? undefined,
					unresolvedItems: parsed.unresolvedItems ?? undefined,
					missingCriteria: parsed.missingCriteria ?? undefined,
					approvalAttemptCount: execResult.attempts,
					auditLog,
				}

				this.recordDecision(request, result, execResult.usedCandidate.modelId, false, state)
				return result
			}
		}

		// Infrastructure failure or schema invalidity across all candidate models
		const isSchemaInvalid = execResult.lastCategory === VerifierFailureCategory.APPROVAL_RESPONSE_INVALID
		const errorMsg = execResult.lastError ? execResult.lastError.message : "Unknown verification failure"
		const reason = isSchemaInvalid
			? `Approval response schema validation failed (${errorMsg}). Fail closed.`
			: `Verification model unavailable (${execResult.lastCategory}: ${errorMsg}). Fail closed to manual approval.`
		const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=${state.approvalMode} fastPath=false approvalModelCalled=true attempt=${execResult.attempts} infrastructureFailure=true verifierUnavailable=${!isSchemaInvalid} verifierCategory=${execResult.lastCategory} finalDecision=MANUAL_APPROVAL reason="${reason}"`

		const highestRisk = request.executionBoundary?.hostImpact.highestRisk
		const fallbackRisk: CommandSafetyRiskLevel = highestRisk && highestRisk !== "none" ? highestRisk : "medium"

		const result: ApprovalDecisionResult = {
			decision: "MANUAL_APPROVAL",
			risk: fallbackRisk,
			reason,
			taskAligned: false,
			infrastructureFailure: true,
			verifierUnavailable: !isSchemaInvalid,
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
				infrastructureFailure: true,
				verifierFailureCategory: VerifierFailureCategory.APPROVAL_RESPONSE_INVALID,
			}
		}

		const extraction = safeExtractJson(rawResponse, approvalDecisionResultSchema)
		if (extraction.success && extraction.data) {
			const data = extraction.data
			return {
				decision: data.decision,
				risk: data.risk as CommandSafetyRiskLevel,
				reason: data.reason,
				taskAligned: data.taskAligned ?? false,
				boundary: data.boundary ?? undefined,
				hostImpact: data.hostImpact ?? undefined,
				hardBoundaryViolation: data.hardBoundaryViolation ?? false,
				isUserConstraintViolation: data.isUserConstraintViolation ?? undefined,
				violatedConstraint: data.violatedConstraint ?? undefined,
				replanGuidance: data.replanGuidance ?? undefined,
				unresolvedItems: data.unresolvedItems ?? undefined,
				missingCriteria: data.missingCriteria ?? undefined,
			}
		}

		const isSchemaError =
			extraction.category === "WRONG_SCHEMA" ||
			extraction.category === "WRONG_ENUM" ||
			extraction.category === "MISSING_FIELD"
		const reason = isSchemaError
			? `Approval response schema validation failed (${extraction.error?.message || "Invalid schema"}). Fail closed.`
			: `Malformed JSON response from Approval Authority model (${extraction.category}: ${extraction.error?.message || "Parse failed"}). Fail closed to manual approval.`

		return {
			decision: "MANUAL_APPROVAL",
			risk: "high",
			reason,
			taskAligned: false,
			infrastructureFailure: true,
			verifierFailureCategory: VerifierFailureCategory.APPROVAL_RESPONSE_INVALID,
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

		const MAX_JUDGE_PARSE_RETRIES = 1 // 1 initial attempt + 1 retry = max 2 attempts total
		let lastErrorCategory = "UNKNOWN"
		let lastErrorMessage = "Unknown error"
		let totalAttempts = 0
		let currentPrompt = userPrompt
		let lastUsedCandidate: VerifierCandidate | null = null

		for (let judgeAttempt = 0; judgeAttempt <= MAX_JUDGE_PARSE_RETRIES; judgeAttempt++) {
			const isRetry = judgeAttempt > 0
			const maxTokens = isRetry ? 1200 : 1024

			const execResult = await this.executeWithFallback({
				systemPrompt,
				userPrompt: currentPrompt,
				state,
				maxTokens,
				responseFormat: "json_object",
			})

			totalAttempts += execResult.attempts
			if (execResult.usedCandidate) {
				lastUsedCandidate = execResult.usedCandidate
			}

			if (execResult.rawResponse !== null && execResult.usedCandidate) {
				const extraction = safeExtractJson(execResult.rawResponse, completionJudgeResponseSchema)

				if (extraction.success && extraction.data) {
					const parsed = extraction.data
					const mappedDecision = parsed.decision === "ALLOW_COMPLETION" ? "ALLOW_AUTO" : "CONTINUE_WORK"
					const retryText = totalAttempts > 1 ? ` retry=true attempt=${totalAttempts}` : ""
					const tierText = execResult.usedCandidate.tier !== "primary" ? ` tier=${execResult.usedCandidate.tier}` : ""
					const extractionNote = extraction.category !== "VALID_JSON" ? ` jsonCategory=${extraction.category}` : ""
					const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=attempt_completion mode=auto fastPath=false approvalModelCalled=true approvalModel=${execResult.usedCandidate.modelId}${tierText}${retryText}${extractionNote} finalDecision=${mappedDecision} reason="${parsed.reason}" workerReinvoked=false`

					const result: ApprovalDecisionResult = {
						decision: mappedDecision,
						risk: mappedDecision === "ALLOW_AUTO" ? "safe" : "medium",
						reason: parsed.reason,
						taskAligned: mappedDecision === "ALLOW_AUTO",
						unresolvedItems: parsed.unresolvedItems,
						missingCriteria: parsed.missingCriteria,
						replanGuidance: parsed.guidance,
						approvalAttemptCount: totalAttempts,
						auditLog,
					}

					this.recordDecision(request, result, execResult.usedCandidate.modelId, false, state)
					return result
				} else {
					// Safe extraction failed (category: TRUNCATED_JSON, WRONG_SCHEMA, EMPTY_RESPONSE, etc.)
					lastErrorCategory = extraction.category
					lastErrorMessage = extraction.error ? extraction.error.message : "Failed to extract valid JSON"

					if (judgeAttempt < MAX_JUDGE_PARSE_RETRIES) {
						// Build targeted correction prompt for bounded retry
						currentPrompt = `${userPrompt}\n\n[CRITICAL CORRECTION FOR PREVIOUS RESPONSE]\nYour previous output could not be parsed: [${extraction.category}] ${extraction.error ? extraction.error.message : "Parse error"}.\nYou MUST output ONLY a valid, single JSON object adhering strictly to the schema. Do NOT include markdown code blocks, do NOT include explanations outside JSON, and do NOT truncate the output.`
						continue
					}
				}
			} else {
				// Provider call failed completely (e.g. rate limit, auth, network on all candidates)
				lastErrorCategory = execResult.lastCategory || "VERIFIER_FAILED"
				lastErrorMessage = execResult.lastError ? execResult.lastError.message : "Provider call failed"
				break
			}
		}

		// If bounded retries exhausted or verifier failed: FAIL CLOSED TO MANUAL_APPROVAL
		// Invariant: NEVER throw uncaught error that reinvokes worker model or causes infinite regeneration loop!
		const verifierUnavailable =
			lastErrorCategory === "RATE_LIMIT" ||
			lastErrorCategory === "AUTH_ERROR" ||
			lastErrorCategory === "NETWORK_TIMEOUT" ||
			lastErrorCategory === "VERIFIER_FAILED"
		const reason = `Completion Judge verification could not produce a valid decision (${lastErrorCategory}: ${lastErrorMessage}). Task completion requires manual approval.`
		const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=attempt_completion mode=auto fastPath=false approvalModelCalled=true attempt=${totalAttempts} infrastructureFailure=true verifierUnavailable=${verifierUnavailable} verifierCategory=${lastErrorCategory} finalDecision=MANUAL_APPROVAL reason="${reason}" workerReinvoked=false`

		let mappedFailureCategory: VerifierFailureCategory | undefined
		if (lastErrorCategory === "RATE_LIMIT") {
			mappedFailureCategory = VerifierFailureCategory.RATE_LIMIT
		} else if (lastErrorCategory === "AUTH_ERROR") {
			mappedFailureCategory = VerifierFailureCategory.AUTH
		} else if (lastErrorCategory === "NETWORK_TIMEOUT") {
			mappedFailureCategory = VerifierFailureCategory.TIMEOUT
		} else if (lastErrorCategory === "NETWORK_ERROR") {
			mappedFailureCategory = VerifierFailureCategory.NETWORK
		} else if (Object.values(VerifierFailureCategory).includes(lastErrorCategory as any)) {
			mappedFailureCategory = lastErrorCategory as VerifierFailureCategory
		}

		const result: ApprovalDecisionResult = {
			decision: "MANUAL_APPROVAL",
			risk: "high",
			reason,
			taskAligned: false,
			infrastructureFailure: true,
			verifierUnavailable,
			verifierFailureCategory: mappedFailureCategory,
			approvalAttemptCount: totalAttempts,
			auditLog,
		}

		this.recordDecision(request, result, lastUsedCandidate?.modelId || "none", false, state)
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
		const extraction = safeExtractJson(rawResponse, completionJudgeResponseSchema)
		if (!extraction.success || !extraction.data) {
			if (extraction.category === "EMPTY_RESPONSE") {
				throw new Error("Empty response from Completion Judge model")
			}
			if (
				extraction.category === "WRONG_SCHEMA" ||
				extraction.category === "WRONG_ENUM" ||
				extraction.category === "MISSING_FIELD"
			) {
				throw new Error(`Completion response validation failed: ${extraction.error}`)
			}
			throw new Error(`Malformed JSON response from Completion Judge model: [${extraction.category}] ${extraction.error}`)
		}

		return {
			decision: extraction.data.decision,
			reason: extraction.data.reason,
			unresolvedItems: extraction.data.unresolvedItems ?? [],
			missingCriteria: extraction.data.missingCriteria ?? [],
			guidance: extraction.data.guidance,
		}
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
