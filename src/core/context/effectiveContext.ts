import { Anthropic } from "@anthropic-ai/sdk"
import { ApiMessage } from "../task-persistence/apiMessages"

export interface OptimizeEffectiveContextOptions {
	/**
	 * Number of recent messages from the end of the history to keep 100% untouched.
	 * Default: 4 messages (covers the immediate active turn and previous response/action).
	 */
	recentMessagesPreserved?: number

	/**
	 * Number of warm turns preserved with Type-Aware Retention before entering cold archive.
	 * Default: 8 turns (16 messages).
	 */
	warmTurnsPreserved?: number

	/**
	 * Maximum bytes for historical ephemeral tool outputs (execute_command, search_files, etc.)
	 * in warm memory before truncation applies.
	 * Default: 2048 bytes (2 KB).
	 */
	maxHistoricalToolBytes?: number

	/**
	 * Maximum bytes for historical read_file tool results before truncation applies.
	 * Default: 20480 bytes (20 KB) - preserves ~500 lines of source code untouched
	 * across turns, ensuring the model retains exact syntax for subsequent edits (apply_diff).
	 */
	maxReadFileBytes?: number

	/**
	 * Maximum bytes for historical skill documentation before truncation applies.
	 * Default: 16384 bytes (16 KB) - preserves complete skill instructions and rules.
	 */
	maxSkillBytes?: number

	/**
	 * Preview head bytes to retain when truncating ephemeral outputs.
	 * Default: 400 bytes.
	 */
	headBytes?: number

	/**
	 * Preview tail bytes to retain when truncating ephemeral outputs.
	 * Default: 400 bytes.
	 */
	tailBytes?: number

	/**
	 * Preview head bytes to retain when truncating read_file results exceeding maxReadFileBytes.
	 * Default: 2048 bytes.
	 */
	readFileHeadBytes?: number

	/**
	 * Preview tail bytes to retain when truncating read_file results exceeding maxReadFileBytes.
	 * Default: 2048 bytes.
	 */
	readFileTailBytes?: number

	/**
	 * Maximum bytes for cold archive ephemeral tool outputs (Zone 2).
	 * Default: 300 bytes.
	 */
	coldMaxEphemeralBytes?: number

	/**
	 * Maximum bytes for cold archive read_file results (Zone 2).
	 * Default: 4096 bytes (4 KB head/tail snippet).
	 */
	coldMaxReadFileBytes?: number

	/**
	 * Maximum bytes for cold archive skill documentation (Zone 2).
	 * Default: 1024 bytes.
	 */
	coldMaxSkillBytes?: number

	/**
	 * Whether to strip redundant <environment_details> from historical user messages.
	 * Default: true.
	 */
	stripHistoricalEnvironmentDetails?: boolean
}

export const DEFAULT_RECENT_MESSAGES_PRESERVED = 4
export const DEFAULT_WARM_TURNS_PRESERVED = 8
export const DEFAULT_MAX_HISTORICAL_TOOL_BYTES = 2048
export const DEFAULT_MAX_READ_FILE_BYTES = 20480 // 20 KB (~500 lines)
export const DEFAULT_MAX_SKILL_BYTES = 16384 // 16 KB
export const DEFAULT_HEAD_BYTES = 400
export const DEFAULT_TAIL_BYTES = 400
export const DEFAULT_READ_FILE_HEAD_BYTES = 2048
export const DEFAULT_READ_FILE_TAIL_BYTES = 2048
export const DEFAULT_COLD_MAX_EPHEMERAL_BYTES = 300
export const DEFAULT_COLD_MAX_READ_FILE_BYTES = 4096 // 4 KB
export const DEFAULT_COLD_MAX_SKILL_BYTES = 1024 // 1 KB

export type ToolResultCategory =
	| "code_read"
	| "skill"
	| "ephemeral_command"
	| "ephemeral_search"
	| "edit_result"
	| "unknown"

export interface ToolCallMetadata {
	name: string
	input?: Record<string, any>
}

