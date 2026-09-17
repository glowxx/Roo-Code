import http from "http"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { WebSocketServer, WebSocket } from "ws"
import { execSync } from "child_process"
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

function listWorkspaceFiles(dir: string, maxFiles = 150): string[] {
	const results: string[] = []
	function walk(currentDir: string, relPrefix = "") {
		if (results.length >= maxFiles) return
		let entries: fs.Dirent[] = []
		try {
			entries = fs.readdirSync(currentDir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (results.length >= maxFiles) break
			if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue
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
				const content = fs.readFileSync(absPath, "utf-8")
				res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
				res.end(content)
			} catch {
				res.writeHead(404, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "File not found" }))
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
					const polyfill = `
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
</script>
`
					html = html.replace("<head>", `<head>${polyfill}`)
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
					if (abs.startsWith(wsRoot) && fs.existsSync(abs)) {
						const content = fs.readFileSync(abs, "utf-8")
						ws.send(JSON.stringify({ type: "fileContent", filePath: clientMsg.filePath, content }))
					} else {
						ws.send(JSON.stringify({ type: "error", message: "File not found or outside workspace" }))
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
