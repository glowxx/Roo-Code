/**
 * StreamAudit - Telemetry and forensic audit for streaming requests
 *
 * Tracks latency, inter-event gaps, reasoning/content/tool events, idle watchdog triggers,
 * side-effect safety, and auto-retry recovery.
 */

export interface StreamAuditData {
	requestId: string
	provider: string
	model: string

	streamStartedAt: number // epoch ms
	streamStartedAtIso: string
	firstEventMs: number | null
	firstReasoningMs: number | null
	firstContentMs: number | null

	lastEventType: "reasoning" | "text" | "tool" | "usage" | "heartbeat" | "none"
	largestInterEventGapMs: number

	validEventCount: number
	reasoningEventCount: number
	contentEventCount: number
	toolEventCount: number

	idleTimeoutMs: number
	idleTriggered: boolean
	idleCategory: "TRANSIENT_STREAM_IDLE" | "NONE"

	partialChars: number
	toolCallObserved: boolean
	sideEffectObserved: boolean

	autoRetryEligible: boolean
	autoRetryAttempt: number
	retrySucceeded: boolean | null
}

export class StreamAuditTracker {
	public data: StreamAuditData
	private lastEventTime: number

	constructor(
		paramsOrTaskId:
			| string
			| {
					requestId: string
					provider: string
					model: string
					idleTimeoutMs: number
					autoRetryAttempt: number
			  },
		instanceId?: string,
		provider?: string,
		model?: string,
		autoRetryAttempt?: number,
		idleTimeoutMs?: number,
	) {
		const now = Date.now()
		this.lastEventTime = performance.now()

		let requestId: string
		let prov: string
		let mod: string
		let idleMs: number
		let retryAttempt: number

		if (typeof paramsOrTaskId === "object") {
			requestId = paramsOrTaskId.requestId
			prov = paramsOrTaskId.provider
			mod = paramsOrTaskId.model
			idleMs = paramsOrTaskId.idleTimeoutMs
			retryAttempt = paramsOrTaskId.autoRetryAttempt
		} else {
			requestId = instanceId ? `${paramsOrTaskId}.${instanceId}` : paramsOrTaskId
			prov = provider || "unknown"
			mod = model || "unknown"
			retryAttempt = autoRetryAttempt ?? 0
			idleMs = idleTimeoutMs ?? 45_000
		}

		this.data = {
			requestId,
			provider: prov,
			model: mod,
			streamStartedAt: now,
			streamStartedAtIso: new Date(now).toISOString(),
			firstEventMs: null,
			firstReasoningMs: null,
			firstContentMs: null,
			lastEventType: "none",
			largestInterEventGapMs: 0,
			validEventCount: 0,
			reasoningEventCount: 0,
			contentEventCount: 0,
			toolEventCount: 0,
			idleTimeoutMs: idleMs,
			idleTriggered: false,
			idleCategory: "NONE",
			partialChars: 0,
			toolCallObserved: false,
			sideEffectObserved: false,
			autoRetryEligible: true,
			autoRetryAttempt: retryAttempt,
			retrySucceeded: null,
		}
	}

	public recordEvent(
		type: "reasoning" | "text" | "tool" | "usage" | "heartbeat",
		charCount: number = 0,
	): void {
		const now = performance.now()
		const elapsedSinceStart = Math.round(now - (now - (Date.now() - this.data.streamStartedAt)))
		const gap = Math.round(now - this.lastEventTime)

		if (this.data.validEventCount > 0 && gap > this.data.largestInterEventGapMs) {
			this.data.largestInterEventGapMs = gap
		}
		this.lastEventTime = now

		this.data.validEventCount++
		this.data.lastEventType = type

		if (this.data.firstEventMs === null) {
			this.data.firstEventMs = Math.max(0, elapsedSinceStart)
		}

		if (type === "reasoning") {
			this.data.reasoningEventCount++
			this.data.partialChars += charCount
			if (this.data.firstReasoningMs === null) {
				this.data.firstReasoningMs = Math.max(0, elapsedSinceStart)
			}
		} else if (type === "text") {
			this.data.contentEventCount++
			this.data.partialChars += charCount
			if (this.data.firstContentMs === null) {
				this.data.firstContentMs = Math.max(0, elapsedSinceStart)
			}
		} else if (type === "tool") {
			this.data.toolEventCount++
			this.data.toolCallObserved = true
		}
	}

	public recordChunk(
		type: "reasoning" | "text" | "tool" | "tool_call" | "tool_call_partial" | "usage" | "grounding" | "heartbeat",
		charCount: number = 0,
	): void {
		const mappedType =
			type === "tool_call" || type === "tool_call_partial"
				? "tool"
				: type === "grounding"
					? "heartbeat"
					: type
		this.recordEvent(mappedType, charCount)
	}

	public recordSideEffect(): void {
		this.data.sideEffectObserved = true
		this.data.autoRetryEligible = false
	}

	public recordIdleTimeout(isTransient: boolean = true): void {
		this.data.idleTriggered = true
		this.data.idleCategory = isTransient ? "TRANSIENT_STREAM_IDLE" : "NONE"
		if (this.data.sideEffectObserved) {
			this.data.autoRetryEligible = false
		}
	}

	public recordOutcome(succeeded: boolean, _errorMessage?: string, isAutoRetrying?: boolean): void {
		this.data.retrySucceeded = succeeded
		if (!succeeded && isAutoRetrying) {
			this.recordIdleTimeout(true)
		}
	}

	public formatLog(): string {
		const d = this.data
		return (
			`[StreamAudit] ` +
			`requestId=${d.requestId} ` +
			`provider=${d.provider} ` +
			`model=${d.model} ` +
			`streamStartedAt=${d.streamStartedAtIso} ` +
			`firstEventMs=${d.firstEventMs ?? "null"} ` +
			`firstReasoningMs=${d.firstReasoningMs ?? "null"} ` +
			`firstContentMs=${d.firstContentMs ?? "null"} ` +
			`lastEventType=${d.lastEventType} ` +
			`largestInterEventGapMs=${d.largestInterEventGapMs} ` +
			`validEventCount=${d.validEventCount} ` +
			`reasoningEventCount=${d.reasoningEventCount} ` +
			`contentEventCount=${d.contentEventCount} ` +
			`toolEventCount=${d.toolEventCount} ` +
			`idleTimeoutMs=${d.idleTimeoutMs} ` +
			`idleTriggered=${d.idleTriggered} ` +
			`idleCategory=${d.idleCategory} ` +
			`partialChars=${d.partialChars} ` +
			`toolCallObserved=${d.toolCallObserved} ` +
			`sideEffectObserved=${d.sideEffectObserved} ` +
			`autoRetryEligible=${d.autoRetryEligible} ` +
			`autoRetryAttempt=${d.autoRetryAttempt} ` +
			`retrySucceeded=${d.retrySucceeded ?? "null"}`
		)
	}

	public log(): void {
		console.log(this.formatLog())
	}
}
