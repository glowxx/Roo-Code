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
	const previewFilenameEl = document.getElementById("preview-filename")
	const previewCodeContentEl = document.getElementById("preview-code-content")

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
	})

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
			window.__desktopAPI.selectFolder()
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
		if (window.__desktopAPI?.isElectron) {
			window.__desktopAPI.sendToExtension(msg)
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
					previewCodeContentEl.textContent = msg.content
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

	function renderSelectedDiff(file) {
		diffViewerHeaderEl.innerHTML = `<span class="diff-filename">${file.filePath} (${file.status})</span>`
		if (!file.newContent) {
			diffContentEl.innerHTML = '<div class="empty-state">File content not available</div>'
			return
		}

		const lines = file.newContent.split("\n")
		let html = ""
		lines.forEach((line, idx) => {
			html += `<div class="diff-line addition"><span style="width: 40px; color: var(--text-muted);">${idx + 1}</span>+ ${escapeHtml(line)}</div>`
		})
		diffContentEl.innerHTML = html
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
			html += `<div class="file-node ${isSelected}" data-path="${escapeHtml(f)}">📄 ${escapeHtml(f)}</div>`
		})
		filesTreeEl.innerHTML = html

		filesTreeEl.querySelectorAll(".file-node").forEach((node) => {
			node.addEventListener("click", () => {
				const path = node.getAttribute("data-path")
				selectedPreviewFile = path
				previewFilenameEl.textContent = path
				previewCodeContentEl.textContent = "Loading file content..."
				sendToServer({ type: "readFile", filePath: path })
				renderFilesTree(filesSearchInput.value.toLowerCase())
			})
		})
	}

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
