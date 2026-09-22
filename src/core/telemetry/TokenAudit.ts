import { Anthropic } from "@anthropic-ai/sdk"
import { ApiMessage } from "../task-persistence/apiMessages"

export interface TokenAuditRecord {
	taskId: string
	requestId: string
	requestIndex: number
	model: string

	systemPromptTokens: number
	environmentTokens: number
	nativeToolSchemaTokens: number
	mcpSchemaTokens: number
	graphifyTokens: number
	historyTokens: number
	toolResultTokens: number
	currentTurnTokens: number

	estimatedInputTokens: number

	providerInputTokens?: number
	providerCachedInputTokens?: number
	providerOutputTokens?: number
	providerReasoningTokens?: number

	messageCount: number
	toolResultCount: number
	largestToolResultBytes: number

	isRetry: boolean
	retryReason: string

	compactionState: string

	cumulativeInputTokens: number
	cumulativeOutputTokens: number

	taskRequestCount: number
	taskCumulativeInput: number
	taskCumulativeOutput: number
	estimatedRetransmittedTokens: number
	currentContextTokens: number
	largestRepeatedPayload: number
}

// In-memory cumulative tracking per task
interface TaskCumulativeStats {
	input: number
	output: number
	requestCount: number
	retransmittedTokens: number
	largestRepeatedPayload: number
}
const taskCumulativeUsage = new Map<string, TaskCumulativeStats>()

export function isTokenAuditEnabled(): boolean {
	return (
		process.env.ROO_TOKEN_AUDIT === "true" ||
		process.env.ROO_TOKEN_AUDIT === "1" ||
		process.env.NODE_ENV === "test-audit"
	)
}

export function estimateTokens(content: unknown): number {
	if (!content) {
		return 0
	}
	if (typeof content === "string") {
		return Math.ceil(content.length / 4)
	}
	if (Array.isArray(content)) {
		let totalChars = 0
		for (const item of content) {
			if (typeof item === "string") {
				totalChars += item.length
			} else if (item && typeof item === "object") {
				if ("text" in item && typeof (item as any).text === "string") {
					totalChars += (item as any).text.length
				} else if ("content" in item) {
					totalChars += estimateTokens((item as any).content) * 4
				} else {
					totalChars += JSON.stringify(item).length
				}
			}
		}
		return Math.ceil(totalChars / 4)
	}
	if (typeof content === "object") {
		if ("text" in (content as any) && typeof (content as any).text === "string") {
			return Math.ceil((content as any).text.length / 4)
		}
		return Math.ceil(JSON.stringify(content).length / 4)
	}
	return Math.ceil(String(content).length / 4)
}

