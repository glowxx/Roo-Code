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

export interface PathValidationResult {
	safe: boolean
	resolvedPath?: string
	error?: string
}

function normalizeFsPath(p: string): string {
	let normalized = path.normalize(path.resolve(p))
	if (process.platform === "win32") {
		if (normalized.startsWith("\\\\?\\UNC\\")) {
			normalized = "\\\\" + normalized.slice(8)
		} else if (normalized.startsWith("\\\\?\\")) {
			normalized = normalized.slice(4)
		}
	}
	return normalized
}

/**
 * Validates that a requested path is strictly located within an allowed root directory.
 * - Prevents null byte injection
 * - Resolves relative paths (../)
 * - Resolves symlinks using realpath to prevent symlink traversal
 * - Ensures path boundary matching (prevents /parent-other starting with /parent)
 * - Handles Windows case-insensitivity, drive letter variations, and leading slash quirks
 */
export function validatePathWithinRoot(
	targetPath: string,
	allowedRoot: string,
	options: { allowExactRoot?: boolean } = {}
): PathValidationResult {
	if (!targetPath || typeof targetPath !== "string") {
		return { safe: false, error: "Path must be a non-empty string" }
	}

	// Guard against null bytes
	if (targetPath.includes("\0")) {
		return { safe: false, error: "Null byte detected in path" }
	}

	try {
		const resolvedRoot = normalizeFsPath(allowedRoot)
		const realRoot = normalizeFsPath(fs.existsSync(resolvedRoot) ? fs.realpathSync(resolvedRoot) : resolvedRoot)

		let cleanTarget = targetPath.trim()
		if (process.platform === "win32") {
			// On Windows, path.isAbsolute("/src/...") returns true!
			// If path starts with / or \ but is NOT a drive letter (e.g. C:\) and NOT a UNC path (\\server\share),
			// treat it as a relative path from the allowed root.
			const isWindowsDrive = /^[a-zA-Z]:[/\\]/.test(cleanTarget)
			const isUNC = cleanTarget.startsWith("\\\\") || cleanTarget.startsWith("//")
			if (!isWindowsDrive && !isUNC && (cleanTarget.startsWith("/") || cleanTarget.startsWith("\\"))) {
				cleanTarget = cleanTarget.replace(/^[/\\]+/, "")
			}
		}

		const absoluteTarget = path.isAbsolute(cleanTarget)
			? normalizeFsPath(cleanTarget)
			: normalizeFsPath(path.resolve(realRoot, cleanTarget))

		let realTarget = absoluteTarget
		if (fs.existsSync(absoluteTarget)) {
			try {
				realTarget = normalizeFsPath(fs.realpathSync(absoluteTarget))
			} catch {
				return { safe: false, error: "Failed to resolve real path" }
			}
		} else {
			// If file does not exist, verify nearest existing ancestor directory
			let checkDir = path.dirname(absoluteTarget)
			while (checkDir !== path.dirname(checkDir) && !fs.existsSync(checkDir)) {
				checkDir = path.dirname(checkDir)
			}
			if (fs.existsSync(checkDir)) {
				const realAncestor = normalizeFsPath(fs.realpathSync(checkDir))
				const normRoot = process.platform === "win32" ? realRoot.toLowerCase() : realRoot
				const normAncestor = process.platform === "win32" ? realAncestor.toLowerCase() : realAncestor
				const relToRoot = path.relative(normRoot, normAncestor)
				if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
					return { safe: false, error: "Path resolves outside allowed directory via symlink ancestor" }
				}
			}
		}

		const normalizedRoot = process.platform === "win32" ? realRoot.toLowerCase() : realRoot
		const normalizedTarget = process.platform === "win32" ? realTarget.toLowerCase() : realTarget

		if (options.allowExactRoot && normalizedTarget === normalizedRoot) {
			return { safe: true, resolvedPath: realTarget }
		}

		const relative = path.relative(normalizedRoot, normalizedTarget)
		const isInside = relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)

		if (!isInside) {
			return { safe: false, error: "Access outside allowed directory forbidden" }
		}

		return { safe: true, resolvedPath: realTarget }
	} catch (err) {
		return { safe: false, error: `Path validation error: ${err instanceof Error ? err.message : String(err)}` }
	}
}

