import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: string
}

export const SectionHeader = ({ description, children, className, ...props }: SectionHeaderProps) => {
	return (
		<div
			className={cn(
				"sticky top-0 z-20 bg-[#090a0f]/85 backdrop-blur-md border-b border-white/[0.06] -mx-5 -mt-5 mb-4 px-5 py-3 rounded-t-xl transition-colors",
				className,
			)}
			{...props}>
			<h3 className="text-sm font-semibold text-vscode-foreground m-0 tracking-tight">{children}</h3>
			{description && <p className="text-xs text-vscode-descriptionForeground mt-1 mb-0 leading-relaxed">{description}</p>}
		</div>
	)
}