export function redactSecrets(text: string): string {
	if (!text) {
		return ""
	}
	return text
		.replace(/sk-[a-zA-Z0-9_\-]{8,}/g, "sk-[REDACTED]")
		.replace(/(Bearer\s+)[a-zA-Z0-9_\-\.]{8,}/gi, "$1[REDACTED]")
		.replace(/(api[-_]?key["']?\s*[:=]\s*["']?)[a-zA-Z0-9_\-]{8,}/gi, "$1[REDACTED]")
		.replace(/(password["']?\s*[:=]\s*["']?)[^"'\s,}{]{4,}/gi, "$1[REDACTED]")
}

export interface PrepareTokenAuditParams {
	taskId: string
	requestId?: string
	model: string
	systemPrompt: string
	nativeTools?: any[]
	mcpTools?: any[]
	messages: (Anthropic.Messages.MessageParam | ApiMessage | any)[]
	isRetry?: boolean
	retryReason?: string
	compactionState?: string
}

export interface FinalizeTokenAuditParams {
	record: TokenAuditRecord
	providerInputTokens?: number
	providerCachedInputTokens?: number
	providerOutputTokens?: number
	providerReasoningTokens?: number
}

export function prepareTokenAuditRecord(params: PrepareTokenAuditParams): TokenAuditRecord {
	const { taskId, requestId = `req-${Date.now()}`, model, systemPrompt, nativeTools = [], mcpTools = [], messages } = params

	const taskStats = taskCumulativeUsage.get(taskId) || {
		input: 0,
		output: 0,
		requestCount: 0,
		retransmittedTokens: 0,
		largestRepeatedPayload: 0,
	}
	taskStats.requestCount += 1
	taskCumulativeUsage.set(taskId, taskStats)

	let systemPromptTokens = estimateTokens(systemPrompt)
	let nativeToolSchemaTokens = estimateTokens(nativeTools)
	let mcpSchemaTokens = estimateTokens(mcpTools)

	let environmentTokens = 0
	let graphifyTokens = 0
	let toolResultTokens = 0
	let toolResultCount = 0
	let largestToolResultBytes = 0
	let historyTokens = 0
	let currentTurnTokens = 0

	const messageCount = messages.length
	const lastIndex = messages.length - 1

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		const isCurrentTurn = i === lastIndex
		const content = msg.content

		let msgTokens = 0

		if (typeof content === "string") {
			msgTokens = estimateTokens(content)
			const envMatch = content.match(/<environment_details>[\s\S]*?<\/environment_details>/g)
			if (envMatch) {
				for (const m of envMatch) {
					environmentTokens += estimateTokens(m)
				}
			}
			if (content.includes("graphify") || content.includes(".graphify")) {
				graphifyTokens += Math.min(msgTokens, 1500)
			}
		} else if (Array.isArray(content)) {
			for (const block of content) {
				const blockTokens = estimateTokens(block)
				msgTokens += blockTokens

				if (block.type === "tool_result") {
					toolResultCount++
					toolResultTokens += blockTokens

					let bytes = 0
					if (typeof block.content === "string") {
						bytes = Buffer.byteLength(block.content, "utf8")
						if (block.content.includes("graphify") || block.content.includes(".graphify")) {
							graphifyTokens += blockTokens
						}
					} else if (Array.isArray(block.content)) {
						for (const sub of block.content) {
							if (sub.type === "text" && typeof sub.text === "string") {
								bytes += Buffer.byteLength(sub.text, "utf8")
								if (sub.text.includes("graphify") || sub.text.includes(".graphify")) {
									graphifyTokens += estimateTokens(sub.text)
								}
							}
						}
					}
					if (bytes > largestToolResultBytes) {
						largestToolResultBytes = bytes
					}
				} else if (block.type === "text" && typeof block.text === "string") {
					const envMatch = block.text.match(/<environment_details>[\s\S]*?<\/environment_details>/g)
					if (envMatch) {
						for (const m of envMatch) {
							environmentTokens += estimateTokens(m)
						}
					}
					if (block.text.includes("graphify") || block.text.includes(".graphify")) {
						graphifyTokens += Math.min(blockTokens, 1500)
					}
				}
			}
		}

		if (isCurrentTurn) {
			currentTurnTokens = msgTokens
		} else {
			historyTokens += msgTokens
		}
	}

	const estimatedInputTokens =
		systemPromptTokens + nativeToolSchemaTokens + mcpSchemaTokens + historyTokens + currentTurnTokens

	const estimatedRetransmittedTokens = Math.max(0, historyTokens)
	taskStats.retransmittedTokens += estimatedRetransmittedTokens
	if (largestToolResultBytes > taskStats.largestRepeatedPayload) {
		taskStats.largestRepeatedPayload = largestToolResultBytes
	}
	taskStats.input += estimatedInputTokens

	// Diagnostic warning for high cumulative amplification without stopping task
	if (taskStats.input >= 1_200_000 || taskStats.retransmittedTokens >= 1_000_000) {
		console.warn(
			`[TokenAudit] High cumulative input amplification detected: task ${taskId} has reached ${taskStats.input} cumulative input tokens (${taskStats.retransmittedTokens} estimated retransmitted) across ${taskStats.requestCount} requests.`,
		)
	}

	return {
		taskId,
		requestId,
		requestIndex: taskStats.requestCount,
		model: redactSecrets(model),
		systemPromptTokens,
		environmentTokens,
		nativeToolSchemaTokens,
		mcpSchemaTokens,
		graphifyTokens,
		historyTokens,
		toolResultTokens,
		currentTurnTokens,
		estimatedInputTokens,
		messageCount,
		toolResultCount,
		largestToolResultBytes,
		isRetry: !!params.isRetry,
		retryReason: params.retryReason || "none",
		compactionState: params.compactionState || "none",
		cumulativeInputTokens: taskStats.input,
		cumulativeOutputTokens: taskStats.output,
		taskRequestCount: taskStats.requestCount,
		taskCumulativeInput: taskStats.input,
		taskCumulativeOutput: taskStats.output,
		estimatedRetransmittedTokens,
		currentContextTokens: estimatedInputTokens,
		largestRepeatedPayload: taskStats.largestRepeatedPayload,
	}
}

export function formatTokenAuditLog(record: TokenAuditRecord): string {
	return `[TokenAudit]
taskId=${record.taskId}
requestId=${record.requestId}
requestIndex=${record.requestIndex}
model=${record.model}

systemPromptTokens=${record.systemPromptTokens}
environmentTokens=${record.environmentTokens}
nativeToolSchemaTokens=${record.nativeToolSchemaTokens}
mcpSchemaTokens=${record.mcpSchemaTokens}
graphifyTokens=${record.graphifyTokens}
historyTokens=${record.historyTokens}
toolResultTokens=${record.toolResultTokens}
currentTurnTokens=${record.currentTurnTokens}

estimatedInputTokens=${record.estimatedInputTokens}

providerInputTokens=${record.providerInputTokens ?? "N/A"}
providerCachedInputTokens=${record.providerCachedInputTokens ?? "N/A"}
providerOutputTokens=${record.providerOutputTokens ?? "N/A"}
providerReasoningTokens=${record.providerReasoningTokens ?? "N/A"}

messageCount=${record.messageCount}
toolResultCount=${record.toolResultCount}
largestToolResultBytes=${record.largestToolResultBytes}

isRetry=${record.isRetry}
retryReason=${record.retryReason}

compactionState=${record.compactionState}

cumulativeInputTokens=${record.cumulativeInputTokens}
cumulativeOutputTokens=${record.cumulativeOutputTokens}
taskRequestCount=${record.taskRequestCount}
taskCumulativeInput=${record.taskCumulativeInput}
taskCumulativeOutput=${record.taskCumulativeOutput}
estimatedRetransmittedTokens=${record.estimatedRetransmittedTokens}
currentContextTokens=${record.currentContextTokens}
largestRepeatedPayload=${record.largestRepeatedPayload}`
}

export function logTokenAudit(record: TokenAuditRecord): void {
	if (isTokenAuditEnabled()) {
		console.log(formatTokenAuditLog(record))
	}
}

export function recordProviderUsage(
	taskId: string,
	record: TokenAuditRecord,
	usage: {
		inputTokens?: number
		outputTokens?: number
		cacheReadTokens?: number
		reasoningTokens?: number
	},
): void {
	const taskStats = taskCumulativeUsage.get(taskId)
	if (taskStats) {
		if (usage.inputTokens !== undefined) {
			// Update cumulative with actual provider input if available
			taskStats.input = taskStats.input - record.estimatedInputTokens + usage.inputTokens
		}
		if (usage.outputTokens !== undefined) {
			taskStats.output += usage.outputTokens
		}
	}

	record.providerInputTokens = usage.inputTokens
	record.providerCachedInputTokens = usage.cacheReadTokens
	record.providerOutputTokens = usage.outputTokens
	record.providerReasoningTokens = usage.reasoningTokens
	if (taskStats) {
		record.cumulativeInputTokens = taskStats.input
		record.cumulativeOutputTokens = taskStats.output
	}

	if (isTokenAuditEnabled()) {
		console.log(`[TokenAudit:Usage]
taskId=${record.taskId}
requestIndex=${record.requestIndex}
providerInputTokens=${usage.inputTokens ?? 0}
providerCachedInputTokens=${usage.cacheReadTokens ?? 0}
providerOutputTokens=${usage.outputTokens ?? 0}
providerReasoningTokens=${usage.reasoningTokens ?? 0}
cumulativeInputTokens=${record.cumulativeInputTokens}
cumulativeOutputTokens=${record.cumulativeOutputTokens}`)
	}
}

export function resetTokenAuditForTask(taskId: string): void {
	taskCumulativeUsage.delete(taskId)
}
