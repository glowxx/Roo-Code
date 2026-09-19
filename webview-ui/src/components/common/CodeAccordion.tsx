import { memo, useMemo, useState } from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { FileCode2, ChevronDown, ChevronUp, Server } from "lucide-react"
import { type ToolProgressStatus } from "@roo-code/types"
import { getLanguageFromPath } from "@src/utils/getLanguageFromPath"
import { formatPathTooltip } from "@src/utils/formatPathTooltip"
import { cn } from "@/lib/utils"

import { ToolUseBlock, ToolUseBlockHeader } from "./ToolUseBlock"
import CodeBlock from "./CodeBlock"
import { PathTooltip } from "../ui/PathTooltip"
import DiffView from "./DiffView"

interface CodeAccordionProps {
	path?: string
	code?: string
	language: string
	progressStatus?: ToolProgressStatus
	isLoading?: boolean
	isExpanded: boolean
	isFeedback?: boolean
	onToggleExpand: () => void
	header?: string
	onJumpToFile?: () => void
	// New props for diff stats
	diffStats?: { added: number; removed: number }
}

const CodeAccordion = ({
	path,
	code = "",
	language,
	progressStatus,
	isLoading,
	isExpanded,
	isFeedback,
	onToggleExpand,
	header,
	onJumpToFile,
	diffStats,
}: CodeAccordionProps) => {
	const inferredLanguage = useMemo(() => language ?? (path ? getLanguageFromPath(path) : "txt"), [path, language])
	const source = useMemo(() => code.trim(), [code])
	const hasHeader = Boolean(path || isFeedback || header)

	// Calculate line count for progressive disclosure
	const lineCount = useMemo(() => (source ? source.split("\n").length : 0), [source])
	const [isTruncated, setIsTruncated] = useState(lineCount > 15)

	// Use provided diff stats only (render-only)
	const derivedStats = useMemo(() => {
		if (diffStats && (diffStats.added > 0 || diffStats.removed > 0)) return diffStats
		return null
	}, [diffStats])

	const hasValidStats = Boolean(derivedStats && (derivedStats.added > 0 || derivedStats.removed > 0))

	return (
		<ToolUseBlock>
			{hasHeader && (
				<ToolUseBlockHeader onClick={onToggleExpand} className="group">
					{isLoading && <VSCodeProgressRing className="size-3 mr-2" />}
					{header ? (
						<div className="flex items-center gap-1.5 min-w-0">
							<Server className="size-3.5 text-vscode-descriptionForeground shrink-0" />
							<PathTooltip content={header}>
								<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 text-vscode-foreground/90 font-medium text-xs">
									{header}
								</span>
							</PathTooltip>
						</div>
					) : isFeedback ? (
						<div className="flex items-center gap-1.5 min-w-0">
							<span className={`codicon codicon-${isFeedback ? "feedback" : "codicon-output"} mr-1 text-vscode-descriptionForeground`} />
							<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 rtl text-vscode-foreground/90 font-medium text-xs">
								{isFeedback ? "User Edits" : "Console Logs"}
							</span>
						</div>
					) : (
						<div className="flex items-center gap-1.5 min-w-0 flex-1">
							<FileCode2 className="size-3.5 text-vscode-descriptionForeground shrink-0" />
							{path?.startsWith(".") && <span>.</span>}
							<PathTooltip content={formatPathTooltip(path)}>
								<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl font-mono text-[11.5px] text-vscode-foreground/90">
									{formatPathTooltip(path)}
								</span>
							</PathTooltip>
						</div>
					)}
					<div className="flex-grow" />

					{/* Prefer diff stats over generic progress indicator if available */}
					{hasValidStats ? (
						<div className="flex items-center gap-1.5 mr-1 font-mono text-[11px] shrink-0">
							<span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
								+{derivedStats!.added}
							</span>
							<span className="px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
								-{derivedStats!.removed}
							</span>
						</div>
					) : (
						progressStatus &&
						progressStatus.text && (
							<div className="flex items-center shrink-0 mr-1 ml-auto text-vscode-descriptionForeground text-xs">
								{progressStatus.icon && (
									<span className={`codicon codicon-${progressStatus.icon} mr-1`} />
								)}
								<span>{progressStatus.text}</span>
							</div>
						)
					)}

					{onJumpToFile && path && (
						<span
							className="codicon codicon-link-external mr-1 hover:text-vscode-foreground transition-colors cursor-pointer shrink-0"
							style={{ fontSize: 13.5 }}
							onClick={(e) => {
								e.stopPropagation()
								onJumpToFile()
							}}
							aria-label={`Open file: ${path}`}
						/>
					)}

					{!onJumpToFile && (
						<span
							className={`opacity-0 group-hover:opacity-100 codicon codicon-chevron-${isExpanded ? "up" : "down"} text-vscode-descriptionForeground transition-opacity shrink-0`}
						/>
					)}
				</ToolUseBlockHeader>
			)}

			{(!hasHeader || isExpanded) && (
				<div className="border-t border-border/20 bg-vscode-editor-background">
					<div
						className={cn(
							"overflow-x-auto font-mono text-xs leading-relaxed max-w-full",
							isTruncated && lineCount > 15
								? "max-h-[280px] overflow-hidden relative"
								: "max-h-[500px] overflow-y-auto",
						)}>
						{inferredLanguage === "diff" ? (
							<DiffView source={source} filePath={path} />
						) : (
							<CodeBlock source={source} language={inferredLanguage} />
						)}
						{isTruncated && lineCount > 15 && (
							<div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-vscode-editor-background to-transparent pointer-events-none" />
						)}
					</div>

					{lineCount > 15 && (
						<button
							onClick={(e) => {
								e.stopPropagation()
								setIsTruncated(!isTruncated)
							}}
							className="w-full py-1 text-[11px] font-medium text-vscode-descriptionForeground hover:text-vscode-foreground bg-vscode-editor-background hover:bg-vscode-toolbar-hoverBackground/40 border-t border-border/20 flex items-center justify-center gap-1 transition-colors cursor-pointer select-none">
							<span>{isTruncated ? `Show more (${lineCount - 15} more lines)` : "Show less"}</span>
							{isTruncated ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
						</button>
					)}
				</div>
			)}
		</ToolUseBlock>
	)
}

export default memo(CodeAccordion)
