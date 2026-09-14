import { Command } from "commander"

import { DEFAULT_FLAGS } from "@/types/constants.js"
import { VERSION } from "@/lib/utils/version.js"
import { run, listCommands, listModes, listModels, listSessions, upgrade } from "@/commands/index.js"

const program = new Command()

program
	.name("roo")
	.description("Roo Code CLI - starts an interactive session by default, use -p/--print for non-interactive output")
	.version(VERSION)
	.enablePositionalOptions()
	.passThroughOptions()

program
	.argument("[prompt]", "Your prompt")
	.option("--prompt-file <path>", "Read prompt from a file instead of command line argument")
	.option("--create-with-session-id <session-id>", "Create a new task with a specific session ID (must be a UUID)")
	.option("--session-id <session-id>", "Resume a specific task by session ID")
	.option("-c, --continue", "Resume the most recent task in the current workspace", false)
	.option("-w, --workspace <path>", "Workspace directory path (defaults to current working directory)")
	.option("-p, --print", "Print response and exit (non-interactive mode)", false)
	.option(
		"--stdin-prompt-stream",
		"Read NDJSON commands from stdin (requires --print and --output-format stream-json)",
		false,
	)
	.option(
		"--signal-only-exit",
		"Do not exit from normal completion/errors; only terminate on SIGINT/SIGTERM (intended for stdin stream harnesses)",
		false,
	)
	.option("-e, --extension <path>", "Path to the extension bundle directory")
	.option("-d, --debug", "Enable debug output (includes detailed debug information)", false)
	.option("-a, --require-approval", "Require manual approval for actions", false)
	.option("-k, --api-key <key>", "API key for the LLM provider")
	.option("--provider <provider>", "API provider (anthropic, openai, openrouter, etc.)")
	.option("-m, --model <model>", "Model to use", DEFAULT_FLAGS.model)
	.option("--mode <mode>", "Mode to start in (code, architect, ask, debug, etc.)", DEFAULT_FLAGS.mode)
	.option("--terminal-shell <path>", "Absolute path to shell executable for inline terminal commands")
	.option(
		"-r, --reasoning-effort <effort>",
		"Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh)",
		DEFAULT_FLAGS.reasoningEffort,
	)
	.option(
		"--consecutive-mistake-limit <limit>",
		"Consecutive error/repetition limit before guidance prompt (0 disables the limit)",
		(value) => Number.parseInt(value, 10),
	)
	.option("--exit-on-error", "Exit on API request errors instead of retrying", false)
	.option("--ephemeral", "Run without persisting state (uses temporary storage)", false)
	.option("--oneshot", "Exit upon task completion", false)
	.option(
		"--output-format <format>",
		'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming)',
		"text",
	)
	.action(run)

const listCommand = program
	.command("list")
	.description("List commands, modes, models, or sessions")
	.enablePositionalOptions()
	.passThroughOptions()

const applyListOptions = (command: Command) =>
	command
		.option("-w, --workspace <path>", "Workspace directory path (defaults to current working directory)")
		.option("-e, --extension <path>", "Path to the extension bundle directory")
		.option("-k, --api-key <key>", "API key for the LLM provider")
		.option("--format <format>", 'Output format: "json" (default) or "text"', "json")
		.option("-d, --debug", "Enable debug output", false)

const runListAction = async (action: () => Promise<void>) => {
	try {
		await action()
		process.exit(0)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`[CLI] Error: ${message}`)
		process.exit(1)
	}
}

const runUpgradeAction = async (action: () => Promise<void>) => {
	try {
		await action()
		process.exit(0)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`[CLI] Error: ${message}`)
		process.exit(1)
	}
}

applyListOptions(listCommand.command("commands").description("List available slash commands")).action(
	async (options: Parameters<typeof listCommands>[0]) => {
		await runListAction(() => listCommands(options))
	},
)

applyListOptions(listCommand.command("modes").description("List available modes")).action(
	async (options: Parameters<typeof listModes>[0]) => {
		await runListAction(() => listModes(options))
	},
)

applyListOptions(listCommand.command("models").description("List available models")).action(
	async (options: Parameters<typeof listModels>[0]) => {
		await runListAction(() => listModels(options))
	},
)

applyListOptions(listCommand.command("sessions").description("List task sessions")).action(
	async (options: Parameters<typeof listSessions>[0]) => {
		await runListAction(() => listSessions(options))
	},
)

program
	.command("upgrade")
	.description("Upgrade Roo Code CLI to the latest version")
	.action(async () => {
		await runUpgradeAction(() => upgrade())
	})

program
	.command("desktop")
	.alias("gui")
	.description("Launch Roo Code Desktop GUI application")
	.option("-w, --workspace <path>", "Workspace directory path", process.cwd())
	.option("-p, --port <number>", "Desktop server port", "4500")
	.option("--web", "Launch in web browser mode", false)
	.option("--electron", "Launch as native Electron window", false)
	.option("--no-open", "Do not automatically open browser", false)
	.action(async (opts) => {
		const { spawn } = await import("child_process")
		const path = await import("path")
		const fs = await import("fs")
		const { fileURLToPath } = await import("url")
		const __dirname = path.dirname(fileURLToPath(import.meta.url))
		let rootDir = __dirname
		while (rootDir !== path.dirname(rootDir)) {
			if (fs.existsSync(path.join(rootDir, "apps", "desktop"))) break
			rootDir = path.dirname(rootDir)
		}
		const desktopCli = path.join(rootDir, "apps", "desktop", "dist", "cli.js")
		const args = [desktopCli, "-w", opts.workspace, "-p", opts.port]
		if (opts.web) args.push("--web")
		if (opts.electron) args.push("--electron")
		if (opts.open === false) args.push("--no-open")
		const child = spawn(process.execPath, args, { stdio: "inherit" })
		child.on("exit", (code) => process.exit(code || 0))
	})

program.parse()
