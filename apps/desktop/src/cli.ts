#!/usr/bin/env node
import { Command } from "commander"
import { spawn } from "child_process"
import path from "path"
import { fileURLToPath } from "url"
import { startDesktopApp } from "./main/index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
		const shouldLaunchElectron = Boolean(opts.electron && !opts.web)
		if (shouldLaunchElectron && !process.versions.electron) {
			try {
				const { default: electronBinary } = await import("electron")
				const appDir = path.join(__dirname, "..")
				const child = spawn(
					String(electronBinary),
					[appDir, ...process.argv.slice(2)],
					{ stdio: "inherit", env: process.env }
				)
				child.on("close", (code) => {
					process.exit(code ?? 0)
				})
				return
			} catch (err) {
				console.warn("Could not spawn Electron binary directly, falling back to in-process launcher:", err)
			}
		}

		await startDesktopApp({
			workspacePath: opts.workspace,
			port: opts.port,
			isElectron: Boolean(opts.electron || process.versions.electron),
			openBrowser: opts.open && !opts.electron && !process.versions.electron,
			dev: opts.dev,
		})
	})

program.parse(process.argv)
