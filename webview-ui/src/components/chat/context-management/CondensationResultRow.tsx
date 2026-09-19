import { useState } from "react"
import type { ContextCondense } from "@roo-code/types"
import { Markdown } from "../Markdown"

interface CondensationResultRowProps {
	data: Partial<ContextCondense>
}

/**
 * Displays the result of a successful context condensation/compaction operation.
 * Shows token reduction, percentage saved, cost, and an expandable summary card.
 */
export function CondensationResultRow({ data }: CondensationResultRowProps) {
	const [isExpanded, setIsExpanded] = useState(false)

	const { cost, prevContextTokens, newContextTokens, summary } = data

	// Handle null/undefined token values to prevent crashes
	const prevTokens = prevContextTokens ?? 0
	const newTokens = newContextTokens ?? 0
	const displayCost = cost ?? 0
	const percentage =
		prevTokens > 0 ? Math.max(0, Math.round(((prevTokens - newTokens) / prevTokens) * 100)) : 0

	return (
		<div className="mb-2 text-xs">
			<div className="bg-vscode-editor-background border border-vscode-editorGroup-border/60 rounded-md p-2 shadow-sm transition-all duration-150">
				<div
					className="flex items-center justify-between cursor-pointer select-none gap-2"
					onClick={() => setIsExpanded(!isExpanded)}>
					<div className="flex items-center gap-1.5 flex-wrap">
						<span>⚡</span>
						<span className="font-semibold text-vscode-foreground">Context compacted:</span>
						<span className="text-vscode-descriptionForeground">
							{`${prevTokens.toLocaleString()} → ${newTokens.toLocaleString()} tokens (-${percentage}%)`}
						</span>
						<button
							type="button"
							className="inline-flex items-center text-vscode-textLink-foreground hover:underline font-medium ml-1 bg-transparent border-none p-0 cursor-pointer text-xs"
							onClick={(e) => {
								e.stopPropagation()
								setIsExpanded(!isExpanded)
							}}>
							{isExpanded ? "Hide Summary ▴" : "View Summary ▾"}
						</button>
					</div>
					{displayCost > 0 && (
						<span className="text-vscode-descriptionForeground text-xs shrink-0 font-mono">
							${displayCost.toFixed(2)}
						</span>
					)}
				</div>

				{isExpanded && summary && (
					<div className="mt-2 pt-2 border-t border-vscode-editorGroup-border/40 text-vscode-foreground text-xs leading-relaxed overflow-auto max-h-96">
						<Markdown markdown={summary} />
					</div>
				)}
			</div>
		</div>
	)
}
