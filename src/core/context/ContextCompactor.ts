import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, ApiHandlerCreateMessageMetadata } from "../../api"
import { ApiMessage } from "../task-persistence/apiMessages"
import { RooIgnoreController } from "../ignore/RooIgnoreController"
import { convertToolBlocksToText, toolUseToText, toolResultToText } from "../condense"
import { maybeRemoveImageBlocks } from "../../api/transform/image-cleaning"

export const CONDENSING_SYSTEM_PROMPT = `You are an expert AI software architect and technical assistant tasked with summarizing conversation history for context condensation.

CRITICAL: This is a summarization-only operation. DO NOT call any tools or output tool use blocks. Output pure Markdown text only.

Provide a comprehensive, highly technical, and structured Markdown summary following these exact section headers:

### 1. Main Objective & Context
State the core task goal, user intent, initial requirements, and constraints.

### 2. Changes Made & Modified Files
Detail all file modifications, additions, and deletions with exact paths. Highlight functions, classes, and components created or updated, along with key bugs resolved.

### 3. Key Architectural Decisions
Describe patterns adopted, design choices made, dependencies added or avoided, and rationale behind technical implementations.

### 4. Next Steps & Current State
Summarize the current task status, recent errors or test results, next actions to execute, and immediate context needed to continue uninterrupted.

CRITICAL INSTRUCTIONS:
- You must output ONLY valid Markdown adhering strictly to the four sections above.
- Maintain high information density and preserve exact technical terms, identifiers, and file paths.`

export interface CompactHistoryOptions {
	messages: ApiMessage[]
	apiHandler: ApiHandler
	systemPrompt: string
	taskId: string
	customInstructions?: string
	preserveTurns?: number
	cwd?: string
	rooIgnoreController?: RooIgnoreController
	metadata?: ApiHandlerCreateMessageMetadata
	abortSignal?: AbortSignal
}

export interface CompactHistoryResult {
	newHistory: ApiMessage[]
	summary: string
	previousTokens: number
	newTokens: number
	cost: number
}

/**
 * Extracts content blocks from an array of ApiMessages for token counting.
 */
function extractContentBlocks(
	messages: ApiMessage[],
	systemPrompt?: string,
): Anthropic.Messages.ContentBlockParam[] {
	const blocks: Anthropic.Messages.ContentBlockParam[] = []

	if (systemPrompt && systemPrompt.trim()) {
		blocks.push({ type: "text", text: systemPrompt })
	}

	for (const msg of messages) {
		if (typeof msg.content === "string") {
			blocks.push({ type: "text", text: msg.content })
		} else if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "text" || block.type === "image") {
					blocks.push(block)
				} else if (block.type === "tool_use") {
					blocks.push({
						type: "text",
						text: toolUseToText(block),
					})
				} else if (block.type === "tool_result") {
					blocks.push({
						type: "text",
						text: toolResultToText(block),
					})
				}
			}
		}
	}

	return blocks
}

/**
 * Calculates token count for a message history using apiHandler.countTokens with fallback estimation.
 */
async function countTokensForHistory(
	messages: ApiMessage[],
	apiHandler: ApiHandler,
	systemPrompt?: string,
): Promise<number> {
	try {
		const blocks = extractContentBlocks(messages, systemPrompt)
		if (blocks.length === 0) {
			return 0
		}
		return await apiHandler.countTokens(blocks)
	} catch (error) {
		console.warn("[ContextCompactor] Failed to count tokens via apiHandler:", error)
		// Fallback token estimation (~4 chars per token)
		const charCount = messages.reduce((total, msg) => {
			if (typeof msg.content === "string") {
				return total + msg.content.length
			}
			if (Array.isArray(msg.content)) {
				return (
					total +
					msg.content.reduce((bTotal, b) => {
						if ("text" in b && typeof b.text === "string") {
							return bTotal + b.text.length
						}
						return bTotal + 100
					}, 0)
				)
			}
			return total
		}, systemPrompt?.length ?? 0)
		return Math.ceil(charCount / 4)
	}
}

/**
 * Helper to normalize any message content into an array of ContentBlockParam.
 */
export function toContentBlocks(
	content: string | Anthropic.Messages.ContentBlockParam[] | undefined,
): Anthropic.Messages.ContentBlockParam[] {
	if (!content) {
		return []
	}
	if (typeof content === "string") {
		return [{ type: "text", text: content }]
	}
	if (Array.isArray(content)) {
		return content.map((block) => {
			if (typeof block === "string") {
				return { type: "text", text: block }
			}
			return block
		})
	}
	return [{ type: "text", text: String(content) }]
}

/**
 * Sanitizes an ApiMessage history array to ensure strictly alternating roles,
 * merging adjacent messages of the same role (specifically consecutive user messages)
 * into a single multi-block message (`ContentBlockParam[]`).
 *
 * This prevents HTTP 400 errors from LLM providers like Anthropic and Bedrock
 * which reject conversations with consecutive user messages.
 */
