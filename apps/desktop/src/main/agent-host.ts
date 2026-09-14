import { createRequire } from "module"
import path from "path"
import fs from "fs"
import { EventEmitter } from "events"
import pWaitFor from "p-wait-for"
import type { ExtensionMessage, WebviewMessage } from "@roo-code/types"
import { createVSCodeAPI, setRuntimeConfigValues } from "@roo-code/vscode-shim"
import type { AgentStatusType, TerminalLogEntry, DiffFileEntry } from "../shared/types.js"

export interface AgentHostOptions {
	workspacePath: string
	extensionPath: string
	storageDir?: string
}

interface ExtensionModule {
	activate: (context: unknown) => Promise<unknown>
	deactivate?: () => Promise<void>
}

export class DesktopAgentHost extends EventEmitter {
	private vscode: ReturnType<typeof createVSCodeAPI> | null = null
	private extensionModule: ExtensionModule | null = null
	private isReady = false
	private currentWorkspace: string
	private extensionPath: string
	private storageDir?: string
	private status: AgentStatusType = "idle"
	private terminalLogs: TerminalLogEntry[] = []
	private diffFiles: Map<string, DiffFileEntry> = new Map()

	constructor(options: AgentHostOptions) {
		super()
		this.currentWorkspace = path.resolve(options.workspacePath)
		this.extensionPath = path.resolve(options.extensionPath)
		this.storageDir = options.storageDir
	}

	public getWorkspace(): string {
		return this.currentWorkspace
	}

	public getStatus(): AgentStatusType {
		return this.status
	}

	public getTerminalLogs(): TerminalLogEntry[] {
		return [...this.terminalLogs]
	}

	public getDiffFiles(): DiffFileEntry[] {
		return Array.from(this.diffFiles.values())
	}

	public async init(): Promise<void> {
		const bundlePath = path.join(this.extensionPath, "extension.js")
		if (!fs.existsSync(bundlePath)) {
			throw new Error(`Roo Code core engine bundle not found at: ${bundlePath}. Please build it first.`)
		}

		if (this.storageDir && !fs.existsSync(this.storageDir)) {
			fs.mkdirSync(this.storageDir, { recursive: true })
		}

		let appRoot = path.dirname(this.extensionPath)
		while (appRoot !== path.dirname(appRoot)) {
			if (fs.existsSync(path.join(appRoot, "node_modules", "@vscode", "ripgrep"))) {
				break
			}
			appRoot = path.dirname(appRoot)
		}

		// Initialize VSCode API mock
		this.vscode = createVSCodeAPI(this.extensionPath, this.currentWorkspace, undefined, {
			appRoot,
			storageDir: this.storageDir,
		})

		;(global as Record<string, unknown>).vscode = this.vscode
		;(global as Record<string, unknown>).__extensionHost = this

		const require = createRequire(import.meta.url)
		const Module = require("module")
		const originalResolve = Module._resolveFilename

		Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
			if (request === "vscode") return "vscode-mock"
			return originalResolve.call(this, request, parent, isMain, options)
		}

		require.cache["vscode-mock"] = {
			id: "vscode-mock",
			filename: "vscode-mock",
			loaded: true,
			exports: this.vscode,
			children: [],
			paths: [],
			path: "",
			isPreloading: false,
			parent: null,
			require,
		} as unknown as NodeModule

		try {
			this.extensionModule = require(bundlePath) as ExtensionModule
		} catch (error) {
			Module._resolveFilename = originalResolve
			throw new Error(`Failed to load engine bundle: ${error instanceof Error ? error.message : String(error)}`)
		}

		Module._resolveFilename = originalResolve

		try {
			await this.extensionModule.activate(this.vscode.context)
		} catch (error) {
			throw new Error(`Failed to activate agent: ${error instanceof Error ? error.message : String(error)}`)
		}

		this.on("extensionWebviewMessage", (msg: ExtensionMessage) => {
			this.processExtensionMessage(msg)
		})

		await pWaitFor(() => this.isReady, { interval: 100, timeout: 15_000 }).catch(() => {
			// Mark ready if timeout expires
			this.isReady = true
		})
	}

	public markWebviewReady(): void {
		this.isReady = true
		this.sendToExtension({ type: "webviewDidLaunch" })
	}

	public isInInitialSetup(): boolean {
		return !this.isReady
	}

	public registerWebviewProvider(_viewId: string, _provider: unknown): void {}
	public unregisterWebviewProvider(_viewId: string): void {}

	public sendToExtension(message: WebviewMessage): void {
		this.emit("webviewMessage", message)
	}

	public setStatus(status: AgentStatusType): void {
		this.status = status
		this.emit("statusChange", status)
	}

	private processExtensionMessage(msg: ExtensionMessage): void {
		// Detect agent status transitions
		if (msg.type === "say") {
			if (msg.say === "tool") {
				this.setStatus("executing")
				try {
					const toolData = typeof msg.text === "string" ? JSON.parse(msg.text) : msg.text
					if (toolData && toolData.tool === "execute_command") {
						this.recordTerminalLog(toolData.command || "")
					}
					if (toolData && (toolData.tool === "write_to_file" || toolData.tool === "apply_diff")) {
						this.recordFileChange(toolData.path, toolData.content || toolData.diff)
					}
				} catch {
					// text wasn't JSON
				}
			} else if (msg.say === "task") {
				this.setStatus("thinking")
			} else if (msg.say === "completion_result") {
				this.setStatus("idle")
			}
		} else if (msg.type === "ask") {
			this.setStatus("waiting_approval")
		}

		// Relay to all attached UI clients
		this.emit("messageToUI", msg)
	}

	private recordTerminalLog(command: string): void {
		const entry: TerminalLogEntry = {
			id: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
			timestamp: Date.now(),
			command,
			output: "Running command in workspace...",
			status: "running",
		}
		this.terminalLogs.push(entry)
		if (this.terminalLogs.length > 100) this.terminalLogs.shift()
		this.emit("terminalLog", entry)
	}

	private recordFileChange(filePath: string, content?: string): void {
		if (!filePath) return
		const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.currentWorkspace, filePath)
		const relPath = path.relative(this.currentWorkspace, absPath)
		const entry: DiffFileEntry = {
			filePath: relPath,
			newContent: content,
			status: fs.existsSync(absPath) ? "modified" : "added",
			additions: content ? content.split("\n").length : 0,
			deletions: 0,
		}
		this.diffFiles.set(relPath, entry)
		this.emit("diffsUpdated", this.getDiffFiles())
	}
}
