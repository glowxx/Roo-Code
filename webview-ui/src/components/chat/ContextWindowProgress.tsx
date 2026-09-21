import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { formatLargeNumber } from "@/utils/format"
import { calculateTokenDistribution } from "@/utils/model-utils"
import { StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"

interface ContextWindowProgressProps {
	contextWindow: number
	contextTokens: number
	maxTokens?: number
	className?: string
}

export const ContextWindowProgress = ({
	contextWindow,
	contextTokens,
	maxTokens,
	className,
}: ContextWindowProgressProps) => {
	const { t } = useTranslation()

	// Use the shared utility function to calculate all token distribution values
	const tokenDistribution = useMemo(
		() => calculateTokenDistribution(contextWindow, contextTokens, maxTokens),
		[contextWindow, contextTokens, maxTokens],
	)

	// Destructure the values we need
	const { currentPercent, availableSize, reservedForOutput } = tokenDistribution

	// For display purposes
	const safeContextWindow = Math.max(0, contextWindow)
	const safeContextTokens = Math.max(0, contextTokens)
	const percent = safeContextWindow > 0 ? Math.min(100, Math.round((safeContextTokens / safeContextWindow) * 100)) : 0

	let colorClass = "text-[var(--vscode-charts-green,#10b981)]"
	let dotClass = "bg-[var(--vscode-charts-green,#10b981)]"
	let barClass = "bg-[var(--vscode-charts-green,#10b981)]"
	let borderClass = "border-[color-mix(in_srgb,var(--vscode-charts-green,#10b981)_30%,transparent)]"
	let badgeBgClass = "bg-[color-mix(in_srgb,var(--vscode-charts-green,#10b981)_10%,transparent)]"

	if (percent > 85) {
		colorClass = "text-[var(--vscode-charts-red,#ef4444)]"
		dotClass = "bg-[var(--vscode-charts-red,#ef4444)]"
		barClass = "bg-[var(--vscode-charts-red,#ef4444)]"
		borderClass = "border-[color-mix(in_srgb,var(--vscode-charts-red,#ef4444)_30%,transparent)]"
		badgeBgClass = "bg-[color-mix(in_srgb,var(--vscode-charts-red,#ef4444)_10%,transparent)]"
	} else if (percent >= 60) {
		colorClass = "text-[var(--vscode-charts-yellow,#f59e0b)]"
		dotClass = "bg-[var(--vscode-charts-yellow,#f59e0b)]"
		barClass = "bg-[var(--vscode-charts-yellow,#f59e0b)]"
		borderClass = "border-[color-mix(in_srgb,var(--vscode-charts-yellow,#f59e0b)_30%,transparent)]"
		badgeBgClass = "bg-[color-mix(in_srgb,var(--vscode-charts-yellow,#f59e0b)_10%,transparent)]"
	}

	// Full breakdown inside StandardTooltip on hover
	const tooltipContent = (
		<div className="space-y-1 text-xs">
			<div>
				{t("chat:tokenProgress.tokensUsed", {
					used: formatLargeNumber(safeContextTokens),
					total: formatLargeNumber(safeContextWindow),
				})}{" "}
				({percent}%)
			</div>
			{reservedForOutput > 0 && (
				<div>
					{t("chat:tokenProgress.reservedForResponse", {
						amount: formatLargeNumber(reservedForOutput),
					})}
				</div>
			)}
			{availableSize > 0 && (
				<div>
					{t("chat:tokenProgress.availableSpace", {
						amount: formatLargeNumber(availableSize),
					})}
				</div>
			)}
		</div>
	)

	return (
		<StandardTooltip content={tooltipContent} side="top" sideOffset={8}>
			<div
				className={cn(
					"inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer select-none",
					"border",
					borderClass,
					badgeBgClass,
					"hover:bg-vscode-toolbar-hoverBackground/60",
					className,
				)}>
				<span className={cn("size-1.5 rounded-full shrink-0", dotClass)} />
				<span data-testid="context-tokens-count" className="font-mono text-vscode-foreground">
					{formatLargeNumber(safeContextTokens)}
				</span>
				<span className="text-vscode-descriptionForeground opacity-70">/</span>
				<span data-testid="context-window-size" className="font-mono text-vscode-foreground">
					{formatLargeNumber(safeContextWindow)}
				</span>
				<span className={cn("font-semibold text-[10px]", colorClass)}>({percent}%)</span>
				<div className="flex-1 relative min-w-[20px] max-w-[28px] h-1 rounded-full overflow-hidden bg-[color-mix(in_srgb,var(--vscode-foreground)_15%,transparent)] shrink-0">
					<div
						className={cn("h-full transition-all duration-300 rounded-full", barClass)}
						style={{ width: `${Math.min(100, Math.max(0, currentPercent))}%` }}
						data-testid="context-tokens-used"
					/>
				</div>
			</div>
		</StandardTooltip>
	)
}