export function getGitBranch(workspacePath: string): string | undefined {
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

export function listWorkspaceFiles(dir: string, maxFiles = 1000): string[] {
	if (!dir || typeof dir !== "string") return []

	let normalizedDir = ""
	try {
		normalizedDir = path.normalize(path.resolve(dir))
		if (!fs.existsSync(normalizedDir)) return []
		const stat = fs.statSync(normalizedDir)
		if (!stat.isDirectory()) return []
	} catch {
		return []
	}

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
			// Ignore directory read errors on Windows (permissions, etc.)
			return
		}

		const fileEntries: fs.Dirent[] = []
		const dirEntries: fs.Dirent[] = []

		for (const entry of entries) {
			if (results.length >= maxFiles) break
			try {
				const nameLower = entry.name.toLowerCase()
				if (IGNORED_SYSTEM_FILES.has(nameLower)) continue

				let isDirectory = false
				try {
					isDirectory = entry.isDirectory()
				} catch {
					isDirectory = false
				}

				let isFile = false
				try {
					isFile = entry.isFile()
				} catch {
					isFile = false
				}

				// If it's a symbolic link (e.g. symlink or junction on Windows) and neither returned true, try statSync safely
				if (!isDirectory && !isFile) {
					try {
						if (entry.isSymbolicLink()) {
							const targetStat = fs.statSync(path.join(currentDir, entry.name))
							isDirectory = targetStat.isDirectory()
							isFile = targetStat.isFile()
						}
					} catch {
						// Broken symlink, inaccessible junction, or permission denied
						continue
					}
				}

				if (isDirectory) {
					if (IGNORED_DIRS.has(entry.name) || IGNORED_DIRS.has(nameLower)) continue
					if (entry.name.startsWith(".") && entry.name !== ".github") continue
					dirEntries.push(entry)
				} else if (isFile) {
					fileEntries.push(entry)
				}
			} catch {
				continue
			}
		}

		try {
			fileEntries.sort((a, b) => a.name.localeCompare(b.name))
		} catch {
			// Fallback if sorting fails
		}

		for (const file of fileEntries) {
			if (results.length >= maxFiles) return
			const relPath = (relPrefix ? `${relPrefix}/${file.name}` : file.name).replace(/\\/g, "/")
			results.push(relPath)
		}

		try {
			dirEntries.sort((a, b) => a.name.localeCompare(b.name))
		} catch {
			// Fallback if sorting fails
		}

		for (const dir of dirEntries) {
			if (results.length >= maxFiles) return
			const relPath = (relPrefix ? `${relPrefix}/${dir.name}` : dir.name).replace(/\\/g, "/")
			const subDirPath = path.join(currentDir, dir.name)
			try {
				walk(subDirPath, relPath)
			} catch {
				// Prevent recursive failure from aborting outer scan
			}
		}
	}

	try {
		walk(normalizedDir)
	} catch {
		return results
	}

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
		const normalized = path.normalize(path.resolve(wsPath))
		const newWs: WorkspaceInfo = {
			path: normalized,
			name: path.basename(normalized),
			branch: getGitBranch(normalized),
			files: listWorkspaceFiles(normalized),
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
			let wsPath = ""
			try {
				const ws = agentHost.getWorkspace()
				if (ws) {
					wsPath = path.normalize(path.resolve(ws))
				}
			} catch {
				wsPath = ""
			}
			const files = wsPath ? listWorkspaceFiles(wsPath) : []
			const info: WorkspaceInfo = {
				path: wsPath,
				name: wsPath ? path.basename(wsPath) : "",
				branch: wsPath ? getGitBranch(wsPath) : undefined,
				files: Array.isArray(files) ? files : [],
			}
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify(info))
			return
		}

		if (pathname === "/api/files") {
			let files: string[] = []
			try {
				const ws = agentHost.getWorkspace()
				if (ws) {
					const wsPath = path.normalize(path.resolve(ws))
					files = listWorkspaceFiles(wsPath)
				}
			} catch {
				files = []
			}
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ files: Array.isArray(files) ? files : [] }))
			return
		}

		if (pathname === "/api/file") {
			const filePath = parsedUrl.searchParams.get("path")
			if (!filePath) {
				res.writeHead(400, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: "Missing path parameter" }))
				return
			}
			const wsRoot = path.normalize(path.resolve(agentHost.getWorkspace()))
			const validation = validatePathWithinRoot(filePath, wsRoot)

			// Path traversal check
			if (!validation.safe || !validation.resolvedPath) {
				res.writeHead(403, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ error: validation.error || "Access outside workspace forbidden" }))
				return
			}
			const absPath = validation.resolvedPath

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
				const fileStream = fs.createReadStream(absPath)
				fileStream.on("error", (err) => {
					if (!res.headersSent) {
						res.writeHead(500, { "Content-Type": "text/plain" })
						res.end("File read error")
					}
				})
				fileStream.pipe(res)
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

			const webviewValidation = validatePathWithinRoot(relWebviewPath, webviewBuildDir, { allowExactRoot: true })
			let targetWebviewPath = webviewValidation.safe && webviewValidation.resolvedPath
				? webviewValidation.resolvedPath
				: path.join(webviewBuildDir, "index.html")

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

	/* Dark Modern Tokens (Linear / Raycast tier) */
	--vscode-editor-background: #090a0f;
	--vscode-editor-foreground: #e4e7ec;
	--vscode-foreground: #f2f4f7;
	--vscode-descriptionForeground: #98a2b3;
	--vscode-disabledForeground: #667085;
	--vscode-errorForeground: #f04438;

	--vscode-input-background: #12141c;
	--vscode-input-foreground: #f8fafc;
	--vscode-input-border: rgba(255, 255, 255, 0.08);
	--vscode-input-placeholderForeground: #667085;
	--vscode-focusBorder: #3b82f6;

	--vscode-button-background: #2563eb;
	--vscode-button-foreground: #ffffff;
	--vscode-button-hoverBackground: #1d4ed8;
	--vscode-button-secondaryBackground: #181b26;
	--vscode-button-secondaryForeground: #f2f4f7;
	--vscode-button-secondaryHoverBackground: #222634;

	--vscode-dropdown-background: #12141c;
	--vscode-dropdown-foreground: #f8fafc;
	--vscode-dropdown-border: rgba(255, 255, 255, 0.08);
	--vscode-dropdown-listBackground: #0e1017;

	--vscode-menu-background: #12141c;
	--vscode-menu-foreground: #f8fafc;

	--vscode-list-hoverBackground: rgba(255, 255, 255, 0.06);
	--vscode-list-hoverForeground: #ffffff;
	--vscode-list-activeSelectionBackground: #2563eb;
	--vscode-list-activeSelectionForeground: #ffffff;

	--vscode-badge-background: #2563eb;
	--vscode-badge-foreground: #ffffff;

	--vscode-textLink-foreground: #60a5fa;
	--vscode-textLink-activeForeground: #93c5fd;
	--vscode-textCodeBlock-background: #06070a;

	--vscode-sideBar-background: #090a0f;
	--vscode-sideBar-foreground: #e4e7ec;
	--vscode-panel-border: rgba(255, 255, 255, 0.06);
	--vscode-editorGroup-border: rgba(255, 255, 255, 0.06);
	--vscode-widget-border: rgba(255, 255, 255, 0.06);
	--vscode-widget-shadow: rgba(0, 0, 0, 0.5);

	--vscode-scrollbarSlider-background: rgba(255, 255, 255, 0.12);
	--vscode-scrollbarSlider-hoverBackground: rgba(255, 255, 255, 0.25);
	--vscode-scrollbarSlider-activeBackground: rgba(255, 255, 255, 0.35);

	--vscode-charts-red: #f04438;
	--vscode-charts-blue: #3b82f6;
	--vscode-charts-yellow: #f79009;
	--vscode-charts-green: #12b76a;
	--vscode-charts-orange: #fb6514;
}

