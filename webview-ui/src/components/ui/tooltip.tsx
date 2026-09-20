"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
	className,
	sideOffset = 0,
	children,
	style,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				className={cn(
					"text-vscode-editorHoverWidget-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-[1000] w-fit origin-(--radix-tooltip-content-transform-origin) rounded-sm px-2 py-1 text-xs text-balance",
					"max-w-[300px] break-words",
					className,
				)}
				style={{
					background: "var(--vscode-editorHoverWidget-background, #252526)",
					border: "1px solid var(--vscode-editorHoverWidget-border, #454545)",
					boxShadow: "0 4px 12px rgba(0, 0, 0, 0.45)",
					zIndex: 1000,
					...style,
				}}
				{...props}>
				{children}
				<TooltipPrimitive.Arrow
					className="border-b border-r z-[1000] size-1.5 translate-y-[calc(-50%_+_1px)] rotate-45"
					style={{
						background: "var(--vscode-editorHoverWidget-background, #252526)",
						borderColor: "var(--vscode-editorHoverWidget-border, #454545)",
						fill: "var(--vscode-editorHoverWidget-background, #252526)",
					}}
				/>
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	)
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
