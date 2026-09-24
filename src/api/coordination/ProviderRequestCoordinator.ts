import { createHash } from "crypto"
import { RequestPriority, RequestTicket, ProviderQueueStats } from "./types"

interface QueuedWaiter {
	ticketId: string
	taskId?: string
	priority: RequestPriority
	createdAt: number
	resolve: (ticket: RequestTicket) => void
	reject: (err: any) => void
	abortSignal?: AbortSignal
	abortCleanup?: () => void
}

interface ProviderState {
	activeCount: number
	activeByTask: Map<string, number>
	maxConcurrency: number
	baselineConcurrency: number
	blockedUntil: number
	lastRequestTime: number
	consecutiveSuccesses: number
	lastBackoffTime: number
	waiting: QueuedWaiter[]
	wakeTimer?: ReturnType<typeof setTimeout>
}

export class ProviderRequestCoordinator {
	private static instance?: ProviderRequestCoordinator
	private queues = new Map<string, ProviderState>()
	private globalLastRequestTime?: number

	public static getInstance(): ProviderRequestCoordinator {
		if (!ProviderRequestCoordinator.instance) {
			ProviderRequestCoordinator.instance = new ProviderRequestCoordinator()
		}
		return ProviderRequestCoordinator.instance
	}

	public static resetInstance(): void {
		if (ProviderRequestCoordinator.instance) {
			for (const state of ProviderRequestCoordinator.instance.queues.values()) {
				if (state.wakeTimer) {
					clearTimeout(state.wakeTimer)
				}
				for (const waiter of state.waiting) {
					waiter.reject(new Error("Coordinator reset"))
				}
			}
			ProviderRequestCoordinator.instance.queues.clear()
		}
		ProviderRequestCoordinator.instance = undefined
	}

