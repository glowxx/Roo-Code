import http from "http"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { WebSocketServer, WebSocket } from "ws"
import { execSync, exec } from "child_process"
import { DesktopAgentHost } from "./agent-host.js"
import type { DesktopClientMessage, DesktopServerMessage, WorkspaceInfo } from "../shared/types.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface DesktopServerOptions {
	port: number
	host?: string
	agentHost: DesktopAgentHost
	staticDir?: string
}

function getGitBranch(workspacePath: string): string | undefined {
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: workspacePath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim()
		return branch || undefined
	} catch {
		return undefined
	}
}

function listWorkspaceFiles(dir: string, maxFiles = 1000): string[] {
	const results: string[] = []
	const IGNORED_DIRS = new Set([
		"node_modules",
		"dist",
		"release",
		"build",
		"out",
		".git",
		".turbo",
		".roo",
		".vscode",
		".idea",
		"coverage",
		".next",
		".cache",
		"temp",
		"tmp",
	])
	const IGNORED_SYSTEM_FILES = new Set([
		".ds_store",
		"thumbs.db",
		"desktop.ini",
	])

	function walk(currentDir: string, relPrefix = "") {
		if (results.length >= maxFiles) return
		let entries: fs.Dirent[] = []
		try {
			entries = fs.readdirSync(currentDir, { withFileTypes: true })
		} catch {
			return
		}

		entries.sort((a, b) => {
			if (a.isDirectory() && !b.isDirectory()) return -1
			if (!a.isDirectory() && b.isDirectory()) return 1
			return a.name.localeCompare(b.name)
		})

		for (const entry of entries) {
			if (results.length >= maxFiles) break
			if (entry.name.startsWith(".") && entry.name !== ".env" && !entry.name.startsWith(".env.")) {
				if (entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue
			}
			if (IGNORED_DIRS.has(entry.name)) continue
			if (IGNORED_SYSTEM_FILES.has(entry.name.toLowerCase())) continue

			const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
			if (entry.isDirectory()) {
				walk(path.join(currentDir, entry.name), relPath)
			} else if (entry.isFile()) {
				results.push(relPath)
			}
		}
	}
	walk(dir)
	return results
}

export function createDesktopServer(options: DesktopServerOptions): {
	server: http.Server
	wss: WebSocketServer
	start: () => Promise<number>
	stop: () => Promise<void>
} {
	const { port, host = "127.0.0.1", agentHost, staticDir } = options
	const clients = new Set<WebSocket>()

	function broadcast(msg: DesktopServerMessage) {
		const payload = JSON.stringify(msg)
		for (const client of clients) {
			if (client.readyState === WebSocket.OPEN) {
				try {
					client.send(payload)
				} catch {
					// client error
				}
			}
		}
	}

	// Listen to agent host events and broadcast to webview
	agentHost.on("messageToUI", (message) => {
		broadcast({ type: "extensionMessage", message })
	})
	agentHost.on("statusChange", (status) => {
		broadcast({ type: "agentStatus", status })
	})
	agentHost.on("terminalLog", (entry) => {
		broadcast({ type: "terminalLog", entry })
	})
	agentHost.on("diffsUpdated", (diffs) => {
		broadcast({ type: "diffsUpdated", diffs })
	})
	agentHost.on("workspaceChanged", (wsPath) => {
		const newWs: WorkspaceInfo = {
			path: wsPath,
			name: path.basename(wsPath),
			branch: getGitBranch(wsPath),
			files: listWorkspaceFiles(wsPath),
		}
		broadcast({ type: "workspaceInfo", workspace: newWs })
		broadcast({ type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
	})

	const server = http.createServer((req, res) => {
		const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
		const pathname = parsedUrl.pathname

		// Enable CORS restricted to localhost/local origins
		const origin = req.headers.origin || ""
		if (!origin || origin.includes("localhost") || origin.includes("127.0.0.1")) {
			res.setHeader("Access-Control-Allow-Origin", origin || "*")
		}
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		// API endpoints
		if (pathname === "/api/workspace") {
			const wsPath = agentHost.getWorkspace()
			const info: WorkspaceInfo = {
				path: wsPath,
				name: path.basename(wsPath),
				branch: getGitBranch(wsPath),
				files: listWorkspaceFiles(wsPath),
			}
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify(info))
			return
		}

		if (pathname === "/api/file") {
			const filePath = parsedUrl.searchParams.get("path")
			if (!filePath) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Missing path parameter" }))
				return
			}
			const wsRoot = path.resolve(agentHost.getWorkspace())
			const absPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(wsRoot, filePath)

			// Path traversal check
			if (!absPath.startsWith(wsRoot)) {
				res.writeHead(403, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Access outside workspace forbidden" }))
				return
			}

			try {
				if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
					res.writeHead(404, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ error: "File not found" }))
					return
				}
				const ext = path.extname(absPath).toLowerCase()
				const mimeTypes: Record<string, string> = {
					".png": "image/png",
					".jpg": "image/jpeg",
					".jpeg": "image/jpeg",
					".gif": "image/gif",
					".webp": "image/webp",
					".ico": "image/x-icon",
					".bmp": "image/bmp",
					".svg": "image/svg+xml",
					".html": "text/html; charset=utf-8",
					".css": "text/css; charset=utf-8",
					".js": "application/javascript; charset=utf-8",
					".mjs": "application/javascript; charset=utf-8",
					".ts": "text/plain; charset=utf-8",
					".tsx": "text/plain; charset=utf-8",
					".json": "application/json; charset=utf-8",
					".md": "text/markdown; charset=utf-8",
					".txt": "text/plain; charset=utf-8",
					".pdf": "application/pdf",
					".mp3": "audio/mpeg",
					".wav": "audio/wav",
					".mp4": "video/mp4",
				}
				const contentType = mimeTypes[ext] || "application/octet-stream"
				res.writeHead(200, { "Content-Type": contentType })
				fs.createReadStream(absPath).pipe(res)
			} catch {
				res.writeHead(500, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Error reading file" }))
			}
			return
		}

		if (pathname === "/api/diffs") {
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify(agentHost.getDiffFiles()))
			return
		}

		if (pathname === "/api/terminal-logs") {
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify(agentHost.getTerminalLogs()))
			return
		}

		// Handle /webview and /assets routes
		if (pathname.startsWith("/webview") || pathname.startsWith("/assets/")) {
			let webviewBuildDir = ""
			const candidateWebviewPaths = [
				process.resourcesPath ? path.join(process.resourcesPath, "webview") : "",
				path.join(__dirname, "..", "webview"),
				path.join(__dirname, "webview"),
			].filter(Boolean)

			for (const candidate of candidateWebviewPaths) {
				if (fs.existsSync(path.join(candidate, "index.html"))) {
					webviewBuildDir = candidate
					break
				}
			}

			if (!webviewBuildDir) {
				let rootDir = __dirname
				while (rootDir !== path.dirname(rootDir)) {
					if (fs.existsSync(path.join(rootDir, "src", "webview-ui", "build"))) {
						webviewBuildDir = path.join(rootDir, "src", "webview-ui", "build")
						break
					}
					rootDir = path.dirname(rootDir)
				}
			}
			let relWebviewPath = pathname.startsWith("/webview")
				? pathname.replace(/^\/webview\/?/, "") || "index.html"
				: pathname.replace(/^\//, "")
			let targetWebviewPath = path.join(webviewBuildDir, relWebviewPath)

			if (!fs.existsSync(targetWebviewPath) || fs.statSync(targetWebviewPath).isDirectory()) {
				targetWebviewPath = path.join(webviewBuildDir, "index.html")
			}

			if (fs.existsSync(targetWebviewPath) && fs.statSync(targetWebviewPath).isFile()) {
				const ext = path.extname(targetWebviewPath).toLowerCase()
				const mimeTypes: Record<string, string> = {
					".html": "text/html; charset=utf-8",
					".js": "application/javascript; charset=utf-8",
					".mjs": "application/javascript; charset=utf-8",
					".css": "text/css; charset=utf-8",
					".json": "application/json; charset=utf-8",
					".png": "image/png",
					".jpg": "image/jpeg",
					".svg": "image/svg+xml",
					".woff": "font/woff",
					".woff2": "font/woff2",
					".ttf": "font/ttf",
				}
				const contentType = mimeTypes[ext] || "application/octet-stream"

				if (ext === ".html") {
					let html = fs.readFileSync(targetWebviewPath, "utf-8")
					const polyfillAndTheme = `
<style id="vscode-theme-tokens">
:root {
	--vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
	--vscode-font-size: 14px;
	--vscode-font-weight: 400;
	--vscode-editor-font-family: "JetBrains Mono", Menlo, Monaco, Consolas, "Courier New", monospace;
	--vscode-editor-font-size: 13px;

	/* Dark Modern Tokens */
	--vscode-editor-background: #0b0c10;
	--vscode-editor-foreground: #e4e7ec;
	--vscode-foreground: #f2f4f7;
	--vscode-descriptionForeground: #98a2b3;
	--vscode-disabledForeground: #667085;
	--vscode-errorForeground: #f04438;

	--vscode-input-background: #14161f;
	--vscode-input-foreground: #f8fafc;
	--vscode-input-border: #252836;
	--vscode-input-placeholderForeground: #667085;
	--vscode-focusBorder: #3b82f6;

	--vscode-button-background: #2563eb;
	--vscode-button-foreground: #ffffff;
	--vscode-button-hoverBackground: #1d4ed8;
	--vscode-button-secondaryBackground: #1a1d28;
	--vscode-button-secondaryForeground: #f2f4f7;
	--vscode-button-secondaryHoverBackground: #252838;

	--vscode-dropdown-background: #14161f;
	--vscode-dropdown-foreground: #f8fafc;
	--vscode-dropdown-border: #252836;
	--vscode-dropdown-listBackground: #10121a;

	--vscode-menu-background: #14161f;
	--vscode-menu-foreground: #f8fafc;

	--vscode-list-hoverBackground: #1a1d28;
	--vscode-list-hoverForeground: #ffffff;
	--vscode-list-activeSelectionBackground: #2563eb;
	--vscode-list-activeSelectionForeground: #ffffff;

	--vscode-badge-background: #2563eb;
	--vscode-badge-foreground: #ffffff;

	--vscode-textLink-foreground: #60a5fa;
	--vscode-textLink-activeForeground: #93c5fd;
	--vscode-textCodeBlock-background: #14161f;

	--vscode-sideBar-background: #0b0c10;
	--vscode-sideBar-foreground: #e4e7ec;
	--vscode-panel-border: #1e212d;
	--vscode-editorGroup-border: #1e212d;
	--vscode-widget-border: #1e212d;
	--vscode-widget-shadow: rgba(0, 0, 0, 0.5);

	--vscode-charts-red: #f04438;
	--vscode-charts-blue: #3b82f6;
	--vscode-charts-yellow: #f79009;
	--vscode-charts-green: #12b76a;
	--vscode-charts-orange: #fb6514;
}

body.vscode-light {
	--vscode-editor-background: #ffffff;
	--vscode-editor-foreground: #1d2939;
	--vscode-foreground: #101828;
	--vscode-descriptionForeground: #475467;
	--vscode-disabledForeground: #98a2b3;
	--vscode-errorForeground: #d92d20;

	--vscode-input-background: #fcfcfd;
	--vscode-input-foreground: #101828;
	--vscode-input-border: #d0d5dd;
	--vscode-input-placeholderForeground: #98a2b3;
	--vscode-focusBorder: #2563eb;

	--vscode-button-background: #2563eb;
	--vscode-button-foreground: #ffffff;
	--vscode-button-hoverBackground: #1d4ed8;
	--vscode-button-secondaryBackground: #f2f4f7;
	--vscode-button-secondaryForeground: #1d2939;
	--vscode-button-secondaryHoverBackground: #e4e7ec;

	--vscode-dropdown-background: #ffffff;
	--vscode-dropdown-foreground: #101828;
	--vscode-dropdown-border: #d0d5dd;
	--vscode-dropdown-listBackground: #ffffff;

	--vscode-menu-background: #ffffff;
	--vscode-menu-foreground: #101828;

	--vscode-list-hoverBackground: #f2f4f7;
	--vscode-list-hoverForeground: #101828;
	--vscode-list-activeSelectionBackground: #2563eb;
	--vscode-list-activeSelectionForeground: #ffffff;

	--vscode-badge-background: #2563eb;
	--vscode-badge-foreground: #ffffff;

	--vscode-textLink-foreground: #1570ef;
	--vscode-textLink-activeForeground: #175cd3;
	--vscode-textCodeBlock-background: #f8fafc;

	--vscode-sideBar-background: #ffffff;
	--vscode-sideBar-foreground: #1d2939;
	--vscode-panel-border: #eaecf0;
	--vscode-editorGroup-border: #eaecf0;
	--vscode-widget-border: #eaecf0;
	--vscode-widget-shadow: rgba(16, 24, 40, 0.08);
}

html, body {
	height: 100%;
	width: 100%;
	margin: 0;
	padding: 0;
	overflow: hidden;
	background-color: var(--vscode-editor-background);
	color: var(--vscode-foreground);
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	-webkit-font-smoothing: antialiased;
}

#root {
	height: 100%;
	width: 100%;
	display: flex;
	flex-direction: column;
}

/* Polished onboarding/settings width constraints */
[data-tab-content], .tab-content {
	max-width: 860px;
	margin: 0 auto;
	width: 100%;
}

/* ==========================================================================
   Luxury Desktop Controls Sizing (Generous Buttons & Input Boxes)
   ========================================================================== */
button, [role="button"] {
	border-radius: 8px !important;
	font-family: var(--vscode-font-family) !important;
	transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

/* Primary buttons with modern gradient & elevation */
button[class*="bg-primary"],
button.primary-btn {
	min-height: 38px !important;
	padding: 8px 18px !important;
	font-size: 13.5px !important;
	font-weight: 600 !important;
	background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%) !important;
	color: #ffffff !important;
	border: 1px solid rgba(255, 255, 255, 0.15) !important;
	box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
	border-radius: 8px !important;
}
button[class*="bg-primary"]:hover {
	background: linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%) !important;
	box-shadow: 0 3px 8px rgba(37, 99, 235, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25) !important;
}

/* Secondary buttons */
button[class*="bg-secondary"] {
	min-height: 38px !important;
	padding: 8px 16px !important;
	font-size: 13.5px !important;
	font-weight: 500 !important;
	background: #191c28 !important;
	color: #e2e8f0 !important;
	border: 1px solid rgba(255, 255, 255, 0.1) !important;
	border-radius: 8px !important;
}
button[class*="bg-secondary"]:hover {
	background: #24293a !important;
	color: #ffffff !important;
	border-color: rgba(255, 255, 255, 0.18) !important;
}

/* Small/Icon buttons in toolbars */
button[class*="size-"], button[class*="h-7 w-7"], button[class*="h-6"] {
	min-height: 30px !important;
	min-width: 30px !important;
	border-radius: 6px !important;
	padding: 4px !important;
}

/* Luxurious modern desktop input, textarea, and select boxes */
input[type="text"],
input[type="password"],
input[type="email"],
input[type="number"],
input[type="search"],
select {
	min-height: 38px !important;
	height: 38px !important;
	padding: 8px 12px !important;
	font-size: 13.5px !important;
	border-radius: 8px !important;
	border: 1px solid rgba(255, 255, 255, 0.12) !important;
	background-color: #12141d !important;
	color: #f8fafc !important;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
	transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
}

textarea {
	min-height: 48px !important;
	padding: 10px 14px !important;
	font-size: 14px !important;
	line-height: 1.5 !important;
	border-radius: 10px !important;
	border: 1px solid rgba(255, 255, 255, 0.12) !important;
	background-color: #12141d !important;
	color: #f8fafc !important;
}

input:focus,
select:focus,
textarea:focus {
	border-color: #3b82f6 !important;
	box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25) !important;
	outline: none !important;
}

/* Combobox / Dropdown triggers */
button[class*="combobox"], [role="combobox"] {
	min-height: 38px !important;
	padding: 8px 12px !important;
	border-radius: 8px !important;
	border: 1px solid rgba(255, 255, 255, 0.12) !important;
	background-color: #12141d !important;
	font-size: 13.5px !important;
}

/* Light theme overrides */
body.vscode-light button[class*="bg-secondary"] {
	background: #f1f5f9 !important;
	color: #1e293b !important;
	border: 1px solid #cbd5e1 !important;
}
body.vscode-light input[type="text"],
body.vscode-light input[type="password"],
body.vscode-light select,
body.vscode-light textarea {
	background-color: #ffffff !important;
	color: #0f172a !important;
	border: 1px solid #cbd5e1 !important;
}

/* Polished custom scrollbars */
::-webkit-scrollbar {
	width: 6px;
	height: 6px;
}
::-webkit-scrollbar-track {
	background: transparent;
}
::-webkit-scrollbar-thumb {
	background: rgba(150, 150, 150, 0.2);
	border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
	background: rgba(150, 150, 150, 0.35);
}
</style>
<script>
window.acquireVsCodeApi = function() {
	return {
		postMessage: function(message) {
			window.parent.postMessage(message, "*");
		},
		getState: function() {
			try { return JSON.parse(localStorage.getItem("vscodeState") || "{}"); } catch(e) { return {}; }
		},
		setState: function(state) {
			try { localStorage.setItem("vscodeState", JSON.stringify(state)); } catch(e) {}
			return state;
		}
	};
};

// Intercept state message to eliminate unwanted/weak Welcome View and land straight in Chat
window.addEventListener("message", function(e) {
	if (e.data && e.data.type === "state" && e.data.state) {
		e.data.state.showWelcome = false;
		if (!e.data.state.apiConfiguration || !e.data.state.apiConfiguration.apiKey) {
			e.data.state.apiConfiguration = e.data.state.apiConfiguration || {};
			if (!e.data.state.apiConfiguration.apiProvider) {
				e.data.state.apiConfiguration.apiProvider = "anthropic";
			}
			e.data.state.apiConfiguration.ollamaModelId = e.data.state.apiConfiguration.ollamaModelId ?? "auto";
		}
	}
}, true);

(function() {
	function syncTheme() {
		try {
			var theme = localStorage.getItem("roo-theme") || "dark";
			var cls = theme === "light" ? "vscode-light" : "vscode-dark";
			document.body.className = cls;
			document.body.setAttribute("data-vscode-theme-kind", cls);
			document.documentElement.className = cls;
		} catch(e) {}
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", syncTheme);
	} else {
		syncTheme();
	}
	window.addEventListener("message", function(e) {
		if (e.data && e.data.type === "themeChange") {
			var cls = e.data.theme === "light" ? "vscode-light" : "vscode-dark";
			document.body.className = cls;
			document.body.setAttribute("data-vscode-theme-kind", cls);
			document.documentElement.className = cls;
		}
	});
})();
</script>
`
					html = html.replace("<head>", `<head>${polyfillAndTheme}`)
					html = html.replace("<body>", `<body class="vscode-dark" data-vscode-theme-kind="vscode-dark">`)
					res.writeHead(200, { "Content-Type": contentType })
					res.end(html)
					return
				}

				res.writeHead(200, { "Content-Type": contentType })
				fs.createReadStream(targetWebviewPath).pipe(res)
				return
			}
		}

		// Serve static frontend assets
		if (staticDir && fs.existsSync(staticDir)) {
			let relativeFilePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "")
			let targetPath = path.join(staticDir, relativeFilePath)

			if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
				targetPath = path.join(staticDir, "index.html")
			}

			if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
				const ext = path.extname(targetPath).toLowerCase()
				const mimeTypes: Record<string, string> = {
					".html": "text/html; charset=utf-8",
					".js": "application/javascript; charset=utf-8",
					".mjs": "application/javascript; charset=utf-8",
					".css": "text/css; charset=utf-8",
					".json": "application/json; charset=utf-8",
					".png": "image/png",
					".jpg": "image/jpeg",
					".svg": "image/svg+xml",
					".ico": "image/x-icon",
					".woff": "font/woff",
					".woff2": "font/woff2",
					".ttf": "font/ttf",
				}
				const contentType = mimeTypes[ext] || "application/octet-stream"
				res.writeHead(200, { "Content-Type": contentType })
				fs.createReadStream(targetPath).pipe(res)
				return
			}
		}

		res.writeHead(404, { "Content-Type": "text/plain" })
		res.end("Not Found")
	})

	const wss = new WebSocketServer({ server, path: "/ws" })

	wss.on("connection", (ws) => {
		clients.add(ws)

		// Send initial state to newly connected client
		const wsPath = agentHost.getWorkspace()
		const initialWorkspace: WorkspaceInfo = {
			path: wsPath,
			name: path.basename(wsPath),
			branch: getGitBranch(wsPath),
			files: listWorkspaceFiles(wsPath),
		}
		ws.send(JSON.stringify({ type: "workspaceInfo", workspace: initialWorkspace }))
		ws.send(JSON.stringify({ type: "agentStatus", status: agentHost.getStatus() }))
		ws.send(JSON.stringify({ type: "diffsUpdated", diffs: agentHost.getDiffFiles() }))

		ws.on("message", (raw) => {
			try {
				const clientMsg = JSON.parse(raw.toString()) as DesktopClientMessage
				if (clientMsg.type === "webviewMessage") {
					agentHost.sendToExtension(clientMsg.message)
				} else if (clientMsg.type === "getWorkspaceInfo") {
					const curPath = agentHost.getWorkspace()
					ws.send(
						JSON.stringify({
							type: "workspaceInfo",
							workspace: {
								path: curPath,
								name: path.basename(curPath),
								branch: getGitBranch(curPath),
								files: listWorkspaceFiles(curPath),
							},
						}),
					)
				} else if (clientMsg.type === "selectFolder") {
					if (clientMsg.path && fs.existsSync(clientMsg.path)) {
						try {
							agentHost.setWorkspace(clientMsg.path)
							const curPath = agentHost.getWorkspace()
							const newWs: WorkspaceInfo = {
								path: curPath,
								name: path.basename(curPath),
								branch: getGitBranch(curPath),
								files: listWorkspaceFiles(curPath),
							}
							broadcast({ type: "workspaceInfo", workspace: newWs })
							broadcast({ type: "diffsUpdated", diffs: agentHost.getDiffFiles() })
						} catch (err) {
							ws.send(JSON.stringify({ type: "error", message: String(err) }))
						}
					} else {
						ws.send(JSON.stringify({ type: "error", message: `Folder does not exist: ${clientMsg.path}` }))
					}
				} else if (clientMsg.type === "readFile") {
					const wsRoot = path.resolve(agentHost.getWorkspace())
					const abs = path.isAbsolute(clientMsg.filePath)
						? path.resolve(clientMsg.filePath)
						: path.resolve(wsRoot, clientMsg.filePath)
					if (abs.startsWith(wsRoot) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
						try {
							const stat = fs.statSync(abs)
							const ext = path.extname(abs).toLowerCase()
							const mimeTypes: Record<string, string> = {
								".png": "image/png",
								".jpg": "image/jpeg",
								".jpeg": "image/jpeg",
								".gif": "image/gif",
								".webp": "image/webp",
								".ico": "image/x-icon",
								".bmp": "image/bmp",
								".svg": "image/svg+xml",
								".mp3": "audio/mpeg",
								".wav": "audio/wav",
								".ogg": "audio/ogg",
								".mp4": "video/mp4",
								".webm": "video/webm",
								".pdf": "application/pdf",
							}

							const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp"].includes(ext)
							const isSvg = ext === ".svg"
							const isMedia = [".mp3", ".wav", ".ogg", ".mp4", ".webm"].includes(ext)
							const isPdf = ext === ".pdf"

							if (isImage || isMedia || isPdf) {
								const buf = fs.readFileSync(abs)
								const mime = mimeTypes[ext] || "application/octet-stream"
								const dataUrl = `data:${mime};base64,${buf.toString("base64")}`
								ws.send(
									JSON.stringify({
										type: "fileContent",
										filePath: clientMsg.filePath,
										fileType: isImage ? "image" : isMedia ? "media" : "pdf",
										mimeType: mime,
										size: stat.size,
										content: dataUrl,
										fileName: path.basename(abs),
										ext: ext.replace(/^\./, ""),
									}),
								)
							} else if (isSvg) {
								const text = fs.readFileSync(abs, "utf-8")
								const mime = "image/svg+xml"
								const dataUrl = `data:${mime};base64,${Buffer.from(text).toString("base64")}`
								ws.send(
									JSON.stringify({
										type: "fileContent",
										filePath: clientMsg.filePath,
										fileType: "svg",
										mimeType: mime,
										size: stat.size,
										content: dataUrl,
										rawText: text,
										fileName: path.basename(abs),
										ext: "svg",
									}),
								)
							} else {
								// Detect binary by reading first 1024 bytes and checking for null bytes
								const fd = fs.openSync(abs, "r")
								const sample = Buffer.alloc(Math.min(1024, stat.size))
								fs.readSync(fd, sample, 0, sample.length, 0)
								fs.closeSync(fd)

								let isBinary = false
								for (let i = 0; i < sample.length; i++) {
									if (sample[i] === 0) {
										isBinary = true
										break
									}
								}

								if (isBinary || stat.size > 3 * 1024 * 1024) {
									ws.send(
										JSON.stringify({
											type: "fileContent",
											filePath: clientMsg.filePath,
											fileType: "binary",
											size: stat.size,
											fileName: path.basename(abs),
											ext: ext.replace(/^\./, ""),
											mtime: stat.mtimeMs,
										}),
									)
								} else {
									const content = fs.readFileSync(abs, "utf-8")
									ws.send(
										JSON.stringify({
											type: "fileContent",
											filePath: clientMsg.filePath,
											fileType: ext === ".md" ? "markdown" : ext === ".json" ? "json" : "text",
											size: stat.size,
											content,
											fileName: path.basename(abs),
											ext: ext.replace(/^\./, ""),
										}),
									)
								}
							}
						} catch (err) {
							ws.send(JSON.stringify({ type: "error", message: `Failed to read file: ${String(err)}` }))
						}
					} else {
						ws.send(JSON.stringify({ type: "error", message: "File not found or outside workspace" }))
					}
				} else if (clientMsg.type === "showItem" || clientMsg.type === "openFile") {
					const wsRoot = path.resolve(agentHost.getWorkspace())
					const abs = path.isAbsolute(clientMsg.filePath)
						? path.resolve(clientMsg.filePath)
						: path.resolve(wsRoot, clientMsg.filePath)
					if (abs.startsWith(wsRoot) && fs.existsSync(abs)) {
						try {
							if (process.platform === "win32") {
								if (clientMsg.type === "showItem") {
									exec(`explorer.exe /select,"${abs}"`, () => {})
								} else {
									exec(`start "" "${abs}"`, () => {})
								}
							}
						} catch {}
					}
				}
			} catch (err) {
				ws.send(JSON.stringify({ type: "error", message: String(err) }))
			}
		})

		ws.on("close", () => {
			clients.delete(ws)
		})
	})

	return {
		server,
		wss,
		start: () =>
			new Promise((resolve) => {
				server.listen(port, host, () => {
					const addr = server.address()
					const actualPort = typeof addr === "object" && addr ? addr.port : port
					resolve(actualPort)
				})
			}),
		stop: () =>
			new Promise((resolve) => {
				for (const client of clients) client.close()
				wss.close(() => {
					server.close(() => resolve())
				})
			}),
	}
}
