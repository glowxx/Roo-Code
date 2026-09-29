import type { ClineMessage } from "@roo-code/types"

export type ConversationLane = "assistant" | "user"
export type ConversationSpacing = "detail" | "activity" | "operation" | "turn"

/** Keep authorship and spacing at the row boundary, including technical rows. */
export function getConversationRowLayout(message: ClineMessage): { lane: ConversationLane; spacing: ConversationSpacing } {
	if (message.type === "say" && (message.say === "user_feedback" || message.say === "user_feedback_diff")) {
		return { lane: "user", spacing: message.say === "user_feedback_diff" ? "detail" : "turn" }
	}
	if (message.say === "command_output") {
		return { lane: "assistant", spacing: "detail" }
	}
	if (
		message.say === "reasoning" ||
		message.say === "api_req_started" ||
		message.say === "checkpoint_saved" ||
		message.say === "condense_context" ||
		message.say === "sliding_window_truncation"
	) {
		return { lane: "assistant", spacing: "activity" }
	}
	return { lane: "assistant", spacing: "operation" }
}