export function sanitizeRoleAlternation(history: ApiMessage[]): ApiMessage[] {
	if (!history || history.length === 0) {
		return []
	}

	const sanitized: ApiMessage[] = []

	for (const msg of history) {
		const prev = sanitized[sanitized.length - 1]
		if (prev && prev.role === msg.role) {
			// Merge consecutive messages with identical roles into a multi-block message
			const prevBlocks = toContentBlocks(prev.content)
			const currBlocks = toContentBlocks(msg.content)
			prev.content = [...prevBlocks, ...currBlocks]

			// Preserve metadata flags
			if (msg.isSummary) {
				prev.isSummary = true
			}
			if (msg.condenseId) {
				prev.condenseId = msg.condenseId
			}
			if (msg.ts && !prev.ts) {
				prev.ts = msg.ts
			}
		} else {
			sanitized.push({
				...msg,
				content: Array.isArray(msg.content)
					? [...msg.content]
					: typeof msg.content === "string"
						? msg.content
						: toContentBlocks(msg.content),
			})
		}
	}

	return sanitized
}

/**
 * Normalizes messages to ensure strictly alternating user/assistant roles
 * and that the first message has role "user", which is required by LLM providers.
 */
function normalizeMessagesForApi(
	messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
	if (messages.length === 0) {
		return []
	}

	const normalized: Anthropic.Messages.MessageParam[] = []

	// Ensure the sequence starts with a user message
	if (messages[0].role !== "user") {
		normalized.push({
			role: "user",
			content: "[Task Context - Intermediate Conversation Follows]",
		})
	}

	for (const msg of messages) {
		const prev = normalized[normalized.length - 1]
		if (prev && prev.role === msg.role) {
			// Merge consecutive messages with identical roles
			const prevBlocks = Array.isArray(prev.content)
				? prev.content
				: [{ type: "text" as const, text: String(prev.content) }]
			const currBlocks = Array.isArray(msg.content)
				? msg.content
				: [{ type: "text" as const, text: String(msg.content) }]
			prev.content = [...prevBlocks, ...currBlocks]
		} else {
			normalized.push({
				role: msg.role,
				content: Array.isArray(msg.content) ? [...msg.content] : msg.content,
			})
		}
	}

	return normalized
}

/**
 * Compacts conversation history by preserving the initial task objective (Message 0),
 * summarizing intermediate conversation turns with a structured LLM call, and preserving
 * the last N turns to maintain immediate train of thought and recently edited lines.
 */