/* 2. OLED Black (Pure Black, Maximum Contrast) */
[data-theme="oled-black"] {
	--vscode-editor-background: #000000;
	--vscode-editor-foreground: #ffffff;
	--vscode-foreground: #ffffff;
	--vscode-descriptionForeground: #a1a1aa;
	--vscode-disabledForeground: #71717a;
	--vscode-input-background: #0a0a0a;
	--vscode-input-foreground: #ffffff;
	--vscode-input-border: rgba(255, 255, 255, 0.14);
	--vscode-focusBorder: #3b82f6;
	--vscode-button-background: #2563eb;
	--vscode-button-foreground: #ffffff;
	--vscode-button-hoverBackground: #1d4ed8;
	--vscode-button-secondaryBackground: #121212;
	--vscode-button-secondaryForeground: #ffffff;
	--vscode-dropdown-background: #0a0a0a;
	--vscode-dropdown-foreground: #ffffff;
	--vscode-dropdown-border: rgba(255, 255, 255, 0.14);
	--vscode-sideBar-background: #000000;
	--vscode-sideBar-foreground: #ffffff;
	--vscode-panel-border: rgba(255, 255, 255, 0.12);
	--vscode-editorGroup-border: rgba(255, 255, 255, 0.12);
	--vscode-badge-background: #2563eb;
	--vscode-textLink-foreground: #60a5fa;
	--vscode-textCodeBlock-background: #050505;
}

