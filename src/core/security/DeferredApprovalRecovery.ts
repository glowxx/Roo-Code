import type { DeferredAttemptSchedule, VerifierAttemptTiming } from "@roo-code/types"

export interface DeferredRecoveryConfig {
	maxAttempts?: number
	baseDelayMs?: number
	maxDelayMs?: number
	minDelayMs?: number
	jitterRatio?: number
}

export function extractRetryAfterMsFromTimeline(timeline?: VerifierAttemptTiming[]): number | undefined {
	if (!timeline || timeline.length === 0) return undefined
	for (const attempt of [...timeline].reverse()) {
		if (attempt.retryAfter) {
			const val = attempt.retryAfter.trim()
			const sec = Number(val)
			if (Number.isFinite(sec) && sec > 0) return sec * 1000
			const parsed = Date.parse(val)
			if (Number.isFinite(parsed) && parsed > Date.now()) return parsed - Date.now()
		}
	}
	return undefined
}

export function calculateDeferredBackoff(
	attempt: number,
	retryAfterMs?: number,
	config: DeferredRecoveryConfig = {},
): DeferredAttemptSchedule {
	const maxAttempts = config.maxAttempts ?? 3
	const minDelay = config.minDelayMs ?? 5000
	const maxDelay = config.maxDelayMs ?? 60000

	if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
		const clampedDelay = Math.min(maxDelay, Math.max(minDelay, Math.round(retryAfterMs)))
		return {
			attempt,
			maxAttempts,
			delayMs: clampedDelay,
			nextRetryAt: Date.now() + clampedDelay,
		}
	}

	// Exponential backoff: attempt 1 -> ~15s, attempt 2 -> ~30s, attempt 3 -> ~60s
	const base = (config.baseDelayMs ?? 15000) * Math.pow(2, attempt - 1)
	const jitterRatio = config.jitterRatio ?? 0.2
	const jitterFactor = 1 - jitterRatio + Math.random() * (jitterRatio * 2)
	const jittered = Math.round(base * jitterFactor)
	const delayMs = Math.min(maxDelay, Math.max(minDelay, jittered))

	return {
		attempt,
		maxAttempts,
		delayMs,
		nextRetryAt: Date.now() + delayMs,
	}
}

export class DeferredApprovalRecoveryController {
	private timer?: NodeJS.Timeout
	private abortController?: AbortController
	private _isCancelled = false
	private _currentAttempt = 0
	private readonly config: DeferredRecoveryConfig

	constructor(config?: DeferredRecoveryConfig) {
		this.config = config ?? {}
	}

	public get currentAttempt(): number {
		return this._currentAttempt
	}

	public get isCancelled(): boolean {
		return this._isCancelled
	}

	public cancel(reason: string = "cancelled"): void {
		this._isCancelled = true
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = undefined
		}
		if (this.abortController) {
			this.abortController.abort(new Error(`Deferred recovery cancelled: ${reason}`))
			this.abortController = undefined
		}
	}

	public scheduleAttempt(
		retryAfterMs?: number,
	): { schedule: DeferredAttemptSchedule; abortSignal: AbortSignal; waitPromise: Promise<boolean> } | null {
		if (this._isCancelled) return null
		if (this._currentAttempt >= (this.config.maxAttempts ?? 3)) return null

		this._currentAttempt++
		const schedule = calculateDeferredBackoff(this._currentAttempt, retryAfterMs, this.config)

		this.abortController = new AbortController()
		const signal = this.abortController.signal

		const waitPromise = new Promise<boolean>((resolve) => {
			let onAbort: (() => void) | undefined
			const cleanup = () => {
				if (this.timer) {
					clearTimeout(this.timer)
					this.timer = undefined
				}
				if (onAbort) {
					signal.removeEventListener("abort", onAbort)
				}
			}

			onAbort = () => {
				cleanup()
				resolve(false)
			}

			if (signal.aborted) {
				resolve(false)
				return
			}
			signal.addEventListener("abort", onAbort, { once: true })

			this.timer = setTimeout(() => {
				cleanup()
				resolve(true)
			}, schedule.delayMs)
		})

		return { schedule, abortSignal: signal, waitPromise }
	}
}
