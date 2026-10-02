import NodeCache from "node-cache"
import getFolderSize from "get-folder-size"

import type { ClineMessage, HistoryItem } from "@roo-code/types"

import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { findLastIndex } from "../../shared/array"
import { getTaskDirectoryPath } from "../../utils/storage"
import { t } from "../../i18n"

const taskSizeCache = new NodeCache({ stdTTL: 30, checkperiod: 5 * 60 })

export type TaskMetadataOptions = {
	taskId: string
	rootTaskId?: string
	parentTaskId?: string
	taskNumber: number
	messages: ClineMessage[]
	globalStoragePath: string
	workspace: string
	mode?: string
	/** Provider profile name for the task (sticky profile feature) */
	apiConfigName?: string
	/** Initial status for the task (e.g., "active" for child tasks) */
	initialStatus?: HistoryItem["status"]
	/** Optional pre-generated or user-assigned title */
	title?: string
	/** Source of the title */
	titleSource?: "generated_ai" | "manual" | "fallback"
	/** Per-chat preferred model ID */
	chatModelId?: string
	/** Per-chat preferred provider */
	chatProvider?: string
	/** Per-chat preferred reasoning effort */
	chatReasoningEffort?: string
	/** Task execution snapshot model ID */
	executionModelId?: string
	/** Task execution snapshot provider */
	executionProvider?: string
	/** Task execution snapshot reasoning effort */
	executionReasoningEffort?: string
	/** Child task ID currently being awaited by this task */
	awaitingChildId?: string
	/** Child task ID this task was delegated to */
	delegatedToId?: string
	/** Child task IDs spawned by this task */
	childIds?: string[]
}

export async function taskMetadata({
	taskId: id,
	rootTaskId,
	parentTaskId,
	taskNumber,
	messages,
	globalStoragePath,
	workspace,
	mode,
	apiConfigName,
	initialStatus,
	awaitingChildId,
	delegatedToId,
	childIds,
	title,
	titleSource,
	chatModelId,
	chatProvider,
	chatReasoningEffort,
	executionModelId,
	executionProvider,
	executionReasoningEffort,
}: TaskMetadataOptions) {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, id)

	// Determine message availability upfront
	const hasMessages = messages && messages.length > 0

	// Pre-calculate all values based on availability
	let timestamp: number
	let tokenUsage: ReturnType<typeof getApiMetrics>
	let taskDirSize: number
	let taskMessage: ClineMessage | undefined
	let lastRelevantMessage: ClineMessage | undefined

	if (!hasMessages) {
		// Handle no messages case
		timestamp = Date.now()
		tokenUsage = {
			totalTokensIn: 0,
			totalTokensOut: 0,
			totalCacheWrites: 0,
			totalCacheReads: 0,
			totalCost: 0,
			contextTokens: 0,
		}
		taskDirSize = 0
	} else {
		// Handle messages case
		taskMessage = messages[0] // First message is always the task say.

		lastRelevantMessage =
			messages[findLastIndex(messages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))] ||
			taskMessage

		timestamp = lastRelevantMessage?.ts ?? Date.now()

		tokenUsage = getApiMetrics(combineApiRequests(combineCommandSequences(messages.slice(1))))

		// Get task directory size
		const cachedSize = taskSizeCache.get<number>(taskDir)

		if (cachedSize === undefined) {
			try {
				taskDirSize = await getFolderSize.loose(taskDir)
				taskSizeCache.set<number>(taskDir, taskDirSize)
			} catch (error) {
				taskDirSize = 0
			}
		} else {
			taskDirSize = cachedSize
		}
	}

	const createdAt = hasMessages ? (taskMessage?.ts ?? Date.now()) : Date.now()

	// Determine completion from explicit status or completion message at task end
	const hasCompletionMessage =
		lastRelevantMessage?.ask === "completion_result" ||
		lastRelevantMessage?.say === "completion_result"

	const isCompleted =
		initialStatus === "completed" ||
		hasCompletionMessage ||
		(hasMessages &&
			messages.some((m) => m.ask === "resume_completed_task") &&
			!messages.slice(findLastIndex(messages, (m) => m.ask === "resume_completed_task") + 1).some((m) => m.type === "say" && m.say === "user_feedback"))

	let resolvedStatus = initialStatus
	if (isCompleted && (!resolvedStatus || resolvedStatus === "active" || resolvedStatus === "interrupted")) {
		resolvedStatus = "completed"
	}

	let needsAttention = false
	if (!isCompleted) {
		if (resolvedStatus === "interrupted") {
			needsAttention = true
		} else if (resolvedStatus === "delegated" && awaitingChildId) {
			// A delegated parent task awaiting child execution does not need user attention.
			// Attention is directed to the active child task.
			needsAttention = false
		} else if (hasMessages) {
			const lastAskIdx = findLastIndex(messages, (m) => m.type === "ask")
			if (lastAskIdx !== -1) {
				const lastAsk = messages[lastAskIdx]
				const lastSubstantiveSayIdx = findLastIndex(
					messages,
					(m) =>
						m.type === "say" &&
						m.say !== "command_safety_warning" &&
						m.say !== "api_req_rate_limit_wait" &&
						m.say !== "api_req_retry_delayed",
				)

				// An ask requires user attention if it is the latest unresolved turn that has not been answered.
				if (lastAskIdx > lastSubstantiveSayIdx && !lastAsk.isAnswered) {
					const isIdleAsk = lastAsk.ask === "resume_completed_task"
					const isAutoApproved = lastAsk.approvalState === "AUTO_APPROVED"
					const isEvaluating = lastAsk.approvalState === "EVALUATING"

					if (!isIdleAsk && !isAutoApproved && !isEvaluating) {
						needsAttention = true
					}
				}
			}
		}
	}

	// Create historyItem once with pre-calculated values.
	// initialStatus is included when provided (e.g., "active" for child tasks)
	// to ensure the status is set from the very first save, avoiding race conditions
	// where attempt_completion might run before a separate status update.
	const historyItem: HistoryItem = {
		id,
		rootTaskId,
		parentTaskId,
		number: taskNumber,
		createdAt,
		ts: timestamp,
		task: hasMessages
			? taskMessage!.text?.trim() || t("common:tasks.incomplete", { taskNumber })
			: t("common:tasks.no_messages", { taskNumber }),
		tokensIn: tokenUsage.totalTokensIn,
		tokensOut: tokenUsage.totalTokensOut,
		cacheWrites: tokenUsage.totalCacheWrites,
		cacheReads: tokenUsage.totalCacheReads,
		totalCost: tokenUsage.totalCost,
		size: taskDirSize,
		workspace,
		mode,
		needsAttention,
		...(chatModelId ? { chatModelId } : {}),
		...(chatProvider ? { chatProvider } : {}),
		...(chatReasoningEffort ? { chatReasoningEffort } : {}),
		...(executionModelId ? { executionModelId } : {}),
		...(executionProvider ? { executionProvider } : {}),
		...(executionReasoningEffort !== undefined ? { executionReasoningEffort } : {}),
		...(typeof apiConfigName === "string" && apiConfigName.length > 0 ? { apiConfigName } : {}),
		...(resolvedStatus && { status: resolvedStatus }),
		...(awaitingChildId ? { awaitingChildId } : {}),
		...(delegatedToId ? { delegatedToId } : {}),
		...(childIds ? { childIds } : {}),
		...(typeof title === "string" && title.length > 0 ? { title } : {}),
		...(titleSource ? { titleSource } : {}),
	}

	return { historyItem, tokenUsage }
}
