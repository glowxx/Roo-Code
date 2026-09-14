#!/usr/bin/env node
import { Command } from "commander"
import { startDesktopApp } from "./main/index.js"

const program = new Command()

program
	.name("roo-desktop")
	.description("Roo Code Desktop - Autonomous AI Developer Standalone Application")
	.version("1.0.0")
	.option("-w, --workspace <path>", "Workspace directory path", process.cwd())
	.option("-p, --port <number>", "HTTP & WebSocket server port", (v) => parseInt(v, 10), 4500)
	.option("--electron", "Launch as native Electron desktop window", false)
	.option("--web", "Launch as web desktop (accessible via browser)", false)
	.option("--no-open", "Do not automatically open browser in web mode")
	.option("--dev", "Enable development mode")
	.action(async (opts) => {
		const isElectron = Boolean(opts.electron || process.env.ELECTRON_RUN_AS_NODE === undefined && process.versions.electron)
		await startDesktopApp({
			workspacePath: opts.workspace,
			port: opts.port,
			isElectron,
			openBrowser: opts.open && !isElectron,
			dev: opts.dev,
		})
	})

program.parse(process.argv)
