import { logStartupDebug, setupGlobalCrashHandlers } from "./logger.js"

setupGlobalCrashHandlers("DesktopMain")
logStartupDebug("=== Roo Code Desktop Starting ===")
logStartupDebug(`Versions: ${JSON.stringify(process.versions)}`)
logStartupDebug(`Process argv: ${JSON.stringify(process.argv)}`)
logStartupDebug(`Cwd: ${process.cwd()}`)

import path from "path"
import fs from "fs"
import os from "os"
import { fileURLToPath } from "url"
import { DesktopAgentHost } from "./agent-host.js"
import { createDesktopServer, validatePathWithinRoot, getGitBranch, listWorkspaceFiles, scanWorkspace } from "./server.js"
import { loadDesktopConfig, saveDesktopConfig } from "./config.js"
import type { WorkspaceInfo } from "../shared/types.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface DesktopRunOptions {
	workspacePath?: string
	port?: number
	isElectron?: boolean
	openBrowser?: boolean
	dev?: boolean
	storageDir?: string
}

export async function startDesktopApp(options: DesktopRunOptions = {}) {
	logStartupDebug(`startDesktopApp called with options: ${JSON.stringify(options)}`)
	let workspacePath = options.workspacePath

	// Check if -w / --workspace was explicitly provided in CLI arguments
	const args = process.argv.slice(2)
	const wsArgIdx = args.indexOf("-w") !== -1 ? args.indexOf("-w") : args.indexOf("--workspace")
	let explicitWsFromArg: string | undefined
	if (wsArgIdx !== -1 && args[wsArgIdx + 1]) {
		explicitWsFromArg = args[wsArgIdx + 1]
	} else {
		const wsEqualArg = args.find((a) => a.startsWith("-w=") || a.startsWith("--workspace="))
		if (wsEqualArg) {
			explicitWsFromArg = wsEqualArg.split("=").slice(1).join("=")
		}
	}

	// If no explicit workspace argument was passed via CLI, try loading lastWorkspacePath from config
	if (!explicitWsFromArg) {
		const config = loadDesktopConfig()
		if (config.lastWorkspacePath && fs.existsSync(config.lastWorkspacePath)) {
			try {
				if (fs.statSync(config.lastWorkspacePath).isDirectory()) {
					workspacePath = config.lastWorkspacePath
				}
			} catch {}
		}
	}

	// Zero-state resilience: do not force process.cwd() when no workspace is selected!
	workspacePath = workspacePath && workspacePath.trim() ? path.resolve(workspacePath) : ""
	const port = options.port || 4500
	const storageDir = options.storageDir || path.join(os.homedir(), ".roo-desktop-data")
	if (!fs.existsSync(storageDir)) {
		fs.mkdirSync(storageDir, { recursive: true })
	}

	// Locate extension bundle
	let extensionPath = ""
	const candidateEnginePaths = [
		process.resourcesPath ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "engine") : "",
		process.resourcesPath ? path.join(process.resourcesPath, "app.asar", "dist", "engine") : "",
		process.resourcesPath ? path.join(process.resourcesPath, "engine") : "",
		path.join(__dirname, "..", "engine"),
		path.join(__dirname, "engine"),
	].filter(Boolean)

	for (const candidate of candidateEnginePaths) {
		if (fs.existsSync(path.join(candidate, "extension.js"))) {
			extensionPath = candidate
			break
		}
	}

	if (!extensionPath) {
		let rootDir = __dirname
		while (rootDir !== path.dirname(rootDir)) {
			if (fs.existsSync(path.join(rootDir, "src", "dist", "extension.js"))) {
				extensionPath = path.join(rootDir, "src", "dist")
				break
			}
			rootDir = path.dirname(rootDir)
		}
	}

	let staticDir = ""
	const candidateStaticDirs = [
		process.resourcesPath ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "renderer") : "",
		process.resourcesPath ? path.join(process.resourcesPath, "app.asar", "dist", "renderer") : "",
		path.join(__dirname, "renderer"),
		path.join(__dirname, "..", "renderer"),
		process.resourcesPath ? path.join(process.resourcesPath, "renderer") : "",
	].filter(Boolean)

	for (const candidate of candidateStaticDirs) {
		if (fs.existsSync(path.join(candidate, "index.html"))) {
			staticDir = candidate
			break
		}
	}

	logStartupDebug("⚡ Starting Roo Code Desktop...")
	logStartupDebug(`📁 Workspace: ${workspacePath || "(none - zero-state)"}`)
	logStartupDebug(`📦 Core Engine: ${extensionPath}`)
	logStartupDebug(`💾 Storage: ${storageDir}`)
	logStartupDebug(`🌐 Static Dir: ${staticDir}`)

	const agentHost = new DesktopAgentHost({
		workspacePath,
		extensionPath,
		storageDir,
	})

	logStartupDebug("Initializing DesktopAgentHost...")
	await agentHost.init()
	logStartupDebug("🤖 Agent Engine initialized successfully.")
	console.log("🤖 Agent Engine initialized successfully.")

	const desktopServer = createDesktopServer({
		port,
		host: "127.0.0.1",
		agentHost,
		staticDir,
	})

	logStartupDebug(`Starting DesktopServer on port ${port}...`)
	const actualPort = await desktopServer.start()
	const appUrl = `http://127.0.0.1:${actualPort}`
	logStartupDebug(`🚀 Roo Code Desktop running at: ${appUrl}`)
	console.log(`🚀 Roo Code Desktop running at: ${appUrl}`)

	if (options.isElectron && process.versions.electron) {
		try {
			logStartupDebug("Electron detected, importing electron module...")
			const electron = await import("electron")
			const electronObj = (electron as any).app ? electron : ((electron as any).default || electron)
			const { app, BrowserWindow, dialog, ipcMain, Menu, shell, screen } = electronObj

			logStartupDebug("Waiting for app.whenReady()...")
			await app.whenReady()
			logStartupDebug("app.whenReady() resolved successfully")

			const config = loadDesktopConfig()
			const windowBounds = config.windowBounds

			let windowX = windowBounds?.x
			let windowY = windowBounds?.y
			if (typeof windowX === "number" && typeof windowY === "number") {
				const displays = screen.getAllDisplays()
				const isVisible = displays.some((d: any) => {
					const { x, y, width, height } = d.bounds
					return (
						windowX! >= x - 50 &&
						windowX! < x + width &&
						windowY! >= y - 50 &&
						windowY! < y + height
					)
				})
				if (!isVisible) {
					windowX = undefined
					windowY = undefined
				}
			}

			let preloadPath = path.join(__dirname, "..", "preload", "index.js")
			const candidatePreloadPaths = [
				process.resourcesPath ? path.join(process.resourcesPath, "app.asar.unpacked", "dist", "preload", "index.js") : "",
				process.resourcesPath ? path.join(process.resourcesPath, "app.asar", "dist", "preload", "index.js") : "",
				preloadPath,
				path.join(__dirname, "preload", "index.js"),
			].filter(Boolean)
			for (const cp of candidatePreloadPaths) {
				if (fs.existsSync(cp)) {
					preloadPath = cp
					break
				}
			}
			logStartupDebug(`Resolved preload script: ${preloadPath}`)

			const iconCandidate = path.join(staticDir, "icon.png")
			logStartupDebug(`Creating BrowserWindow (icon: ${iconCandidate})...`)
			const win = new BrowserWindow({
				width: windowBounds?.width ?? 1300,
				height: windowBounds?.height ?? 880,
				x: windowX,
				y: windowY,
				minWidth: 900,
				minHeight: 600,
				title: "Roo Code Desktop",
				backgroundColor: "#090a0f",
				icon: fs.existsSync(iconCandidate) ? iconCandidate : undefined,
				frame: false,
				titleBarStyle: "hidden",
				titleBarOverlay: false,
				webPreferences: {
					preload: preloadPath,
					contextIsolation: true,
					nodeIntegration: false,
				},
			})
			logStartupDebug(`BrowserWindow created (id: ${win.id})`)

			if (windowBounds?.isMaximized) {
				win.maximize()
			}

			const saveBounds = () => {
				if (win.isDestroyed()) return
				const isMaximized = win.isMaximized()
				if (isMaximized) {
					saveDesktopConfig({
						windowBounds: {
							...(loadDesktopConfig().windowBounds || { width: 1300, height: 880 }),
							isMaximized: true,
						},
					})
				} else {
					const bounds = win.getBounds()
					saveDesktopConfig({
						windowBounds: {
							width: bounds.width,
							height: bounds.height,
							x: bounds.x,
							y: bounds.y,
							isMaximized: false,
						},
					})
				}
			}

			let saveBoundsTimeout: NodeJS.Timeout | null = null
			const debouncedSaveBounds = () => {
				if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout)
				saveBoundsTimeout = setTimeout(saveBounds, 500)
			}

			win.on("resize", debouncedSaveBounds)
			win.on("move", debouncedSaveBounds)
			win.on("maximize", saveBounds)
			win.on("unmaximize", debouncedSaveBounds)
			win.on("close", () => {
				if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout)
				saveBounds()
			})

			// IPC Handlers for communication with renderer
			ipcMain.on("desktop:message-to-extension", (_event, message) => {
				agentHost.sendToExtension(message as any)
			})

			// Window control IPC handlers
			ipcMain.on("desktop:window-minimize", () => {
				if (!win.isDestroyed()) win.minimize()
			})
			ipcMain.on("desktop:window-maximize", () => {
				if (!win.isDestroyed()) {
					if (win.isMaximized()) {
						win.unmaximize()
					} else {
						win.maximize()
					}
				}
			})
			ipcMain.on("desktop:window-close", () => {
				if (!win.isDestroyed()) win.close()
			})

			const handleSelectFolder = async () => {
				const result = await dialog.showOpenDialog(win, {
					properties: ["openDirectory"],
					defaultPath: agentHost.getWorkspace() || undefined,
				})
				if (!result.canceled && result.filePaths.length > 0) {
					const selectedPath = result.filePaths[0]
					if (selectedPath) {
						console.log(`Switching workspace to: ${selectedPath}`)
						const normalized = path.normalize(path.resolve(selectedPath))
						await agentHost.setWorkspace(normalized)
						saveDesktopConfig({ lastWorkspacePath: normalized })
						const scan = scanWorkspace(normalized)
						const newWs: WorkspaceInfo = {
							path: normalized,
							name: path.basename(normalized),
							branch: getGitBranch(normalized),
							files: scan.files,
							directories: scan.directories,
						}
						if (!win.isDestroyed()) {
							win.webContents.send("desktop:message-from-extension", { type: "workspaceInfo", workspace: newWs })
							win.webContents.send("desktop:message-from-extension", { type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
						}
						return normalized
					}
				}
				return null
			}

			ipcMain.handle("desktop:select-folder", handleSelectFolder)
			ipcMain.handle("desktop:select-workspace", handleSelectFolder)

			ipcMain.handle("desktop:show-item", async (_event, filePath: string) => {
				if (filePath && typeof filePath === "string") {
					const rawWs = agentHost.getWorkspace()
					if (!rawWs || !rawWs.trim()) return false
					const wsRoot = path.normalize(path.resolve(rawWs))
					const validation = validatePathWithinRoot(filePath, wsRoot)
					if (validation.safe && validation.resolvedPath && fs.existsSync(validation.resolvedPath)) {
						shell.showItemInFolder(validation.resolvedPath)
						return true
					}
				}
				return false
			})

			ipcMain.handle("desktop:open-path", async (_event, filePath: string) => {
				if (filePath && typeof filePath === "string") {
					const rawWs = agentHost.getWorkspace()
					if (!rawWs || !rawWs.trim()) return false
					const wsRoot = path.normalize(path.resolve(rawWs))
					const validation = validatePathWithinRoot(filePath, wsRoot)
					if (validation.safe && validation.resolvedPath && fs.existsSync(validation.resolvedPath)) {
						await shell.openPath(validation.resolvedPath)
						return true
					}
				}
				return false
			})

			// Create application menu
			const menuTemplate: Electron.MenuItemConstructorOptions[] = [
				{
					label: "File",
					submenu: [
						{
							label: "Open Workspace Folder...",
							accelerator: "CmdOrCtrl+O",
							click: async () => {
								await handleSelectFolder()
							},
						},
						{ type: "separator" },
						{ role: "quit" },
					],
				},
				{
					label: "Edit",
					submenu: [
						{ role: "undo" },
						{ role: "redo" },
						{ type: "separator" },
						{ role: "cut" },
						{ role: "copy" },
						{ role: "paste" },
						{ role: "selectAll" },
					],
				},
				{
					label: "View",
					submenu: [
						{ role: "reload" },
						{ role: "forceReload" },
						{ role: "toggleDevTools" },
						{ type: "separator" },
						{ role: "resetZoom" },
						{ role: "zoomIn" },
						{ role: "zoomOut" },
						{ type: "separator" },
						{ role: "togglefullscreen" },
					],
				},
			]

			const menu = Menu.buildFromTemplate(menuTemplate)
			Menu.setApplicationMenu(menu)

			win.webContents.on("did-finish-load", () => {
				logStartupDebug("BrowserWindow webContents 'did-finish-load' fired")
				if (!win.isDestroyed()) {
					const rawWs = agentHost.getWorkspace()
					const curWs = rawWs && rawWs.trim() ? path.normalize(path.resolve(rawWs)) : ""
					const scan = curWs ? scanWorkspace(curWs) : { files: [], directories: [] }
					const newWs: WorkspaceInfo = {
						path: curWs,
						name: curWs ? path.basename(curWs) : "",
						branch: curWs ? getGitBranch(curWs) : undefined,
						files: scan.files,
						directories: scan.directories,
					}
					win.webContents.send("desktop:message-from-extension", { type: "workspaceInfo", workspace: newWs })
					win.webContents.send("desktop:message-from-extension", { type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
				}
			})

			win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
				logStartupDebug(`BrowserWindow did-fail-load: ${errorCode} - ${errorDescription} (${validatedURL})`)
			})

			win.webContents.on("render-process-gone", (_event, details) => {
				logStartupDebug(`BrowserWindow render-process-gone: ${JSON.stringify(details)}`)
			})

			logStartupDebug(`Loading appUrl in BrowserWindow: ${appUrl}`)
			await win.loadURL(appUrl)
			logStartupDebug("win.loadURL completed successfully")

			win.on("closed", () => {
				logStartupDebug("BrowserWindow closed")
				desktopServer.stop().finally(() => app.quit())
			})

			app.on("window-all-closed", () => {
				logStartupDebug("app window-all-closed")
				if (process.platform !== "darwin") {
					app.quit()
				}
			})
			return
		} catch (err) {
			const msg = `Electron GUI could not be initialized, falling back to Web Desktop: ${err instanceof Error ? err.stack : String(err)}`
			logStartupDebug(msg)
			console.warn(msg)
		}
	}

	if (options.openBrowser) {
		try {
			const { default: open } = await import("open")
			await open(appUrl)
		} catch {
			// ignore open error
		}
	}

	return { url: appUrl, stop: desktopServer.stop }
}

