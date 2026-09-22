import { type ClineMessage } from "@roo-code/types"

/**
 * Returns the latest user-authored prompt in the task conversation history.
 *
 * Traversal logic:
 * 1. Iterates backwards from the newest message to find the latest message where
 *    `type === "say" && say === "user_feedback"` that has non-empty text or images.
 * 2. Excludes assistant messages, tool results, diff edits, todo edits, command outputs,
 *    telemetry, and system events.
 * 3. Falls back to `messages[0]` (the initial task prompt) if no subsequent user feedback exists.
 * 4. Returns `undefined` if messages is empty or undefined.
 *
 * Note: The initial task in storage is never modified; this helper is strictly for presentation.
 *
 * @param messages Array of ClineMessage from extension state
 * @returns The latest user-authored ClineMessage or undefined
 */
export function getLatestUserPrompt(messages: ClineMessage[] | undefined): ClineMessage | undefined {
	if (!messages || messages.length === 0) {
		return undefined
	}

	for (let i = messages.length - 1; i > 0; i--) {
		const message = messages[i]
		if (
			message.type === "say" &&
			message.say === "user_feedback" &&
			(Boolean(message.text?.trim()) || (message.images && message.images.length > 0))
		) {
			return message
		}
	}

	return messages[0]
}

/**
 * Returns the slice of modified messages corresponding to the agent's work
 * performed in response to the latest user-authored prompt.
 *
 * Traversal logic:
 * 1. If `latestUserPrompt` is undefined or matches `initialTask` (by reference or `ts`),
 *    all `modifiedMessages` belong to this prompt.
 * 2. Otherwise, finds `latestUserPrompt` in `modifiedMessages` (by reference or `ts`).
 * 3. Returns all messages that come after that prompt (`modifiedMessages.slice(promptIndex + 1)`).
 * 4. Falls back to `modifiedMessages` if `promptIndex === -1`.
 *
 * @param modifiedMessages Consolidated messages array from ChatView
 * @param latestUserPrompt The latest user-authored ClineMessage
 * @param initialTask The initial task ClineMessage (messages[0])
 * @returns Array of ClineMessages representing the work done for the latest prompt
 */
export function getLatestPromptModifiedMessages(
	modifiedMessages: ClineMessage[],
	latestUserPrompt: ClineMessage | undefined,
	initialTask: ClineMessage | undefined,
): ClineMessage[] {
	if (!modifiedMessages || modifiedMessages.length === 0) {
		return []
	}

	if (!latestUserPrompt || !initialTask || latestUserPrompt === initialTask || latestUserPrompt.ts === initialTask.ts) {
		return modifiedMessages
	}

	const promptIndex = modifiedMessages.findLastIndex(
		(m) => m === latestUserPrompt || m.ts === latestUserPrompt.ts,
	)

	if (promptIndex === -1) {
		return modifiedMessages
	}

	return modifiedMessages.slice(promptIndex + 1)
}