/* 3. Midnight Navy (GitHub Dark Dimmed Tone) */
[data-theme="midnight-navy"] {
	--vscode-editor-background: #0d1117;
	--vscode-editor-foreground: #e6edf3;
	--vscode-foreground: #e6edf3;
	--vscode-descriptionForeground: #8b949e;
	--vscode-disabledForeground: #6e7681;
	--vscode-input-background: #161b22;
	--vscode-input-foreground: #e6edf3;
	--vscode-input-border: rgba(240, 246, 252, 0.12);
	--vscode-focusBorder: #58a6ff;
	--vscode-button-background: #1f6feb;
	--vscode-button-foreground: #ffffff;
	--vscode-button-hoverBackground: #388bfd;
	--vscode-button-secondaryBackground: #21262d;
	--vscode-button-secondaryForeground: #e6edf3;
	--vscode-dropdown-background: #161b22;
	--vscode-dropdown-foreground: #e6edf3;
	--vscode-dropdown-border: rgba(240, 246, 252, 0.12);
	--vscode-sideBar-background: #0d1117;
	--vscode-sideBar-foreground: #e6edf3;
	--vscode-panel-border: rgba(240, 246, 252, 0.1);
	--vscode-editorGroup-border: rgba(240, 246, 252, 0.1);
	--vscode-badge-background: #1f6feb;
	--vscode-textLink-foreground: #58a6ff;
	--vscode-textCodeBlock-background: #090d12;
}

/* 4. Cyberpunk (Cool Graphite with Neon Cyan) */
[data-theme="cyberpunk"] {
	--vscode-editor-background: #090d16;
	--vscode-editor-foreground: #f1f5f9;
	--vscode-foreground: #f1f5f9;
	--vscode-descriptionForeground: #94a3b8;
	--vscode-disabledForeground: #64748b;
	--vscode-input-background: #0f172a;
	--vscode-input-foreground: #f1f5f9;
	--vscode-input-border: rgba(0, 240, 255, 0.2);
	--vscode-focusBorder: #00f0ff;
	--vscode-button-background: #00b4d8;
	--vscode-button-foreground: #090d16;
	--vscode-button-hoverBackground: #00f0ff;
	--vscode-button-secondaryBackground: #1e293b;
	--vscode-button-secondaryForeground: #00f0ff;
	--vscode-dropdown-background: #0f172a;
	--vscode-dropdown-foreground: #f1f5f9;
	--vscode-dropdown-border: rgba(0, 240, 255, 0.2);
	--vscode-sideBar-background: #090d16;
	--vscode-sideBar-foreground: #f1f5f9;
	--vscode-panel-border: rgba(0, 240, 255, 0.15);
	--vscode-editorGroup-border: rgba(0, 240, 255, 0.15);
	--vscode-badge-background: #00f0ff;
	--vscode-badge-foreground: #090d16;
	--vscode-textLink-foreground: #00f0ff;
	--vscode-textCodeBlock-background: #06090e;
}

