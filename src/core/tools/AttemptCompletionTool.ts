import * as vscode from "vscode"

import { RooCodeEventName, type HistoryItem } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

import { findLast } from "../../shared/array"
import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AttemptCompletionParams {
	result: string
	command?: string
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void>
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		const { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Terminal state guard: If task is already completed, do not allow subsequent completion attempts
		if (task.isTaskCompleted) {
			pushToolResult(formatResponse.toolResult("Task is already completed."))
			return
		}

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			await task.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos =
			task.todoList && task.todoList.some((todo) => todo.status === "in_progress" || todo.status === "pending")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion")
				pushToolResult(await task.sayAndCreateMissingParamError("attempt_completion", "result"))
				return
			}

			task.consecutiveMistakeCount = 0

			await task.say("completion_result", result, undefined, false)

			// Mark candidate completion message as EVALUATING while approval is pending
			const completionSayMsg = task.clineMessages
				? findLast(task.clineMessages, (m) => m.say === "completion_result")
				: undefined
			if (completionSayMsg) {
				completionSayMsg.approvalState = "EVALUATING"
				task.updateClineMessage?.(completionSayMsg)
			}

			// Check for subtask using parentTaskId (metadata-driven delegation)
			if (task.parentTaskId) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active" || status === "interrupted") {
							// Defensively check parent existence before attempting delegation
							let parentExists = false
							try {
								const { historyItem: parentHistory } = await provider.getTaskWithId(task.parentTaskId!)
								parentExists = Boolean(parentHistory)
							} catch {
								parentExists = false
							}

							if (!parentExists) {
								console.warn(
									`[AttemptCompletionTool] Parent task ${task.parentTaskId} not found. Falling through to standalone completion.`,
								)
								// Fall through to normal completion ask flow
							} else {
								// Prevent duplicate in-flight completion calls
								if (task.isDelegatingCompletion) {
									return
								}
								task.isDelegatingCompletion = true
								try {
									const delegation = await this.delegateToParent(
										task,
										result,
										provider,
										askFinishSubTaskApproval,
										pushToolResult,
									)
									if (delegation === "delegated") {
										if (completionSayMsg) {
											completionSayMsg.approvalState = "AUTO_APPROVED"
											task.updateClineMessage?.(completionSayMsg)
										}
										task.markTaskCompleted?.()
										this.emitTaskCompleted(task)
									}
									if (delegation !== "continue") return
								} finally {
									task.isDelegatingCompletion = false
								}
							}
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							console.error(
								`[AttemptCompletionTool] Unexpected child task status "${status}" for task ${task.taskId}. ` +
									`Expected "active", "interrupted" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						console.error(
							`[AttemptCompletionTool] Failed to get history for task ${task.taskId}: ${(err as Error)?.message ?? String(err)}. ` +
								`Skipping delegation.`,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			task.setLastCompletionResultText?.(result)
			const { response, text, images } = await task.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				if (completionSayMsg) {
					completionSayMsg.approvalState = "AUTO_APPROVED"
					task.updateClineMessage?.(completionSayMsg)
				}
				const completionAskMsg = task.clineMessages
					? findLast(task.clineMessages, (m) => m.type === "ask" && m.ask === "completion_result")
					: undefined
				if (completionAskMsg) {
					completionAskMsg.approvalState = "AUTO_APPROVED"
					completionAskMsg.isAnswered = true
					task.updateClineMessage?.(completionAskMsg)
				}
				task.markTaskCompleted?.()
				this.emitTaskCompleted(task)
				pushToolResult(formatResponse.toolResult("Task completed successfully."))
				await task.flushPendingToolResultsToHistory?.()
				try {
					const provider = task.providerRef.deref() as any
					if (
						provider &&
						typeof provider.getTaskWithId === "function" &&
						typeof provider.updateTaskHistory === "function"
					) {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						if (historyItem && historyItem.status !== "completed") {
							await provider.updateTaskHistory({
								...historyItem,
								status: "completed",
								needsAttention: false,
							})
						}
					}
				} catch {
					// non-fatal
				}
				return
			}

			if (completionSayMsg) {
				completionSayMsg.approvalState = "DENIED"
				task.updateClineMessage?.(completionSayMsg)
			}
			const completionAskMsg = task.clineMessages
				? findLast(task.clineMessages, (m) => m.type === "ask" && m.ask === "completion_result")
				: undefined
			if (completionAskMsg) {
				completionAskMsg.approvalState = "DENIED"
				completionAskMsg.isAnswered = true
				task.updateClineMessage?.(completionAskMsg)
			}

			// User provided feedback or autonomous CONTINUE_WORK feedback
			if (text) {
				let isAutonomousContinueWork = false
				let reasonText = ""
				try {
					const parsed = JSON.parse(text)
					if (parsed.status === "continue_work" || parsed.decision === "CONTINUE_WORK") {
						isAutonomousContinueWork = true
						reasonText = parsed.reason || ""
					}
				} catch {}

				if (isAutonomousContinueWork) {
					// Inform the user why completion was rejected and why autonomous work continues
					const explanation = reasonText
						? `🔍 **Completion Review:** Work continuation requested.\n\n**Reason:** ${reasonText}`
						: `🔍 **Completion Review:** Work continuation requested by completion verification.`
					await task.say("text", explanation)
					// Return structured continuation directly to worker model without fake user speech bubble
					pushToolResult(formatResponse.toolResult(text, images))
				} else {
					await task.say("user_feedback", text ?? "", images)
					const feedbackText = `<user_message>\n${text}\n</user_message>`
					pushToolResult(formatResponse.toolResult(feedbackText, images))
				}
			} else {
				await task.say("user_feedback", "", images)
				pushToolResult(
					formatResponse.toolResult("<user_message>\nTask completion not accepted.\n</user_message>", images)
				)
			}
		} catch (error) {
			await handleError("completing task", error as Error)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns:
	 * - "delegated" when completion was approved and parent resumed
	 * - "denied" when user denied finishing the subtask
	 * - "continue" when caller should fall through to normal completion ask flow
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<"delegated" | "denied" | "continue"> {
		const didApprove = await askFinishSubTaskApproval()

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return "denied"
		}

		pushToolResult("")

		await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary: result,
		})

		return "delegated"
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			} else {
				await task.say("completion_result", result ?? "", undefined, false)
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			}
		} else {
			await task.say("completion_result", result ?? "", undefined, block.partial)
		}
	}

	private emitTaskCompleted(task: Task): void {
		// Force final token usage update before emitting TaskCompleted.
		// This ensures the latest stats are captured regardless of throttle timer.
		task.emitFinalTokenUsageUpdate()
		task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()
