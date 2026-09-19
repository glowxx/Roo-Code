import { cn } from "@/lib/utils"

export const ToolUseBlock = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"overflow-hidden rounded-lg border border-border/30 bg-card/40 hover:border-border/50 transition-colors",
			className,
		)}
		{...props}
	/>
)

export const ToolUseBlockHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex items-center select-none text-xs text-vscode-descriptionForeground py-1.5 px-2.5 gap-2 cursor-pointer hover:bg-vscode-toolbar-hoverBackground/40 transition-colors",
			className,
		)}
		{...props}
	/>
)