/**
 * Classifies a tool output into a semantic category for retention policies.
 */
export function determineToolCategory(
	toolInfo?: ToolCallMetadata,
	text?: string,
): ToolResultCategory {
	if (toolInfo?.name) {
		switch (toolInfo.name) {
			case "read_file":
				return "code_read"
			case "skill":
			case "load_skill":
				return "skill"
			case "execute_command":
			case "read_command_output":
				return "ephemeral_command"
			case "search_files":
			case "list_files":
			case "codebase_search":
				return "ephemeral_search"
			case "apply_diff":
			case "apply_patch":
			case "write_to_file":
			case "edit_file":
			case "search_and_replace":
				return "edit_result"
			default:
				break
		}
	}

	if (text) {
		// Heuristic detection if tool name was not indexed
		if (
			text.includes("# /graphify") ||
			text.includes("name: graphify") ||
			text.includes("name: using-agent-skills") ||
			text.startsWith("Skill: ") ||
			text.includes("--- Skill Instructions ---") ||
			(text.startsWith("---\nname:") && text.includes("description:")) ||
			(text.includes("<skill") && text.includes("</skill>")) ||
			(text.includes("## Usage") && text.includes("skill"))
		) {
			return "skill"
		}

		if (
			text.startsWith("File: ") &&
			(text.includes("\n") || text.includes("Lines "))
		) {
			return "code_read"
		}

		if (
			text.match(/exit code:?\s*\d+/i) ||
			text.match(/Command failed with exit code/i) ||
			text.includes("Execution completed")
		) {
			return "ephemeral_command"
		}
	}

	return "unknown"
}

/**
 * Truncates an ephemeral output (command stdout, search listing) preserving exit code and summary.
 */
