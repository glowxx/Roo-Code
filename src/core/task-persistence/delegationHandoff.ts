import type { ClineMessage } from "@roo-code/types"
import { findLast } from "../../shared/array"
import { readTaskMessages, saveTaskMessages } from "./taskMessages"
import { readApiMessages, saveApiMessages } from "./apiMessages"
import { validateAndFixToolResultIds } from "../task/validateToolResultIds"

export interface DelegationHandoffOptions {
	parentTaskId: string
	childTaskId: string
	globalStoragePath: string
	completionResultSummary?: string
	readTaskMessagesFn?: typeof readTaskMessages
	saveTaskMessagesFn?: typeof saveTaskMessages
	readApiMessagesFn?: typeof readApiMessages
	saveApiMessagesFn?: typeof saveApiMessages
}

export interface DelegationHandoffResult {
	completionResultSummary: string
	parentClineMessages: ClineMessage[]
	parentApiMessages: any[]
}

/**
 * Safely applies a completed child's execution result to its delegated parent.
 *
 * Invariants enforced:
 * 1. Exactly-once UI message injection (`say: "subtask_result"`).
 * 2. Exactly-once API message injection (`tool_result` corresponding to `tool_use: "new_task"`).
 * 3. Durable recovery: can reconstruct child result from child `ui_messages.json` if needed.
 * 4. Idempotent across restarts: does not duplicate results if called repeatedly.
 */
export async function applyDelegationHandoff({
	parentTaskId,
	childTaskId,
	globalStoragePath,
	completionResultSummary: providedSummary,
	readTaskMessagesFn = readTaskMessages,
	saveTaskMessagesFn = saveTaskMessages,
	readApiMessagesFn = readApiMessages,
	saveApiMessagesFn = saveApiMessages,
}: DelegationHandoffOptions): Promise<DelegationHandoffResult> {
	let completionResultSummary = providedSummary

	// If no summary was passed, attempt to extract it from durable child UI messages
	if (!completionResultSummary) {
		try {
			const childMessages = await readTaskMessagesFn({ taskId: childTaskId, globalStoragePath })
			const completionSay = findLast(
				childMessages,
				(m: ClineMessage) =>
					(m.type === "say" && m.say === "completion_result") ||
					(m.type === "ask" && m.ask === "completion_result"),
			)
			completionResultSummary = completionSay?.text || `Subtask ${childTaskId} completed.`
		} catch {
			completionResultSummary = `Subtask ${childTaskId} completed.`
		}
	}

	let parentClineMessages: ClineMessage[] = []
	try {
		parentClineMessages = await readTaskMessagesFn({ taskId: parentTaskId, globalStoragePath })
	} catch {
		parentClineMessages = []
	}
	if (!Array.isArray(parentClineMessages)) parentClineMessages = []

	let parentApiMessages: any[] = []
	try {
		parentApiMessages = (await readApiMessagesFn({ taskId: parentTaskId, globalStoragePath })) as any[]
	} catch {
		parentApiMessages = []
	}
	if (!Array.isArray(parentApiMessages)) parentApiMessages = []

	const ts = Date.now()

	// 1. UI message idempotency: exactly once
	const alreadyHasSubtaskUi = parentClineMessages.some(
		(m) => m.type === "say" && m.say === "subtask_result" && m.text === completionResultSummary,
	)
	if (!alreadyHasSubtaskUi) {
		const subtaskUiMessage: ClineMessage = {
			type: "say",
			say: "subtask_result",
			text: completionResultSummary,
			ts,
		}
		parentClineMessages.push(subtaskUiMessage)
		await saveTaskMessagesFn({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })
	}

	// 2. Find tool_use_id from last assistant message for new_task
	let toolUseId: string | undefined
	for (let i = parentApiMessages.length - 1; i >= 0; i--) {
		const msg = parentApiMessages[i]
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_use" && block.name === "new_task") {
					toolUseId = block.id
					break
				}
			}
			if (toolUseId) break
		}
	}

	let apiHistoryModified = false
	if (toolUseId) {
		const lastMsg = parentApiMessages[parentApiMessages.length - 1]
		let alreadyHasToolResult = false
		if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
			for (const block of lastMsg.content) {
				if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
					block.content = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
					alreadyHasToolResult = true
					apiHistoryModified = true
					break
				}
			}
		}

		if (!alreadyHasToolResult) {
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "tool_result" as const,
						tool_use_id: toolUseId,
						content: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
					},
				],
				ts,
			})
			apiHistoryModified = true
		}

		const lastMessage = parentApiMessages[parentApiMessages.length - 1]
		if (lastMessage?.role === "user") {
			const validatedMessage = validateAndFixToolResultIds(lastMessage, parentApiMessages.slice(0, -1))
			parentApiMessages[parentApiMessages.length - 1] = validatedMessage
		}
	} else {
		const fallbackText = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
		const alreadyHasFallbackText = parentApiMessages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some((b: any) => b.type === "text" && b.text === fallbackText),
		)
		if (!alreadyHasFallbackText) {
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "text" as const,
						text: fallbackText,
					},
				],
				ts,
			})
			apiHistoryModified = true
		}
	}

	if (apiHistoryModified) {
		await saveApiMessagesFn({ messages: parentApiMessages as any, taskId: parentTaskId, globalStoragePath })
	}

	const finalSummary: string = completionResultSummary || `Subtask ${childTaskId} completed.`

	return {
		completionResultSummary: finalSummary,
		parentClineMessages,
		parentApiMessages,
	}
}
