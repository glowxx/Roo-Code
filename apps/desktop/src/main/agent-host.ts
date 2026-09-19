import { createRequire } from "module"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { EventEmitter } from "events"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
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
	private provider: any = null

	constructor(options: AgentHostOptions) {
		super()
		this.currentWorkspace = path.normalize(path.resolve(options.workspacePath))
		this.extensionPath = path.normalize(path.resolve(options.extensionPath))
		this.storageDir = options.storageDir ? path.normalize(path.resolve(options.storageDir)) : undefined
	}

	public getWorkspace(): string {
		return this.currentWorkspace
	}

	public setWorkspace(newWorkspace: string): void {
		const normalized = path.normalize(path.resolve(newWorkspace))
		if (!fs.existsSync(normalized)) {
			throw new Error(`Directory does not exist: ${normalized}`)
		}
		this.currentWorkspace = normalized
		this.diffFiles.clear()
		this.terminalLogs = []
		if (this.vscode && (this.vscode as Record<string, unknown>).workspace) {
			const ws = (this.vscode as Record<string, unknown>).workspace as any
			if (typeof ws.setWorkspaceFolders === "function") {
				ws.setWorkspaceFolders(this.currentWorkspace)
			} else {
				const UriClass = (this.vscode as Record<string, unknown>).Uri as { file: (p: string) => unknown }
				ws.workspaceFolders = [
					{
						uri: UriClass.file(this.currentWorkspace),
						name: path.basename(this.currentWorkspace),
						index: 0,
					},
				]
				ws.name = path.basename(this.currentWorkspace)
				this.provider?.handleWorkspaceChanged?.(this.currentWorkspace)
			}
		} else {
			this.provider?.handleWorkspaceChanged?.(this.currentWorkspace)
		}
		this.emit("workspaceChanged", this.currentWorkspace)
	}

	public getStatus(): AgentStatusType {
		return this.status
	}

	public getTerminalLogs(): TerminalLogEntry[] {
		return [...this.terminalLogs]
	}

	public clearTerminalLogs(): void {
		this.terminalLogs = []
	}

	public getDiffFiles(): DiffFileEntry[] {
		return Array.from(this.diffFiles.values())
	}

	public async init(): Promise<void> {
		const bundlePath = path.join(this.extensionPath, "extension.js")
		if (!fs.existsSync(bundlePath)) {
			throw new Error(`Roo Code core engine bundle not found at: ${bundlePath}. Please build it first.`)
		}

		// Ensure CommonJS package.json exists in extensionPath so Node loads bundle as CJS
		const enginePkgPath = path.join(this.extensionPath, "package.json")
		if (!fs.existsSync(enginePkgPath)) {
			try {
				fs.writeFileSync(enginePkgPath, JSON.stringify({ name: "@roo-code/engine", type: "commonjs" }, null, 2))
			} catch {
				// Read-only filesystem fallback
			}
		}

		if (this.storageDir && !fs.existsSync(this.storageDir)) {
			fs.mkdirSync(this.storageDir, { recursive: true })
		}

		// Find appRoot for VSCode API (needs node_modules/@vscode/ripgrep/bin/rg)
		const binName = process.platform === "win32" ? "rg.exe" : "rg"
		const candidateAppRoots = [
			process.resourcesPath || "",
			path.join(__dirname, ".."), // dist/
			path.join(__dirname, "../.."), // apps/desktop
			this.extensionPath,
		].filter(Boolean)

		let appRoot = ""
		for (const candidate of candidateAppRoots) {
			if (
				fs.existsSync(path.join(candidate, "node_modules", "@vscode", "ripgrep", "bin", binName)) ||
				fs.existsSync(path.join(candidate, "bin", binName))
			) {
				appRoot = candidate
				break
			}
		}

		if (!appRoot) {
			let searchDir = path.dirname(this.extensionPath)
			while (searchDir !== path.dirname(searchDir)) {
				const directPath = path.join(searchDir, "node_modules", "@vscode", "ripgrep", "bin", binName)
				if (fs.existsSync(directPath)) {
					appRoot = searchDir
					break
				}
				const pnpmDir = path.join(searchDir, "node_modules", ".pnpm")
				if (fs.existsSync(pnpmDir)) {
					try {
						const entries = fs.readdirSync(pnpmDir)
						const rgEntry = entries.find((e) => e.startsWith("@vscode+ripgrep"))
						if (rgEntry) {
							const pnpmRgPath = path.join(pnpmDir, rgEntry)
							if (fs.existsSync(path.join(pnpmRgPath, "node_modules", "@vscode", "ripgrep", "bin", binName))) {
								appRoot = pnpmRgPath
								break
							}
						}
					} catch {}
				}
				searchDir = path.dirname(searchDir)
			}
		}

		if (!appRoot) {
			appRoot = path.join(__dirname, "..")
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
	}

	public markWebviewReady(): void {
		this.isReady = true
		this.sendToExtension({ type: "webviewDidLaunch" })
	}

	public isInInitialSetup(): boolean {
		return !this.isReady
	}

	public registerWebviewProvider(_viewId: string, provider: unknown): void {
		this.provider = provider
	}
	public unregisterWebviewProvider(_viewId: string): void {
		this.provider = null
	}

	public sendToExtension(message: WebviewMessage): void {
		this.emit("webviewMessage", message)
	}

	public setStatus(status: AgentStatusType): void {
		this.status = status
		this.emit("statusChange", status)
	}

	private processExtensionMessage(msg: ExtensionMessage): void {
		const raw = msg as Record<string, any>
		// Detect agent status transitions
		if (raw.type === "say") {
			if (raw.say === "tool") {
				this.setStatus("executing")
				try {
					const toolData = typeof raw.text === "string" ? JSON.parse(raw.text) : raw.text
					if (toolData && toolData.tool === "execute_command") {
						this.recordTerminalLog(toolData.command || "")
					}
					if (toolData && (toolData.tool === "write_to_file" || toolData.tool === "apply_diff")) {
						this.recordFileChange(toolData.path, toolData.content || toolData.diff)
					}
				} catch {
					// text wasn't JSON
				}
			} else if (raw.say === "command") {
				this.setStatus("executing")
				this.recordTerminalLog(typeof raw.text === "string" ? raw.text : "")
			} else if (raw.say === "command_output") {
				this.updateLatestTerminalOutput(typeof raw.text === "string" ? raw.text : "")
			} else if (raw.say === "task") {
				this.setStatus("thinking")
			} else if (raw.say === "completion_result") {
				this.setStatus("idle")
				this.finishRunningTerminalLogs()
			}
		} else if (raw.type === "ask") {
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

	private updateLatestTerminalOutput(output: string): void {
		if (this.terminalLogs.length > 0) {
			const latest = this.terminalLogs[this.terminalLogs.length - 1]
			if (latest) {
				latest.output = output || "(Command completed with no output)"
				latest.status = "completed"
				this.emit("terminalLog", latest)
			}
		}
	}

	private finishRunningTerminalLogs(): void {
		for (const log of this.terminalLogs) {
			if (log.status === "running") {
				log.status = "completed"
			}
		}
	}

	private recordFileChange(filePath: string, content?: string): void {
		if (!filePath) return
		const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.currentWorkspace, filePath)
		const relPath = path.relative(this.currentWorkspace, absPath)
		let oldContent: string | undefined = undefined
		const fileExists = fs.existsSync(absPath)
		if (fileExists) {
			try {
				oldContent = fs.readFileSync(absPath, "utf-8")
			} catch {
				// file read error
			}
		}

		const oldLines = oldContent ? oldContent.split("\n").length : 0
		const newLines = content ? content.split("\n").length : 0

		const entry: DiffFileEntry = {
			filePath: relPath,
			oldContent,
			newContent: content,
			status: fileExists ? "modified" : "added",
			additions: Math.max(1, newLines),
			deletions: oldLines > 0 && newLines > 0 ? Math.max(0, oldLines - newLines) : 0,
		}
		this.diffFiles.set(relPath, entry)
		this.emit("diffsUpdated", this.getDiffFiles())
	}
}
