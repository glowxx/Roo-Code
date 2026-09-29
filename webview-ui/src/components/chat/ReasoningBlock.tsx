import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import MarkdownBlock from "../common/MarkdownBlock"
import { Lightbulb, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface ReasoningBlockProps {
	content: string
	ts: number
	isStreaming: boolean
	isLast: boolean
	metadata?: any
}

export const ReasoningBlock = ({ content, isStreaming, isLast }: ReasoningBlockProps) => {
	const { t } = useTranslation()
	const { reasoningBlockCollapsed } = useExtensionState()

	const [isCollapsed, setIsCollapsed] = useState(reasoningBlockCollapsed)

	const startTimeRef = useRef<number>(Date.now())
	const [elapsed, setElapsed] = useState<number>(0)
	const contentRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setIsCollapsed(reasoningBlockCollapsed)
	}, [reasoningBlockCollapsed])

	useEffect(() => {
		if (isLast && isStreaming) {
			const tick = () => setElapsed(Date.now() - startTimeRef.current)
			tick()
			const id = setInterval(tick, 1000)
			return () => clearInterval(id)
		}
	}, [isLast, isStreaming])

	const seconds = Math.floor(elapsed / 1000)
	const secondsLabel = t("chat:reasoning.seconds", { count: seconds })

	const handleToggle = () => {
		setIsCollapsed(!isCollapsed)
	}

	return (
		<div className="group my-1">
			<div
				className={cn(
					"flex items-center justify-between py-1 px-2 rounded-lg border transition-all cursor-pointer select-none text-xs",
					isStreaming && isLast
						? "bg-primary/[0.06] border-primary/30 text-vscode-foreground font-medium shadow-xs"
						: "border-transparent text-vscode-descriptionForeground opacity-70 hover:opacity-100 hover:bg-vscode-input-background/40",
				)}
				onClick={handleToggle}>
				<div className="flex items-center gap-2">
					{isStreaming && isLast ? (
						<span className="relative flex h-2 w-2">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
							<span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
						</span>
					) : (
						<Lightbulb className="w-3.5 h-3.5 shrink-0" />
					)}
					<span className={cn(isStreaming && isLast ? "font-semibold text-primary" : "font-medium")}>
						{t("chat:reasoning.thinking")}
					</span>
					{elapsed > 0 && (
						<span className="text-[11px] opacity-80 font-mono">
							{secondsLabel}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<ChevronUp
						className={cn(
							"w-3.5 h-3.5 transition-transform duration-200 opacity-0 group-hover:opacity-100",
							isCollapsed && "-rotate-180",
						)}
					/>
				</div>
			</div>
			{(content?.trim()?.length ?? 0) > 0 && !isCollapsed && (
				<div
					ref={contentRef}
					className="border-l border-vscode-descriptionForeground/20 ml-3 pl-3.5 py-1 text-vscode-descriptionForeground break-words prose-measure text-xs">
					<MarkdownBlock markdown={content} />
				</div>
			)}
		</div>
	)
}
