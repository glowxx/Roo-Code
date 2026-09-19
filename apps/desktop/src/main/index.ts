import path from "path"
import fs from "fs"
import os from "os"
import { fileURLToPath } from "url"
import { DesktopAgentHost } from "./agent-host.js"
import { createDesktopServer, validatePathWithinRoot, getGitBranch, listWorkspaceFiles } from "./server.js"
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
	const workspacePath = path.resolve(options.workspacePath || process.cwd())
	const port = options.port || 4500
	const storageDir = options.storageDir || path.join(os.homedir(), ".roo-desktop-data")
	if (!fs.existsSync(storageDir)) {
		fs.mkdirSync(storageDir, { recursive: true })
	}

	// Locate extension bundle
	let extensionPath = ""
	const candidateEnginePaths = [
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

	let staticDir = path.join(__dirname, "renderer")
	if (!fs.existsSync(staticDir)) {
		staticDir = path.join(__dirname, "..", "renderer")
	}
	if (!fs.existsSync(staticDir) && process.resourcesPath) {
		staticDir = path.join(process.resourcesPath, "renderer")
	}

	console.log("⚡ Starting Roo Code Desktop...")
	console.log(`📁 Workspace: ${workspacePath}`)
	console.log(`📦 Core Engine: ${extensionPath}`)
	console.log(`💾 Storage: ${storageDir}`)

	const agentHost = new DesktopAgentHost({
		workspacePath,
		extensionPath,
		storageDir,
	})

	await agentHost.init()
	console.log("🤖 Agent Engine initialized successfully.")

	const desktopServer = createDesktopServer({
		port,
		host: "127.0.0.1",
		agentHost,
		staticDir,
	})

	const actualPort = await desktopServer.start()
	const appUrl = `http://localhost:${actualPort}`
	console.log(`🚀 Roo Code Desktop running at: ${appUrl}`)

	if (options.isElectron && process.versions.electron) {
		try {
			const electron = await import("electron")
			const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = electron

			await app.whenReady()

			const iconCandidate = path.join(staticDir, "icon.png")
			const win = new BrowserWindow({
				width: 1300,
				height: 880,
				minWidth: 900,
				minHeight: 600,
				title: "Roo Code Desktop",
				backgroundColor: "#090a0f",
				icon: fs.existsSync(iconCandidate) ? iconCandidate : undefined,
				frame: false,
				titleBarStyle: "hidden",
				titleBarOverlay: false,
				webPreferences: {
					preload: path.join(__dirname, "..", "preload", "index.js"),
					contextIsolation: true,
					nodeIntegration: false,
				},
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

			ipcMain.handle("desktop:select-folder", async () => {
				const result = await dialog.showOpenDialog(win, {
					properties: ["openDirectory"],
					defaultPath: agentHost.getWorkspace(),
				})
				if (!result.canceled && result.filePaths.length > 0) {
					const selectedPath = result.filePaths[0]
					if (selectedPath) {
						console.log(`Switching workspace to: ${selectedPath}`)
						const normalized = path.normalize(path.resolve(selectedPath))
						await agentHost.setWorkspace(normalized)
						const newWs: WorkspaceInfo = {
							path: normalized,
							name: path.basename(normalized),
							branch: getGitBranch(normalized),
							files: listWorkspaceFiles(normalized),
						}
						if (!win.isDestroyed()) {
							win.webContents.send("desktop:message-from-extension", { type: "workspaceInfo", workspace: newWs })
							win.webContents.send("desktop:message-from-extension", { type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
						}
						return normalized
					}
				}
				return null
			})

			ipcMain.handle("desktop:show-item", async (_event, filePath: string) => {
				if (filePath && typeof filePath === "string") {
					const wsRoot = path.normalize(path.resolve(agentHost.getWorkspace()))
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
					const wsRoot = path.normalize(path.resolve(agentHost.getWorkspace()))
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
								const result = await dialog.showOpenDialog(win, {
									properties: ["openDirectory"],
									defaultPath: agentHost.getWorkspace(),
								})
								if (!result.canceled && result.filePaths.length > 0) {
									const selectedPath = result.filePaths[0]
									if (selectedPath) {
										console.log(`Switching workspace to: ${selectedPath}`)
										const normalized = path.normalize(path.resolve(selectedPath))
										await agentHost.setWorkspace(normalized)
										const newWs: WorkspaceInfo = {
											path: normalized,
											name: path.basename(normalized),
											branch: getGitBranch(normalized),
											files: listWorkspaceFiles(normalized),
										}
										if (!win.isDestroyed()) {
											win.webContents.send("desktop:message-from-extension", { type: "workspaceInfo", workspace: newWs })
											win.webContents.send("desktop:message-from-extension", { type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
										}
									}
								}
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
				if (!win.isDestroyed()) {
					const curWs = path.normalize(path.resolve(agentHost.getWorkspace()))
					const newWs: WorkspaceInfo = {
						path: curWs,
						name: path.basename(curWs),
						branch: getGitBranch(curWs),
						files: listWorkspaceFiles(curWs),
					}
					win.webContents.send("desktop:message-from-extension", { type: "workspaceInfo", workspace: newWs })
					win.webContents.send("desktop:message-from-extension", { type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
				}
			})

			await win.loadURL(appUrl)

			win.on("closed", () => {
				desktopServer.stop().finally(() => app.quit())
			})

			app.on("window-all-closed", () => {
				if (process.platform !== "darwin") {
					app.quit()
				}
			})
			return
		} catch (err) {
			console.warn("Electron GUI could not be initialized, falling back to Web Desktop:", err)
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
	let workspacePath = process.cwd()
	const wsArgIdx = args.indexOf("-w") !== -1 ? args.indexOf("-w") : args.indexOf("--workspace")
	if (wsArgIdx !== -1 && args[wsArgIdx + 1]) {
		workspacePath = args[wsArgIdx + 1]!
	}

	startDesktopApp({
		workspacePath,
		isElectron: true,
	}).catch((err) => {
		console.error("Failed to start Roo Code Desktop in Electron:", err)
	})
}