export async function compactHistory(options: CompactHistoryOptions): Promise<CompactHistoryResult> {
	const {
		messages,
		apiHandler,
		systemPrompt,
		taskId,
		customInstructions,
		preserveTurns = 2,
		metadata,
	} = options

	// Minimum messages required: Message 0 + intermediate messages + preserved turns
	if (!messages || messages.length < 4) {
		throw new Error("Not enough messages to compact context (minimum 4 messages required).")
	}

	// Calculate previous tokens before compaction
	const previousTokens = await countTokensForHistory(messages, apiHandler, systemPrompt)

	// Preserve Message 0 (the initial user prompt / task goal)
	const initialMessage = messages[0]

	// Preserve the last N exchanges (default 2 exchanges = 4 messages)
	let preservedMessageCount = preserveTurns * 2

	// Ensure we preserve at least 1 exchange and leave at least 1 intermediate message after Message 0
	if (messages.length - preservedMessageCount <= 1) {
		preservedMessageCount = Math.max(2, Math.floor((messages.length - 2) / 2) * 2)
	}

	const startOfPreservedTurns = Math.max(1, messages.length - preservedMessageCount)

	// Extract intermediate messages (from index 1 up to start of preserved turns)
	const intermediateMessages = messages.slice(1, startOfPreservedTurns)
	const preservedRecentMessages = messages.slice(startOfPreservedTurns)

	if (intermediateMessages.length === 0) {
		throw new Error("Not enough intermediate messages to compact.")
	}

	// Clean intermediate messages: remove images if needed and convert tool blocks to text
	const cleanedIntermediate = maybeRemoveImageBlocks(intermediateMessages, apiHandler)
	const transformedIntermediate: Anthropic.Messages.MessageParam[] = cleanedIntermediate.map((msg) => ({
		role: msg.role === "assistant" ? "assistant" : "user",
		content: convertToolBlocksToText(msg.content as any) as any,
	}))

	// Construct request messages for summarization
	const rawRequestMessages: Anthropic.Messages.MessageParam[] = []

	// If intermediate messages start with an assistant message, prepend initial task objective as user message
	if (transformedIntermediate[0]?.role === "assistant") {
		const initialText =
			typeof initialMessage.content === "string"
				? initialMessage.content
				: convertToolBlocksToText(initialMessage.content as any)
		rawRequestMessages.push({
			role: "user",
			content: Array.isArray(initialText)
				? initialText
				: [{ type: "text" as const, text: `Original Task Goal:\n${initialText}` }],
		})
	}

	rawRequestMessages.push(...transformedIntermediate)

	// Build the final user summarization prompt
	let finalRequestPrompt =
		"Please synthesize and summarize the conversation history above following the required structured Markdown format with the 4 headings."
	if (customInstructions && customInstructions.trim()) {
		finalRequestPrompt += `\n\nAdditional Instructions:\n${customInstructions.trim()}`
	}

	rawRequestMessages.push({
		role: "user",
		content: [{ type: "text" as const, text: finalRequestPrompt }],
	})

	const requestMessages = normalizeMessagesForApi(rawRequestMessages)

	// Execute isolated LLM call for summarization
	if (!apiHandler || typeof apiHandler.createMessage !== "function") {
		throw new Error("API handler is invalid for condensing. Cannot proceed.")
	}

	if (options.abortSignal?.aborted) {
		throw new Error("Context condensation was aborted.")
	}

	let summary = ""
	let cost = 0
	let finishReason: string | undefined

	const condensingMetadata: ApiHandlerCreateMessageMetadata = {
		taskId,
		...metadata,
	}

	const CONDENSATION_TIMEOUT_MS = 60_000
	const abortController = new AbortController()
	let timeoutId: NodeJS.Timeout | undefined
	let didTimeout = false

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			didTimeout = true
			abortController.abort()
			reject(new Error("Context condensation timed out after 60 seconds."))
		}, CONDENSATION_TIMEOUT_MS)
	})

	const abortPromise = new Promise<never>((_, reject) => {
		if (options.abortSignal?.aborted) {
			reject(new Error("Context condensation was aborted."))
			return
		}
		options.abortSignal?.addEventListener(
			"abort",
			() => {
				abortController.abort()
				reject(new Error("Context condensation was aborted."))
			},
			{ once: true },
		)
	})

	let iterator: AsyncIterator<any> | undefined

	try {
		const stream = apiHandler.createMessage(
			CONDENSING_SYSTEM_PROMPT,
			requestMessages,
			condensingMetadata,
		)
		iterator = stream[Symbol.asyncIterator]()

		while (true) {
			if (options.abortSignal?.aborted) {
				throw new Error("Context condensation was aborted.")
			}
			if (abortController.signal.aborted) {
				throw new Error("Context condensation timed out after 60 seconds.")
			}

			const { value: chunk, done } = await Promise.race([
				iterator.next(),
				timeoutPromise,
				abortPromise,
			])

			if (done) {
				break
			}

			if (chunk.type === "text") {
				summary += chunk.text
			} else if (chunk.type === "usage") {
				cost = chunk.totalCost ?? 0
			} else if (chunk.type === "error") {
				throw new Error(chunk.message || chunk.error || "Stream error")
			}

			const reason =
				(chunk as any).finish_reason ??
				(chunk as any).finishReason ??
				(chunk as any).stop_reason ??
				(chunk as any).stopReason
			if (reason) {
				finishReason = reason
			}
		}
	} catch (error) {
		if (iterator?.return) {
			try {
				void iterator.return().catch(() => {})
			} catch {
				// ignore cleanup error
			}
		}

		if (options.abortSignal?.aborted || (error instanceof Error && error.message.includes("aborted"))) {
			throw new Error("Context condensation was aborted.")
		}

		if (didTimeout || (error instanceof Error && error.message.includes("timed out after 60 seconds"))) {
			throw new Error("Context condensation timed out after 60 seconds.")
		}

		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error("[ContextCompactor] Error during condensing API call:", error)
		throw new Error(`Context condensation LLM call failed: ${errorMessage}`)
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId)
		}
	}

	// Verify finish_reason
	if (finishReason === "max_tokens" || finishReason === "length") {
		throw new Error(
			`Context condensation incomplete: model output was truncated (finish_reason: ${finishReason}).`,
		)
	}

	summary = summary.trim()
	if (!summary) {
		throw new Error("Context condensation failed: received empty summary from model.")
	}

	// Construct synthetic summary message
	const summaryMessage: ApiMessage = {
		role: "user",
		content: [{ type: "text", text: `[Context Compacted Summary]\n\n${summary}` }],
		ts: Date.now(),
		isSummary: true,
	}

	// Construct newHistory with sanitized role alternation: [messages[0], summaryMessage, ...preservedRecentMessages]
	const newHistory: ApiMessage[] = sanitizeRoleAlternation([
		initialMessage,
		summaryMessage,
		...preservedRecentMessages,
	])

	// Calculate new tokens after compaction
	const newTokens = await countTokensForHistory(newHistory, apiHandler, systemPrompt)

	return {
		newHistory,
		summary,
		previousTokens,
		newTokens,
		cost,
	}
}
