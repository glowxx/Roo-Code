import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { DesktopAgentHost } from "./agent-host.js"
import { createDesktopServer } from "./server.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface DesktopRunOptions {
	workspacePath?: string
	port?: number
	isElectron?: boolean
	openBrowser?: boolean
	dev?: boolean
}

export async function startDesktopApp(options: DesktopRunOptions = {}) {
	const workspacePath = path.resolve(options.workspacePath || process.cwd())
	const port = options.port || 4500

	// Locate extension bundle
	let rootDir = __dirname
	while (rootDir !== path.dirname(rootDir)) {
		if (fs.existsSync(path.join(rootDir, "src", "dist", "extension.js"))) {
			break
		}
		rootDir = path.dirname(rootDir)
	}

	const extensionPath = path.join(rootDir, "src", "dist")
	let staticDir = path.join(__dirname, "renderer")
	if (!fs.existsSync(staticDir)) {
		staticDir = path.join(__dirname, "..", "renderer")
	}
	if (!fs.existsSync(staticDir)) {
		staticDir = path.join(rootDir, "apps", "desktop", "dist", "renderer")
	}

	console.log("⚡ Starting Roo Code Desktop...")
	console.log(`📁 Workspace: ${workspacePath}`)
	console.log(`📦 Core Engine: ${extensionPath}`)

	const agentHost = new DesktopAgentHost({
		workspacePath,
		extensionPath,
		storageDir: path.join(workspacePath, ".roo-desktop-data"),
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
			const { app, BrowserWindow, dialog, ipcMain, Menu } = electron

			await app.whenReady()

			const win = new BrowserWindow({
				width: 1300,
				height: 880,
				minWidth: 900,
				minHeight: 600,
				title: "Roo Code Desktop",
				backgroundColor: "#18181b",
				webPreferences: {
					preload: path.join(__dirname, "..", "preload", "index.js"),
					contextIsolation: true,
					nodeIntegration: false,
				},
			})

			// Create application menu
			const menuTemplate: electron.MenuItemConstructorOptions[] = [
				{
					label: "File",
					submenu: [
						{
							label: "Open Workspace Folder...",
							accelerator: "CmdOrCtrl+O",
							click: async () => {
								const result = await dialog.showOpenDialog(win, {
									properties: ["openDirectory"],
									defaultPath: workspacePath,
								})
								if (!result.canceled && result.filePaths.length > 0) {
									const selectedPath = result.filePaths[0]
									console.log(`Switching workspace to: ${selectedPath}`)
									// Reload with new workspace
									app.relaunch({ args: process.argv.slice(1).concat(["--workspace", selectedPath]) })
									app.exit(0)
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
