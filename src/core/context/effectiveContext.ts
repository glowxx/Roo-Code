import { Anthropic } from "@anthropic-ai/sdk"
import { ApiMessage } from "../task-persistence/apiMessages"

export interface OptimizeEffectiveContextOptions {
	/**
	 * Number of recent messages from the end of the history to keep 100% untouched.
	 * Default: 4 messages (covers the immediate active turn and previous response/action).
	 */
	recentMessagesPreserved?: number

	/**
	 * Maximum bytes for historical tool outputs before truncation applies.
	 * Default: 2048 bytes (2 KB).
	 */
	maxHistoricalToolBytes?: number

	/**
	 * Preview head bytes to retain when truncating.
	 * Default: 400 bytes.
	 */
	headBytes?: number

	/**
	 * Preview tail bytes to retain when truncating.
	 * Default: 400 bytes.
	 */
	tailBytes?: number
}

const DEFAULT_RECENT_MESSAGES_PRESERVED = 4
const DEFAULT_MAX_HISTORICAL_TOOL_BYTES = 2048
const DEFAULT_HEAD_BYTES = 400
const DEFAULT_TAIL_BYTES = 400

/**
 * Truncates a large string payload while preserving head, tail, and structural summary.
 */
function truncateTextPayload(
	text: string,
	maxBytes: number,
	headBytes: number,
	tailBytes: number,
): string {
	const totalBytes = Buffer.byteLength(text, "utf8")
	if (totalBytes <= maxBytes) {
		return text
	}

	const lines = text.split("\n")
	const totalLines = lines.length

	// Detect special tool outputs for tailored summarization
	const isSkillDoc = text.includes("# /graphify") || text.includes("name: graphify") || text.includes("## Usage")
	if (isSkillDoc) {
		const headPreview = text.slice(0, Math.min(text.length, headBytes))
		return `[Historical skill documentation truncated: ${totalBytes} bytes, ${totalLines} lines. Skill was loaded in this session]
--- Preview ---
${headPreview}
... [documentation omitted - instructions already active] ...`
	}

	// Extract head and tail
	const head = text.slice(0, Math.min(text.length, headBytes))
	const tail = text.slice(Math.max(0, text.length - tailBytes))

	// Extract exit code or error markers if present
	const exitCodeMatch = text.match(/exit code:?\s*(\d+)/i) || text.match(/Command failed with exit code\s*(\d+)/i)
	const exitCodeStr = exitCodeMatch ? ` (exit code: ${exitCodeMatch[1]})` : ""

	return `[Historical tool output truncated: ${totalLines} lines, ${totalBytes} bytes${exitCodeStr}. Full output preserved in task storage/logs]
--- Output Preview (Head) ---
${head}
--- Output Preview (Tail) ---
${tail}
[End of truncated tool output]`
}

/**
 * Optimizes the effective conversation history sent to the LLM by truncating
 * large historical tool results from older turns, while keeping the immediate
 * active turns at 100% full fidelity.
 *
 * CRITICAL ARCHITECTURAL PRINCIPLE:
 * PERSISTED FULL HISTORY !== LLM EFFECTIVE HISTORY
 *
 * This function NEVER mutates the input messages or stored task history on disk.
 * It produces a safe in-memory copy for API request generation.
 *
 * @param messages Filtered effective messages to be sent to API
 * @param options Configuration options
 * @returns Non-destructively optimized messages array for API payload
 */
export function optimizeEffectiveApiHistory(
	messages: ApiMessage[],
	options: OptimizeEffectiveContextOptions = {},
): ApiMessage[] {
	if (!messages || messages.length === 0) {
		return []
	}

	const recentMessagesPreserved = options.recentMessagesPreserved ?? DEFAULT_RECENT_MESSAGES_PRESERVED
	const maxBytes = options.maxHistoricalToolBytes ?? DEFAULT_MAX_HISTORICAL_TOOL_BYTES
	const headBytes = options.headBytes ?? DEFAULT_HEAD_BYTES
	const tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES

	const cutoffIndex = Math.max(0, messages.length - recentMessagesPreserved)

	return messages.map((msg, index) => {
		// Recent messages (active turn + immediate context) are preserved 100% untouched
		if (index >= cutoffIndex) {
			return msg
		}

		// Only user messages contain tool_result blocks
		if (msg.role !== "user" || !msg.content) {
			return msg
		}

		// String content
		if (typeof msg.content === "string") {
			const truncated = truncateTextPayload(msg.content, maxBytes, headBytes, tailBytes)
			if (truncated !== msg.content) {
				return { ...msg, content: truncated }
			}
			return msg
		}

		// Array of content blocks
		if (Array.isArray(msg.content)) {
			let modified = false
			const newContent = msg.content.map((block) => {
				if (block.type === "tool_result") {
					const toolResultBlock = block as Anthropic.Messages.ToolResultBlockParam
					if (typeof toolResultBlock.content === "string") {
						const truncated = truncateTextPayload(toolResultBlock.content, maxBytes, headBytes, tailBytes)
						if (truncated !== toolResultBlock.content) {
							modified = true
							return {
								...toolResultBlock,
								content: truncated,
							}
						}
					} else if (Array.isArray(toolResultBlock.content)) {
						let subModified = false
						const newSubBlocks = toolResultBlock.content.map((subBlock) => {
							if (subBlock.type === "text" && typeof subBlock.text === "string") {
								const truncated = truncateTextPayload(subBlock.text, maxBytes, headBytes, tailBytes)
								if (truncated !== subBlock.text) {
									subModified = true
									return { ...subBlock, text: truncated }
								}
							}
							return subBlock
						})
						if (subModified) {
							modified = true
							return {
								...toolResultBlock,
								content: newSubBlocks,
							}
						}
					}
				}
				return block
			})

			if (modified) {
				return { ...msg, content: newContent }
			}
		}

		return msg
	})
}
