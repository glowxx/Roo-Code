// Roo Code Desktop Client Application
(() => {
	// State
	let socket = null
	let currentWorkspace = null
	let terminalLogs = []
	let diffFiles = []
	let selectedDiffFile = null
	let selectedPreviewFile = null
	let isConnected = false

	// DOM Elements
	const workspaceNameEl = document.getElementById("workspace-name")
	const openFolderBtn = document.getElementById("open-folder-btn")
	const gitPill = document.getElementById("git-pill")
	const gitBranchEl = document.getElementById("git-branch")
	const agentStatusBadge = document.getElementById("agent-status-badge")
	const statusTextEl = document.getElementById("status-text")
	const diffsCountEl = document.getElementById("diffs-count")
	const terminalCountEl = document.getElementById("terminal-count")
	const footerWorkspaceEl = document.getElementById("footer-workspace-path")
	const connectionStatusEl = document.getElementById("connection-status")
	const webviewFrame = document.getElementById("webview-frame")
	const themeToggleBtn = document.getElementById("theme-toggle")

	// Diffs elements
	const diffsFileListEl = document.getElementById("diffs-file-list")
	const diffFileCounterEl = document.getElementById("diff-file-counter")
	const diffViewerHeaderEl = document.getElementById("diff-viewer-header")
	const diffContentEl = document.getElementById("diff-content")

	// Terminal elements
	const terminalOutputEl = document.getElementById("terminal-output")
	const clearTerminalBtn = document.getElementById("clear-terminal-btn")

	// Files elements
	const filesTreeEl = document.getElementById("files-tree")
	const filesSearchInput = document.getElementById("files-search")
	const previewFileIconEl = document.getElementById("preview-file-icon")
	const previewFilenameEl = document.getElementById("preview-filename")
	const previewFileBadgeEl = document.getElementById("preview-file-badge")
	const previewFileSizeEl = document.getElementById("preview-file-size")
	const previewHeaderActionsEl = document.getElementById("preview-header-actions")
	const previewCopyBtn = document.getElementById("preview-copy-btn")
	const previewToggleWrapBtn = document.getElementById("preview-toggle-wrap-btn")
	const previewToggleViewBtn = document.getElementById("preview-toggle-view-btn")
	const previewOpenExternalBtn = document.getElementById("preview-open-external-btn")
	const previewContentAreaEl = document.getElementById("preview-content-area")

	let currentPreviewMsg = null
	let isCodeWrapped = false
	let isSvgSourceView = false

	// Setup Tabs Navigation
	const tabs = document.querySelectorAll(".nav-tab")
	const panels = document.querySelectorAll(".tab-panel")

	tabs.forEach((tab) => {
		tab.addEventListener("click", () => {
			const targetTab = tab.getAttribute("data-tab")
			tabs.forEach((t) => t.classList.remove("active"))
			panels.forEach((p) => p.classList.remove("active"))

			tab.classList.add("active")
			const targetPanel = document.getElementById(`tab-${targetTab}`)
			if (targetPanel) targetPanel.classList.add("active")
		})
	})

	// Theme Toggle
	let currentTheme = localStorage.getItem("roo-theme") || "dark"
	if (currentTheme === "light") {
		document.body.classList.remove("dark-theme")
		document.body.classList.add("light-theme")
		updateThemeIcons(true)
	}

	themeToggleBtn.addEventListener("click", () => {
		const isLight = document.body.classList.contains("light-theme")
		const nextTheme = isLight ? "dark" : "light"
		if (isLight) {
			document.body.classList.remove("light-theme")
			document.body.classList.add("dark-theme")
			localStorage.setItem("roo-theme", "dark")
			updateThemeIcons(false)
		} else {
			document.body.classList.remove("dark-theme")
			document.body.classList.add("light-theme")
			localStorage.setItem("roo-theme", "light")
			updateThemeIcons(true)
		}
		if (webviewFrame?.contentWindow) {
			webviewFrame.contentWindow.postMessage({ type: "themeChange", theme: nextTheme }, "*")
		}
	})

	if (webviewFrame) {
		webviewFrame.addEventListener("load", () => {
			const theme = localStorage.getItem("roo-theme") || "dark"
			webviewFrame.contentWindow?.postMessage({ type: "themeChange", theme }, "*")
		})
	}

	function updateThemeIcons(isLight) {
		const moon = document.querySelector(".moon-icon")
		const sun = document.querySelector(".sun-icon")
		if (isLight) {
			moon.style.display = "none"
			sun.style.display = "block"
		} else {
			moon.style.display = "block"
			sun.style.display = "none"
		}
	}

	// Folder Selection
	openFolderBtn.addEventListener("click", () => {
		if (window.__desktopAPI?.selectFolder) {
			window.__desktopAPI.selectFolder().then((newPath) => {
				if (newPath) {
					sendToServer({ type: "getWorkspaceInfo" })
				}
			})
		} else {
			const newPath = prompt("Enter full path of folder to open:", currentWorkspace?.path || "")
			if (newPath && newPath.trim()) {
				sendToServer({ type: "selectFolder", path: newPath.trim() })
			}
		}
	})

	// Clear Terminal
	clearTerminalBtn.addEventListener("click", () => {
		terminalLogs = []
		renderTerminalLogs()
		terminalCountEl.textContent = "0"
	})

	// Files Search Filter
	filesSearchInput.addEventListener("input", (e) => {
		const filter = e.target.value.toLowerCase()
		renderFilesTree(filter)
	})

	// Setup Bidirectional Bridge with Iframe
	window.addEventListener("message", (event) => {
		// Only listen to messages from the webview iframe
		if (event.source === webviewFrame?.contentWindow) {
			const data = event.data
			if (data) {
				sendToServer({ type: "webviewMessage", message: data })
			}
		}
	})

	function forwardToWebview(msg) {
		if (webviewFrame?.contentWindow) {
			webviewFrame.contentWindow.postMessage(msg, "*")
		}
	}

	// Listen to Electron IPC messages if running inside Electron
	if (window.__desktopAPI?.onExtensionMessage) {
		window.__desktopAPI.onExtensionMessage((msg) => {
			if (msg && typeof msg === "object") {
				handleServerMessage(msg)
			}
		})
	}

	// WebSocket connection to Agent Engine
	function connectWebSocket() {
		const protocol = location.protocol === "https:" ? "wss:" : "ws:"
		const wsUrl = `${protocol}//${location.host}/ws`

		socket = new WebSocket(wsUrl)

		socket.onopen = () => {
			isConnected = true
			connectionStatusEl.textContent = "Connected to Engine"
			connectionStatusEl.parentElement.querySelector(".indicator-dot").style.background = "var(--success)"
			sendToServer({ type: "getWorkspaceInfo" })
		}

		socket.onmessage = (event) => {
			try {
				const serverMsg = JSON.parse(event.data)
				handleServerMessage(serverMsg)
			} catch (err) {
				console.error("Error parsing server message:", err)
			}
		}

		socket.onclose = () => {
			isConnected = false
			connectionStatusEl.textContent = "Disconnected (Reconnecting...)"
			connectionStatusEl.parentElement.querySelector(".indicator-dot").style.background = "var(--danger)"
			setTimeout(connectWebSocket, 2000)
		}

		socket.onerror = (err) => {
			console.error("WebSocket error:", err)
		}
	}

	function sendToServer(msg) {
		if (window.__desktopAPI?.isElectron && msg.type === "webviewMessage") {
			window.__desktopAPI.sendToExtension(msg.message)
			return
		}
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(msg))
		}
	}

	function handleServerMessage(msg) {
		switch (msg.type) {
			case "extensionMessage":
				forwardToWebview(msg.message)
				break

			case "workspaceInfo":
				currentWorkspace = msg.workspace
				renderWorkspaceInfo(msg.workspace)
				break

			case "agentStatus":
				updateAgentStatus(msg.status)
				break

			case "terminalLog":
				terminalLogs.push(msg.entry)
				if (terminalLogs.length > 100) terminalLogs.shift()
				renderTerminalLogs()
				terminalCountEl.textContent = String(terminalLogs.length)
				break

			case "diffsUpdated":
				diffFiles = msg.diffs || []
				renderDiffs()
				diffsCountEl.textContent = String(diffFiles.length)
				break

			case "fileContent":
				if (msg.filePath === selectedPreviewFile) {
					renderFilePreview(msg)
				}
				break
		}
	}

	function updateAgentStatus(status) {
		agentStatusBadge.className = `agent-status-badge status-${status}`
		const labels = {
			idle: "Idle",
			thinking: "Thinking...",
			executing: "Running Command...",
			waiting_approval: "Waiting for Approval",
			error: "Error",
		}
		statusTextEl.textContent = labels[status] || status
	}

	function renderWorkspaceInfo(ws) {
		if (!ws) return
		workspaceNameEl.textContent = ws.name || ws.path
		workspaceNameEl.title = ws.path
		footerWorkspaceEl.textContent = `Path: ${ws.path}`

		if (ws.branch) {
			gitPill.style.display = "flex"
			gitBranchEl.textContent = ws.branch
		} else {
			gitPill.style.display = "none"
		}

		renderFilesTree()
	}

	function renderDiffs() {
		diffFileCounterEl.textContent = `${diffFiles.length} file${diffFiles.length === 1 ? "" : "s"}`
		if (diffFiles.length === 0) {
			diffsFileListEl.innerHTML = '<div class="empty-state">No changes made by the agent yet.</div>'
			diffContentEl.innerHTML = `
				<div class="diff-placeholder">
					<p>When Roo Code modifies files in this workspace, you can inspect the diffs here.</p>
				</div>
			`
			return
		}

		diffsFileListEl.innerHTML = ""
		diffFiles.forEach((file) => {
			const item = document.createElement("div")
			item.className = `diff-item ${selectedDiffFile === file.filePath ? "selected" : ""}`
			item.innerHTML = `
				<span>${file.filePath}</span>
				<div class="diff-stats">
					<span class="add">+${file.additions}</span>
					<span class="del">-${file.deletions}</span>
				</div>
			`
			item.addEventListener("click", () => {
				selectedDiffFile = file.filePath
				renderDiffs()
				renderSelectedDiff(file)
			})
			diffsFileListEl.appendChild(item)
		})

		if (!selectedDiffFile && diffFiles.length > 0) {
			selectedDiffFile = diffFiles[0].filePath
			renderSelectedDiff(diffFiles[0])
		}
	}

	function computeLCSDiff(oldLines, newLines) {
		const m = oldLines.length
		const n = newLines.length
		if (m > 1200 || n > 1200) {
			const result = []
			const max = Math.max(m, n)
			for (let i = 0; i < max; i++) {
				const o = oldLines[i]
				const nw = newLines[i]
				if (o !== undefined && nw !== undefined) {
					if (o === nw) result.push({ type: "same", line: o, oldNum: i + 1, newNum: i + 1 })
					else {
						result.push({ type: "del", line: o, oldNum: i + 1 })
						result.push({ type: "add", line: nw, newNum: i + 1 })
					}
				} else if (o !== undefined) {
					result.push({ type: "del", line: o, oldNum: i + 1 })
				} else if (nw !== undefined) {
					result.push({ type: "add", line: nw, newNum: i + 1 })
				}
			}
			return result
		}

		const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
		for (let i = 0; i < m; i++) {
			for (let j = 0; j < n; j++) {
				if (oldLines[i] === newLines[j]) {
					dp[i + 1][j + 1] = dp[i][j] + 1
				} else {
					dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1])
				}
			}
		}

		let i = m, j = n
		const result = []
		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
				result.push({ type: "same", line: oldLines[i - 1], oldNum: i, newNum: j })
				i--
				j--
			} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
				result.push({ type: "add", line: newLines[j - 1], newNum: j })
				j--
			} else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
				result.push({ type: "del", line: oldLines[i - 1], oldNum: i })
				i--
			}
		}
		return result.reverse()
	}

	function renderSelectedDiff(file) {
		diffViewerHeaderEl.innerHTML = `<span class="diff-filename">${escapeHtml(file.filePath)} &nbsp;·&nbsp; <span style="text-transform: capitalize; color: var(--text-primary); font-weight: 600;">${escapeHtml(file.status)}</span></span>`
		if (!file.newContent && !file.oldContent) {
			diffContentEl.innerHTML = '<div class="empty-state">File content not available</div>'
			return
		}

		if (file.oldContent && file.newContent && file.oldContent !== file.newContent) {
			const oldLines = file.oldContent.split("\n")
			const newLines = file.newContent.split("\n")
			const diffItems = computeLCSDiff(oldLines, newLines)
			let html = ""
			diffItems.forEach((item) => {
				if (item.type === "same") {
					html += `<div class="diff-line"><span class="diff-gutter">${item.newNum || item.oldNum}</span>  ${escapeHtml(item.line)}</div>`
				} else if (item.type === "del") {
					html += `<div class="diff-line deletion"><span class="diff-gutter">${item.oldNum}</span>- ${escapeHtml(item.line)}</div>`
				} else if (item.type === "add") {
					html += `<div class="diff-line addition"><span class="diff-gutter">${item.newNum}</span>+ ${escapeHtml(item.line)}</div>`
				}
			})
			diffContentEl.innerHTML = html
		} else {
			const lines = (file.newContent || file.oldContent || "").split("\n")
			let html = ""
			lines.forEach((line, idx) => {
				html += `<div class="diff-line addition"><span class="diff-gutter">${idx + 1}</span>+ ${escapeHtml(line)}</div>`
			})
			diffContentEl.innerHTML = html
		}
	}

	function renderTerminalLogs() {
		if (terminalLogs.length === 0) {
			terminalOutputEl.innerHTML = '<div class="terminal-empty">Terminal output from tools and commands executed by Roo Code will appear here.</div>'
			return
		}

		let html = ""
		terminalLogs.slice().reverse().forEach((log) => {
			const time = new Date(log.timestamp).toLocaleTimeString()
			html += `
				<div class="terminal-log-card">
					<div class="terminal-card-header">
						<span class="terminal-cmd">$ ${escapeHtml(log.command)}</span>
						<span>${time}</span>
					</div>
					<div class="terminal-cmd-body">${escapeHtml(log.output)}</div>
				</div>
			`
		})
		terminalOutputEl.innerHTML = html
	}

	function formatBytes(bytes, decimals = 1) {
		if (!bytes || bytes === 0) return "0 B"
		const k = 1024
		const dm = decimals < 0 ? 0 : decimals
		const sizes = ["B", "KB", "MB", "GB", "TB"]
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
	}

	function getFileIconInfo(filePath) {
		const ext = filePath.split(".").pop()?.toLowerCase() || ""
		switch (ext) {
			case "png":
			case "jpg":
			case "jpeg":
			case "gif":
			case "webp":
			case "ico":
			case "bmp":
				return {
					icon: `<svg class="file-icon icon-image" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
					type: "image",
					badge: ext.toUpperCase(),
				}
			case "svg":
				return {
					icon: `<svg class="file-icon icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
					type: "svg",
					badge: "SVG",
				}
			case "ts":
			case "tsx":
				return {
					icon: `<svg class="file-icon icon-ts" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
					type: "ts",
					badge: ext.toUpperCase(),
				}
			case "js":
			case "jsx":
			case "mjs":
			case "cjs":
				return {
					icon: `<svg class="file-icon icon-js" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
					type: "js",
					badge: ext.toUpperCase(),
				}
			case "json":
				return {
					icon: `<svg class="file-icon icon-json" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6c0-1.1.9-2 2-2h2v4H6a2 2 0 0 1-2-2z"></path><path d="M20 6c0-1.1-.9-2-2-2h-2v4h2a2 2 0 0 1 2-2z"></path><path d="M4 18c0 1.1.9 2 2 2h2v-4H6a2 2 0 0 0-2 2z"></path><path d="M20 18c0 1.1-.9 2-2 2h-2v-4h2a2 2 0 0 0 2 2z"></path></svg>`,
					type: "json",
					badge: "JSON",
				}
			case "md":
			case "markdown":
				return {
					icon: `<svg class="file-icon icon-md" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
					type: "md",
					badge: "MD",
				}
			case "html":
				return {
					icon: `<svg class="file-icon icon-html" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
					type: "html",
					badge: "HTML",
				}
			case "css":
			case "scss":
			case "less":
				return {
					icon: `<svg class="file-icon icon-css" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>`,
					type: "css",
					badge: "CSS",
				}
			case "bat":
			case "cmd":
			case "sh":
			case "ps1":
				return {
					icon: `<svg class="file-icon icon-script" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
					type: "script",
					badge: ext.toUpperCase(),
				}
			case "pdf":
				return {
					icon: `<svg class="file-icon icon-pdf" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
					type: "pdf",
					badge: "PDF",
				}
			case "zip":
			case "tar":
			case "gz":
			case "7z":
			case "rar":
				return {
					icon: `<svg class="file-icon icon-zip" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>`,
					type: "archive",
					badge: ext.toUpperCase(),
				}
			case "exe":
			case "dll":
			case "bin":
			case "msi":
			case "pak":
				return {
					icon: `<svg class="file-icon icon-exe" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><circle cx="12" cy="12" r="3"></circle></svg>`,
					type: "binary",
					badge: ext.toUpperCase(),
				}
			default:
				return {
					icon: `<svg class="file-icon icon-doc" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`,
					type: "text",
					badge: ext ? ext.toUpperCase() : "FILE",
				}
		}
	}

	function renderFilesTree(filter = "") {
		const files = currentWorkspace?.files || []
		const filtered = filter ? files.filter((f) => f.toLowerCase().includes(filter)) : files

		if (filtered.length === 0) {
			filesTreeEl.innerHTML = '<div class="empty-state">No files found</div>'
			return
		}

		let html = ""
		filtered.forEach((f) => {
			const isSelected = selectedPreviewFile === f ? "selected" : ""
			const parts = f.split("/")
			const fileName = parts.pop() || f
			const dirPath = parts.join("/")
			const iconInfo = getFileIconInfo(f)
			html += `
				<div class="file-node ${isSelected}" data-path="${escapeHtml(f)}" title="${escapeHtml(f)}">
					${iconInfo.icon}
					<span class="file-name">${escapeHtml(fileName)}</span>
					${dirPath ? `<span class="file-dir">${escapeHtml(dirPath)}</span>` : ""}
				</div>
			`
		})
		filesTreeEl.innerHTML = html

		filesTreeEl.querySelectorAll(".file-node").forEach((node) => {
			node.addEventListener("click", () => {
				const path = node.getAttribute("data-path")
				selectedPreviewFile = path
				previewFilenameEl.textContent = path
				previewContentAreaEl.innerHTML = '<div class="preview-placeholder"><p>Loading file preview...</p></div>'
				sendToServer({ type: "readFile", filePath: path })
				renderFilesTree(filesSearchInput.value.toLowerCase())
			})
		})
	}

	function renderFilePreview(msg) {
		currentPreviewMsg = msg
		const iconInfo = getFileIconInfo(msg.filePath)

		previewFileIconEl.innerHTML = iconInfo.icon
		previewFilenameEl.textContent = msg.fileName || msg.filePath
		previewFileBadgeEl.textContent = iconInfo.badge
		previewFileBadgeEl.style.display = "inline-block"
		previewFileSizeEl.textContent = msg.size !== undefined ? `• ${formatBytes(msg.size)}` : ""
		previewHeaderActionsEl.style.display = "flex"

		// Reset view toggles
		previewToggleViewBtn.style.display = msg.fileType === "svg" ? "inline-flex" : "none"
		previewToggleWrapBtn.style.display = (msg.fileType === "text" || msg.fileType === "markdown" || msg.fileType === "json" || msg.fileType === "svg") ? "inline-flex" : "none"

		if (msg.fileType === "image") {
			previewContentAreaEl.innerHTML = `
				<div class="image-preview-stage">
					<div class="image-viewport">
						<div class="image-checkerboard">
							<img src="${msg.content}" class="preview-img" id="preview-img-target" alt="${escapeHtml(msg.fileName || '')}" />
						</div>
					</div>
					<div class="image-meta-bar">
						<span id="img-dim-text">Loading dimensions...</span>
						<span class="meta-sep">•</span>
						<span>${formatBytes(msg.size)}</span>
						<span class="meta-sep">•</span>
						<span>${msg.mimeType || 'image'}</span>
					</div>
				</div>
			`
			const imgEl = document.getElementById("preview-img-target")
			if (imgEl) {
				imgEl.onload = () => {
					const dimEl = document.getElementById("img-dim-text")
					if (dimEl) dimEl.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight} px`
				}
			}
		} else if (msg.fileType === "svg") {
			isSvgSourceView = false
			renderSvgPreview()
		} else if (msg.fileType === "media") {
			const isVideo = [".mp4", ".webm"].some((ext) => (msg.filePath || "").toLowerCase().endsWith(ext))
			if (isVideo) {
				previewContentAreaEl.innerHTML = `
					<div class="media-preview-container">
						<video controls src="${msg.content}" class="preview-media-video"></video>
					</div>
				`
			} else {
				previewContentAreaEl.innerHTML = `
					<div class="media-preview-container">
						<audio controls src="${msg.content}" class="preview-media-audio"></audio>
					</div>
				`
			}
		} else if (msg.fileType === "pdf") {
			previewContentAreaEl.innerHTML = `
				<embed src="${msg.content}" type="application/pdf" class="preview-pdf-frame" />
			`
		} else if (msg.fileType === "binary") {
			previewContentAreaEl.innerHTML = `
				<div class="binary-preview-card">
					<div class="binary-icon-wrap">${iconInfo.icon}</div>
					<h3 class="binary-title">${escapeHtml(msg.fileName || msg.filePath)}</h3>
					<p class="binary-desc">Binary file (${formatBytes(msg.size)}). This file cannot be displayed directly as text.</p>
					<div class="binary-actions">
						<button class="binary-open-btn" id="binary-reveal-btn">Reveal in File Explorer</button>
					</div>
				</div>
			`
			document.getElementById("binary-reveal-btn")?.addEventListener("click", () => {
				revealCurrentFile()
			})
		} else {
			// Text / JSON / Markdown
			let textContent = msg.content || ""
			if (msg.fileType === "json") {
				try {
					textContent = JSON.stringify(JSON.parse(textContent), null, 2)
				} catch {}
			}
			renderCodeText(textContent)
		}
	}

	function renderSvgPreview() {
		if (!currentPreviewMsg) return
		if (isSvgSourceView) {
			renderCodeText(currentPreviewMsg.rawText || "")
			previewToggleViewBtn.querySelector("span").textContent = "View Image"
		} else {
			previewToggleViewBtn.querySelector("span").textContent = "View Code"
			previewContentAreaEl.innerHTML = `
				<div class="image-preview-stage">
					<div class="image-viewport">
						<div class="image-checkerboard">
							<img src="${currentPreviewMsg.content}" class="preview-img" alt="SVG Preview" />
						</div>
					</div>
					<div class="image-meta-bar">
						<span>Vector Graphic</span>
						<span class="meta-sep">•</span>
						<span>${formatBytes(currentPreviewMsg.size)}</span>
						<span class="meta-sep">•</span>
						<span>image/svg+xml</span>
					</div>
				</div>
			`
		}
	}

	function renderCodeText(text) {
		const lines = text.split("\n")
		let gutterHtml = ""
		for (let i = 1; i <= lines.length; i++) {
			gutterHtml += `${i}\n`
		}

		const wrapClass = isCodeWrapped ? "wrapped" : ""
		previewContentAreaEl.innerHTML = `
			<div class="code-preview-container">
				<div class="code-gutter">${gutterHtml}</div>
				<pre class="code-lines-body ${wrapClass}" id="code-lines-body"><code>${escapeHtml(text)}</code></pre>
			</div>
		`
	}

	function revealCurrentFile() {
		if (!selectedPreviewFile) return
		if (window.__desktopAPI?.showItemInFolder) {
			window.__desktopAPI.showItemInFolder(selectedPreviewFile)
		} else {
			sendToServer({ type: "showItem", filePath: selectedPreviewFile })
		}
	}

	// Preview Header Actions
	previewCopyBtn?.addEventListener("click", () => {
		if (!currentPreviewMsg) return
		let textToCopy = ""
		if (currentPreviewMsg.fileType === "image" || currentPreviewMsg.fileType === "media" || currentPreviewMsg.fileType === "pdf") {
			textToCopy = currentPreviewMsg.filePath
		} else if (currentPreviewMsg.fileType === "svg" && currentPreviewMsg.rawText) {
			textToCopy = currentPreviewMsg.rawText
		} else {
			textToCopy = currentPreviewMsg.content || currentPreviewMsg.filePath
		}
		navigator.clipboard.writeText(textToCopy).then(() => {
			const label = previewCopyBtn.querySelector("span")
			if (label) {
				const orig = label.textContent
				label.textContent = "Copied!"
				setTimeout(() => { label.textContent = orig }, 1500)
			}
		})
	})

	previewToggleWrapBtn?.addEventListener("click", () => {
		isCodeWrapped = !isCodeWrapped
		previewToggleWrapBtn.classList.toggle("active", isCodeWrapped)
		const body = document.getElementById("code-lines-body")
		if (body) {
			body.classList.toggle("wrapped", isCodeWrapped)
		}
	})

	previewToggleViewBtn?.addEventListener("click", () => {
		isSvgSourceView = !isSvgSourceView
		renderSvgPreview()
	})

	previewOpenExternalBtn?.addEventListener("click", () => {
		revealCurrentFile()
	})

	function escapeHtml(text) {
		return String(text)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;")
	}

	// Initialize
	connectWebSocket()
})()
