export enum RequestPriority {
	VERIFIER = 300,
	FOREGROUND = 200,
	BACKGROUND = 100,
}

export interface RequestTicket {
	readonly id: string
	readonly providerKey: string
	readonly taskId?: string
	readonly priority: RequestPriority
	release: () => void
	reportRateLimit: (retryAfterSeconds: number) => void
	reportSuccess: () => void
}

export interface ProviderQueueStats {
	activeCount: number
	queuedCount: number
	maxConcurrency: number
	baselineConcurrency: number
	blockedUntil: number
	lastRequestTime: number
	consecutiveSuccesses: number
}