/* 5. Clean Light (Warm Paper Slate) */
body.vscode-light,
[data-theme="clean-light"] {
	/* Warm paper slate anti-glare background */
	--vscode-editor-background: #f8fafc;
	--vscode-editor-foreground: #0f172a;
	--vscode-foreground: #0f172a;
	--vscode-descriptionForeground: #475569;
	--vscode-disabledForeground: #94a3b8;
	--vscode-errorForeground: #dc2626;

	--vscode-input-background: #ffffff;
	--vscode-input-foreground: #0f172a;
	--vscode-input-border: rgba(0, 0, 0, 0.12);
	--vscode-input-placeholderForeground: #94a3b8;
	--vscode-focusBorder: #2563eb;

	--vscode-button-background: #2563eb;
	--vscode-button-foreground: #ffffff;
	--vscode-button-hoverBackground: #1d4ed8;
	--vscode-button-secondaryBackground: #e2e8f0;
	--vscode-button-secondaryForeground: #1e293b;
	--vscode-button-secondaryHoverBackground: #cbd5e1;

	--vscode-dropdown-background: #ffffff;
	--vscode-dropdown-foreground: #0f172a;
	--vscode-dropdown-border: rgba(0, 0, 0, 0.12);
	--vscode-dropdown-listBackground: #ffffff;

	--vscode-menu-background: #ffffff;
	--vscode-menu-foreground: #0f172a;

	--vscode-list-hoverBackground: rgba(0, 0, 0, 0.05);
	--vscode-list-hoverForeground: #0f172a;
	--vscode-list-activeSelectionBackground: #2563eb;
	--vscode-list-activeSelectionForeground: #ffffff;

	--vscode-badge-background: #2563eb;
	--vscode-badge-foreground: #ffffff;

	--vscode-textLink-foreground: #2563eb;
	--vscode-textLink-activeForeground: #1d4ed8;
	--vscode-textCodeBlock-background: #e2e8f0;

	--vscode-sideBar-background: #f8fafc;
	--vscode-sideBar-foreground: #0f172a;
	--vscode-panel-border: rgba(0, 0, 0, 0.08);
	--vscode-editorGroup-border: rgba(0, 0, 0, 0.08);
	--vscode-widget-border: rgba(0, 0, 0, 0.08);
	--vscode-widget-shadow: rgba(15, 23, 42, 0.08);

	--vscode-scrollbarSlider-background: rgba(0, 0, 0, 0.15);
	--vscode-scrollbarSlider-hoverBackground: rgba(0, 0, 0, 0.28);
	--vscode-scrollbarSlider-activeBackground: rgba(0, 0, 0, 0.4);
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
		if (!e.data.state.apiConfiguration || (!e.data.state.apiConfiguration.apiKey && !e.data.state.apiConfiguration.xkiroApiKey)) {
			e.data.state.apiConfiguration = e.data.state.apiConfiguration || {};
			if (!e.data.state.apiConfiguration.apiProvider) {
				e.data.state.apiConfiguration.apiProvider = "xkiro";
			}
			e.data.state.apiConfiguration.ollamaModelId = e.data.state.apiConfiguration.ollamaModelId ?? "auto";
		}
	}
}, true);

