import { createRequire } from "module"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { EventEmitter } from "events"
import { execSync } from "child_process"

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
	private terminalLogsByWorkspace: Map<string, TerminalLogEntry[]> = new Map()
	private archivedTerminalLogs: Array<{ workspace: string; timestamp: number; logs: TerminalLogEntry[] }> = []
	private diffFiles: Map<string, DiffFileEntry> = new Map()
	private diffFilesByWorkspace: Map<string, Map<string, DiffFileEntry>> = new Map()
	private provider: any = null
	private currentWorkspaceEpoch = 0
	private pendingWorkspaceChangeAbortController: AbortController | null = null

	constructor(options: AgentHostOptions) {
		super()
		this.currentWorkspace = options.workspacePath && options.workspacePath.trim() ? path.normalize(path.resolve(options.workspacePath)) : ""
		this.extensionPath = path.normalize(path.resolve(options.extensionPath))
		this.storageDir = options.storageDir ? path.normalize(path.resolve(options.storageDir)) : undefined
	}

	public getWorkspace(): string {
		return this.currentWorkspace
	}

	public async setWorkspace(newWorkspace?: string): Promise<void> {
		this.currentWorkspaceEpoch++
		const epoch = this.currentWorkspaceEpoch

		if (this.pendingWorkspaceChangeAbortController) {
			this.pendingWorkspaceChangeAbortController.abort()
		}
		this.pendingWorkspaceChangeAbortController = new AbortController()

		// Save current workspace state before switching
		if (this.currentWorkspace) {
			this.terminalLogsByWorkspace.set(this.currentWorkspace, [...this.terminalLogs])
			this.diffFilesByWorkspace.set(this.currentWorkspace, new Map(this.diffFiles))
		}

		if (!newWorkspace || typeof newWorkspace !== "string" || !newWorkspace.trim()) {
			this.currentWorkspace = ""
			this.terminalLogs = []
			this.diffFiles = new Map()
			this.emit("terminalLogsCleared")
			this.emit("diffsUpdated", [])
			if (this.vscode && (this.vscode as Record<string, unknown>).workspace) {
				const ws = (this.vscode as Record<string, unknown>).workspace as any
				if (typeof ws.setWorkspaceFolders === "function") {
					ws.setWorkspaceFolders([])
				} else {
					ws.workspaceFolders = undefined
					ws.name = undefined
				}
			}
			await this.provider?.handleWorkspaceChanged?.("", this.currentWorkspaceEpoch)
			if (this.currentWorkspaceEpoch === epoch) {
				this.emit("workspaceChanged", "")
			}
			return
		}

		const normalized = path.normalize(path.resolve(newWorkspace))
		if (!fs.existsSync(normalized)) {
			console.warn(`Directory does not exist: ${normalized}`)
			return
		}

		this.currentWorkspace = normalized
		this.terminalLogs = this.terminalLogsByWorkspace.get(this.currentWorkspace) || []
		this.diffFiles = this.diffFilesByWorkspace.get(this.currentWorkspace) || new Map()
		this.refreshDiffsFromGit()
		this.emit("terminalLogsUpdated", this.terminalLogs)
		this.emit("diffsUpdated", Array.from(this.diffFiles.values()))
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
			}
		}
		await this.provider?.handleWorkspaceChanged?.(this.currentWorkspace, this.currentWorkspaceEpoch)
		if (this.currentWorkspaceEpoch === epoch) {
			this.emit("workspaceChanged", this.currentWorkspace)
		}
	}

	public getStatus(): AgentStatusType {
		return this.status
	}

	public getTerminalLogs(): TerminalLogEntry[] {
		return [...this.terminalLogs]
	}

	public getArchivedTerminalLogs(): Array<{ workspace: string; timestamp: number; logs: TerminalLogEntry[] }> {
		return [...this.archivedTerminalLogs]
	}

	public clearTerminalLogs(): void {
		if (this.terminalLogs.length > 0) {
			this.archivedTerminalLogs.push({
				workspace: this.currentWorkspace,
				timestamp: Date.now(),
				logs: [...this.terminalLogs],
			})
			if (this.archivedTerminalLogs.length > 20) {
				this.archivedTerminalLogs.shift()
			}
		}
		this.terminalLogs = []
		this.emit("terminalLogsCleared")
	}

	public getDiffFiles(): DiffFileEntry[] {
		return Array.from(this.diffFiles.values())
	}

	public refreshDiffsFromGit(): void {
		this.diffFiles.clear()
		if (!this.currentWorkspace || !fs.existsSync(this.currentWorkspace)) {
			this.emit("diffsUpdated", this.getDiffFiles())
			return
		}

		try {
			const statusOutput = execSync("git status --porcelain -uall", {
				cwd: this.currentWorkspace,
				encoding: "utf-8",
				timeout: 5000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim()

			if (statusOutput) {
				const lines = statusOutput.split("\n")
				for (const line of lines) {
					if (!line || line.length < 4) continue
					const statusCode = line.substring(0, 2).trim()
					let relPath = line.substring(3).trim()
					if (relPath.startsWith('"') && relPath.endsWith('"')) {
						relPath = relPath.slice(1, -1)
					}
					if (relPath.includes(" -> ")) {
						relPath = relPath.split(" -> ")[1]!.trim()
					}
					const absPath = path.join(this.currentWorkspace, relPath)

					let oldContent: string | undefined = undefined
					let newContent: string | undefined = undefined
					let fileStatus: "modified" | "added" | "deleted" = "modified"

					if (statusCode === "??" || statusCode === "A") {
						fileStatus = "added"
						if (fs.existsSync(absPath)) {
							try {
								const stat = fs.statSync(absPath)
								if (stat.size < 1024 * 1024) {
									newContent = fs.readFileSync(absPath, "utf-8")
								}
							} catch {}
						}
					} else if (statusCode === "D") {
						fileStatus = "deleted"
						try {
							oldContent = execSync(`git show HEAD:"${relPath.replace(/\\/g, "/")}"`, {
								cwd: this.currentWorkspace,
								encoding: "utf-8",
								timeout: 3000,
								stdio: ["ignore", "pipe", "ignore"],
							})
						} catch {}
					} else {
						fileStatus = "modified"
						if (fs.existsSync(absPath)) {
							try {
								const stat = fs.statSync(absPath)
								if (stat.size < 1024 * 1024) {
									newContent = fs.readFileSync(absPath, "utf-8")
								}
							} catch {}
						}
						try {
							oldContent = execSync(`git show HEAD:"${relPath.replace(/\\/g, "/")}"`, {
								cwd: this.currentWorkspace,
								encoding: "utf-8",
								timeout: 3000,
								stdio: ["ignore", "pipe", "ignore"],
							})
						} catch {}
					}

					const oldLines = oldContent ? oldContent.split("\n").length : 0
					const newLines = newContent ? newContent.split("\n").length : 0

					const entry: DiffFileEntry = {
						filePath: relPath.replace(/\\/g, "/"),
						oldContent,
						newContent,
						status: fileStatus,
						additions: fileStatus === "added" ? Math.max(1, newLines) : Math.max(1, newLines >= oldLines ? newLines - oldLines : 1),
						deletions: fileStatus === "deleted" ? Math.max(1, oldLines) : (oldLines > newLines ? oldLines - newLines : 0),
					}
					this.diffFiles.set(entry.filePath, entry)
				}
			}
		} catch {
			// Not a git repository or git command failed
		}

		this.emit("diffsUpdated", this.getDiffFiles())
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
			process.resourcesPath ? path.join(process.resourcesPath, "app.asar.unpacked", "dist") : "",
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
		this.vscode = createVSCodeAPI(this.extensionPath, this.currentWorkspace || "", undefined, {
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
	public getProvider(): any {
		return this.provider
	}

	public getChatsByWorkspace(): Record<string, Array<{ id: string; title: string; ts: number }>> {
		let items: any[] = []

		// 1. Try in-memory provider.taskHistoryStore
		if (this.provider?.taskHistoryStore && typeof this.provider.taskHistoryStore.getAll === "function") {
			try {
				const storeItems = this.provider.taskHistoryStore.getAll()
				if (Array.isArray(storeItems)) {
					items = [...storeItems]
				}
			} catch (e) {
				console.warn("[DesktopAgentHost] Error getting task history from store:", e)
			}
		}

		// 2. Fallback to index on disk if empty
		if (items.length === 0 && this.storageDir) {
			try {
				const indexPath = path.join(this.storageDir, "global-storage", "tasks", "_index.json")
				if (fs.existsSync(indexPath)) {
					const content = fs.readFileSync(indexPath, "utf-8")
					const parsed = JSON.parse(content)
					if (Array.isArray(parsed?.entries)) {
						items = parsed.entries
					}
				}
			} catch {}
		}

		// 3. Fallback to reading task folders on disk
		if (items.length === 0 && this.storageDir) {
			try {
				const tasksDir = path.join(this.storageDir, "global-storage", "tasks")
				if (fs.existsSync(tasksDir)) {
					const entries = fs.readdirSync(tasksDir, { withFileTypes: true })
					for (const entry of entries) {
						if (entry.isDirectory() && entry.name !== "checkpoints") {
							const itemPath = path.join(tasksDir, entry.name, "history_item.json")
							if (fs.existsSync(itemPath)) {
								try {
									const hItem = JSON.parse(fs.readFileSync(itemPath, "utf-8"))
									if (hItem && hItem.id) items.push(hItem)
								} catch {}
							}
						}
					}
				}
			} catch {}
		}

		const result: Record<string, Array<{ id: string; title: string; ts: number }>> = {}

		for (const item of items) {
			if (!item || !item.id) continue
			let ws = ""
			if (item.workspace && typeof item.workspace === "string" && item.workspace.trim()) {
				ws = path.normalize(path.resolve(item.workspace.trim()))
			} else if (this.currentWorkspace) {
				ws = path.normalize(path.resolve(this.currentWorkspace))
			} else {
				ws = "__unassigned__"
			}

			const list = result[ws] ?? []
			list.push({
				id: String(item.id),
				title: typeof item.task === "string" && item.task.trim() ? item.task.trim() : "Untitled Task",
				ts: typeof item.ts === "number" ? item.ts : Date.now(),
			})
			result[ws] = list
		}

		// Sort each workspace's chats by timestamp descending (newest first)
		for (const ws of Object.keys(result)) {
			result[ws]?.sort((a, b) => b.ts - a.ts)
		}

		return result
	}

	public async showTaskWithId(taskId: string): Promise<void> {
		if (!taskId || typeof taskId !== "string") return
		if (this.provider && typeof this.provider.showTaskWithId === "function") {
			try {
				await this.provider.showTaskWithId(taskId)
			} catch (err) {
				console.warn("[DesktopAgentHost] provider.showTaskWithId error:", err)
			}
		}
		this.sendToExtension({ type: "showTaskWithId", text: taskId } as any)
	}

	public async clearTask(): Promise<void> {
		if (this.terminalLogs.length > 0) {
			this.archivedTerminalLogs.push({
				workspace: this.currentWorkspace,
				timestamp: Date.now(),
				logs: [...this.terminalLogs],
			})
			if (this.archivedTerminalLogs.length > 20) {
				this.archivedTerminalLogs.shift()
			}
		}
		if (this.currentWorkspace) {
			this.diffFilesByWorkspace.delete(this.currentWorkspace)
			this.terminalLogsByWorkspace.delete(this.currentWorkspace)
		}
		this.terminalLogs = []
		this.diffFiles.clear()
		this.emit("terminalLogsCleared")
		this.emit("diffsUpdated", [])
		if (this.provider && typeof (this.provider as any).clearTask === "function") {
			try {
				await (this.provider as any).clearTask()
			} catch (err) {
				console.warn("[DesktopAgentHost] provider.clearTask error:", err)
			}
		}
		this.sendToExtension({ type: "clearTask" } as any)
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

		// Handle terminal session lifecycle events from extension
		if (raw.type === "terminalSessionStarted") {
			const id = String(raw.id || `cmd-${Date.now()}`)
			const command = String(raw.command || "")
			const cwd = String(raw.cwd || this.currentWorkspace || "")
			const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.now()

			let session = this.terminalLogs.find((s) => s.id === id)
			if (!session) {
				session = {
					id,
					command,
					cwd,
					timestamp,
					output: "",
					status: "running",
				}
				this.terminalLogs.push(session)
				if (this.terminalLogs.length > 200) this.terminalLogs.shift()
			} else {
				if (command) session.command = command
				if (cwd) session.cwd = cwd
				session.timestamp = timestamp
				session.status = "running"
			}
			this.emit("terminalSessionStarted", {
				id: session.id,
				command: session.command,
				cwd: session.cwd,
				timestamp: session.timestamp,
			})
			this.emit("terminalLog", session)
		} else if (raw.type === "terminalOutput") {
			const id = String(raw.id || "")
			const data = String(raw.data || "")
			let session = id ? this.terminalLogs.find((s) => s.id === id) : undefined
			if (!session && this.terminalLogs.length > 0) {
				session = this.terminalLogs[this.terminalLogs.length - 1]
			}
			if (session) {
				session.output = (session.output || "") + data
				this.emit("terminalOutput", { id: session.id, data })
				this.emit("terminalLog", session)
			}
		} else if (raw.type === "terminalSessionEnded") {
			const id = String(raw.id || "")
			const exitCode = typeof raw.exitCode === "number" ? raw.exitCode : 0
			let session = id ? this.terminalLogs.find((s) => s.id === id) : undefined
			if (!session && this.terminalLogs.length > 0) {
				session = this.terminalLogs[this.terminalLogs.length - 1]
			}
			if (session) {
				session.exitCode = exitCode
				session.status = exitCode === 0 ? "completed" : "error"
				this.emit("terminalSessionEnded", { id: session.id, exitCode })
				this.emit("terminalLog", session)
			}
		} else if (raw.type === "commandExecutionStatus") {
			let statusObj: any = null
			try {
				statusObj = typeof raw.text === "string" ? JSON.parse(raw.text) : (raw.status ? raw : null)
			} catch {}

			if (statusObj && statusObj.executionId) {
				const execId = String(statusObj.executionId)
				let session = this.terminalLogs.find((s) => s.id === execId)

				if (statusObj.status === "started") {
					if (!session) {
						session = {
							id: execId,
							command: statusObj.command || "",
							cwd: this.currentWorkspace || "",
							timestamp: Date.now(),
							output: "",
							status: "running",
						}
						this.terminalLogs.push(session)
						if (this.terminalLogs.length > 200) this.terminalLogs.shift()
						this.emit("terminalSessionStarted", {
							id: session.id,
							command: session.command,
							cwd: session.cwd,
							timestamp: session.timestamp,
						})
						this.emit("terminalLog", session)
					}
				} else if (statusObj.status === "output") {
					if (!session) {
						session = {
							id: execId,
							command: "",
							cwd: this.currentWorkspace || "",
							timestamp: Date.now(),
							output: statusObj.output || "",
							status: "running",
						}
						this.terminalLogs.push(session)
						if (this.terminalLogs.length > 200) this.terminalLogs.shift()
					} else {
						session.output = statusObj.output || session.output
					}
					this.emit("terminalOutput", { id: execId, data: statusObj.output || "" })
					this.emit("terminalLog", session)
				} else if (statusObj.status === "exited") {
					const exitCode = typeof statusObj.exitCode === "number" ? statusObj.exitCode : 0
					if (session) {
						session.exitCode = exitCode
						session.status = exitCode === 0 ? "completed" : "error"
					}
					this.emit("terminalSessionEnded", { id: execId, exitCode })
					if (session) this.emit("terminalLog", session)
				} else if (statusObj.status === "timeout" || statusObj.status === "fallback") {
					if (session) {
						session.status = "error"
						session.exitCode = -1
						this.emit("terminalSessionEnded", { id: execId, exitCode: -1 })
						this.emit("terminalLog", session)
					}
				}
			}
		}

		// Handle workspace files changed event from engine
		if (raw.type === "workspaceFilesChanged" && Array.isArray(raw.files)) {
			for (const file of raw.files) {
				const relPath = (file.path || "").replace(/\\/g, "/")
				const absPath = file.absolutePath || (this.currentWorkspace ? path.resolve(this.currentWorkspace, relPath) : relPath)
				let newContent: string | undefined = undefined
				const existing = this.diffFiles.get(relPath)
				let oldContent: string | undefined = existing?.oldContent

				if (file.changeType !== "deleted" && fs.existsSync(absPath)) {
					try {
						newContent = fs.readFileSync(absPath, "utf-8")
					} catch {}
				}

				const status: "modified" | "added" | "deleted" =
					file.changeType === "created" ? "added" : file.changeType === "deleted" ? "deleted" : "modified"

				const entry: DiffFileEntry = {
					filePath: relPath,
					oldContent,
					newContent,
					status,
					additions: typeof file.additions === "number" ? file.additions : 0,
					deletions: typeof file.deletions === "number" ? file.deletions : 0,
				}
				this.diffFiles.set(relPath, entry)
			}
			this.emit("workspaceFilesChanged", raw.files)
			this.emit("diffsUpdated", this.getDiffFiles())
			this.refreshGitDiffs().catch(() => {})
		}

		// Detect agent status transitions
		if (raw.type === "say") {
			if (raw.say === "tool") {
				this.setStatus("executing")
				try {
					const toolData = typeof raw.text === "string" ? JSON.parse(raw.text) : raw.text
					if (toolData && toolData.tool === "execute_command") {
						this.recordTerminalLog(toolData.command || "")
					}
					if (
						toolData &&
						(toolData.tool === "write_to_file" ||
							toolData.tool === "apply_diff" ||
							toolData.tool === "editedExistingFile" ||
							toolData.tool === "newFileCreated" ||
							toolData.tool === "appliedDiff")
					) {
						this.handleToolFileChange(toolData)
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

		if (
			raw.type === "taskHistoryUpdated" ||
			raw.type === "taskHistoryItemUpdated" ||
			raw.type === "relinquishControl" ||
			(raw.type === "say" && (raw.say === "task" || raw.say === "completion_result"))
		) {
			this.emit("taskHistoryChanged")
		}

		// Relay to all attached UI clients
		this.emit("messageToUI", msg)
	}

	private recordTerminalLog(command: string): void {
		const entry: TerminalLogEntry = {
			id: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
			timestamp: Date.now(),
			command,
			cwd: this.currentWorkspace,
			output: "Running command in workspace...",
			status: "running",
		}
		this.terminalLogs.push(entry)
		if (this.terminalLogs.length > 200) this.terminalLogs.shift()
		this.emit("terminalSessionStarted", {
			id: entry.id,
			command: entry.command,
			cwd: entry.cwd || "",
			timestamp: entry.timestamp,
		})
		this.emit("terminalLog", entry)
	}

	private updateLatestTerminalOutput(output: string): void {
		if (this.terminalLogs.length > 0) {
			const latest = this.terminalLogs[this.terminalLogs.length - 1]
			if (latest) {
				latest.output = output || "(Command completed with no output)"
				latest.status = "completed"
				this.emit("terminalOutput", { id: latest.id, data: output })
				this.emit("terminalLog", latest)
			}
		}
	}

	private finishRunningTerminalLogs(): void {
		for (const log of this.terminalLogs) {
			if (log.status === "running") {
				log.status = "completed"
				this.emit("terminalSessionEnded", { id: log.id, exitCode: log.exitCode ?? 0 })
				this.emit("terminalLog", log)
			}
		}
	}

	private handleToolFileChange(toolData: any): void {
		const filePath = toolData.path
		if (!filePath) return

		const absPath = path.isAbsolute(filePath)
			? path.normalize(filePath)
			: path.normalize(path.resolve(this.currentWorkspace || "", filePath))
		const relPath = this.currentWorkspace
			? path.relative(this.currentWorkspace, absPath).replace(/\\/g, "/")
			: filePath.replace(/\\/g, "/")

		let oldContent: string | undefined = toolData.originalContent
		let newContent: string | undefined = typeof toolData.content === "string" ? toolData.content : undefined
		const fileExists = fs.existsSync(absPath)

		if (fileExists && newContent === undefined) {
			try {
				newContent = fs.readFileSync(absPath, "utf-8")
			} catch {}
		}

		const existing = this.diffFiles.get(relPath)
		if (!oldContent && existing?.oldContent) {
			oldContent = existing.oldContent
		}

		let status: "modified" | "added" | "deleted" = "modified"
		if (toolData.tool === "newFileCreated" || (!fileExists && !existing)) {
			status = "added"
		} else if (toolData.tool === "deleted") {
			status = "deleted"
		}

		let additions = 0
		let deletions = 0

		if (toolData.diffStats && typeof toolData.diffStats === "object") {
			additions = toolData.diffStats.added ?? 0
			deletions = toolData.diffStats.removed ?? 0
		} else if (newContent) {
			const newLines = newContent.split("\n").length
			const oldLines = oldContent ? oldContent.split("\n").length : 0
			if (status === "added") {
				additions = newLines
				deletions = 0
			} else {
				additions = Math.max(1, newLines)
				deletions = oldLines > 0 && newLines > 0 ? Math.max(0, oldLines - newLines) : 0
			}
		}

		const entry: DiffFileEntry = {
			filePath: relPath,
			oldContent: oldContent ?? existing?.oldContent,
			newContent: newContent ?? existing?.newContent,
			status,
			additions: additions || existing?.additions || 0,
			deletions: deletions || existing?.deletions || 0,
		}

		this.diffFiles.set(relPath, entry)
		this.emit("diffsUpdated", this.getDiffFiles())
		this.emit("workspaceFilesChanged", [
			{
				path: relPath,
				absolutePath: absPath,
				changeType: status === "added" ? "created" : status === "deleted" ? "deleted" : "modified",
				additions: entry.additions,
				deletions: entry.deletions,
			},
		])
		this.refreshGitDiffs().catch(() => {})
	}

	public async refreshGitDiffs(): Promise<void> {
		if (!this.currentWorkspace) return
		try {
			const statusOutput = execSync("git status --porcelain", {
				cwd: this.currentWorkspace,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 5000,
			})

			if (!statusOutput || !statusOutput.trim()) {
				return
			}

			const lines = statusOutput.split("\n").filter((l) => l.trim().length > 0)
			for (const line of lines) {
				const statusCode = line.substring(0, 2)
				let relPath = line.substring(3).trim()
				if (relPath.startsWith('"') && relPath.endsWith('"')) {
					relPath = relPath.slice(1, -1)
				}
				if (relPath.includes(" -> ")) {
					relPath = relPath.split(" -> ")[1]?.trim() || relPath
				}
				const cleanRelPath = relPath.replace(/\\/g, "/")
				const absPath = path.resolve(this.currentWorkspace, cleanRelPath)

				const isDeleted = statusCode.includes("D")
				const isUntracked = statusCode === "??"
				const isAdded = statusCode.includes("A") || isUntracked

				let status: "modified" | "added" | "deleted" = "modified"
				if (isDeleted) status = "deleted"
				else if (isAdded) status = "added"

				let oldContent: string | undefined = undefined
				let newContent: string | undefined = undefined
				let additions = 0
				let deletions = 0

				if (!isDeleted && fs.existsSync(absPath)) {
					try {
						newContent = fs.readFileSync(absPath, "utf-8")
					} catch {}
				}

				if (!isUntracked) {
					try {
						oldContent = execSync(`git show HEAD:"${cleanRelPath}"`, {
							cwd: this.currentWorkspace,
							encoding: "utf-8",
							stdio: ["ignore", "pipe", "ignore"],
							timeout: 3000,
						})
					} catch {}

					try {
						const numstat = execSync(`git diff --numstat HEAD -- "${cleanRelPath}"`, {
							cwd: this.currentWorkspace,
							encoding: "utf-8",
							stdio: ["ignore", "pipe", "ignore"],
							timeout: 3000,
						}).trim()
						if (numstat) {
							const parts = numstat.split(/\s+/)
							if (parts[0]) additions = parseInt(parts[0], 10) || 0
							if (parts[1]) deletions = parseInt(parts[1], 10) || 0
						}
					} catch {}
				}

				if (isAdded && newContent) {
					additions = newContent.split("\n").length
					deletions = 0
				} else if (isDeleted && oldContent) {
					additions = 0
					deletions = oldContent.split("\n").length
				}

				const existing = this.diffFiles.get(cleanRelPath)
				this.diffFiles.set(cleanRelPath, {
					filePath: cleanRelPath,
					oldContent: oldContent ?? existing?.oldContent,
					newContent: newContent ?? existing?.newContent,
					status,
					additions: additions || existing?.additions || 0,
					deletions: deletions || existing?.deletions || 0,
				})
			}
			this.emit("diffsUpdated", this.getDiffFiles())
		} catch {
			// Git error or not a git repository
		}
	}
}
