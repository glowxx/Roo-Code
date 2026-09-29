import { useCallback, useState, memo, useMemo } from "react"
import { useEvent } from "react-use"
import { t } from "i18next"
import { ChevronDown, ChevronUp, OctagonX, Copy, Check, CheckCircle2, XCircle } from "lucide-react"

import { type ExtensionMessage, type CommandExecutionStatus, commandExecutionStatusSchema } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { parseCommand } from "@roo/parse-command"

import { vscode } from "@src/utils/vscode"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { extractPatternsFromCommand } from "@src/utils/command-parser"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"

import { Button, StandardTooltip } from "@src/components/ui"
import CodeBlock from "@src/components/common/CodeBlock"

import { CommandPatternSelector } from "./CommandPatternSelector"
import { TerminalOutput } from "./TerminalOutput"
import { analyzeCommandOutput, type CommandOutputAnalysis } from "./command-output-analyzer"

interface CommandPattern {
	pattern: string
	description?: string
}

interface CommandExecutionProps {
	executionId: string
	text?: string
	icon?: JSX.Element | null
	title?: JSX.Element | null
}

export const CommandExecution = ({ executionId, text, icon, title }: CommandExecutionProps) => {
	const {
		currentTaskItem,
		terminalShellIntegrationDisabled = false,
		allowedCommands = [],
		deniedCommands = [],
		setAllowedCommands,
		setDeniedCommands,
	} = useExtensionState()

	const { command, output: parsedOutput } = useMemo(() => parseCommandAndOutput(text), [text])

	const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
	const [streamingOutput, setStreamingOutput] = useState("")
	const [status, setStatus] = useState<CommandExecutionStatus | null>(null)

	const { copyWithFeedback, showCopyFeedback } = useCopyToClipboard()

	// The command's output can either come from the text associated with the
	// task message (this is the case for completed commands) or from the
	// streaming output (this is the case for running commands).
	const output = streamingOutput || parsedOutput

	const analysis = useMemo(() => {
		return analyzeCommandOutput(output, status?.status === "exited" ? status.exitCode : undefined)
	}, [output, status])

	const isStreaming = status?.status === "started" || (streamingOutput.length > 0 && status?.status !== "exited")

	// Determine effective expanded state
	const isExpanded = useMemo(() => {
		if (userExpanded !== null) {
			return userExpanded
		}
		// While actively streaming, keep expanded so user watches output live
		if (isStreaming) {
			return true
		}
		// Completed long output (>12 lines): default to collapsed compact preview
		if (analysis.isLong) {
			return false
		}
		// Standard output: follow shell integration setting
		return terminalShellIntegrationDisabled
	}, [userExpanded, isStreaming, analysis.isLong, terminalShellIntegrationDisabled])

	// Extract command patterns from the actual command that was executed
	const commandPatterns = useMemo<CommandPattern[]>(() => {
		// First get all individual commands (including subshell commands) using parseCommand
		const allCommands = parseCommand(command)

		// Then extract patterns from each command using the existing pattern extraction logic
		const allPatterns = new Set<string>()

		// Add all individual commands first
		allCommands.forEach((cmd) => {
			if (cmd.trim()) {
				allPatterns.add(cmd.trim())
			}
		})

		// Then add extracted patterns for each command
		allCommands.forEach((cmd) => {
			const patterns = extractPatternsFromCommand(cmd)
			patterns.forEach((pattern) => allPatterns.add(pattern))
		})

		return Array.from(allPatterns).map((pattern) => ({
			pattern,
		}))
	}, [command])

	// Handle pattern changes
	const handleAllowPatternChange = (pattern: string) => {
		const isAllowed = allowedCommands.includes(pattern)
		const newAllowed = isAllowed ? allowedCommands.filter((p) => p !== pattern) : [...allowedCommands, pattern]
		const newDenied = deniedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const handleDenyPatternChange = (pattern: string) => {
		const isDenied = deniedCommands.includes(pattern)
		const newDenied = isDenied ? deniedCommands.filter((p) => p !== pattern) : [...deniedCommands, pattern]
		const newAllowed = allowedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const onMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "commandExecutionStatus") {
				const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))

				if (result.success) {
					const data = result.data

					if (data.executionId !== executionId) {
						return
					}

					switch (data.status) {
						case "started":
							setStatus(data)
							break
						case "output":
							setStreamingOutput(data.output)
							break
						case "fallback":
							setUserExpanded(true)
							break
						default:
							setStatus(data)
							break
					}
				}
			}
		},
		[executionId],
	)

	useEvent("message", onMessage)

	const handleCopyOutput = useCallback(
		(e: React.MouseEvent) => {
			copyWithFeedback(output, e)
		},
		[copyWithFeedback, output],
	)

	return (
		<>
			<div className="flex flex-row items-center justify-between gap-2 mb-1">
				<div className="flex flex-row items-center gap-2">
					{icon}
					{title}
					{status?.status === "exited" && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs">
							<StandardTooltip
								content={t("chat.commandExecution.exitStatus", { exitStatus: status.exitCode })}>
								<div
									className={cn(
										"rounded-full size-2",
										status.exitCode === 0 ? "bg-green-600" : "bg-red-600",
									)}
								/>
							</StandardTooltip>
						</div>
					)}
				</div>
				<div className=" flex flex-row items-center justify-between gap-2 px-1">
					<div className="flex flex-row items-center gap-1">
						{status?.status === "started" && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								{status.pid && <div className="whitespace-nowrap">(PID: {status.pid})</div>}
								<StandardTooltip content={t("chat:commandExecution.abort")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() =>
											vscode.postMessage({
												type: "terminalOperation",
												terminalOperation: "abort",
												taskId: currentTaskItem?.id,
											})
										}>
										<OctagonX className="size-4" />
									</Button>
								</StandardTooltip>
							</div>
						)}
						{output.length > 0 && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setUserExpanded(!isExpanded)}
								aria-label={
									isExpanded
										? t("chat:commandExecution.collapseOutput", { defaultValue: "Collapse output" })
										: t("chat:commandExecution.expandOutput", { defaultValue: "Expand output" })
								}>
								<ChevronDown
									className={cn(
										"size-4 transition-transform duration-200",
										isExpanded && "rotate-180",
									)}
								/>
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="bg-card/40 border border-border/30 rounded-lg ml-6 mt-1.5 overflow-hidden transition-colors hover:border-border/50">
				<div className="p-2">
					<CodeBlock source={command} language="shell" />
					<OutputContainer
						isExpanded={isExpanded}
						output={output}
						analysis={analysis}
						onToggleExpand={() => setUserExpanded(!isExpanded)}
						onCopy={handleCopyOutput}
						showCopyFeedback={showCopyFeedback}
						isStreaming={isStreaming}
					/>
				</div>
				{command && command.trim() && (
					<CommandPatternSelector
						patterns={commandPatterns}
						allowedCommands={allowedCommands}
						deniedCommands={deniedCommands}
						onAllowPatternChange={handleAllowPatternChange}
						onDenyPatternChange={handleDenyPatternChange}
					/>
				)}
			</div>
		</>
	)
}