function truncateEphemeralPayload(
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

	const head = text.slice(0, Math.min(text.length, headBytes))
	const tail = text.slice(Math.max(0, text.length - tailBytes))

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
 * Truncates a large source code file reading result with a generous preview and navigation instructions.
 */
function truncateCodePayload(
	text: string,
	maxBytes: number,
	headBytes: number,
	tailBytes: number,
	filePath?: string,
): string {
	const totalBytes = Buffer.byteLength(text, "utf8")
	if (totalBytes <= maxBytes) {
		return text
	}

	const lines = text.split("\n")
	const totalLines = lines.length

	const head = text.slice(0, Math.min(text.length, headBytes))
	const tail = text.slice(Math.max(0, text.length - tailBytes))
	const fileRef = filePath ? ` for '${filePath}'` : ""

	return `[Historical read_file output${fileRef} partially truncated: ${totalLines} lines, ${totalBytes} bytes. Showing head and tail. To inspect intermediate lines, re-read with offset/limit.]
--- File Content (Head) ---
${head}
... [${totalLines} lines total - intermediate code omitted in historical turn. Re-read with offset/limit if editing middle lines] ...
--- File Content (Tail) ---
${tail}
[End of truncated file content]`
}

/**
 * Truncates large skill documentation when exceeding the skill byte threshold.
 */
function truncateSkillPayload(
	text: string,
	maxBytes: number,
	headBytes: number,
): string {
	const totalBytes = Buffer.byteLength(text, "utf8")
	if (totalBytes <= maxBytes) {
		return text
	}

	const lines = text.split("\n")
	const totalLines = lines.length
	const headPreview = text.slice(0, Math.min(text.length, headBytes))

	return `[Historical skill documentation truncated: ${totalBytes} bytes, ${totalLines} lines. Skill was loaded in this session]
--- Preview ---
${headPreview}
... [documentation omitted - instructions already active] ...`
}

/**
 * Truncates an ephemeral output to a compact micro-stub for cold archive turns (Zone 2).
 */
function truncateEphemeralMicroStub(text: string): string {
	const totalBytes = Buffer.byteLength(text, "utf8")
	const lines = text.split("\n")
	const totalLines = lines.length
	const exitCodeMatch = text.match(/exit code:?\s*(\d+)/i) || text.match(/Command failed with exit code\s*(\d+)/i)
	const exitCodeStr = exitCodeMatch ? ` (exit code: ${exitCodeMatch[1]})` : ""

	return `[Historical tool output: ${totalLines} lines, ${totalBytes} bytes${exitCodeStr}. Full output preserved in logs]`
}

/**
 * Truncates a source code read to a concise head/tail navigation stub for cold archive turns (Zone 2).
 */
function truncateColdCodePayload(text: string, filePath?: string): string {
	const totalBytes = Buffer.byteLength(text, "utf8")
	const lines = text.split("\n")
	const totalLines = lines.length
	if (totalLines <= 30 && totalBytes <= 4096) {
		return text
	}
	const headLines = lines.slice(0, 15).join("\n")
	const tailLines = lines.slice(Math.max(15, lines.length - 10)).join("\n")
	const fileRef = filePath ? ` for '${filePath}'` : ""

	return `[Historical read_file output${fileRef} (cold turn): ${totalLines} lines, ${totalBytes} bytes. To inspect intermediate lines, re-read with offset/limit.]
--- File Content (Head) ---
${headLines}
... [${totalLines} lines total - intermediate code omitted in historical turn. Re-read with offset/limit if editing middle lines] ...
--- File Content (Tail) ---
${tailLines}
[End of truncated file content]`
}

/**
 * Truncates large skill documentation to an activation reference stub for cold archive turns (Zone 2).
 */
function truncateColdSkillPayload(text: string): string {
	const lines = text.split("\n")
	const totalLines = lines.length
	const totalBytes = Buffer.byteLength(text, "utf8")
	const firstLine = lines.find((l) => l.trim().length > 0) || "Skill"

	return `[Historical skill documentation (${firstLine.slice(0, 50)}): ${totalLines} lines, ${totalBytes} bytes. Skill instructions active in session]`
}

/**
 * Routes text payload to the appropriate type-aware truncation logic.
 */
function processHistoricalPayload(
	text: string,
	toolInfo: ToolCallMetadata | undefined,
	options: {
		maxEphemeralBytes: number
		maxReadFileBytes: number
		maxSkillBytes: number
		headBytes: number
		tailBytes: number
		readFileHeadBytes: number
		readFileTailBytes: number
		coldMaxEphemeralBytes?: number
		coldMaxReadFileBytes?: number
		coldMaxSkillBytes?: number
		isZone2?: boolean
	},
): string {
	const category = determineToolCategory(toolInfo, text)

	if (options.isZone2) {
		if (category === "code_read") {
			const filePath = typeof toolInfo?.input?.path === "string" ? toolInfo.input.path : undefined
			return truncateColdCodePayload(text, filePath)
		}
		if (category === "skill") {
			return truncateColdSkillPayload(text)
		}
		if (category === "ephemeral_command" || category === "ephemeral_search") {
			return truncateEphemeralMicroStub(text)
		}
	}

	if (category === "code_read") {
		const filePath = typeof toolInfo?.input?.path === "string" ? toolInfo.input.path : undefined
		return truncateCodePayload(
			text,
			options.maxReadFileBytes,
			options.readFileHeadBytes,
			options.readFileTailBytes,
			filePath,
		)
	}

	if (category === "skill") {
		return truncateSkillPayload(text, options.maxSkillBytes, options.headBytes)
	}

	return truncateEphemeralPayload(
		text,
		options.maxEphemeralBytes,
		options.headBytes,
		options.tailBytes,
	)
}

/**
 * Truncates a large string payload while preserving head, tail, and structural summary.
 * Maintained for backward compatibility.
 */
export function truncateTextPayload(
	text: string,
	maxBytes: number,
	headBytes: number,
	tailBytes: number,
): string {
	return processHistoricalPayload(text, undefined, {
		maxEphemeralBytes: maxBytes,
		maxReadFileBytes: maxBytes,
		maxSkillBytes: maxBytes,
		headBytes,
		tailBytes,
		readFileHeadBytes: headBytes,
		readFileTailBytes: tailBytes,
		coldMaxEphemeralBytes: DEFAULT_COLD_MAX_EPHEMERAL_BYTES,
		coldMaxReadFileBytes: DEFAULT_COLD_MAX_READ_FILE_BYTES,
		coldMaxSkillBytes: DEFAULT_COLD_MAX_SKILL_BYTES,
	})
}

/**
 * Optimizes the effective conversation history sent to the LLM by applying
 * Type-Aware Retention to historical tool results from older turns:
 * - High-volume ephemeral outputs (execute_command, search_files) are aggressively compressed
 * - Source code read_file results retain full fidelity up to 20 KB (~500 lines) so the agent
 *   never loses code context when subsequently modifying it with apply_diff
 * - Skills retain full instructions up to 16 KB
 * - Recent turns (active turn + immediate context) are preserved 100% untouched.
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
	const warmTurnsPreserved = options.warmTurnsPreserved ?? DEFAULT_WARM_TURNS_PRESERVED
	const maxEphemeralBytes = options.maxHistoricalToolBytes ?? DEFAULT_MAX_HISTORICAL_TOOL_BYTES
	const maxReadFileBytes = options.maxReadFileBytes ?? DEFAULT_MAX_READ_FILE_BYTES
	const maxSkillBytes = options.maxSkillBytes ?? DEFAULT_MAX_SKILL_BYTES
	const headBytes = options.headBytes ?? DEFAULT_HEAD_BYTES
	const tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES
	const readFileHeadBytes = options.readFileHeadBytes ?? DEFAULT_READ_FILE_HEAD_BYTES
	const readFileTailBytes = options.readFileTailBytes ?? DEFAULT_READ_FILE_TAIL_BYTES
	const coldMaxEphemeralBytes = options.coldMaxEphemeralBytes ?? DEFAULT_COLD_MAX_EPHEMERAL_BYTES
	const coldMaxReadFileBytes = options.coldMaxReadFileBytes ?? DEFAULT_COLD_MAX_READ_FILE_BYTES
	const coldMaxSkillBytes = options.coldMaxSkillBytes ?? DEFAULT_COLD_MAX_SKILL_BYTES
	const stripEnvDetails = options.stripHistoricalEnvironmentDetails ?? true

	const truncationConfig = {
		maxEphemeralBytes,
		maxReadFileBytes,
		maxSkillBytes,
		headBytes,
		tailBytes,
		readFileHeadBytes,
		readFileTailBytes,
		coldMaxEphemeralBytes,
		coldMaxReadFileBytes,
		coldMaxSkillBytes,
	}

	// 1. Build tool call metadata map from assistant messages (indexed by tool_use_id)
	const toolCallMap = new Map<string, ToolCallMetadata>()
	for (const msg of messages) {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use" && block.id) {
					toolCallMap.set(block.id, {
						name: block.name,
						input: (block as any).input,
					})
				}
			}
		}
	}

	// Zone cutoffs:
	// Zone 0: [cutoffIndex ... messages.length - 1] -> 100% untouched
	// Zone 1: [warmCutoffIndex ... cutoffIndex - 1] -> Warm Working Memory (Type-Aware Retention)
	// Zone 2: [0 ... warmCutoffIndex - 1] -> Cold Archive (Micro-Stubs, Navigation Stubs)
	const cutoffIndex = Math.max(0, messages.length - recentMessagesPreserved)
	const warmCutoffIndex = Math.max(0, messages.length - (recentMessagesPreserved + warmTurnsPreserved * 2))

	return messages.map((msg, index) => {
		// Zone 0: Recent messages (active turn + immediate context) are preserved 100% untouched
		if (index >= cutoffIndex) {
			return msg
		}

		// Truncation markers are synthetic structural indicators that must never be modified
		if (msg.isTruncationMarker) {
			return msg
		}

		const isZone2 = index < warmCutoffIndex
		const zoneTruncationConfig = {
			...truncationConfig,
			isZone2,
		}

		// Plain text user messages: strip historical environment details and ephemeralize cold skill expansions
		if (typeof msg.content === "string") {
			// Pure summary messages without environment details are preserved untouched
			if (
				msg.isSummary &&
				(msg.content.includes("[Context Compacted Summary]") || msg.content.includes("### CONTEXT COMPACTION HANDOFF")) &&
				!msg.content.includes("<environment_details>")
			) {
				return msg
			}

			let text = msg.content
			let modified = false

			if (stripEnvDetails && text.includes("<environment_details>")) {
				text = text.replace(
					/<environment_details>[\s\S]*?<\/environment_details>/g,
					"[Environment details omitted for previous turn]",
				)
				modified = true
			}

			const isSummary =
				msg.isSummary ||
				text.includes("[Context Compacted Summary]") ||
				text.includes("### CONTEXT COMPACTION HANDOFF")

			if (
				!isSummary &&
				isZone2 &&
				text.length > 4000 &&
				(text.includes("# /graphify") ||
					text.includes("name: graphify") ||
					text.includes("name: using-agent-skills") ||
					text.includes("--- Skill Instructions ---") ||
					text.startsWith("Skill: ") ||
					(text.startsWith("---\nname:") && text.includes("description:")) ||
					(text.includes("<skill") && text.includes("</skill>")) ||
					(text.includes("## Usage") && text.includes("skill")))
			) {
				text =
					`[Skill instructions loaded in earlier turn (${text.length} bytes). Instructions active in session]\n\n` +
					text.slice(0, 500) +
					"\n... [Remaining skill documentation omitted in historical turn] ..."
				modified = true
			}

			if (modified) {
				return { ...msg, content: text }
			}
			return msg
		}

		// Array of content blocks
		if (Array.isArray(msg.content)) {
			let modified = false
			const newContent = msg.content.map((block) => {
				if (block.type === "tool_result") {
					const toolResultBlock = block as Anthropic.Messages.ToolResultBlockParam
					const toolInfo = toolResultBlock.tool_use_id ? toolCallMap.get(toolResultBlock.tool_use_id) : undefined

					if (typeof toolResultBlock.content === "string") {
						const truncated = processHistoricalPayload(toolResultBlock.content, toolInfo, zoneTruncationConfig)
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
								const truncated = processHistoricalPayload(subBlock.text, toolInfo, zoneTruncationConfig)
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
				} else if (block.type === "text" && typeof block.text === "string") {
					// Summary blocks must NEVER be truncated or treated as tool results/ephemeral skills
					const isSummaryBlock =
						block.text.includes("[Context Compacted Summary]") ||
						block.text.includes("### CONTEXT COMPACTION HANDOFF")

					if (isSummaryBlock) {
						return block
					}

					let newText = block.text
					let textModified = false

					if (stripEnvDetails && newText.includes("<environment_details>")) {
						newText = newText.replace(
							/<environment_details>[\s\S]*?<\/environment_details>/g,
							"[Environment details omitted for previous turn]",
						)
						textModified = true
					}

					if (
						isZone2 &&
						newText.length > 4000 &&
						(newText.includes("# /graphify") ||
							newText.includes("name: graphify") ||
							newText.includes("name: using-agent-skills") ||
							newText.includes("--- Skill Instructions ---") ||
							newText.startsWith("Skill: ") ||
							(newText.startsWith("---\nname:") && newText.includes("description:")) ||
							(newText.includes("<skill") && newText.includes("</skill>")) ||
							(newText.includes("## Usage") && newText.includes("skill")))
					) {
						newText =
							`[Skill instructions loaded in earlier turn (${newText.length} bytes). Instructions active in session]\n\n` +
							newText.slice(0, 500) +
							"\n... [Remaining skill documentation omitted in historical turn] ..."
						textModified = true
					}

					if (textModified) {
						modified = true
						return { ...block, text: newText }
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
