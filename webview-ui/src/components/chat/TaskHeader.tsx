import { memo, useRef, useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ChevronUp, ChevronDown, HardDriveDownload, HardDriveUpload, FoldVertical, ArrowLeft, Plus } from "lucide-react"
import prettyBytes from "pretty-bytes"

import { type ClineMessage, getModelContextWindow } from "@roo-code/types"

import { getModelMaxOutputTokens } from "@roo/api"

import { formatLargeNumber } from "@src/utils/format"
import { cn } from "@src/lib/utils"
import { StandardTooltip, Button } from "@src/components/ui"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { vscode } from "@src/utils/vscode"

import Thumbnails from "../common/Thumbnails"

import { TaskActions } from "./TaskActions"
import { Mention } from "./Mention"
import { TodoListDisplay } from "./TodoListDisplay"
import { LucideIconButton } from "./LucideIconButton"

export interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	aggregatedCost?: number
	hasSubtasks?: boolean
	parentTaskId?: string
	costBreakdown?: string
	contextTokens: number
	buttonsDisabled: boolean
	isCondensing?: boolean
	handleCondenseContext?: (taskId: string) => void
	todos?: any[]
}

const TaskHeader = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	aggregatedCost,
	hasSubtasks,
	parentTaskId,
	costBreakdown,
	contextTokens,
	buttonsDisabled,
	isCondensing = false,
	handleCondenseContext,
	todos,
}: TaskHeaderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration, currentTaskItem, clineMessages } = useExtensionState()
	const { id: modelId, info: model } = useSelectedModel(apiConfiguration)
	const [isTaskExpanded, setIsTaskExpanded] = useState(false)

	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const customContextOverride =
		(apiConfiguration as any)?.xkiroCustomContextWindow || (apiConfiguration as any)?.customContextWindow
	const contextWindow = customContextOverride || model?.contextWindow || getModelContextWindow(modelId) || 1

	// Calculate maxTokens (reserved for output) once for reuse in percentage and tooltip
	const maxTokens = useMemo(
		() =>
			model
				? getModelMaxOutputTokens({
						modelId,
						model,
						settings: apiConfiguration,
					})
				: 0,
		[model, modelId, apiConfiguration],
	)
	const reservedForOutput = maxTokens || 0

	const isCompactDisabled = Boolean(
		buttonsDisabled || isCondensing || (clineMessages ? clineMessages.length < 4 : false),
	)
	const isSpinning = Boolean(isCondensing || buttonsDisabled)

	const handleCompact = (e?: React.MouseEvent) => {
		e?.stopPropagation()
		if (isCompactDisabled || !currentTaskItem?.id) {
			return
		}
		vscode.postMessage({ type: "compactTask", taskId: currentTaskItem.id })
		handleCondenseContext?.(currentTaskItem.id)
	}

	const CompactIcon = useMemo(
		() => (props: any) => (
			<FoldVertical {...props} className={cn(props?.className, isSpinning && "animate-spin")} />
		),
		[isSpinning],
	)

	const compactButton = (
		<LucideIconButton
			title={t("chat:task.compactContext", "Compress conversation history and reclaim context tokens")}
			icon={CompactIcon as any}
			disabled={isCompactDisabled}
			onClick={handleCompact}
			className="p-1"
		/>
	)
	const condenseButton = compactButton

	const hasTodos = todos && Array.isArray(todos) && todos.length > 0

	// Determine if this is a subtask (has a parent)
	const isSubtask = !!parentTaskId

	const handleBackToParent = () => {
		if (parentTaskId) {
			vscode.postMessage({ type: "showTaskWithId", text: parentTaskId })
		}
	}

	return (
		<div className="group pt-2 pb-0 px-3">
			{isSubtask && (
				<div className="mb-2" onClick={(e) => e.stopPropagation()}>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleBackToParent}
						className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground">
						<ArrowLeft className="size-3" />
						{t("chat:task.backToParentTask")}
					</Button>
				</div>
			)}
			<div
				className={cn(
					"px-3 pt-2.5 pb-2 flex flex-col gap-1.5 relative z-1 cursor-pointer",
					"bg-vscode-input-background hover:bg-vscode-input-background/90",
					"text-vscode-foreground/80 hover:text-vscode-foreground",
					"shadow-lg shadow-vscode-sideBar-background/50 rounded-xl",
					hasTodos && "border-b-0",
				)}
				onClick={(e) => {
					// Don't expand if clicking on todos section
					if (e.target instanceof Element && e.target.closest("[data-todo-list]")) {
						return
					}

					// Don't expand if clicking on buttons or interactive elements
					if (
						e.target instanceof Element &&
						(e.target.closest("button") ||
							e.target.closest('[role="button"]') ||
							e.target.closest(".share-button") ||
							e.target.closest("[data-radix-popper-content-wrapper]") ||
							e.target.closest("img") ||
							e.target.tagName === "IMG")
					) {
						return
					}

					// Don't expand/collapse if user is selecting text
					const selection = window.getSelection()
					if (selection && selection.toString().length > 0) {
						return
					}

					setIsTaskExpanded(!isTaskExpanded)
				}}>
				<div className="flex justify-between items-center gap-0">
					<div className="flex items-center select-none grow min-w-0">
						<div className="grow min-w-0">
							{isTaskExpanded && <span className="font-bold">{t("chat:task.title")}</span>}
							{!isTaskExpanded && (
								<div className="flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
									<Mention text={task.text} />
								</div>
							)}
						</div>
						<div className="flex items-center shrink-0 ml-2 gap-1" onClick={(e) => e.stopPropagation()}>
							<StandardTooltip content={t("chat:startNewTask.title", "New Chat")}>
								<button
									onClick={() => vscode.postMessage({ type: "clearTask" })}
									data-testid="header-new-chat-btn"
									className="shrink-0 min-h-[20px] min-w-[20px] p-[2px] cursor-pointer opacity-75 hover:opacity-100 hover:bg-vscode-toolbar-hoverBackground bg-transparent border-none rounded-md transition-colors"
									aria-label={t("chat:startNewTask.title", "New Chat")}>
									<Plus size={16} />
								</button>
							</StandardTooltip>
							<StandardTooltip content={isTaskExpanded ? t("chat:task.collapse") : t("chat:task.expand")}>
								<button
									onClick={() => setIsTaskExpanded(!isTaskExpanded)}
									className="shrink-0 min-h-[20px] min-w-[20px] p-[2px] cursor-pointer opacity-85 hover:opacity-100 bg-transparent border-none rounded-md">
									{isTaskExpanded ? (
										<ChevronUp size={16} />
									) : (
										<ChevronDown size={16} className="opacity-0 group-hover:opacity-100" />
									)}
								</button>
							</StandardTooltip>
						</div>
					</div>
				</div>
				{!isTaskExpanded && (
					<div
						className="flex items-center justify-between text-sm text-muted-foreground/70"
						onClick={(e) => e.stopPropagation()}>
						<div className="flex items-center gap-2">
							{compactButton}
							{!!totalCost && (
								<>
									<span>·</span>
									<StandardTooltip
										content={
											hasSubtasks ? (
												<div>
													<div>
														{t("chat:costs.totalWithSubtasks", {
															cost: (aggregatedCost ?? totalCost).toFixed(2),
														})}
													</div>
													{costBreakdown && (
														<div className="text-xs mt-1">{costBreakdown}</div>
													)}
												</div>
											) : (
												<div>{t("chat:costs.total", { cost: totalCost.toFixed(2) })}</div>
											)
										}
										side="top"
										sideOffset={8}>
										<>
											<span>
												${(aggregatedCost ?? totalCost).toFixed(2)}
												{hasSubtasks && (
													<span
														className="text-xs ml-1"
														title={t("chat:costs.includesSubtasks")}>
														*
													</span>
												)}
											</span>
										</>
									</StandardTooltip>
								</>
							)}
						</div>
					</div>
				)}
				{/* Expanded state: Show task text and images */}
				{isTaskExpanded && (
					<>
						<div
							ref={textContainerRef}
							className="text-vscode-font-size overflow-y-auto break-words break-anywhere relative">
							<div
								ref={textRef}
								className="overflow-auto max-h-80 whitespace-pre-wrap break-words break-anywhere cursor-text py-0.5"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: "unset",
									WebkitBoxOrient: "vertical",
								}}>
								<Mention text={task.text} />
							</div>
						</div>
						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						<div onClick={(e) => e.stopPropagation()}>
							<TaskActions item={currentTaskItem} buttonsDisabled={buttonsDisabled} />
						</div>

						<div className="pt-3 mt-2 -mx-2.5 px-2.5 border-t border-vscode-sideBar-background">
							<table className="w-full text-sm">
								<tbody>
									<tr>
										<th
											className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]"
											data-testid="context-window-label">
											{t("chat:task.contextWindow")}
										</th>
										<td className="font-light align-top">
											<div className="flex items-center gap-1 -mt-1">
												{compactButton}
											</div>
										</td>
									</tr>

									<tr>
										<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
											{t("chat:task.tokens")}
										</th>
										<td className="font-light align-top">
											<div className="flex items-center gap-1 flex-wrap">
												{typeof tokensIn === "number" && tokensIn > 0 && (
													<span>↑ {formatLargeNumber(tokensIn)}</span>
												)}
												{typeof tokensOut === "number" && tokensOut > 0 && (
													<span>↓ {formatLargeNumber(tokensOut)}</span>
												)}
											</div>
										</td>
									</tr>

									{((typeof cacheReads === "number" && cacheReads > 0) ||
										(typeof cacheWrites === "number" && cacheWrites > 0)) && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.cache")}
											</th>
											<td className="font-light align-top">
												<div className="flex items-center gap-1 flex-wrap">
													{typeof cacheWrites === "number" && cacheWrites > 0 && (
														<>
															<HardDriveDownload className="size-2.5" />
															<span>{formatLargeNumber(cacheWrites)}</span>
														</>
													)}
													{typeof cacheReads === "number" && cacheReads > 0 && (
														<>
															<HardDriveUpload className="size-2.5" />
															<span>{formatLargeNumber(cacheReads)}</span>
														</>
													)}
												</div>
											</td>
										</tr>
									)}

									{!!totalCost && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.apiCost")}
											</th>
											<td className="font-light align-top">
												<StandardTooltip
													content={
														hasSubtasks ? (
															<div>
																<div>
																	{t("chat:costs.totalWithSubtasks", {
																		cost: (aggregatedCost ?? totalCost).toFixed(2),
																	})}
																</div>
																{costBreakdown && (
																	<div className="text-xs mt-1">{costBreakdown}</div>
																)}
															</div>
														) : (
															<div>
																{t("chat:costs.total", { cost: totalCost.toFixed(2) })}
															</div>
														)
													}
													side="top"
													sideOffset={8}>
													<span>
														${(aggregatedCost ?? totalCost).toFixed(2)}
														{hasSubtasks && (
															<span
																className="text-xs ml-1"
																title={t("chat:costs.includesSubtasks")}>
																*
															</span>
														)}
													</span>
												</StandardTooltip>
											</td>
										</tr>
									)}

									{/* Size display */}
									{!!currentTaskItem?.size && currentTaskItem.size > 0 && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-2 h-[20px]">
												{t("chat:task.size")}
											</th>
											<td className="font-light align-top">
												{prettyBytes(currentTaskItem.size)}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</>
				)}
				{/* Todo list - always shown at bottom when todos exist */}
				{hasTodos && <TodoListDisplay todos={todos ?? (task as any)?.tool?.todos ?? []} />}
			</div>
		</div>
	)
}

export default memo(TaskHeader)