// Auto-start when executed directly in an Electron process (e.g. electron . or packaged app)
if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
	const args = process.argv.slice(2)
	let workspacePath: string | undefined
	const wsArgIdx = args.indexOf("-w") !== -1 ? args.indexOf("-w") : args.indexOf("--workspace")
	if (wsArgIdx !== -1 && args[wsArgIdx + 1]) {
		workspacePath = args[wsArgIdx + 1]!
	} else {
		const wsEqualArg = args.find((a) => a.startsWith("-w=") || a.startsWith("--workspace="))
		if (wsEqualArg) {
			workspacePath = wsEqualArg.split("=").slice(1).join("=")
		}
	}

	if (!workspacePath) {
		const config = loadDesktopConfig()
		if (config.lastWorkspacePath && fs.existsSync(config.lastWorkspacePath)) {
			try {
				if (fs.statSync(config.lastWorkspacePath).isDirectory()) {
					workspacePath = config.lastWorkspacePath
				}
			} catch {}
		}
	}

	logStartupDebug(`Electron auto-start resolved workspacePath: ${workspacePath || "(none)"}`)
	startDesktopApp({
		workspacePath: workspacePath || "",
		isElectron: true,
	}).catch((err) => {
		const msg = `Failed to start Roo Code Desktop in Electron: ${err?.stack || err}`
		logStartupDebug(msg)
		console.error(msg)
	})
}
