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
