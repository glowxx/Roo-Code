import type {
	UnifiedApprovalRequest,
	ApprovalDecisionResult,
	CommandSafetyConfig,
	CommandSafetyRiskLevel,
	ProviderSettings,
	ExtensionState,
	DecisionLogEntry,
	VerifierAttemptTiming,
} from "@roo-code/types"
import { randomUUID } from "crypto"
import {
	approvalDecisionResultSchema,
	completionJudgeResponseSchema,
	isSafetyModelConfigured,
	resolveProviderApiKey,
	getModelId,
	VerifierFailureCategory,
} from "@roo-code/types"
import { CommandSafetyJudge, type ProviderCallDetails } from "./CommandSafetyJudge"
import { ExecutionBoundaryAnalyzer } from "./ExecutionBoundaryAnalyzer"
import { containsDangerousSubstitution, getCommandDecision } from "../auto-approval/commands"
import {
	buildAutonomousApprovalPrompt,
	buildCompletionJudgePrompt,
	sanitizeForSafetyPrompt,
} from "./safetyPromptTemplate"
import { DecisionLogStore } from "./DecisionLogStore"
import { ProviderRequestCoordinator } from "../../api/coordination/ProviderRequestCoordinator"
import { RequestPriority, RequestTicket } from "../../api/coordination/types"
import { safeExtractJson, type SafeJsonExtractResult } from "./SafeJsonExtractor"
import { safeRateLimitHeaders, safeRetryAfterHeader } from "./rateLimitTelemetry"
import { extractRetryAfterMsFromTimeline } from "./DeferredApprovalRecovery"

export interface VerifierHealthState {
	consecutiveFailures: number
	lastFailureAt: number
	cooldownUntil: number
	lastCategory?: VerifierFailureCategory
}

export interface ApprovalOrchestratorOptions {
	timeoutMs?: number
	judge?: CommandSafetyJudge
}

export function classifyVerifierError(error: any): VerifierFailureCategory {
	if (!error) return VerifierFailureCategory.OTHER_TRANSIENT
	const status = error.status || error.statusCode || error.response?.status || error.$metadata?.httpStatusCode
	const code = (error.code || error.cause?.code || "").toString().toLowerCase()
	const msg = (error.message || "").toLowerCase()
	const name = (error.name || "").toString()

	// 1. Cancellation (AbortError not caused by timeout or budget limit)
	if (
		name === "AbortError" &&
		!msg.includes("timed out") &&
		!msg.includes("timeout") &&
		!msg.includes("budget exceeded")
	) {
		return VerifierFailureCategory.CANCELLED
	}

	// 2. Rate limiting (429)
	if (
		status === 429 ||
		code === "rate_limit_exceeded" ||
		msg.includes("rate limit") ||
		msg.includes("too many requests") ||
		msg.includes("resource_exhausted")
	) {
		return VerifierFailureCategory.RATE_LIMIT
	}

	// 3. Quota & Billing
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

	// 4. Auth
	if (
		status === 401 ||
		status === 403 ||
		msg.includes("unauthorized") ||
		msg.includes("invalid api key") ||
		msg.includes("forbidden")
	) {
		return VerifierFailureCategory.AUTH
	}

	// 5. Genuine Model Not Found / Invalid Model (404, explicit model_not_found, removed/deprecated)
	if (
		status === 404 ||
		code === "model_not_found" ||
		msg.includes("model not found") ||
		msg.includes("model does not exist") ||
		msg.includes("does not exist") ||
		msg.includes("invalid model") ||
		msg.includes("unknown model") ||
		msg.includes("model has been deleted") ||
		msg.includes("model deprecated") ||
		msg.includes("model is not available") ||
		msg.includes("no such model")
	) {
		return VerifierFailureCategory.MODEL_UNAVAILABLE
	}

	// 6. Timeouts (Deadline, request timeout, client abort on timeout)
	if (
		status === 408 ||
		status === 524 ||
		code === "etimedout" ||
		code === "esockettimedout" ||
		name === "TimeoutError" ||
		msg.includes("timed out") ||
		msg.includes("timeout") ||
		msg.includes("etimedout") ||
		msg.includes("deadline exceeded") ||
		msg.includes("budget exceeded")
	) {
		return VerifierFailureCategory.TIMEOUT
	}

	// 7. Transient Provider Errors: 500, 502, 503, 504, 529, service unavailable, bad gateway, overloaded
	if (
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504 ||
		status === 529 ||
		msg.includes("service unavailable") ||
		msg.includes("bad gateway") ||
		msg.includes("gateway timeout") ||
		msg.includes("server error") ||
		msg.includes("internal server error") ||
		msg.includes("overloaded") ||
		msg.includes("temporarily unavailable")
	) {
		return VerifierFailureCategory.PROVIDER_ERROR
	}

	// 8. Network & Transport Errors: ECONNRESET, ECONNREFUSED, socket hang up, fetch failed
	if (
		code === "econnreset" ||
		code === "econnrefused" ||
		code === "enotfound" ||
		code === "und_err_socket" ||
		code === "und_err_body_timeout" ||
		code === "err_stream_premature_close" ||
		msg.includes("connection reset") ||
		msg.includes("econnreset") ||
		msg.includes("econnrefused") ||
		msg.includes("enotfound") ||
		msg.includes("socket hang up") ||
		msg.includes("network") ||
		msg.includes("fetch failed")
	) {
		return VerifierFailureCategory.NETWORK
	}

	return VerifierFailureCategory.OTHER_TRANSIENT
}

export function isTransientVerifierError(category: VerifierFailureCategory): boolean {
	return (
		category === VerifierFailureCategory.TIMEOUT ||
		category === VerifierFailureCategory.PROVIDER_ERROR ||
		category === VerifierFailureCategory.NETWORK ||
		category === VerifierFailureCategory.RATE_LIMIT ||
		category === VerifierFailureCategory.OTHER_TRANSIENT
	)
}

export function isDeferredRetryableCategory(category?: VerifierFailureCategory): boolean {
	if (!category) return false
	return (
		category === VerifierFailureCategory.TIMEOUT ||
		category === VerifierFailureCategory.PROVIDER_ERROR ||
		category === VerifierFailureCategory.NETWORK ||
		category === VerifierFailureCategory.RATE_LIMIT ||
		category === VerifierFailureCategory.OTHER_TRANSIENT
	)
}

function retryAfterMs(error: any): number | undefined {
	const headers = error?.headers || error?.response?.headers
	const value = typeof headers?.get === "function"
		? headers.get("retry-after")
		: headers?.["retry-after"] || headers?.["Retry-After"]
	if (value == null || String(value).trim() === "") return undefined
	const seconds = Number(value)
	const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) - Date.now()
	return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined
}

function errorStatus(error: any): number | undefined {
	return error?.status || error?.statusCode || error?.response?.status || error?.$metadata?.httpStatusCode
}

export interface VerifierCandidate {
	tier: "primary" | "secondary"
	provider: string
	modelId: string
	apiKey: string
}