CommandExecution.displayName = "CommandExecution"

interface OutputContainerProps {
	isExpanded: boolean
	output: string
	analysis: CommandOutputAnalysis
	onToggleExpand: () => void
	onCopy: (e: React.MouseEvent) => void
	showCopyFeedback: boolean
	isStreaming: boolean
}

const OutputContainerInternal = ({
	isExpanded,
	output,
	analysis,
	onToggleExpand,
	onCopy,
	showCopyFeedback,
	isStreaming,
}: OutputContainerProps) => {
	if (!output || output.length === 0) {
		return null
	}

	// Long output (> 12 lines) handling
	if (analysis.isLong && !isStreaming) {
		return (
			<div className="mt-2 pt-2 border-t border-border/25 flex flex-col gap-2">
				{/* Compact Outcome / Status Bar */}
				<div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-secondary/30 text-xs font-mono">
					<div className="flex items-center gap-2 min-w-0">
						{analysis.isFailed ? (
							<XCircle className="size-3.5 text-red-500 shrink-0" />
						) : (
							<CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
						)}
						<span
							className={cn(
								"font-medium truncate",
								analysis.isFailed ? "text-red-400" : "text-emerald-400",
							)}>
							{analysis.summaryBadge}
						</span>
					</div>

					<div className="flex items-center gap-1 shrink-0">
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
							onClick={onCopy}>
							{showCopyFeedback ? (
								<>
									<Check className="size-3 text-emerald-500" />
									<span className="text-[11px] text-emerald-500">
										{t("chat:commandExecution.copied", { defaultValue: "Copied" }) || "Copied"}
									</span>
								</>
							) : (
								<>
									<Copy className="size-3" />
									<span className="text-[11px]">
										{t("chat:commandExecution.copyFullOutput", { defaultValue: "Copy" }) || "Copy"}
									</span>
								</>
							)}
						</Button>

						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
							onClick={onToggleExpand}>
							{isExpanded ? (
								<>
									<ChevronUp className="size-3" />
									<span className="text-[11px]">
										{t("chat:commandExecution.collapseOutput", { defaultValue: "Collapse" }) || "Collapse"}
									</span>
								</>
							) : (
								<>
									<ChevronDown className="size-3" />
									<span className="text-[11px]">
										{t("chat:commandExecution.showFullOutput", {
											count: analysis.totalLines,
											defaultValue: `Show full output (${analysis.totalLines} lines)`,
										}) || `Show full output (${analysis.totalLines} lines)`}
									</span>
								</>
							)}
						</Button>
					</div>
				</div>

				{/* Output display */}
				{isExpanded ? (
					<div className="max-h-[460px] overflow-y-auto overflow-x-hidden rounded bg-black/20 p-1 border border-border/20">
						<TerminalOutput content={output} />
					</div>
				) : (
					<div className="rounded bg-black/15 p-1 border border-border/15 opacity-90 hover:opacity-100 transition-opacity">
						<TerminalOutput content={analysis.previewContent} />
					</div>
				)}
			</div>
		)
	}

	// Short output or active streaming
	return (
		<div
			className={cn("overflow-hidden", {
				"max-h-0": !isExpanded,
				"max-h-[460px] overflow-y-auto mt-1 pt-1 border-t border-border/25": isExpanded,
			})}>
			{output.length > 0 && <TerminalOutput content={output} />}
		</div>
	)
}

const OutputContainer = memo(OutputContainerInternal)

const parseCommandAndOutput = (text: string | undefined) => {
	if (!text) {
		return { command: "", output: "" }
	}

	const index = text.indexOf(COMMAND_OUTPUT_STRING)

	if (index === -1) {
		return { command: text, output: "" }
	}

	return {
		command: text.slice(0, index),
		output: text.slice(index + COMMAND_OUTPUT_STRING.length),
	}
}
