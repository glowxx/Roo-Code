/** Ordered conversation used to check authorship lanes and vertical rhythm. */
export const conversationRegressionFixture = [
	{ type: "say", say: "user_feedback", text: "Please inspect the task", lane: "user", spacing: "turn" },
	{ type: "say", say: "text", text: "I will inspect the task.", lane: "assistant", spacing: "operation" },
	{ type: "say", say: "reasoning", text: "Thinking", lane: "assistant", spacing: "activity" },
	{ type: "say", say: "api_req_started", text: "{}", lane: "assistant", spacing: "activity" },
	{ type: "ask", ask: "tool", text: '{"tool":"editedExistingFile","path":"src/example.ts"}', lane: "assistant", spacing: "operation" },
	{ type: "say", say: "checkpoint_saved", text: "abc123", lane: "assistant", spacing: "activity" },
	{ type: "say", say: "condense_context", text: "Context compacted", lane: "assistant", spacing: "activity" },
	{ type: "ask", ask: "command", text: "echo ok", lane: "assistant", spacing: "operation" },
	{ type: "say", say: "command_output", text: "ok", lane: "assistant", spacing: "detail" },
	{ type: "say", say: "error", text: "Safety guardrail warning", lane: "assistant", spacing: "operation" },
	{ type: "ask", ask: "tool", text: '{"tool":"execute_command","command":"echo ok"}', lane: "assistant", spacing: "operation" },
	{ type: "say", say: "text", text: "The task is complete.", lane: "assistant", spacing: "operation" },
	{ type: "say", say: "completion_result", text: "Done", lane: "assistant", spacing: "operation" },
] as const