export class ApprovalOrchestrator {
	private static readonly verifierHealth = new Map<string, VerifierHealthState>()
	private static readonly inFlightVerifications = new Map<string, Promise<ApprovalDecisionResult>>()

	private static candidateKey(candidate: VerifierCandidate): string {
		const providerKey = ProviderRequestCoordinator.getInstance().deriveProviderKey(
			candidate.provider, candidate.apiKey, undefined, "verifier",
		)
		return `${providerKey}:${candidate.modelId}`.toLowerCase()
	}

	public static getVerifierHealth(candidateKey: string): VerifierHealthState | undefined {
		return ApprovalOrchestrator.verifierHealth.get(candidateKey.toLowerCase())
	}

	public static resetVerifierHealth(): void {
		ApprovalOrchestrator.verifierHealth.clear()
	}

	public static recordVerifierSuccess(candidateKey: string): void {
		ApprovalOrchestrator.verifierHealth.delete(candidateKey.toLowerCase())
	}

	public static recordVerifierFailure(
		candidateKey: string,
		category: VerifierFailureCategory,
		now: number = Date.now()
	): VerifierHealthState {
		const key = candidateKey.toLowerCase()
		const current = ApprovalOrchestrator.verifierHealth.get(key) || {
			consecutiveFailures: 0,
			lastFailureAt: 0,
			cooldownUntil: 0,
		}

		current.consecutiveFailures += 1
		current.lastFailureAt = now
		current.lastCategory = category

		// Cooldown policy:
		// - INVALID_MODEL / MODEL_UNAVAILABLE: 5 minutes (300,000ms) - model does not exist
		// - RATE_LIMIT or FREE_QUOTA_EXHAUSTED: 30 seconds (30,000ms)
		// - TIMEOUT / PROVIDER_ERROR / NETWORK / OTHER_TRANSIENT:
		//   Only repeated verification failures (>= 2 consecutive failures across verifications):
		//   trips circuit breaker for 30 seconds (30,000ms)
		if (
			category === VerifierFailureCategory.INVALID_MODEL ||
			category === VerifierFailureCategory.MODEL_UNAVAILABLE
		) {
			current.cooldownUntil = now + 300000
		} else if (
			category === VerifierFailureCategory.RATE_LIMIT ||
			category === VerifierFailureCategory.FREE_QUOTA_EXHAUSTED
		) {
			current.cooldownUntil = now + 30000
		} else if (current.consecutiveFailures >= 2) {
			current.cooldownUntil = now + 30000
		}

		ApprovalOrchestrator.verifierHealth.set(key, current)
		return current
	}

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