	public deriveProviderKey(provider?: string, apiKey?: string, profileName?: string): string {
		const normProvider = (provider || "unknown").toLowerCase().trim()
		if (apiKey && apiKey.trim()) {
			const hash = createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 12)
			return `${normProvider}:${hash}`
		}
		if (profileName && profileName.trim()) {
			return `${normProvider}:${profileName.trim()}`
		}
		return `${normProvider}:default`
	}

	private getBaselineConcurrency(providerKey: string): number {
		const provider = providerKey.split(":")[0].toLowerCase()
		switch (provider) {
			case "anthropic":
			case "openai":
				return 4
			case "xkiro":
			case "openrouter":
			case "gemini":
				return 3
			case "ollama":
			case "lmstudio":
				return 2
			default:
				return 2
		}
	}

	private getOrCreateProviderState(providerKey: string): ProviderState {
		let state = this.queues.get(providerKey)
		if (!state) {
			const baseline = this.getBaselineConcurrency(providerKey)
			state = {
				activeCount: 0,
				activeByTask: new Map(),
				maxConcurrency: baseline,
				baselineConcurrency: baseline,
				blockedUntil: 0,
				lastRequestTime: 0,
				consecutiveSuccesses: 0,
				lastBackoffTime: 0,
				waiting: [],
			}
			this.queues.set(providerKey, state)
		}
		return state
	}

	public getStats(providerKey: string): ProviderQueueStats {
		const state = this.getOrCreateProviderState(providerKey)
		return {
			activeCount: state.activeCount,
			queuedCount: state.waiting.length,
			maxConcurrency: state.maxConcurrency,
			baselineConcurrency: state.baselineConcurrency,
			blockedUntil: state.blockedUntil,
			lastRequestTime: state.lastRequestTime,
			consecutiveSuccesses: state.consecutiveSuccesses,
		}
	}

	public getLastRequestTime(providerKey?: string): number | undefined {
		if (providerKey) {
			const state = this.queues.get(providerKey)
			return state?.lastRequestTime
		}
		return this.globalLastRequestTime
	}

	public setLastRequestTime(time: number, providerKey?: string): void {
		this.globalLastRequestTime = time
		if (providerKey) {
			const state = this.getOrCreateProviderState(providerKey)
			state.lastRequestTime = time
		}
	}

	public reportRateLimit(providerKey: string, retryAfterSeconds: number): void {
		const state = this.getOrCreateProviderState(providerKey)
		const durationMs = Math.max(1, Math.ceil(retryAfterSeconds)) * 1000
		const newBlockedUntil = Date.now() + durationMs
		state.blockedUntil = Math.max(state.blockedUntil, newBlockedUntil)

		// AIMD decrease
		state.maxConcurrency = Math.max(1, state.maxConcurrency - 1)
		state.consecutiveSuccesses = 0
		state.lastBackoffTime = Date.now()

		// Schedule wake timer when block expires
		if (state.wakeTimer) {
			clearTimeout(state.wakeTimer)
		}
		state.wakeTimer = setTimeout(() => {
			this.pumpQueue(providerKey)
		}, durationMs + 20)
	}

	public reportSuccess(providerKey: string): void {
		const state = this.getOrCreateProviderState(providerKey)
		state.consecutiveSuccesses++

		// AIMD increase on sustained success: 10 successes and at least 30s since last backoff
		if (
			state.consecutiveSuccesses >= 10 &&
			state.maxConcurrency < state.baselineConcurrency &&
			Date.now() - state.lastBackoffTime >= 30_000
		) {
			state.maxConcurrency++
			state.consecutiveSuccesses = 0
		}
	}

	public async acquireTicket(options: {
		providerKey: string
		taskId?: string
		priority?: RequestPriority
		abortSignal?: AbortSignal
	}): Promise<RequestTicket> {
		const { providerKey, taskId, priority = RequestPriority.FOREGROUND, abortSignal } = options

		if (abortSignal?.aborted) {
			throw new Error("Request aborted before ticket acquisition")
		}

		const state = this.getOrCreateProviderState(providerKey)
		const ticketId = `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

		// Check if immediately grantable
		const isBlocked = state.blockedUntil > Date.now()
		const hasCapacity = state.activeCount < state.maxConcurrency
		const taskSlotCap = Math.max(1, Math.ceil(state.maxConcurrency / 2))
		const currentTaskSlots = taskId ? (state.activeByTask.get(taskId) || 0) : 0
		const violatesTaskCap = state.waiting.length > 0 && taskId && currentTaskSlots >= taskSlotCap

		if (!isBlocked && hasCapacity && !violatesTaskCap && state.waiting.length === 0) {
			return this.grantTicket(state, providerKey, ticketId, taskId, priority)
		}

		// Otherwise enqueue
		return new Promise<RequestTicket>((resolve, reject) => {
			const waiter: QueuedWaiter = {
				ticketId,
				taskId,
				priority,
				createdAt: Date.now(),
				resolve,
				reject,
				abortSignal,
			}

			if (abortSignal) {
				const onAbort = () => {
					const idx = state.waiting.indexOf(waiter)
					if (idx !== -1) {
						state.waiting.splice(idx, 1)
					}
					reject(new Error("Request aborted while queued"))
				}
				abortSignal.addEventListener("abort", onAbort, { once: true })
				waiter.abortCleanup = () => abortSignal.removeEventListener("abort", onAbort)
			}

			state.waiting.push(waiter)

			// If blocked, ensure wake timer is active
			if (isBlocked && !state.wakeTimer) {
				const delayMs = Math.max(10, state.blockedUntil - Date.now() + 20)
				state.wakeTimer = setTimeout(() => {
					this.pumpQueue(providerKey)
				}, delayMs)
			} else if (!isBlocked) {
				this.pumpQueue(providerKey)
			}
		})
	}

	private grantTicket(
		state: ProviderState,
		providerKey: string,
		ticketId: string,
		taskId?: string,
		priority: RequestPriority = RequestPriority.FOREGROUND
	): RequestTicket {
		state.activeCount++
		if (taskId) {
			state.activeByTask.set(taskId, (state.activeByTask.get(taskId) || 0) + 1)
		}
		const now = performance.now()
		state.lastRequestTime = now
		this.globalLastRequestTime = now

		let released = false

		const ticket: RequestTicket = {
			id: ticketId,
			providerKey,
			taskId,
			priority,
			release: () => {
				if (released) return
				released = true
				state.activeCount = Math.max(0, state.activeCount - 1)
				if (taskId) {
					const count = state.activeByTask.get(taskId) || 1
					if (count <= 1) {
						state.activeByTask.delete(taskId)
					} else {
						state.activeByTask.set(taskId, count - 1)
					}
				}
				this.pumpQueue(providerKey)
			},
			reportRateLimit: (retryAfterSeconds: number) => {
				this.reportRateLimit(providerKey, retryAfterSeconds)
			},
			reportSuccess: () => {
				this.reportSuccess(providerKey)
			},
		}

		return ticket
	}

	private pumpQueue(providerKey: string): void {
		const state = this.queues.get(providerKey)
		if (!state) return

		if (state.blockedUntil > Date.now()) {
			if (!state.wakeTimer) {
				const delayMs = Math.max(10, state.blockedUntil - Date.now() + 20)
				state.wakeTimer = setTimeout(() => {
					this.pumpQueue(providerKey)
				}, delayMs)
			}
			return
		}

		if (state.wakeTimer) {
			clearTimeout(state.wakeTimer)
			state.wakeTimer = undefined
		}

		while (state.activeCount < state.maxConcurrency && state.waiting.length > 0) {
			// Sort waiting requests by priority with aging bonus (+50 points every 5 seconds)
			const now = Date.now()
			state.waiting.sort((a, b) => {
				const ageA = Math.floor((now - a.createdAt) / 5000) * 50
				const ageB = Math.floor((now - b.createdAt) / 5000) * 50
				return b.priority + ageB - (a.priority + ageA)
			})

			// Check if highest priority request can be granted without task monopolization
			const taskSlotCap = Math.max(1, Math.ceil(state.maxConcurrency / 2))
			let selectedIdx = -1

			for (let i = 0; i < state.waiting.length; i++) {
				const candidate = state.waiting[i]
				const taskCount = candidate.taskId ? (state.activeByTask.get(candidate.taskId) || 0) : 0
				if (!candidate.taskId || taskCount < taskSlotCap || state.waiting.length === 1) {
					selectedIdx = i
					break
				}
			}

			// If all candidates hit task cap, grant the highest priority anyway
			if (selectedIdx === -1 && state.waiting.length > 0) {
				selectedIdx = 0
			}

			if (selectedIdx === -1) {
				break
			}

			const [selected] = state.waiting.splice(selectedIdx, 1)
			if (selected.abortCleanup) {
				selected.abortCleanup()
			}

			if (selected.abortSignal?.aborted) {
				selected.reject(new Error("Request aborted while queued"))
				continue
			}

			const ticket = this.grantTicket(state, providerKey, selected.ticketId, selected.taskId, selected.priority)
			selected.resolve(ticket)
		}
	}
}