(function() {
	function syncTheme() {
		try {
			var theme = localStorage.getItem("roo-theme") || "linear-dark";
			var isLight = theme === "clean-light" || theme === "light";
			var cls = isLight ? "vscode-light" : "vscode-dark";
			document.body.className = cls;
			document.body.setAttribute("data-vscode-theme-kind", cls);
			document.documentElement.className = cls;
			document.documentElement.setAttribute("data-theme", theme);
			document.body.setAttribute("data-theme", theme);
		} catch(e) {}
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", syncTheme);
	} else {
		syncTheme();
	}
	window.addEventListener("message", function(e) {
		if (e.data && e.data.type === "themeChange") {
			var theme = e.data.theme || "linear-dark";
			var isLight = theme === "clean-light" || theme === "light";
			var cls = isLight ? "vscode-light" : "vscode-dark";
			document.body.className = cls;
			document.body.setAttribute("data-vscode-theme-kind", cls);
			document.documentElement.className = cls;
			document.documentElement.setAttribute("data-theme", theme);
			document.body.setAttribute("data-theme", theme);
			try { localStorage.setItem("roo-theme", theme); } catch(err) {}
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
				const fileStream = fs.createReadStream(targetWebviewPath)
				fileStream.on("error", (err) => {
					if (!res.headersSent) {
						res.writeHead(500, { "Content-Type": "text/plain" })
						res.end("File read error")
					}
				})
				fileStream.pipe(res)
				return
			}
		}

		// Serve static frontend assets
		if (staticDir && fs.existsSync(staticDir)) {
			let relativeFilePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "")
			const staticValidation = validatePathWithinRoot(relativeFilePath, staticDir, { allowExactRoot: true })
			let targetPath = staticValidation.safe && staticValidation.resolvedPath
				? staticValidation.resolvedPath
				: path.join(staticDir, "index.html")

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
				const fileStream = fs.createReadStream(targetPath)
				fileStream.on("error", (err) => {
					if (!res.headersSent) {
						res.writeHead(500, { "Content-Type": "text/plain" })
						res.end("File read error")
					}
				})
				fileStream.pipe(res)
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
		let wsPath = ""
		try {
			const rawWs = agentHost.getWorkspace()
			if (rawWs) {
				wsPath = path.normalize(path.resolve(rawWs))
			}
		} catch {
			wsPath = ""
		}
		const initialFiles = wsPath ? listWorkspaceFiles(wsPath) : []
		const initialWorkspace: WorkspaceInfo = {
			path: wsPath,
			name: wsPath ? path.basename(wsPath) : "",
			branch: wsPath ? getGitBranch(wsPath) : undefined,
			files: Array.isArray(initialFiles) ? initialFiles : [],
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
					let curPath = ""
					try {
						const rawWs = agentHost.getWorkspace()
						if (rawWs) {
							curPath = path.normalize(path.resolve(rawWs))
						}
					} catch {
						curPath = ""
					}
					const files = curPath ? listWorkspaceFiles(curPath) : []
					ws.send(
						JSON.stringify({
							type: "workspaceInfo",
							workspace: {
								path: curPath,
								name: curPath ? path.basename(curPath) : "",
								branch: curPath ? getGitBranch(curPath) : undefined,
								files: Array.isArray(files) ? files : [],
							},
						}),
					)
				} else if (clientMsg.type === "selectFolder") {
					if (clientMsg.path && fs.existsSync(clientMsg.path)) {
						try {
							const normalized = path.normalize(path.resolve(clientMsg.path))
							agentHost.setWorkspace(normalized)
							const curPath = path.normalize(path.resolve(agentHost.getWorkspace()))
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
					const wsRoot = path.normalize(path.resolve(agentHost.getWorkspace()))
					const validation = validatePathWithinRoot(clientMsg.filePath, wsRoot)
					if (!validation.safe || !validation.resolvedPath) {
						ws.send(JSON.stringify({ type: "error", message: validation.error || "Access outside workspace forbidden" }))
						return
					}
					const abs = validation.resolvedPath
					if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
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
								let fd: number | undefined
								let sample: Buffer
								try {
									fd = fs.openSync(abs, "r")
									sample = Buffer.alloc(Math.min(1024, stat.size))
									fs.readSync(fd, sample, 0, sample.length, 0)
								} finally {
									if (fd !== undefined) {
										fs.closeSync(fd)
									}
								}

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
					const wsRoot = path.normalize(path.resolve(agentHost.getWorkspace()))
					const validation = validatePathWithinRoot(clientMsg.filePath, wsRoot)
					if (validation.safe && validation.resolvedPath && fs.existsSync(validation.resolvedPath)) {
						const abs = validation.resolvedPath
						try {
							if (process.platform === "win32") {
								if (clientMsg.type === "showItem") {
									exec(`explorer.exe /select,"${abs}"`, () => {})
								} else {
									exec(`start "" "${abs}"`, () => {})
								}
							}
						} catch {}
					} else {
						ws.send(JSON.stringify({ type: "error", message: validation.error || "Access outside workspace forbidden" }))
					}
				} else if (clientMsg.type === "getDiffs") {
					ws.send(JSON.stringify({ type: "diffsUpdated", diffs: agentHost.getDiffFiles() }))
				} else if (clientMsg.type === "clearTerminalLogs") {
					if (typeof (agentHost as any).clearTerminalLogs === "function") {
						;(agentHost as any).clearTerminalLogs()
					}
					ws.send(JSON.stringify({ type: "diffsUpdated", diffs: agentHost.getDiffFiles() }))
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