		const workerProvider = state?.apiConfiguration?.apiProvider?.toLowerCase().trim()
		const workerModel = getModelId(state?.apiConfiguration)?.toLowerCase().trim()
		return candidates.filter((candidate) =>
			!(candidate.provider === workerProvider && candidate.modelId.toLowerCase() === workerModel),
		)
	}

	public async executeWithFallback(params: {
		systemPrompt: string
		userPrompt: string
		state: Partial<ExtensionState>
		maxTokens?: number
		responseFormat?: "json_object" | "text"
		validateResponse?: (raw: string) => boolean
		logicalVerificationId?: string
		signal?: AbortSignal
	}): Promise<{
		rawResponse: string | null
		usedCandidate: VerifierCandidate | null
		lastError: Error | null
		lastCategory: VerifierFailureCategory
		attempts: number
		callDetails?: ProviderCallDetails | null
		queueWaitMs?: number
		requestMs?: number
		totalMs?: number
		attemptTimeline?: VerifierAttemptTiming[]
		inCooldown?: boolean
	}> {
		const candidates = this.getVerifierCandidates(params.state)
		if (candidates.length === 0) {
			return {
				rawResponse: null,
				usedCandidate: null,
				lastError: new Error("No verifier candidates configured"),
				lastCategory: VerifierFailureCategory.INVALID_MODEL,
				attempts: 0,
			}
		}

		const now = Date.now()
		const availableCandidates = candidates.filter((c) => {
			const candidateKey = ApprovalOrchestrator.candidateKey(c)
			const health = ApprovalOrchestrator.getVerifierHealth(candidateKey)
			if (health && health.cooldownUntil > now) {
				return false
			}
			return true
		})

		if (availableCandidates.length === 0) {
			// All candidates in cooldown
			const firstCandidateKey = ApprovalOrchestrator.candidateKey(candidates[0])
			const health = ApprovalOrchestrator.getVerifierHealth(firstCandidateKey)
			return {
				rawResponse: null,
				usedCandidate: null,
				lastError: new Error("All safety verifier candidates are currently in cooldown"),
				lastCategory: health?.lastCategory || VerifierFailureCategory.OTHER_TRANSIENT,
				attempts: 0,
				inCooldown: true,
			}
		}

		const TOTAL_BUDGET_MS = this.timeoutMs
		const verificationStartAt = Date.now()
		const deadline = verificationStartAt + TOTAL_BUDGET_MS
		const logicalVerificationId = params.logicalVerificationId || `verif-${randomUUID()}`
		const attemptTimeline: VerifierAttemptTiming[] = []
		let totalAttempts = 0
		let lastError: Error | null = null
		let lastCategory: VerifierFailureCategory = VerifierFailureCategory.OTHER_TRANSIENT
		let lastQueueWaitMs = 0
		let lastRequestMs = 0

		for (const candidate of availableCandidates) {
			const candidateKey = ApprovalOrchestrator.candidateKey(candidate)
			const systemPrompt = params.systemPrompt

			let candidateAttempts = 0
			const maxAttemptsForCandidate = 2
			let candidateSucceeded = false

			while (candidateAttempts < maxAttemptsForCandidate) {
				if (params.signal?.aborted) {
					lastError = new Error("Approval verification cancelled by user")
					lastCategory = VerifierFailureCategory.CANCELLED
					break
				}

				const remainingBudget = deadline - Date.now()
				if (remainingBudget <= 500) {
					if (!lastError) {
						lastError = new Error(`Approval AI evaluation budget exceeded (${TOTAL_BUDGET_MS}ms)`)
						lastCategory = VerifierFailureCategory.TIMEOUT
					}
					break
				}

				candidateAttempts++
				totalAttempts++
				const attemptId = `${logicalVerificationId}-attempt-${totalAttempts}`
				const attemptCreatedAt = Date.now()

				// Separate bounded queue wait timeout (max 5000ms or remaining budget)
				const queueTimeoutMs = Math.min(5000, remainingBudget)
				const coordinator = ProviderRequestCoordinator.getInstance()
				const providerKey = coordinator.deriveProviderKey(candidate.provider, candidate.apiKey, undefined, "verifier")
				let ticket: RequestTicket | undefined

				const queueAbort = new AbortController()
				const queueTimeoutId = setTimeout(() => {
					queueAbort.abort(new Error(`Approval AI queue wait timed out after ${queueTimeoutMs}ms`))
				}, queueTimeoutMs)

				const onParentAbortQueue = () => {
					queueAbort.abort(new Error("Approval AI verification cancelled by user"))
				}
				if (params.signal) {
					params.signal.addEventListener("abort", onParentAbortQueue, { once: true })
					if (params.signal.aborted) onParentAbortQueue()
				}

				const queueStart = Date.now()
				let queueWaitMs = 0
				let requestStartAt = 0
				let transportStartAt = 0
				let requestEndAt = 0
				let localWaitEndAt = 0
				let attemptCompletedAt = 0
				let backoffMs = 0
				let responseHeadersAt = 0
				let responseStatus = 0
				let responseRetryAfter: string | null | undefined
				let rateLimitHeaders: Record<string, string> | undefined
				let attemptCategory = "SUCCESS"

				try {
					try {
						ticket = await coordinator.acquireTicket({
							providerKey,
							priority: RequestPriority.VERIFIER,
							abortSignal: queueAbort.signal,
						})
					} catch (error) {
						if (queueAbort.signal.aborted && !params.signal?.aborted) {
							throw new Error(`Approval AI queue wait timed out after ${queueTimeoutMs}ms`)
						}
						throw error
					} finally {
						clearTimeout(queueTimeoutId)
						if (params.signal) {
							params.signal.removeEventListener("abort", onParentAbortQueue)
						}
						queueWaitMs = Date.now() - queueStart
						lastQueueWaitMs = queueWaitMs
					}

					if (params.signal?.aborted) {
						lastError = new Error("Approval verification cancelled by user")
						lastCategory = VerifierFailureCategory.CANCELLED
						break
					}

					const remainingAfterQueue = deadline - Date.now()
					if (remainingAfterQueue <= 500) {
						throw new Error(`Approval AI evaluation budget exceeded after queue wait (${TOTAL_BUDGET_MS}ms)`)
					}

					// Bounded model generation timeout: balanced across attempts to prevent attempt 2 starvation
					const attemptsRemaining = maxAttemptsForCandidate - candidateAttempts + 1
					const maxAttemptCap =
						candidateAttempts === 1
							? Math.min(11000, Math.max(4500, Math.floor((remainingAfterQueue - 300) / attemptsRemaining)))
							: Math.min(12000, remainingAfterQueue)
					const genTimeoutMs = Math.min(maxAttemptCap, remainingAfterQueue)
					const genAbort = new AbortController()
					let genTimeoutId: NodeJS.Timeout | undefined
					let rejectCancellation: ((reason: Error) => void) | undefined
					const cancellationPromise = new Promise<never>((_, reject) => { rejectCancellation = reject })

					const onParentAbortGen = () => {
						const cancellation = new Error("Approval AI verification cancelled by user")
						cancellation.name = "AbortError"
						genAbort.abort(cancellation)
						rejectCancellation?.(cancellation)
					}
					if (params.signal) {
						params.signal.addEventListener("abort", onParentAbortGen, { once: true })
						if (params.signal.aborted) onParentAbortGen()
					}

					const timeoutPromise = new Promise<never>((_, reject) => {
						genTimeoutId = setTimeout(() => {
							const timeoutError = new Error(`Approval AI evaluation timed out after ${genTimeoutMs}ms`)
							genAbort.abort(timeoutError)
							reject(timeoutError)
						}, genTimeoutMs)
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
						signal: genAbort.signal,
						maxTokens: isRetry ? (params.maxTokens ?? 350) * 2 : (params.maxTokens ?? 350),
						responseFormat: params.responseFormat,
						attemptId,
						logicalVerificationId,
						managedRetry: true,
						onTransportStart: (at: number) => { transportStartAt = at },
						onTransportResponse: (status: number, at: number, retryAfter?: string | null, headers?: Record<string, string>) => {
							responseStatus = status
							responseHeadersAt = at
							responseRetryAfter = safeRetryAfterHeader(retryAfter)
							rateLimitHeaders = safeRateLimitHeaders(headers)
						},
					}

					requestStartAt = Date.now()
					let callRes: any
					try {
						const providerCall = CommandSafetyJudge.globalCallProviderOverride
							? CommandSafetyJudge.globalCallProviderOverride(callParams)
							: typeof (this.judge as any).callProviderDetails === "function"
								? this.judge.callProviderDetails(callParams)
								: this.judge.callProvider(callParams)
						const observedCall = Promise.resolve(providerCall).then(
							(value) => { requestEndAt = Date.now(); return value },
							(error) => { requestEndAt = Date.now(); throw error },
						)
						callRes = await Promise.race([observedCall, timeoutPromise, cancellationPromise])
					} finally {
						localWaitEndAt = Date.now()
						lastRequestMs = localWaitEndAt - requestStartAt
						if (genTimeoutId) clearTimeout(genTimeoutId)
						if (params.signal) {
							params.signal.removeEventListener("abort", onParentAbortGen)
						}
					}
					const callDetails: ProviderCallDetails = typeof callRes === "string" ? { text: callRes } : callRes
					const rawResponse = callDetails.text

					if (params.validateResponse && !params.validateResponse(rawResponse)) {
						lastError = new Error(`Approval response failed schema or JSON extraction`)
						lastCategory = VerifierFailureCategory.APPROVAL_RESPONSE_INVALID
						attemptCategory = lastCategory
						if (candidateAttempts < maxAttemptsForCandidate && deadline - Date.now() > 1000 && !params.signal?.aborted) {
							ticket?.release()
							attemptCompletedAt = Date.now()
							backoffMs = 300
							await new Promise((r) => setTimeout(r, backoffMs))
							continue
						}
						break
					}

					candidateSucceeded = true
					coordinator.reportSuccess(providerKey)
					ApprovalOrchestrator.recordVerifierSuccess(candidateKey)

					return {
						rawResponse,
						usedCandidate: candidate,
						lastError: null,
						lastCategory: VerifierFailureCategory.OTHER_TRANSIENT,
						attempts: totalAttempts,
						callDetails,
						queueWaitMs: lastQueueWaitMs,
						requestMs: lastRequestMs,
						totalMs: Date.now() - verificationStartAt,
						attemptTimeline,
					}
				} catch (error: any) {
					lastError = error instanceof Error ? error : new Error(String(error))
					lastCategory = classifyVerifierError(lastError)
					attemptCategory = lastCategory
					ticket?.release()

					if (params.signal?.aborted) {
						lastCategory = VerifierFailureCategory.CANCELLED
						attemptCategory = lastCategory
					}
					if (lastCategory === VerifierFailureCategory.CANCELLED) {
						break
					}

					if (lastCategory === VerifierFailureCategory.RATE_LIMIT) {
						const waitMs = retryAfterMs(error)
						coordinator.reportRateLimit(providerKey, (waitMs ?? 5000) / 1000)
						if (
							waitMs !== undefined &&
							waitMs <= 2000 &&
							candidateAttempts < maxAttemptsForCandidate &&
							deadline - Date.now() > waitMs + 1500 &&
							!params.signal?.aborted
						) {
							attemptCompletedAt = Date.now()
							await new Promise<void>((resolve) => {
								const timer = setTimeout(resolve, waitMs)
								if (params.signal) {
									params.signal.addEventListener(
										"abort",
										() => {
											clearTimeout(timer)
											resolve()
										},
										{ once: true },
									)
								}
							})
							if (params.signal?.aborted) {
								lastCategory = VerifierFailureCategory.CANCELLED
								attemptCategory = lastCategory
								break
							}
							continue
						}
						break
					}

					if (!isTransientVerifierError(lastCategory)) {
						break
					}

					const remainingTime = deadline - Date.now()
					if (candidateAttempts < maxAttemptsForCandidate && remainingTime > 1000 && !params.signal?.aborted) {
						backoffMs = Math.min(500, Math.max(100, remainingTime - 1000))
						attemptCompletedAt = Date.now()
						await new Promise<void>((resolve) => {
							const timer = setTimeout(resolve, backoffMs)
							if (params.signal) {
								params.signal.addEventListener("abort", () => {
									clearTimeout(timer)
									resolve()
								}, { once: true })
							}
						})
						if (params.signal?.aborted) {
							lastCategory = VerifierFailureCategory.CANCELLED
							attemptCategory = lastCategory
							break
						}
						continue
					} else {
						break
					}
				} finally {
					ticket?.release()
					const attemptEndAt = attemptCompletedAt || Date.now()
					const attemptLog: VerifierAttemptTiming = {
						logicalVerificationId,
						attemptId,
						provider: candidate.provider,
						model: candidate.modelId,
						createdAt: attemptCreatedAt,
						queueEnterAt: queueStart,
						requestStartAt: requestStartAt || null,
						transportStartAt: transportStartAt || null,
						responseHeadersAt: responseHeadersAt || null,
						requestEndAt: requestEndAt || null,
						localWaitEndAt: localWaitEndAt || null,
						attemptEndAt,
						queueWaitMs,
						requestMs: requestStartAt ? lastRequestMs : 0,
						backoffMs,
						totalMs: attemptEndAt - attemptCreatedAt,
						httpStatus: responseStatus || (attemptCategory !== "SUCCESS" ? errorStatus(lastError) ?? null : null),
						retryAfter:
							responseRetryAfter ??
							(lastError
								? retryAfterMs(lastError)
									? String(Math.round(retryAfterMs(lastError)! / 1000))
									: null
								: null),
						rateLimitHeaders: rateLimitHeaders ?? {},
						category: attemptCategory,
					}
					attemptTimeline.push(attemptLog)
					console.log(`[ApprovalAttempt] ${JSON.stringify(attemptLog)}`)
				}
			}

			if (!candidateSucceeded && lastCategory !== VerifierFailureCategory.CANCELLED) {
				ApprovalOrchestrator.recordVerifierFailure(candidateKey, lastCategory)
			}

			if (params.signal?.aborted || lastCategory === VerifierFailureCategory.CANCELLED) {
				break
			}
		}

		return {
			rawResponse: null,
			usedCandidate: null,
			lastError,
			lastCategory,
			attempts: totalAttempts,
			queueWaitMs: lastQueueWaitMs,
			requestMs: lastRequestMs,
			totalMs: Date.now() - verificationStartAt,
			attemptTimeline,
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

		const workerModel = (getModelId(workerConfig) || "").toLowerCase().trim()
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
	 * 1. Explicit command deny and execution boundary checks
	 * 2. Deterministic fast path (0ms, 0 tokens) -> terminal ALLOW_AUTO or deny
	 * 3. Authority separation for actions that need AI
	 * 4. Contextual AI adjudication by an independent model
	 * 5. Fail-Closed Fallback -> MANUAL_APPROVAL (never fallback to worker model)
	 */
	public async evaluate(
		request: UnifiedApprovalRequest,
		state?: Partial<ExtensionState> | null,
		options?: { signal?: AbortSignal }
	): Promise<ApprovalDecisionResult> {
		const approvalConfig = state?.commandSafetyConfig
		const workerConfig = state?.apiConfiguration
		const taskId = request.taskId || "unknown"
		if (request.actionType === "execute_command" && request.target.command &&
			getCommandDecision(request.target.command, state?.allowedCommands || [], state?.deniedCommands || []) === "auto_deny") {
			const reason = "Command matches an explicit user deny rule."
			const result: ApprovalDecisionResult = {
				decision: "DENY_AND_REPLAN", risk: "high", reason, taskAligned: false,
				auditLog: `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=auto fastPath=true approvalModelCalled=false finalDecision=DENY_AND_REPLAN reason="${reason}"`,
			}
			this.recordDecision(request, result, undefined, true, state)
			return result
		}

		// 1. Command-specific Execution Boundary Analysis (intercept boundary escapes first)
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

		// 2. Deterministic Fast-Path Evaluation
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

		// 3. Only actions needing AI require an independent verifier.
		if (!this.validateAuthoritySeparation(workerConfig, approvalConfig)) {
			const reason = `AI Collusion Hazard: Configured Approval Authority model ('${approvalConfig?.modelId}') is identical to Worker Model. Self-approval is forbidden. Manual approval required.`
			const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=auto fastPath=false approvalModelCalled=false finalDecision=MANUAL_APPROVAL reason="${reason}"`
			const result: ApprovalDecisionResult = {
				decision: "MANUAL_APPROVAL", risk: "critical", reason, taskAligned: false,
				hardBoundaryViolation: true, auditLog,
			}
			this.recordDecision(request, result, approvalConfig?.modelId, false, state)
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

		const verificationKey = `${taskId}:${request.id}`
		const active = ApprovalOrchestrator.inFlightVerifications.get(verificationKey)
		if (active) {
			const signal = options?.signal
			if (!signal) return await active
			const cancelled: ApprovalDecisionResult = {
				decision: "MANUAL_APPROVAL",
				risk: "high",
				reason: "Safety verification was cancelled. Review this action manually.",
				taskAligned: false,
				infrastructureFailure: true,
				verifierFailureCategory: VerifierFailureCategory.CANCELLED,
				auditLog: `[ApprovalAudit] taskId=${taskId} actionId=${request.id} duplicate=true finalDecision=MANUAL_APPROVAL reason="cancelled"`,
			}
			if (signal.aborted) return cancelled
			let onAbort: (() => void) | undefined
			try {
				const aborted = new Promise<ApprovalDecisionResult>((resolve) => {
					onAbort = () => resolve(cancelled)
					signal.addEventListener("abort", onAbort, { once: true })
					if (signal.aborted) onAbort()
				})
				const result = await Promise.race([active, aborted])
				return signal.aborted ? cancelled : result
			} finally {
				if (onAbort) signal.removeEventListener("abort", onAbort)
			}
		}

		const verification = request.actionType === "attempt_completion"
			? this.evaluateCompletionWithApprovalAi(request, state!, options)
			: this.evaluateWithApprovalAi(request, state!, options)
		ApprovalOrchestrator.inFlightVerifications.set(verificationKey, verification)
		try {
			return await verification
		} finally {
			if (ApprovalOrchestrator.inFlightVerifications.get(verificationKey) === verification) {
				ApprovalOrchestrator.inFlightVerifications.delete(verificationKey)
			}
		}
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
			const isMutatingTask = (content: string) =>
				/implement|edit|modify|fix|polish|patch|create\s+file|delete|build|setup|write\s+(?:code|files?)|add\s+(?:code|files?)/i.test(content)

			const actionableInProgress = inProgress.filter((t) => {
				if ((hasNoModifyConstraint || isReadOnlyOrReportScope) && isMutatingTask(t.content)) {
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
						guidance:
							"Finish this in-progress item. If blocked, mark it blocked and report the blocker; if out of scope, use update_todo_list to mark it [c] (cancelled).",
					})),
				}
			}

			// Gate 4: Check pending TODOs (ignore blocked or cancelled items)
			const pending = (target.todoListSnapshot || []).filter(
				(t) => t.status === "pending"
			)
			const actionablePending = pending.filter((t) => {
				if ((hasNoModifyConstraint || isReadOnlyOrReportScope) && isMutatingTask(t.content)) {
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
						guidance: "Complete pending item, or update todo list to [c] (cancelled) if no longer applicable.",
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
				if ((hasNoModifyConstraint || isReadOnlyOrReportScope) && isMutatingTask(t.content)) {
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
			// Hard-block writes to protected files (rules, configs, keys) - System Safety P0 (Non-overridable)
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

			// Hard-block writes outside workspace in autonomous mode - System Safety P0 (Non-overridable)
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

			const explicitConstraints = request.taskContext.explicitConstraints || []
			const latestInstruction = request.taskContext.latestUserInstruction || ""
			const substantiveInstruction = request.taskContext.latestSubstantiveInstruction || latestInstruction
			const activeGoal = request.taskContext.activeGoal || ""
			const normTarget = (target.filePath || "").replace(/\\/g, "/").toLowerCase()

			// Extract scoped write allowances and denials
			const scopedAllows: string[] = [
				...(request.taskContext.scopedWriteAllows || []).map((s) => s.replace(/\\/g, "/").toLowerCase().trim()),
			]
			const scopedDenies: string[] = [
				...(request.taskContext.scopedWriteDenies || []).map((s) => s.replace(/\\/g, "/").toLowerCase().trim()),
			]
			const supplementalAllows = (request.taskContext.supplementalWriteAllows || []).map((s) =>
				s.replace(/\\/g, "/").toLowerCase().trim(),
			)
			const hasCanonicalScope = request.taskContext.canonicalConstraints !== undefined

			for (const c of hasCanonicalScope ? [] : explicitConstraints) {
				const allowMatch = c.match(
					/(?:ALLOWED\s+to\s+modify|możesz\s+modyfikować|modyfikuj\s+wyłącznie|modify\s+only)\s*(.+)/i
				)
				if (allowMatch && allowMatch[1]) {
					const cleanScope = allowMatch[1].replace(/[\(\)].*$/, "").trim().toLowerCase()
					if (cleanScope && !/^(kodu|code|all\s+files|wszystko)$/i.test(cleanScope)) {
						scopedAllows.push(cleanScope)
					}
				}
				const denyMatch = c.match(
					/(?:DO\s+NOT\s+modify(?:\s+files\s+in|\s+code\s+in)?|nie\s+modyfikuj(?:\s+plików\s+w|\s+kodu\s+w)?)\s*(.+)/i
				)
				if (denyMatch && denyMatch[1]) {
					const cleanScope = denyMatch[1].replace(/[\(\)].*$/, "").trim().toLowerCase()
					if (cleanScope && !/^(kodu|code|all\s+files|wszystko)$/i.test(cleanScope)) {
						scopedDenies.push(cleanScope)
					}
				}
			}

			// Also parse prompt text if scopes are not explicitly extracted in explicitConstraints
			const promptText = `${substantiveInstruction}\n${latestInstruction}\n${activeGoal}`

			const allowSectionRegex =
				/(?:modify\s+only|you\s+(?:may|can)\s+modify\s+only|commit\s+only|change\s+only|edit\s+only|modyfikuj\s+wyłącznie|zmieniaj\s+tylko|edytuj\s+tylko|commituj\s+tylko|popraw\s+tylko|napraw\s+tylko|fix\s+only|zakres\s+zapisu(?:\s*:\s*|\s+)wyłącznie(?:\s*w)?|authorized\s+to\s+modify\s+only):?([\s\S]*?)(?=(?:\n\s*\n|\b(?:do\s+not|nie\s+(?:modyfikuj|commituj|zmieniaj|ruszaj)|zakaz|goals?|instructions?|uwaga)\b|$))/i
			const allowSectionMatch = hasCanonicalScope ? null : promptText.match(allowSectionRegex)
			if (allowSectionMatch && allowSectionMatch[1]) {
				const lines = allowSectionMatch[1].split(/\n|;|,|\/|\s+and\s+|\s+or\s+|\s+oraz\s+|\s+i\s+/)
				for (const line of lines) {
					let cleaned = line
						.trim()
						.replace(/^[\s*\->•]+/, "")
						.replace(/[\(\)].*$/, "")
						.replace(/[.,:;!]+$/, "")
						.trim()
						.toLowerCase()
					if (cleaned.length > 4 && cleaned.endsWith("u")) {
						cleaned = cleaned.slice(0, -1)
					}
					if (
						cleaned &&
						!/^(kodu|code|all\s+files|wszystko|pliki|files)$/i.test(cleaned) &&
						!scopedAllows.includes(cleaned)
					) {
						scopedAllows.push(cleaned)
					}
				}
			}

			const denySectionRegex =
				/(?:do\s+not\s+(?:modify|commit|touch|edit)\s*(?:files\s+in|code\s+in)?|nie\s+(?:modyfikuj|commituj|ruszaj|zmieniaj)\s*(?:plików\s+w|kodu\s+w)?|zakaz\s+modyfikacji):?([\s\S]*?)(?=(?:\n\s*\n|\b(?:modify\s+only|commit\s+only|change\s+only|modyfikuj\s+wyłącznie|zmieniaj\s+tylko|edytuj\s+tylko|commituj\s+tylko|popraw\s+tylko|napraw\s+tylko|fix\s+only|ale\s+popraw|zamiast\s+tego|goals?|instructions?|uwaga)\b|$))/i
			const denySectionMatch = hasCanonicalScope ? null : promptText.match(denySectionRegex)
			if (denySectionMatch && denySectionMatch[1]) {
				const lines = denySectionMatch[1].split(/\n|;|,|\/|\s+and\s+|\s+or\s+|\s+oraz\s+|\s+i\s+/)
				for (const line of lines) {
					let cleaned = line
						.trim()
						.replace(/^[\s*\->•]+/, "")
						.replace(/[\(\)].*$/, "")
						.replace(/[.,:;!]+$/, "")
						.trim()
						.toLowerCase()
					if (cleaned.length > 4 && cleaned.endsWith("u")) {
						cleaned = cleaned.slice(0, -1)
					}
					if (
						cleaned &&
						!/^(kodu|code|all\s+files|wszystko|pliki|files)$/i.test(cleaned) &&
						!scopedDenies.includes(cleaned)
					) {
						scopedDenies.push(cleaned)
					}
				}
			}

			// Helper to check scope match
			const isScopeMatch = (filePath: string, scopePattern: string) => {
				const clean = scopePattern
					.replace(/^\.?\//, "")
					.replace(/\/$/, "")
					.replace(/[.,:;!]+$/, "")
					.trim()
				return Boolean(clean && (filePath === clean || filePath.startsWith(`${clean}/`) || filePath.endsWith(`/${clean}`) || filePath.includes(`/${clean}/`)))
			}

			// 1. Check scoped denials
			const forbiddenScope = scopedDenies.find((d) => isScopeMatch(normTarget, d))
			if (forbiddenScope) {
				return {
					decision: "DENY_AND_REPLAN",
					risk: "medium",
					reason: `The user explicitly forbade modifying files in scope '${forbiddenScope}'.`,
					taskAligned: false,
					hardBoundaryViolation: false,
					isUserConstraintViolation: true,
					violatedConstraint: `DO NOT modify files in ${forbiddenScope}`,
					replanGuidance: `Do not modify files in forbidden scope '${forbiddenScope}'. Only work within authorized scopes.`,
				}
			}
			const supplementalAllow = supplementalAllows.find((a) => isScopeMatch(normTarget, a))
			if (supplementalAllow) {
				return {
					decision: "ALLOW_AUTO",
					risk: "low",
					reason: `File modification matches an additional user-authorized scope '${supplementalAllow}'.`,
					taskAligned: true,
				}
			}

			// 2. Check scoped allowances
			const matchingAllowScope = scopedAllows.find((a) => isScopeMatch(normTarget, a))
			if (matchingAllowScope) {
				return {
					decision: "ALLOW_AUTO",
					risk: "low",
					reason: `File modification matches explicitly authorized scope '${matchingAllowScope}'.`,
					taskAligned: true,
				}
			}

			// 3. If explicit scoped allows exist but this target does NOT match any of them
			if (scopedAllows.length > 0) {
				return {
					decision: "DENY_AND_REPLAN",
					risk: "medium",
					reason: `Target file is outside the explicitly authorized modification scope (${scopedAllows.join(", ")}).`,
					taskAligned: false,
					hardBoundaryViolation: false,
					isUserConstraintViolation: true,
					violatedConstraint: `modify only ${scopedAllows.join(", ")}`,
					replanGuidance: `Do not modify files outside authorized scope (${scopedAllows.join(", ")}). Work only in allowed scopes.`,
				}
			}

			// 4. Affirmative override checking on latest instructions
			const hasAffirmativeModifyOverride =
				/(?:disable.*read-only|lift.*read-only|remove.*read-only|allow.*modify|zezwalam.*modyfikacj|wyłącz.*read-only|odblokuj.*edycj|you\s+can\s+modify|możesz(?:\s+jednak)?\s+modyfikować|(?:^|[^\w])(?!nie\s+)(?:popraw|napraw|fix)\s+(?:kod|frontend|ui|backend|bug|błąd|[a-z0-9_-]+))/i.test(
					substantiveInstruction
				) ||
				/(?:disable.*read-only|lift.*read-only|remove.*read-only|allow.*modify|zezwalam.*modyfikacj|wyłącz.*read-only|odblokuj.*edycj|you\s+can\s+modify|możesz(?:\s+jednak)?\s+modyfikować|(?:^|[^\w])(?!nie\s+)(?:popraw|napraw|fix)\s+(?:kod|frontend|ui|backend|bug|błąd|[a-z0-9_-]+))/i.test(
					latestInstruction
				)

			// 5. Global negative constraint check
			const hasNoModifyConstraint =
				!hasAffirmativeModifyOverride &&
				(explicitConstraints.some((c) => {
					// Guard against negative assertions like "This is NOT a read-only review" or "To NIE jest zadanie read-only"
					const isNegative =
						/(?:not|nie\s+jest|no\s+longer|to\s+nie\s+jest)\s+(?:a\s+)?(?:strictly\s+)?(?:read-only|tylko\s+do\s+odczytu|analiz[aą])/i.test(
							c
						)
					if (isNegative) return false
					return /nie\s+(?:modyfikuj|poprawiaj|naprawiaj|zmieniaj)\s+(?:kodu|plików|niczego)|do\s+not\s+(?:modify|fix|change)\s+(?:code|files|anything)|read-only|tylko\s+do\s+odczytu/i.test(
						c
					)
				}) ||
					/(?:^|\b)(?:nie\s+(?:poprawiaj|naprawiaj|zmieniaj|ruszaj)\s+(?:kodu|plików|niczego)|do\s+not\s+(?:modify|fix|change|touch)\s+(?:code|files|anything))\b/i.test(
						promptText
					))
			if (hasNoModifyConstraint) {
				return {
					decision: "DENY_AND_REPLAN",
					risk: "medium",
					reason: "The current task is strictly read-only by user constraint ('DO NOT modify code'). Modifying source files is forbidden.",
					taskAligned: false,
					hardBoundaryViolation: false,
					isUserConstraintViolation: true,
					violatedConstraint: "DO NOT modify code (READ-ONLY)",
					replanGuidance:
						"The current task is explicitly read-only. Do not modify source code or attempt to make failing tests pass by editing implementation. Continue the review using read-only inspection or test runs only.",
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
				const substantiveInstruction = request.taskContext.latestSubstantiveInstruction || latestInstruction
				const activeGoal = request.taskContext.activeGoal || ""

				// 1. Check affirmative user override in latest or substantive user instruction
				const hasAffirmativeOverride =
					/(?:proceed\s+with|tak|yes|potwierdzam|confirm|allow|permit|go\s+ahead|approved?|możesz|you\s+can|you\s+may).*(?:commit|add|staging)/i.test(
						substantiveInstruction
					) ||
					/(?:proceed\s+with|tak|yes|potwierdzam|confirm|allow|permit|go\s+ahead|approved?|możesz|you\s+can|you\s+may).*(?:commit|add|staging)/i.test(
						latestInstruction
					)

				// 2. Extract scoped permissions and prohibitions
				const scopedAllows: string[] = [
					...(request.taskContext.scopedWriteAllows || []).map((s) => s.replace(/\\/g, "/").toLowerCase().trim()),
				]
				const scopedDenies: string[] = [
					...(request.taskContext.scopedWriteDenies || []).map((s) => s.replace(/\\/g, "/").toLowerCase().trim()),
				]

				for (const c of explicitConstraints) {
					const allowMatch = c.match(
						/(?:ALLOWED\s+to\s+commit|commit\s+wyłącznie|masz\s+pozwolenie\s+na:\s*commit\s+wyłącznie|możesz\s+commitować)\s*(.+)/i
					)
					if (allowMatch && allowMatch[1]) {
						scopedAllows.push(
							...allowMatch[1]
								.split(/[\s,;/]+/)
								.map((s) => s.trim().toLowerCase())
								.filter(Boolean)
						)
					}
					const denyMatch = c.match(
						/(?:DO\s+NOT\s+commit(?:\s+changes)?(?:\s+to)?|nie\s+commituj(?:\s+zmian)?)\s*(.+)/i
					)
					if (denyMatch && denyMatch[1]) {
						const rawScope = denyMatch[1].replace(/\(nie\s+commituj\)/i, "").trim()
						if (rawScope && !/^(changes|kodu|files)?$/i.test(rawScope)) {
							scopedDenies.push(
								...rawScope
									.split(/[\s,;/]+/)
									.map((s) => s.trim().toLowerCase())
									.filter(Boolean)
							)
						}
					}
				}

				// Also inspect prompt text for scoped rules if not in explicitConstraints
				const promptText = `${substantiveInstruction}\n${latestInstruction}\n${activeGoal}`
				const promptAllowMatch = promptText.match(
					/(?:commit\s+wyłącznie|masz\s+pozwolenie\s+na:\s*commit\s+wyłącznie|you\s+(?:may|can)\s+commit\s+only)\s*([^\n.;]+)/i
				)
				if (promptAllowMatch && promptAllowMatch[1]) {
					scopedAllows.push(
						...promptAllowMatch[1]
							.split(/[\s,;/]+/)
							.map((s) => s.trim().toLowerCase())
							.filter(Boolean)
					)
				}
				const promptDenyMatch = promptText.match(
					/(?:nie\s+commituj\s+zmian|do\s+not\s+commit\s+changes\s+to)\s*([^\n.;]+)/i
				)
				if (promptDenyMatch && promptDenyMatch[1]) {
					scopedDenies.push(
						...promptDenyMatch[1]
							.split(/[\s,;/]+/)
							.map((s) => s.trim().toLowerCase())
							.filter(Boolean)
					)
				}

				// Parse target paths from git command (e.g., git add -- velune-website/)
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
						reason:
							"Cannot stage all files globally with 'git add .' when prohibited scopes exist. Stage only the allowed scope.",
						taskAligned: false,
						hardBoundaryViolation: false,
						isUserConstraintViolation: true,
						violatedConstraint: "scoped commit policy",
						replanGuidance: `Stage only the specifically authorized scope (${scopedAllows.join(", ") || "explicit directory"}) rather than all files.`,
					}
				}

				// Check if the target explicitly matches an allowed scope
				const matchesAllowedScope =
					scopedAllows.length > 0 &&
					(pathArgs.some((p) => scopedAllows.some((allowedScope) => p.toLowerCase().includes(allowedScope))) ||
						(/^git\s+commit/i.test(cmd) && pathArgs.length === 0))

				if (matchesAllowedScope || hasAffirmativeOverride) {
					return {
						decision: "ALLOW_AUTO",
						risk: "low",
						reason: `Git operation scoped to authorized path (${pathArgs.join(", ") || scopedAllows.join(", ") || "authorized scope"}) per user instruction.`,
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
						reason:
							"The user explicitly forbade git commits/modifications ('NIE commituj'). Staging or committing code is forbidden.",
						taskAligned: false,
						hardBoundaryViolation: false,
						isUserConstraintViolation: true,
						violatedConstraint: "NIE commituj",
						replanGuidance:
							"Do not stage or commit files. Keep changes unstaged or work strictly read-only per user instructions.",
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
		state: Partial<ExtensionState>,
		options?: { signal?: AbortSignal }
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
				scopedWriteAllows: request.taskContext.scopedWriteAllows?.map((s) => sanitizeForSafetyPrompt(s, knownSecrets)),
				supplementalWriteAllows: request.taskContext.supplementalWriteAllows?.map((s) => sanitizeForSafetyPrompt(s, knownSecrets)),
				scopedWriteDenies: request.taskContext.scopedWriteDenies?.map((s) => sanitizeForSafetyPrompt(s, knownSecrets)),
				workspacePath: request.taskContext.workspacePath,
				isWithinWorkspace: request.taskContext.isWithinWorkspace,
			},
			stage1Risk: request.executionBoundary?.hostImpact.highestRisk,
			stage1Reason: request.executionBoundary?.hostImpact.reasons.join("; "),
			previousDenial: request.previousDenial,
		})
		const promptBytes = Buffer.byteLength(systemPrompt + userPrompt, "utf8")
		const promptApproxTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4)

		const execResult = await this.executeWithFallback({
			systemPrompt,
			userPrompt,
			state,
			maxTokens: 350,
			logicalVerificationId: request.id,
			signal: options?.signal,
			validateResponse: (raw: string) => safeExtractJson(raw, approvalDecisionResultSchema).success,
		})

		if (execResult.rawResponse !== null && execResult.usedCandidate) {
			const extraction = safeExtractJson(execResult.rawResponse, approvalDecisionResultSchema)
			if (extraction.success && extraction.data) {
				const parsed = extraction.data
				let finalReason: string = parsed.reason || "Action evaluated by safety judge."
				if (
					(parsed.decision === "DENY_AND_REPLAN" || parsed.decision === "HARD_BLOCK") &&
					!finalReason.toLowerCase().startsWith("safety verification rejected")
				) {
					finalReason = `Safety verification rejected this action. ${finalReason}`
				}
				const retryText = execResult.attempts > 1 ? ` retry=true attempt=${execResult.attempts}` : ""
				const tierText = execResult.usedCandidate.tier !== "primary" ? ` tier=${execResult.usedCandidate.tier}` : ""
				const extractionNote = extraction.category !== "VALID_JSON" ? ` jsonCategory=${extraction.category}` : ""
				const timingText = ` queueWaitMs=${execResult.queueWaitMs ?? 0} requestMs=${execResult.requestMs ?? 0} totalMs=${execResult.totalMs ?? 0} approvalPromptBytes=${promptBytes} approvalPromptApproxTokens=${promptApproxTokens}`
				const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=${state.approvalMode} fastPath=false approvalModelCalled=true approvalModel=${execResult.usedCandidate.modelId}${tierText}${retryText}${extractionNote}${timingText} finalDecision=${parsed.decision} reason="${finalReason}"`

				const result: ApprovalDecisionResult = {
					decision: parsed.decision,
					risk: parsed.risk as CommandSafetyRiskLevel,
					reason: finalReason,
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
					queueWaitMs: execResult.queueWaitMs,
					requestMs: execResult.requestMs,
					totalMs: execResult.totalMs,
					attemptTimeline: execResult.attemptTimeline,
					approvalPromptBytes: promptBytes,
					approvalPromptApproxTokens: promptApproxTokens,
					auditLog,
				}

				this.recordDecision(request, result, execResult.usedCandidate.modelId, false, state)
				return result
			}
		}

		// Infrastructure failure or schema invalidity across all candidate models
		const isSchemaInvalid = execResult.lastCategory === VerifierFailureCategory.APPROVAL_RESPONSE_INVALID
		const isModelUnavailable =
			execResult.lastCategory === VerifierFailureCategory.MODEL_UNAVAILABLE ||
			execResult.lastCategory === VerifierFailureCategory.INVALID_MODEL
		const isVerifierUnavailable =
			isModelUnavailable ||
			execResult.lastCategory === VerifierFailureCategory.FREE_QUOTA_EXHAUSTED ||
			execResult.lastCategory === VerifierFailureCategory.AUTH
		const errorMsg = execResult.lastError ? execResult.lastError.message : "Unknown verification failure"

		const timingText = ` queueWaitMs=${execResult.queueWaitMs ?? 0} requestMs=${execResult.requestMs ?? 0} totalMs=${execResult.totalMs ?? 0} approvalPromptBytes=${promptBytes} approvalPromptApproxTokens=${promptApproxTokens}`
		const cooldownText = execResult.inCooldown ? " inCooldown=true" : ""

		let reason: string
		if (execResult.inCooldown) {
			reason = "Safety verification is in cooldown after repeated failures. Review this action manually."
		} else if (isSchemaInvalid) {
			reason = `Approval response schema validation failed (${errorMsg}). Fail closed.`
		} else if (isModelUnavailable) {
			reason = `Safety verification model is unavailable. Configured model no longer exists or cannot be used. (${execResult.lastCategory}: ${errorMsg})`
		} else if (execResult.lastCategory === VerifierFailureCategory.FREE_QUOTA_EXHAUSTED) {
			reason = `Safety verification quota exhausted. Review this action manually. (FREE_QUOTA_EXHAUSTED: ${errorMsg})`
		} else if (execResult.lastCategory === VerifierFailureCategory.AUTH) {
			reason = `Safety verification authentication failed. Review your API key. (AUTH: ${errorMsg})`
		} else if (execResult.lastCategory === VerifierFailureCategory.RATE_LIMIT) {
			reason = `Safety verification is temporarily rate limited. Review this action manually. (RATE_LIMIT: ${errorMsg})`
		} else if (execResult.lastCategory === VerifierFailureCategory.TIMEOUT) {
			reason = `Safety verification temporarily unavailable. Review this action manually. (TIMEOUT: ${errorMsg})`
		} else if (execResult.lastCategory === VerifierFailureCategory.PROVIDER_ERROR) {
			reason = `Safety verification temporarily unavailable. Review this action manually. (PROVIDER_ERROR: ${errorMsg})`
		} else if (execResult.lastCategory === VerifierFailureCategory.NETWORK) {
			reason = `Safety verification temporarily unavailable. Review this action manually. (NETWORK: ${errorMsg})`
		} else if (execResult.lastCategory === VerifierFailureCategory.CANCELLED) {
			reason = `Safety verification was cancelled. Review this action manually. (CANCELLED: ${errorMsg})`
		} else {
			reason = `Safety verification temporarily unavailable. Review this action manually. (${execResult.lastCategory || "VERIFIER_FAILED"}: ${errorMsg})`
		}

		const auditLog = `[ApprovalAudit] taskId=${taskId} actionId=${request.id} actionType=${request.actionType} mode=${state.approvalMode} fastPath=false approvalModelCalled=true attempt=${execResult.attempts} infrastructureFailure=true verifierUnavailable=${isVerifierUnavailable}${cooldownText} verifierCategory=${execResult.lastCategory}${timingText} finalDecision=MANUAL_APPROVAL reason="${reason}"`

		const highestRisk = request.executionBoundary?.hostImpact.highestRisk
		const fallbackRisk: CommandSafetyRiskLevel = highestRisk && highestRisk !== "none" ? highestRisk : "medium"

		const extractedRetryAfterMs = extractRetryAfterMsFromTimeline(execResult.attemptTimeline)

		const result: ApprovalDecisionResult = {
			decision: "MANUAL_APPROVAL",
			risk: fallbackRisk,
			reason,
			taskAligned: false,
			infrastructureFailure: true,
			verifierUnavailable: isVerifierUnavailable,
			verifierFailureCategory: execResult.lastCategory,
			approvalAttemptCount: execResult.attempts,
			queueWaitMs: execResult.queueWaitMs,
			requestMs: execResult.requestMs,
			totalMs: execResult.totalMs,
			attemptTimeline: execResult.attemptTimeline,
			approvalPromptBytes: promptBytes,
			approvalPromptApproxTokens: promptApproxTokens,
			auditLog,
			retryAfterMs: extractedRetryAfterMs,
			inCooldown: execResult.inCooldown,
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
				reason: data.reason || "Action evaluated by safety judge.",
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
		state: Partial<ExtensionState>,
		options?: { signal?: AbortSignal }
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
		const approvalPromptBytes = Buffer.byteLength(systemPrompt + userPrompt, "utf8")
		const approvalPromptApproxTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4)
		const attemptTimeline: VerifierAttemptTiming[] = []
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
				logicalVerificationId: `${request.id}-judge-${judgeAttempt}`,
				signal: options?.signal,
				responseFormat: "json_object",
			})

			totalAttempts += execResult.attempts
			attemptTimeline.push(...(execResult.attemptTimeline || []))
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
						attemptTimeline,
						approvalPromptBytes,
						approvalPromptApproxTokens,
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
		const isModelUnavailable =
			lastErrorCategory === VerifierFailureCategory.MODEL_UNAVAILABLE ||
			lastErrorCategory === VerifierFailureCategory.INVALID_MODEL
		const verifierUnavailable = isModelUnavailable
		let reason: string
		if (isModelUnavailable) {
			reason = `Safety verification model is unavailable. Configured model no longer exists or cannot be used. (${lastErrorCategory}: ${lastErrorMessage})`
		} else if (lastErrorCategory === VerifierFailureCategory.RATE_LIMIT || lastErrorCategory === "RATE_LIMIT") {
			reason = `Safety verification is temporarily rate limited. Review this action manually. (RATE_LIMIT: ${lastErrorMessage})`
		} else {
			reason = `Completion Judge verification could not produce a valid decision (${lastErrorCategory}: ${lastErrorMessage}). Task completion requires manual approval.`
		}
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

		const extractedRetryAfterMs = extractRetryAfterMsFromTimeline(attemptTimeline)

		const result: ApprovalDecisionResult = {
			decision: "MANUAL_APPROVAL",
			risk: "high",
			reason,
			taskAligned: false,
			infrastructureFailure: true,
			verifierUnavailable,
			verifierFailureCategory: mappedFailureCategory,
			approvalAttemptCount: totalAttempts,
			attemptTimeline,
			approvalPromptBytes,
			approvalPromptApproxTokens,
			auditLog,
			retryAfterMs: extractedRetryAfterMs,
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
			latencyMs: result.totalMs,
			attemptTimeline: result.attemptTimeline,
			approvalPromptBytes: result.approvalPromptBytes,
			approvalPromptApproxTokens: result.approvalPromptApproxTokens,
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
