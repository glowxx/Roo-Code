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
	let currentAgentStatus = null
	let currentApiConfig = null
	let currentApiProfileName = "default"
	let currentPreviewMsg = null
	let isCodeWrapped = false
	let isSvgSourceView = false
	let currentDesktopTab = "chat"
	try {
		const saved = localStorage.getItem("roo-quick-api-config")
		if (saved) currentApiConfig = JSON.parse(saved)
	} catch (e) {}

	// Folder expansions state
	const expandedFolders = new Set()
	let hasUserToggledFolders = false
	try {
		const savedExpansions = sessionStorage.getItem("roo-expanded-folders")
		if (savedExpansions) {
			const parsed = JSON.parse(savedExpansions)
			if (Array.isArray(parsed)) {
				parsed.forEach((p) => expandedFolders.add(p))
				if (expandedFolders.size > 0) hasUserToggledFolders = true
			}
		}
	} catch (e) {}

	function saveFolderExpansions() {
		try {
			sessionStorage.setItem("roo-expanded-folders", JSON.stringify(Array.from(expandedFolders)))
		} catch (e) {}
	}

	// DOM Elements
	const workspaceNameEl = document.getElementById("workspace-name")
	const openFolderBtn = document.getElementById("open-folder-btn")
	const gitPill = document.getElementById("git-pill")
	const gitBranchEl = document.getElementById("git-branch")
	const diffsCountEl = document.getElementById("diffs-count")
	const terminalCountEl = document.getElementById("terminal-count")
	const footerWorkspaceEl = document.getElementById("footer-workspace-path")
	const connectionStatusEl = document.getElementById("connection-status")
	const webviewFrame = document.getElementById("webview-frame")
	const webviewLoadingState = document.getElementById("webview-loading-state")
	const webviewLoadingTitle = document.getElementById("webview-loading-title")
	const webviewLoadingDesc = document.getElementById("webview-loading-desc")
	const webviewErrorState = document.getElementById("webview-error-state")
	const webviewErrorTitle = document.getElementById("webview-error-title")
	const webviewErrorDesc = document.getElementById("webview-error-desc")
	const webviewRetryBtn = document.getElementById("webview-retry-btn")
	const webviewRetryText = document.getElementById("webview-retry-text")
	// Header & Window controls
	const windowMinimizeBtn = document.getElementById("window-minimize-btn")
	const windowMaximizeBtn = document.getElementById("window-maximize-btn")
	const windowCloseBtn = document.getElementById("window-close-btn")
	const engineConnectionBadge = document.getElementById("engine-connection-badge")
	const engineConnectionText = document.getElementById("engine-connection-text")
	const tabLabelChat = document.getElementById("tab-label-chat")
	const tabLabelDiffs = document.getElementById("tab-label-diffs")
	const tabLabelTerminal = document.getElementById("tab-label-terminal")
	const tabLabelFiles = document.getElementById("tab-label-files")
	const tabLabelSettings = document.getElementById("tab-label-settings")

	// API Modal elements
	const apiModalBackdrop = document.getElementById("api-modal-backdrop")
	const closeApiModalBtn = document.getElementById("close-api-modal-btn")
	const cancelApiModalBtn = document.getElementById("cancel-api-modal-btn")
	const apiProviderSelect = document.getElementById("api-provider-select")
	const apiBaseUrlInput = document.getElementById("api-base-url-input")
	const groupBaseUrl = document.getElementById("group-base-url")
	const baseUrlHint = document.getElementById("base-url-hint")
	const apiKeyInput = document.getElementById("api-key-input")
	const groupApiKey = document.getElementById("group-api-key")
	const apiKeyHint = document.getElementById("api-key-hint")
	const toggleKeyVisibilityBtn = document.getElementById("toggle-key-visibility-btn")
	const apiModelInput = document.getElementById("api-model-input")
	const modelSuggestions = document.getElementById("model-suggestions")
	const saveApiConfigBtn = document.getElementById("save-api-config-btn")
	const openFullSettingsFromModalBtn = document.getElementById("open-full-settings-from-modal-btn")
	const settingsOpenBtn = document.getElementById("nav-settings-btn")
	const quickApiBtn = document.getElementById("quick-api-btn")
	const apiPillLabel = document.getElementById("api-pill-label")

	// Diffs elements
	const diffsSidebarTitle = document.getElementById("diffs-sidebar-title")
	const diffsFileListEl = document.getElementById("diffs-file-list")
	const diffFileCounterEl = document.getElementById("diff-file-counter")
	const diffViewerHeaderEl = document.getElementById("diff-viewer-header")
	const diffContentEl = document.getElementById("diff-content")
	const diffsPlaceholderText = document.getElementById("diffs-placeholder-text")

	// Terminal elements
	const terminalTitleText = document.getElementById("terminal-title-text")
	const terminalOutputEl = document.getElementById("terminal-output")
	const clearTerminalBtn = document.getElementById("clear-terminal-btn")
	const terminalClearText = document.getElementById("terminal-clear-text")
	const terminalEmptyText = document.getElementById("terminal-empty-text")

	// Files elements
	const filesSidebarTitle = document.getElementById("files-sidebar-title")
	const filesTreeEl = document.getElementById("files-tree")
	const filesTreeEmpty = document.getElementById("files-tree-empty")
	const filesSearchInput = document.getElementById("files-search")
	const previewFileIconEl = document.getElementById("preview-file-icon")
	const previewFilenameEl = document.getElementById("preview-filename")
	const previewFileBadgeEl = document.getElementById("preview-file-badge")
	const previewFileSizeEl = document.getElementById("preview-file-size")
	const previewHeaderActionsEl = document.getElementById("preview-header-actions")
	const previewCopyBtn = document.getElementById("preview-copy-btn")
	const previewCopyText = document.getElementById("preview-copy-text")
	const previewToggleWrapBtn = document.getElementById("preview-toggle-wrap-btn")
	const previewWrapText = document.getElementById("preview-wrap-text")
	const previewToggleViewBtn = document.getElementById("preview-toggle-view-btn")
	const previewSourceText = document.getElementById("preview-source-text")
	const previewOpenExternalBtn = document.getElementById("preview-open-external-btn")
	const previewInExplorerText = document.getElementById("preview-in-explorer-text")
	const previewContentAreaEl = document.getElementById("preview-content-area")
	const previewPlaceholderText = document.getElementById("preview-placeholder-text")

	// Sidebar Elements & State
	const sidebarEl = document.getElementById("app-sidebar")
	const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn")
	const sidebarProjectsListEl = document.getElementById("sidebar-projects-list")
	const sidebarProjectsCountEl = document.getElementById("sidebar-projects-count")
	const sidebarHeaderTitleEl = document.getElementById("sidebar-header-title")
	const sidebarProjectsLabelEl = document.getElementById("sidebar-projects-label")
	const sidebarHintTextEl = document.getElementById("sidebar-hint-text")

	let sidebarData = {
		recentWorkspaces: [],
		currentWorkspace: "",
		chats: {},
	}
	let isSidebarCollapsed = localStorage.getItem("roo-sidebar-collapsed") === "true"
	let activeTaskId = null
	const projectExpansions = new Set()

	// ==========================================
	// Desktop Internationalization (i18n)
	// ==========================================
	const desktopTranslations = {
		en: {
			// Loading & Error States
			loadingTitle: "Initializing Roo Code engine...",
			loadingDesc: "Connecting to server and preparing agent view...",
			loadingServerHealth: (attempt, max) => `Waiting for server readiness... (attempt ${attempt}/${max})`,
			loadingConnectingServer: "Connecting to server...",
			loadingServerUnavailable: "Application server is not responding to healthcheck requests. Make sure the Roo Code engine is running.",
			loadingAgentView: "Loading agent view...",
			loadingTimeout: "Loading agent view timed out.",
			loadingFrameError: (reason, delay, attempt, max) => `Frame load error (${reason || "connection aborted"}). Retrying in ${delay}ms... (attempt ${attempt}/${max})`,
			loadingFrameFailed: "Failed to load agent view after 3 attempts. Check connection and retry.",
			loadingNetworkError: "Network error while loading iframe.",
			errorTitle: "Failed to load agent view",
			errorDesc: "Server is not responding or connection to core application failed.",
			retryBtn: "Retry",

			// Navigation tabs
			tabAgent: "Agent",
			tabDiffs: "Diffs",
			tabTerminal: "Terminal",
			tabFiles: "Files",
			tabSettings: "Settings",

			// Connection statuses & agent status
			statusConnected: "Connected",
			statusConnecting: "Connecting...",
			statusDisconnected: "Disconnected (Reconnecting...)",
			statusThinking: "Thinking...",
			statusExecuting: "Running Command...",
			statusWaitingApproval: "Waiting for Approval",
			statusError: "Error",
			coreEngineConnected: "Core Engine: Connected",
			coreEngineConnecting: "Core Engine: Reconnecting...",
			connectedToEngine: "Connected to Engine",

			// Explorer & File Preview
			projectFiles: "Project Files",
			searchFilesPlaceholder: "Search project files...",
			loadingFileTree: "Loading file tree...",
			noFilesFound: "No files found",
			noWorkspaceOpen: "No workspace folder open",
			selectFileToPreview: "Select a file from the tree to preview",
			previewPlaceholder: "Select any file from the project tree to view its code, image, or details.",
			failedToLoadFilePreview: "Failed to load file preview",
			fileCouldNotBeOpened: "File could not be opened",
			copy: "Copy",
			wrap: "Wrap",
			sourceCode: "Source Code",
			inExplorer: "In Explorer",

			// Diffs
			modifiedFiles: "Modified Files",
			filesCount: (count) => `${count} file${count === 1 ? "" : "s"}`,
			noChangesRecorded: "No file changes recorded.",
			noChangesAgent: "No changes made by the agent yet.",
			diffsPlaceholder: "When Roo Code modifies files in this workspace, you can inspect the diffs here.",
			selectFileToReview: "Select a file from the list to review changes",
			fileContentNotAvailable: "File content not available",

			// Terminal
			terminalTitle: "Terminal & Agent Command Logs",
			terminalClear: "Clear",
			terminalEmpty: "Roo Code terminal command executions and logs will appear here.",

			// Sidebar
			workspaces: "Workspaces",
			projectsSection: "PROJECTS",
			noConversations: "No conversations",
			newChat: "New Chat",
			toggleSidebar: "Toggle Sidebar (Ctrl+B)",
			activeProject: "Active",
			removeRecent: "Remove from recent",
			newChatInProject: "New chat in this project",
			openWorkspaceFolder: "Open Folder",
			toggleSidebarHint: "toggle sidebar",
		},
		pl: {
			// Loading & Error States
			loadingTitle: "Inicjalizacja silnika Roo Code...",
			loadingDesc: "Nawiązywanie połączenia z serwerem i przygotowywanie widoku agenta...",
			loadingServerHealth: (attempt, max) => `Oczekiwanie na gotowość serwera... (próba ${attempt}/${max})`,
			loadingConnectingServer: "Nawiązywanie połączenia z serwerem...",
			loadingServerUnavailable: "Serwer aplikacji nie odpowiada na żądania healthcheck. Upewnij się, że silnik Roo Code został uruchomiony.",
			loadingAgentView: "Ładowanie widoku agenta...",
			loadingTimeout: "Przekroczono limit czasu ładowania widoku agenta.",
			loadingFrameError: (reason, delay, attempt, max) => `Błąd ładowania ramki (${reason || "połączenie przerwane"}). Ponawianie za ${delay}ms... (próba ${attempt}/${max})`,
			loadingFrameFailed: "Nie udało się załadować widoku agenta po 3 próbach. Sprawdź połączenie i ponów próbę.",
			loadingNetworkError: "Błąd sieciowy podczas ładowania ramki iframe.",
			errorTitle: "Nie udało się załadować widoku agenta",
			errorDesc: "Serwer nie odpowiada lub wystąpił błąd połączenia z rdzeniem aplikacji.",
			retryBtn: "Ponów próbę",

			// Navigation tabs
			tabAgent: "Agent",
			tabDiffs: "Diffs",
			tabTerminal: "Terminal",
			tabFiles: "Pliki",
			tabSettings: "Ustawienia",

			// Connection statuses & agent status
			statusConnected: "Połączono",
			statusConnecting: "Łączenie...",
			statusDisconnected: "Rozłączono (Ponowne łączenie...)",
			statusThinking: "Myślenie...",
			statusExecuting: "Wykonywanie polecenia...",
			statusWaitingApproval: "Oczekiwanie na zatwierdzenie",
			statusError: "Błąd",
			coreEngineConnected: "Rdzeń silnika: Połączono",
			coreEngineConnecting: "Rdzeń silnika: Ponowne łączenie...",
			connectedToEngine: "Połączono z silnikiem",

			// Explorer & File Preview
			projectFiles: "Pliki projektu",
			searchFilesPlaceholder: "Szukaj plików projektu...",
			loadingFileTree: "Ładowanie drzewa plików...",
			noFilesFound: "Nie znaleziono plików",
			noWorkspaceOpen: "Brak otwartego folderu roboczego",
			selectFileToPreview: "Wybierz plik z drzewa, aby wyświetlić podgląd",
			previewPlaceholder: "Wybierz dowolny plik z drzewa projektu, aby zobaczyć jego kod, obraz lub szczegóły.",
			failedToLoadFilePreview: "Nie udało się załadować podglądu pliku",
			fileCouldNotBeOpened: "Nie można otworzyć pliku",
			copy: "Kopiuj",
			wrap: "Zawijaj",
			sourceCode: "Kod źródłowy",
			inExplorer: "W eksploratorze",

			// Diffs
			modifiedFiles: "Zmodyfikowane pliki",
			filesCount: (count) => `${count} plik${count === 1 ? "" : count < 5 ? "i" : "ów"}`,
			noChangesRecorded: "Brak zarejestrowanych zmian w plikach.",
			noChangesAgent: "Brak zmian wprowadzonych dotąd przez agenta.",
			diffsPlaceholder: "Gdy Roo Code zmodyfikuje pliki w tym obszarze, zobaczysz tutaj podgląd zmian (diff).",
			selectFileToReview: "Wybierz plik z listy, aby przejrzeć zmiany",
			fileContentNotAvailable: "Zawartość pliku niedostępna",

			// Terminal
			terminalTitle: "Dziennik poleceń terminala i agenta",
			terminalClear: "Wyczyść",
			terminalEmpty: "Wyniki poleceń terminala i dzienniki wykonania Roo Code pojawią się tutaj.",

			// Sidebar
			workspaces: "Obszary robocze",
			projectsSection: "PROJEKTY",
			noConversations: "Brak konwersacji",
			newChat: "Nowy czat",
			toggleSidebar: "Zwiń/Rozwiń panel (Ctrl+B)",
			activeProject: "Aktywny",
			removeRecent: "Usuń z listy",
			newChatInProject: "Nowy czat w tym projekcie",
			openWorkspaceFolder: "Otwórz folder",
			toggleSidebarHint: "zwiń/rozwiń panel",
		},
	}

	let currentLanguage = (() => {
		try {
			const saved = localStorage.getItem("roo-language")
			if (saved) return (saved === "pl" || saved.startsWith("pl")) ? "pl" : "en"
			const vscodeState = localStorage.getItem("vscodeState")
			if (vscodeState) {
				const parsed = JSON.parse(vscodeState)
				if (parsed?.language) {
					return (parsed.language === "pl" || parsed.language.startsWith("pl")) ? "pl" : "en"
				}
			}
		} catch (e) {}
		return navigator.language?.startsWith("pl") ? "pl" : "en"
	})()

	function tDesktop(key, ...args) {
		const lang = currentLanguage === "pl" ? "pl" : "en"
		const entry = desktopTranslations[lang]?.[key] ?? desktopTranslations.en[key]
		if (typeof entry === "function") {
			return entry(...args)
		}
		return entry ?? key
	}

	function applyDesktopTranslations(lang) {
		if (lang) {
			currentLanguage = (lang === "pl" || (typeof lang === "string" && lang.startsWith("pl"))) ? "pl" : "en"
		}

		// 1. Loading & Error elements
		if (webviewLoadingTitle) webviewLoadingTitle.textContent = tDesktop("loadingTitle")
		if (webviewLoadingDesc && (!webviewLoadingDesc.dataset.custom || webviewLoadingDesc.textContent === desktopTranslations.en.loadingDesc || webviewLoadingDesc.textContent === desktopTranslations.pl.loadingDesc)) {
			webviewLoadingDesc.textContent = tDesktop("loadingDesc")
		}
		if (webviewErrorTitle) webviewErrorTitle.textContent = tDesktop("errorTitle")
		if (webviewErrorDesc && (!webviewErrorDesc.dataset.custom || webviewErrorDesc.textContent === desktopTranslations.en.errorDesc || webviewErrorDesc.textContent === desktopTranslations.pl.errorDesc)) {
			webviewErrorDesc.textContent = tDesktop("errorDesc")
		}
		if (webviewRetryText) webviewRetryText.textContent = tDesktop("retryBtn")

		// 2. Tab labels
		if (tabLabelChat) tabLabelChat.textContent = tDesktop("tabAgent")
		if (tabLabelDiffs) tabLabelDiffs.textContent = tDesktop("tabDiffs")
		if (tabLabelTerminal) tabLabelTerminal.textContent = tDesktop("tabTerminal")
		if (tabLabelFiles) tabLabelFiles.textContent = tDesktop("tabFiles")
		if (tabLabelSettings) tabLabelSettings.textContent = tDesktop("tabSettings")

		// 3. Connection badge & status texts
		if (isConnected) {
			if (connectionStatusEl) connectionStatusEl.textContent = tDesktop("connectedToEngine")
			if (engineConnectionText && !currentAgentStatus) engineConnectionText.textContent = tDesktop("statusConnected")
			if (engineConnectionBadge && !currentAgentStatus) engineConnectionBadge.title = tDesktop("coreEngineConnected")
		} else {
			if (connectionStatusEl) connectionStatusEl.textContent = tDesktop("statusDisconnected")
			if (engineConnectionText) engineConnectionText.textContent = tDesktop("statusConnecting")
			if (engineConnectionBadge) engineConnectionBadge.title = tDesktop("coreEngineConnecting")
		}
		if (currentAgentStatus) {
			updateAgentStatus(currentAgentStatus)
		}

		// 4. Explorer titles & placeholders
		if (filesSidebarTitle) filesSidebarTitle.textContent = tDesktop("projectFiles")
		if (filesSearchInput) filesSearchInput.placeholder = tDesktop("searchFilesPlaceholder")
		if (filesTreeEmpty) filesTreeEmpty.textContent = tDesktop("loadingFileTree")
		if (previewFilenameEl && !selectedPreviewFile) {
			previewFilenameEl.textContent = tDesktop("selectFileToPreview")
		}
		if (previewCopyText) previewCopyText.textContent = tDesktop("copy")
		if (previewWrapText) previewWrapText.textContent = tDesktop("wrap")
		if (previewSourceText) previewSourceText.textContent = isSvgSourceView ? "View Image" : tDesktop("sourceCode")
		if (previewInExplorerText) previewInExplorerText.textContent = tDesktop("inExplorer")
		if (previewPlaceholderText) previewPlaceholderText.textContent = tDesktop("previewPlaceholder")

		// 5. Diffs titles & placeholders
		if (diffsSidebarTitle) diffsSidebarTitle.textContent = tDesktop("modifiedFiles")
		if (diffFileCounterEl) diffFileCounterEl.textContent = tDesktop("filesCount", diffFiles.length)
		if (diffsPlaceholderText) diffsPlaceholderText.textContent = tDesktop("diffsPlaceholder")
		const diffViewerFilename = diffViewerHeaderEl?.querySelector(".diff-filename")
		if (diffViewerFilename && !selectedDiffFile) {
			diffViewerFilename.textContent = tDesktop("selectFileToReview")
		}

		// 6. Terminal titles & placeholders
		if (terminalTitleText) terminalTitleText.textContent = tDesktop("terminalTitle")
		if (terminalClearText) terminalClearText.textContent = tDesktop("terminalClear")
		if (terminalEmptyText) terminalEmptyText.textContent = tDesktop("terminalEmpty")

		// 7. Sidebar elements
		if (sidebarHeaderTitleEl) sidebarHeaderTitleEl.textContent = tDesktop("workspaces")
		if (sidebarProjectsLabelEl) sidebarProjectsLabelEl.textContent = tDesktop("projectsSection")
		if (sidebarHintTextEl) sidebarHintTextEl.textContent = tDesktop("toggleSidebarHint")
		if (sidebarToggleBtn) sidebarToggleBtn.title = tDesktop("toggleSidebar")
	}

	// Apply initial desktop translations immediately
	applyDesktopTranslations(currentLanguage)

	function switchDesktopTab(targetTab, origin = "user", values = null) {
		if (!targetTab) return
		// Loop guard / idempotency check
		if (currentDesktopTab === targetTab) return

		currentDesktopTab = targetTab

		// Update nav tabs active styling
		tabs.forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === targetTab))

		// Update panels active styling:
		// "chat" and "settings" both live inside the webview in #tab-chat
		panels.forEach((p) => {
			if (targetTab === "settings" || targetTab === "chat") {
				p.classList.toggle("active", p.id === "tab-chat")
			} else {
				p.classList.toggle("active", p.id === `tab-${targetTab}`)
			}
		})

		// If switching to files tab and files tree is empty or requires refresh, load files
		if (targetTab === "files") {
			const isTreeEmpty = !filesTreeEl || filesTreeEl.children.length === 0 || filesTreeEl.querySelector(".empty-state")
			if (!currentWorkspace?.files || currentWorkspace.files.length === 0 || isTreeEmpty) {
				loadWorkspaceFiles()
			}
		}

		// If user clicked in desktop shell, notify webview with origin: "sync"
		if (origin === "user") {
			if (targetTab === "settings") {
				forwardToWebview({
					type: "switchTab",
					tab: "settings",
					origin: "sync",
					values: values || { section: "providers" },
				})
			} else if (targetTab === "chat") {
				forwardToWebview({
					type: "switchTab",
					tab: "chat",
					origin: "sync",
				})
			}
		}
	}

	// Setup Tabs Navigation
	const tabs = document.querySelectorAll(".nav-tab")
	const panels = document.querySelectorAll(".tab-panel")

	tabs.forEach((tab) => {
		tab.addEventListener("click", () => {
			const targetTab = tab.getAttribute("data-tab")
			switchDesktopTab(targetTab, "user")
		})
	})

	// Theme Synchronization (5 themes)
	function applyDesktopTheme(theme) {
		if (!theme) return
		const isLight = theme === "clean-light" || theme === "light"
		document.body.classList.toggle("light-theme", isLight)
		document.body.classList.toggle("dark-theme", !isLight)
		document.body.setAttribute("data-theme", theme)
		localStorage.setItem("roo-theme", theme)
	}

	const savedTheme = localStorage.getItem("roo-theme") || "linear-dark"
	applyDesktopTheme(savedTheme)

	// Window Controls (Minimize, Maximize, Close)
	windowMinimizeBtn?.addEventListener("click", () => {
		window.__desktopAPI?.minimize?.()
	})
	windowMaximizeBtn?.addEventListener("click", () => {
		window.__desktopAPI?.maximize?.()
	})
	windowCloseBtn?.addEventListener("click", () => {
		window.__desktopAPI?.close?.()
	})

	// ==========================================
	// AntiGravity Sidebar (Projects & Chats)
	// ==========================================
	// Restore initial collapsed state
	if (sidebarEl && isSidebarCollapsed) {
		sidebarEl.classList.add("collapsed")
	}

	function toggleSidebar(forceState) {
		if (!sidebarEl) return
		if (typeof forceState === "boolean") {
			isSidebarCollapsed = forceState
		} else {
			isSidebarCollapsed = !sidebarEl.classList.contains("collapsed")
		}
		sidebarEl.classList.toggle("collapsed", isSidebarCollapsed)
		try {
			localStorage.setItem("roo-sidebar-collapsed", isSidebarCollapsed ? "true" : "false")
		} catch (e) {}
	}

	sidebarToggleBtn?.addEventListener("click", () => toggleSidebar())

	// Global shortcuts: Ctrl+B / Cmd+B (toggle sidebar), Ctrl+N / Cmd+N (new chat)
	window.addEventListener("keydown", (e) => {
		if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B") && !e.shiftKey && !e.altKey) {
			e.preventDefault()
			toggleSidebar()
		}
		if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N") && !e.shiftKey && !e.altKey) {
			e.preventDefault()
			startNewChat()
		}
	})

	async function openFolderDialog() {
		if (window.__desktopAPI?.selectFolder) {
			try {
				const newPath = await window.__desktopAPI.selectFolder()
				if (newPath) {
					await selectWorkspaceFolder(newPath)
					fetchSidebarData()
				}
			} catch (err) {
				console.error("Failed to select folder via Electron dialog:", err)
			}
		} else {
			const newPath = prompt("Enter full path of folder to open:", currentWorkspace?.path || "")
			if (newPath && newPath.trim()) {
				const trimmed = newPath.trim()
				await selectWorkspaceFolder(trimmed)
				fetchSidebarData()
			}
		}
	}

	function startNewChat(workspacePath) {
		if (workspacePath && currentWorkspace?.path && pathNormalize(workspacePath) !== pathNormalize(currentWorkspace.path)) {
			selectWorkspaceFolder(workspacePath).then(() => {
				forwardToWebview({ type: "action", action: "chatButtonClicked" })
				forwardToWebview({ type: "clearTask" })
				switchDesktopTab("chat", "user")
			})
			return
		}
		forwardToWebview({ type: "action", action: "chatButtonClicked" })
		forwardToWebview({ type: "clearTask" })
		switchDesktopTab("chat", "user")
	}

	function pathNormalize(p) {
		if (!p) return ""
		return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
	}

	function formatTimeAgo(ts) {
		if (!ts || typeof ts !== "number") return ""
		const diff = Date.now() - ts
		if (diff < 60000) return "Just now"
		const mins = Math.floor(diff / 60000)
		if (mins < 60) return `${mins}m ago`
		const hours = Math.floor(mins / 60)
		if (hours < 24) return `${hours}h ago`
		const days = Math.floor(hours / 24)
		if (days === 1) return "Yesterday"
		if (days < 7) return `${days}d ago`
		const d = new Date(ts)
		return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
	}

	async function fetchSidebarData() {
		try {
			const res = await fetch("/api/sidebar-data")
			if (res.ok) {
				const data = await res.json()
				updateSidebarData(data)
			}
		} catch (e) {
			console.warn("[Sidebar] Failed to fetch sidebar data:", e)
		}
	}

	function updateSidebarData(data) {
		if (!data) return
		sidebarData = {
			recentWorkspaces: Array.isArray(data.recentWorkspaces) ? data.recentWorkspaces : [],
			currentWorkspace: data.currentWorkspace || currentWorkspace?.path || "",
			chats: data.chats || {},
		}

		// Auto-expand current workspace if nothing is expanded
		if (sidebarData.currentWorkspace && projectExpansions.size === 0) {
			projectExpansions.add(sidebarData.currentWorkspace)
		}

		renderSidebar()
	}

	async function switchChat(taskId, wsPath) {
		if (!taskId) return
		activeTaskId = taskId
		renderSidebar()

		switchDesktopTab("chat", "user")

		forwardToWebview({ type: "showTaskWithId", text: taskId })

		try {
			const resp = await fetch("/api/chat/switch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ taskId, workspacePath: wsPath }),
			})
			if (!resp.ok) {
				sendToServer({ type: "switchChat", taskId, workspacePath: wsPath })
			}
		} catch (err) {
			console.warn("[Sidebar] Error calling switch chat endpoint, using WS:", err)
			sendToServer({ type: "switchChat", taskId, workspacePath: wsPath })
		}
	}

	async function selectWorkspaceFolder(wsPath) {
		if (!wsPath) return
		projectExpansions.add(wsPath)
		try {
			const resp = await fetch("/api/workspace", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: wsPath }),
			})
			if (resp.ok) {
				const data = await resp.json()
				renderWorkspaceInfo(data)
			} else {
				sendToServer({ type: "selectFolder", path: wsPath })
			}
		} catch (err) {
			sendToServer({ type: "selectFolder", path: wsPath })
		}
	}

	function removeRecentWorkspace(wsPath) {
		sidebarData.recentWorkspaces = sidebarData.recentWorkspaces.filter(
			(p) => pathNormalize(p) !== pathNormalize(wsPath)
		)
		renderSidebar()
		sendToServer({ type: "removeRecentWorkspace", path: wsPath })
	}

	function renderSidebar() {
		if (!sidebarProjectsListEl) return

		const curWsNorm = pathNormalize(sidebarData.currentWorkspace || currentWorkspace?.path || "")
		let workspaces = [...sidebarData.recentWorkspaces]

		// Ensure current workspace is present
		if (sidebarData.currentWorkspace && !workspaces.some((w) => pathNormalize(w) === curWsNorm)) {
			workspaces.unshift(sidebarData.currentWorkspace)
		}

		// Also check if there are chats for workspaces not currently in recentWorkspaces
		for (const wsKey of Object.keys(sidebarData.chats)) {
			if (wsKey !== "__unassigned__" && !workspaces.some((w) => pathNormalize(w) === pathNormalize(wsKey))) {
				workspaces.push(wsKey)
			}
		}

		if (sidebarProjectsCountEl) {
			sidebarProjectsCountEl.textContent = String(workspaces.length)
		}

		if (workspaces.length === 0) {
			sidebarProjectsListEl.innerHTML = `
				<div class="sidebar-empty-state">
					<p>${escapeHtml(tDesktop("noWorkspaceOpen"))}</p>
					<button class="btn-start-chat" id="sidebar-open-first-btn" style="margin-top:8px;">+ ${escapeHtml(tDesktop("openWorkspaceFolder"))}</button>
				</div>
			`
			document.getElementById("sidebar-open-first-btn")?.addEventListener("click", () => {
				openFolderDialog()
			})
			return
		}

		let html = ""

		workspaces.forEach((ws) => {
			const wsNorm = pathNormalize(ws)
			const isActive = wsNorm === curWsNorm
			const wsName = ws.split(/[/\\]/).filter(Boolean).pop() || ws
			let chats = []

			// Find chats matching this workspace
			for (const [chatWs, chatList] of Object.entries(sidebarData.chats)) {
				if (pathNormalize(chatWs) === wsNorm) {
					chats = chatList
					break
				}
			}

			const isExpanded = projectExpansions.has(ws) || (isActive && projectExpansions.size <= 1)

			let chatsHtml = ""
			if (chats.length > 0) {
				chats.forEach((chat) => {
					const isChatActive = activeTaskId === chat.id
					chatsHtml += `
						<div class="sidebar-chat-item ${isChatActive ? "active" : ""}" data-task-id="${escapeHtml(chat.id)}" data-workspace="${escapeHtml(ws)}">
							<svg class="chat-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
							</svg>
							<div class="chat-meta">
								<span class="chat-title" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</span>
								<span class="chat-time">${escapeHtml(formatTimeAgo(chat.ts))}</span>
							</div>
						</div>
					`
				})
			} else {
				chatsHtml = `
					<div class="sidebar-no-chats">
						<span>${escapeHtml(tDesktop("noConversations"))}</span>
						<button class="btn-start-chat" data-action="new-chat-in-ws" data-workspace="${escapeHtml(ws)}">+ ${escapeHtml(tDesktop("newChat"))}</button>
					</div>
				`
			}

			html += `
				<div class="sidebar-project-item ${isActive ? "active" : ""}" data-workspace="${escapeHtml(ws)}">
					<div class="project-header" data-workspace="${escapeHtml(ws)}">
						<button class="project-chevron-btn" data-action="toggle-project" data-workspace="${escapeHtml(ws)}" title="Toggle chats">
							<svg class="chevron-icon ${isExpanded ? "expanded" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<polyline points="9 18 15 12 9 6"></polyline>
							</svg>
						</button>
						<div class="project-icon-box" data-action="switch-workspace" data-workspace="${escapeHtml(ws)}">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
							</svg>
						</div>
						${isActive ? `<span class="project-status-dot" title="${escapeHtml(tDesktop("activeProject"))}"></span>` : ""}
						<div class="project-meta" data-action="switch-workspace" data-workspace="${escapeHtml(ws)}" title="${escapeHtml(ws)}">
							<span class="project-name" title="${escapeHtml(wsName)}">${escapeHtml(wsName)}</span>
							<span class="project-path" title="${escapeHtml(ws)}">${escapeHtml(ws)}</span>
						</div>
						<div class="project-actions">
							<button class="project-action-btn" data-action="new-chat-in-ws" data-workspace="${escapeHtml(ws)}" title="${escapeHtml(tDesktop("newChatInProject"))}">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<line x1="12" y1="5" x2="12" y2="19"/>
									<line x1="5" y1="12" x2="19" y2="12"/>
								</svg>
							</button>
							${
								!isActive
									? `<button class="project-action-btn project-remove-btn" data-action="remove-project" data-workspace="${escapeHtml(ws)}" title="${escapeHtml(tDesktop("removeRecent"))}">
										<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<line x1="18" y1="6" x2="6" y2="18"/>
											<line x1="6" y1="6" x2="18" y2="18"/>
										</svg>
									</button>`
									: ""
							}
						</div>
					</div>
					<div class="project-chats-list ${isExpanded ? "expanded" : ""}">
						${chatsHtml}
					</div>
				</div>
			`
		})

		sidebarProjectsListEl.innerHTML = html

		// Attach event delegations for dynamically generated items
		sidebarProjectsListEl.querySelectorAll(".sidebar-chat-item").forEach((el) => {
			el.addEventListener("click", () => {
				const taskId = el.getAttribute("data-task-id")
				const ws = el.getAttribute("data-workspace")
				if (taskId) switchChat(taskId, ws)
			})
		})

		sidebarProjectsListEl.querySelectorAll("[data-action='toggle-project']").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation()
				const ws = btn.getAttribute("data-workspace")
				if (ws) {
					if (projectExpansions.has(ws)) {
						projectExpansions.delete(ws)
					} else {
						projectExpansions.add(ws)
					}
					renderSidebar()
				}
			})
		})

		sidebarProjectsListEl.querySelectorAll("[data-action='switch-workspace']").forEach((el) => {
			el.addEventListener("click", () => {
				const ws = el.getAttribute("data-workspace")
				if (ws && pathNormalize(ws) !== curWsNorm) {
					selectWorkspaceFolder(ws)
				}
			})
		})

		sidebarProjectsListEl.querySelectorAll("[data-action='new-chat-in-ws']").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation()
				const ws = btn.getAttribute("data-workspace")
				if (ws) startNewChat(ws)
			})
		})

		sidebarProjectsListEl.querySelectorAll("[data-action='remove-project']").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation()
				const ws = btn.getAttribute("data-workspace")
				if (ws) removeRecentWorkspace(ws)
			})
		})
	}

	// Webview Loading & Cold Start Resilience with Healthcheck and Exponential Backoff Retry
	let webviewRetryCount = 0
	const MAX_WEBVIEW_RETRIES = 3
	const RETRY_DELAYS = [500, 1000, 2000]
	let webviewLoadTimeoutTimer = null

	function showWebviewLoading(statusText) {
		if (webviewLoadingState) {
			webviewLoadingState.style.display = "flex"
			if (webviewLoadingTitle) webviewLoadingTitle.textContent = tDesktop("loadingTitle")
			const desc = webviewLoadingDesc || webviewLoadingState.querySelector(".placeholder-desc")
			if (desc && statusText) {
				desc.textContent = statusText
				desc.dataset.custom = "true"
			}
		}
		if (webviewErrorState) webviewErrorState.style.display = "none"
		if (webviewFrame) webviewFrame.style.display = "none"
	}

	function showWebviewError(message) {
		if (webviewLoadingState) webviewLoadingState.style.display = "none"
		if (webviewFrame) webviewFrame.style.display = "none"
		if (webviewErrorState) {
			webviewErrorState.style.display = "flex"
			if (webviewErrorTitle) webviewErrorTitle.textContent = tDesktop("errorTitle")
			if (webviewErrorDesc && message) {
				webviewErrorDesc.textContent = message
				webviewErrorDesc.dataset.custom = "true"
			}
			if (webviewRetryText) webviewRetryText.textContent = tDesktop("retryBtn")
		}
	}

	function showWebviewSuccess() {
		clearTimeout(webviewLoadTimeoutTimer)
		if (webviewLoadingState) webviewLoadingState.style.display = "none"
		if (webviewErrorState) webviewErrorState.style.display = "none"
		if (webviewFrame) {
			if (!webviewFrame.getAttribute("src") || webviewFrame.getAttribute("src") === "") {
				webviewFrame.src = "/webview/index.html"
			}
			webviewFrame.style.display = "block"
			const theme = localStorage.getItem("roo-theme") || "linear-dark"
			webviewFrame.contentWindow?.postMessage({ type: "themeChange", theme }, "*")
			webviewFrame.contentWindow?.postMessage({ type: "languageChange", language: currentLanguage }, "*")
		}
	}

	async function checkServerHealth(maxAttempts = 3, delays = RETRY_DELAYS) {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			try {
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), 2000)
				const res = await fetch("/api/health", { signal: controller.signal, cache: "no-store" })
				clearTimeout(timeoutId)
				if (res.ok) {
					return true
				}
			} catch (err) {
				console.warn(`Healthcheck attempt ${attempt + 1}/${maxAttempts} failed:`, err)
			}
			if (attempt < maxAttempts - 1) {
				const delay = delays[attempt] || 1000
				showWebviewLoading(tDesktop("loadingServerHealth", attempt + 2, maxAttempts))
				await new Promise((resolve) => setTimeout(resolve, delay))
			}
		}
		showWebviewError(tDesktop("loadingServerUnavailable"))
		return false
	}

	async function loadWebviewFrame() {
		if (!webviewFrame) return
		clearTimeout(webviewLoadTimeoutTimer)

		showWebviewLoading(tDesktop("loadingConnectingServer"))

		const isServerReady = await checkServerHealth(MAX_WEBVIEW_RETRIES, RETRY_DELAYS)
		if (!isServerReady) {
			showWebviewError(tDesktop("loadingServerUnavailable"))
			return
		}

		showWebviewLoading(tDesktop("loadingAgentView"))

		// Set up frame load timeout (8 seconds)
		webviewLoadTimeoutTimer = setTimeout(() => {
			console.warn("Webview iframe loading timed out.")
			handleWebviewLoadError(tDesktop("loadingTimeout"))
		}, 8000)

		// Set src to trigger load
		webviewFrame.src = "/webview/index.html"
	}

	function handleWebviewLoadError(reason) {
		clearTimeout(webviewLoadTimeoutTimer)
		if (webviewRetryCount < MAX_WEBVIEW_RETRIES) {
			const delay = RETRY_DELAYS[webviewRetryCount] || 1000
			webviewRetryCount++
			showWebviewLoading(tDesktop("loadingFrameError", reason, delay, webviewRetryCount, MAX_WEBVIEW_RETRIES))
			setTimeout(() => {
				loadWebviewFrame()
			}, delay)
		} else {
			showWebviewError(reason || tDesktop("loadingFrameFailed"))
		}
	}

	if (webviewFrame) {
		webviewFrame.addEventListener("load", () => {
			clearTimeout(webviewLoadTimeoutTimer)
			webviewRetryCount = 0
			showWebviewSuccess()
		})

		webviewFrame.addEventListener("error", () => {
			handleWebviewLoadError(tDesktop("loadingNetworkError"))
		})
	}

	webviewRetryBtn?.addEventListener("click", () => {
		webviewRetryCount = 0
		loadWebviewFrame()
	})

	// Initiate safe webview loading
	loadWebviewFrame()

	// Folder Selection
	openFolderBtn?.addEventListener("click", () => {
		openFolderDialog()
	})

	// Clear Terminal
	clearTerminalBtn?.addEventListener("click", () => {
		terminalLogs = []
		renderTerminalLogs()
		terminalCountEl.textContent = "0"
	})

	// Files Search Filter
	let searchDebounceTimer = null
	filesSearchInput?.addEventListener("input", (e) => {
		clearTimeout(searchDebounceTimer)
		searchDebounceTimer = setTimeout(() => {
			const filter = e.target.value.toLowerCase()
			renderFilesTree(filter)
		}, 150)
	})

	// Setup Bidirectional Bridge with Iframe
	window.addEventListener("message", (event) => {
		if (event.data?.type === "toggleSidebar") {
			toggleSidebar()
			return
		}
		// Only listen to messages from the webview iframe
		if (event.source === webviewFrame?.contentWindow) {
			const data = event.data
			if (data) {
				if (data.type === "languageChange" && data.language) {
					const newLang = (data.language === "pl" || data.language.startsWith("pl")) ? "pl" : "en"
					if (newLang !== currentLanguage) {
						currentLanguage = newLang
						localStorage.setItem("roo-language", currentLanguage)
						applyDesktopTranslations(currentLanguage)
					}
				}
				if (data.type === "state" && data.state?.language) {
					const newLang = (data.state.language === "pl" || data.state.language.startsWith("pl")) ? "pl" : "en"
					if (newLang !== currentLanguage) {
						currentLanguage = newLang
						localStorage.setItem("roo-language", currentLanguage)
						applyDesktopTranslations(currentLanguage)
					}
				}
				if (data.type === "themeChange" && data.theme) {
					applyDesktopTheme(data.theme)
				}
				if (data.type === "switchTab" && data.tab) {
					switchDesktopTab(data.tab, "sync")
					return
				}
				if (data.type === "action" && data.action) {
					if (data.action === "chatButtonClicked" || (data.action === "switchTab" && data.tab === "chat")) {
						switchDesktopTab("chat", "sync")
						return
					}
					if (data.action === "settingsButtonClicked" || (data.action === "switchTab" && data.tab === "settings")) {
						switchDesktopTab("settings", "sync")
						return
					}
				}
				if (data.type === "upsertApiConfiguration" && data.apiConfiguration) {
					currentApiConfig = { ...currentApiConfig, ...data.apiConfiguration }
					updateApiPill(currentApiConfig)
				}
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
		const protocol = window.location.protocol === "https:" ? "wss://" : "ws://"
		const host = window.location.host || "127.0.0.1:4500"
		const wsUrl = `${protocol}${host}/ws`
		console.log("[WS] Connecting to:", wsUrl)

		try {
			socket = new WebSocket(wsUrl)
		} catch (err) {
			console.error("[WS ERROR] Failed to create WebSocket:", err)
			setTimeout(connectWebSocket, 2000)
			return
		}

		socket.onopen = () => {
			console.log("[WS] Connected successfully to:", wsUrl)
			isConnected = true
			if (connectionStatusEl) {
				connectionStatusEl.textContent = tDesktop("connectedToEngine")
				const dot = connectionStatusEl.parentElement?.querySelector(".indicator-dot")
				if (dot) dot.style.background = "var(--success)"
			}
			if (engineConnectionText) engineConnectionText.textContent = tDesktop("statusConnected")
			if (engineConnectionBadge) {
				engineConnectionBadge.className = "engine-connection-badge status-connected"
				engineConnectionBadge.title = tDesktop("coreEngineConnected")
			}
			// WebSocket connected - remove loading overlay immediately
			showWebviewSuccess()
			sendToServer({ type: "getWorkspaceInfo" })
		}

		socket.onmessage = (event) => {
			try {
				const serverMsg = JSON.parse(event.data)
				handleServerMessage(serverMsg)
			} catch (err) {
				console.error("[WS ERROR] Error parsing server message:", err)
			}
		}

		socket.onclose = (event) => {
			console.warn(`[WS] Connection closed (code: ${event.code}, reason: ${event.reason || "none"}). Reconnecting...`)
			isConnected = false
			if (connectionStatusEl) {
				connectionStatusEl.textContent = tDesktop("statusDisconnected")
				const dot = connectionStatusEl.parentElement?.querySelector(".indicator-dot")
				if (dot) dot.style.background = "var(--danger)"
			}
			if (engineConnectionText) engineConnectionText.textContent = tDesktop("statusConnecting")
			if (engineConnectionBadge) {
				engineConnectionBadge.className = "engine-connection-badge status-connecting"
				engineConnectionBadge.title = tDesktop("coreEngineConnecting")
			}
			setTimeout(connectWebSocket, 2000)
		}

		socket.onerror = (err) => {
			console.error("[WS ERROR]", err)
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
			case "sidebarData":
				updateSidebarData(msg.data)
				break

			case "extensionMessage":
				forwardToWebview(msg.message)
				if (msg.message?.type === "state" && msg.message.state) {
					if (msg.message.state.language) {
						const newLang = (msg.message.state.language === "pl" || msg.message.state.language.startsWith("pl")) ? "pl" : "en"
						if (newLang !== currentLanguage) {
							currentLanguage = newLang
							localStorage.setItem("roo-language", currentLanguage)
							applyDesktopTranslations(currentLanguage)
						}
					}
					if (msg.message.state.apiConfiguration) {
						currentApiConfig = { ...currentApiConfig, ...msg.message.state.apiConfiguration }
						updateApiPill(currentApiConfig)
					}
					if (msg.message.state.currentApiConfigName) {
						currentApiProfileName = msg.message.state.currentApiConfigName
					}
					if (msg.message.state.currentTaskId) {
						activeTaskId = msg.message.state.currentTaskId
						renderSidebar()
					}
				}
				if (
					msg.message?.type === "taskHistoryUpdated" ||
					msg.message?.type === "taskHistoryItemUpdated" ||
					(msg.message?.type === "say" && msg.message?.say === "completion_result")
				) {
					fetchSidebarData()
				}
				if (msg.message?.type === "showTaskWithId" && msg.message.text) {
					activeTaskId = msg.message.text
					renderSidebar()
				}
				break

			case "workspaceInfo":
				currentWorkspace = msg.workspace
				renderWorkspaceInfo(msg.workspace)
				if (msg.workspace?.path) {
					sidebarData.currentWorkspace = msg.workspace.path
					if (!sidebarData.recentWorkspaces.some((w) => pathNormalize(w) === pathNormalize(msg.workspace.path))) {
						sidebarData.recentWorkspaces.unshift(msg.workspace.path)
					}
					projectExpansions.add(msg.workspace.path)
					renderSidebar()
				}
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
				if (
					msg.filePath === selectedPreviewFile ||
					(msg.filePath && selectedPreviewFile && msg.filePath.replace(/\\/g, "/") === selectedPreviewFile.replace(/\\/g, "/"))
				) {
					renderFilePreview(msg)
				}
				break

			case "error":
				console.error("Server error:", msg.message)
				if (selectedPreviewFile && previewContentAreaEl && previewContentAreaEl.querySelector(".preview-placeholder")) {
					previewContentAreaEl.innerHTML = `
						<div class="empty-state" style="color: var(--danger, #f04438);">
							<div class="empty-title">${escapeHtml(tDesktop("failedToLoadFilePreview"))}</div>
							<div class="empty-subtitle">${escapeHtml(msg.message || tDesktop("fileCouldNotBeOpened"))}</div>
						</div>
					`
				}
				break
		}
	}

	function updateAgentStatus(status) {
		currentAgentStatus = status
		const labels = {
			idle: tDesktop("statusConnected"),
			thinking: tDesktop("statusThinking"),
			executing: tDesktop("statusExecuting"),
			waiting_approval: tDesktop("statusWaitingApproval"),
			error: tDesktop("statusError"),
		}
		if (engineConnectionText) {
			engineConnectionText.textContent = labels[status] || status
		}
		if (engineConnectionBadge) {
			engineConnectionBadge.className = `engine-connection-badge status-${status === "idle" ? "connected" : status}`
			engineConnectionBadge.title = status === "idle" ? tDesktop("coreEngineConnected") : (labels[status] || status)
		}
	}

	let lastRenderedWorkspacePath = null

	function renderWorkspaceInfo(ws) {
		if (!ws) return
		if (ws.path && ws.path !== lastRenderedWorkspacePath) {
			lastRenderedWorkspacePath = ws.path
			expandedFolders.clear()
			hasUserToggledFolders = false
			selectedPreviewFile = null
			try {
				sessionStorage.removeItem("roo-expanded-folders")
			} catch (e) {}
		}
		if (workspaceNameEl) {
			workspaceNameEl.textContent = ws.name || ws.path
			workspaceNameEl.title = ws.path
		}
		if (footerWorkspaceEl) {
			footerWorkspaceEl.textContent = "Path: " + ws.path
		}

		if (ws.branch) {
			if (gitPill) gitPill.style.display = "flex"
			if (gitBranchEl) gitBranchEl.textContent = ws.branch
		} else {
			if (gitPill) gitPill.style.display = "none"
		}

		renderFilesTree(ws.files || [], filesSearchInput?.value?.toLowerCase() || "", ws.directories || [])
	}

	function renderDiffs() {
		diffFileCounterEl.textContent = tDesktop("filesCount", diffFiles.length)
		if (diffFiles.length === 0) {
			diffsFileListEl.innerHTML = `<div class="empty-state">${escapeHtml(tDesktop("noChangesAgent"))}</div>`
			diffContentEl.innerHTML = `
				<div class="diff-placeholder">
					<p id="diffs-placeholder-text">${escapeHtml(tDesktop("diffsPlaceholder"))}</p>
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
			diffContentEl.innerHTML = `<div class="empty-state">${escapeHtml(tDesktop("fileContentNotAvailable"))}</div>`
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
			terminalOutputEl.innerHTML = `<div class="terminal-empty" id="terminal-empty-text">${escapeHtml(tDesktop("terminalEmpty"))}</div>`
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
			case "py":
			case "pyw":
				return {
					icon: `<svg class="file-icon icon-code" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
					type: "code",
					badge: "PY",
				}
			case "yaml":
			case "yml":
				return {
					icon: `<svg class="file-icon icon-yaml" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>`,
					type: "yaml",
					badge: "YAML",
				}
			default:
				return {
					icon: `<svg class="file-icon icon-doc" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`,
					type: "text",
					badge: ext ? ext.toUpperCase() : "FILE",
				}
		}
	}

	let loadFilesAbortController = null

	async function loadWorkspaceFiles() {
		if (loadFilesAbortController) {
			loadFilesAbortController.abort()
		}
		loadFilesAbortController = new AbortController()
		const signal = loadFilesAbortController.signal

		try {
			const res = await fetch("/api/files", { signal })
			if (res.ok) {
				const data = await res.json()
				if (signal.aborted) return
				if (data && (Array.isArray(data.files) || Array.isArray(data.directories))) {
					if (!currentWorkspace) {
						currentWorkspace = { files: [], directories: [] }
					}
					currentWorkspace.files = Array.isArray(data.files) ? data.files : []
					currentWorkspace.directories = Array.isArray(data.directories) ? data.directories : []
					renderFilesTree(currentWorkspace.files, filesSearchInput?.value?.trim().toLowerCase() || "", currentWorkspace.directories)
					if (currentWorkspace.name) {
						return data.files
					}
				}
			}
		} catch (err) {
			if (err.name === "AbortError" || signal.aborted) {
				return
			}
			console.warn("Failed to load files from /api/files:", err)
		}

		try {
			if (signal.aborted) return
			const wsRes = await fetch("/api/workspace", { signal })
			if (wsRes.ok) {
				const wsData = await wsRes.json()
				if (signal.aborted) return
				if (wsData) {
					currentWorkspace = wsData
					renderWorkspaceInfo(wsData)
					return wsData.files
				}
			}
		} catch (e) {
			if (e.name === "AbortError" || signal.aborted) {
				return
			}
			console.error("Failed to load workspace from /api/workspace:", e)
		}
	}

	function ensureParentFoldersExpanded(filePath) {
		if (!filePath) return
		const parts = filePath.split(/[\\/]/).filter(Boolean)
		let cur = ""
		for (let i = 0; i < parts.length - 1; i++) {
			cur = cur ? `${cur}/${parts[i]}` : parts[i]
			expandedFolders.add(cur)
		}
	}

	function buildTree(files = [], directories = []) {
		const root = {
			name: "",
			path: "",
			type: "folder",
			children: new Map(),
		}

		// 1. Create nodes for all directories first
		if (Array.isArray(directories)) {
			for (const rawDir of directories) {
				if (typeof rawDir !== "string") continue
				const parts = rawDir.split(/[\\/]/).filter(Boolean)
				if (parts.length === 0) continue

				let current = root
				let currentPath = ""

				for (let i = 0; i < parts.length; i++) {
					const segment = parts[i]
					currentPath = currentPath ? `${currentPath}/${segment}` : segment

					let folder = current.children.get(segment)
					if (!folder || folder.type !== "folder") {
						folder = {
							type: "folder",
							name: segment,
							path: currentPath,
							children: new Map(),
						}
						current.children.set(segment, folder)
					}
					current = folder
				}
			}
		}

		// 2. Insert nodes for all files
		if (Array.isArray(files)) {
			for (const rawPath of files) {
				if (typeof rawPath !== "string") continue
				const parts = rawPath.split(/[\\/]/).filter(Boolean)
				if (parts.length === 0) continue

				let current = root
				let currentPath = ""

				for (let i = 0; i < parts.length; i++) {
					const segment = parts[i]
					const isFile = i === parts.length - 1
					currentPath = currentPath ? `${currentPath}/${segment}` : segment

					if (isFile) {
						current.children.set(segment, {
							type: "file",
							name: segment,
							path: currentPath,
						})
					} else {
						let folder = current.children.get(segment)
						if (!folder || folder.type !== "folder") {
							folder = {
								type: "folder",
								name: segment,
								path: currentPath,
								children: new Map(),
							}
							current.children.set(segment, folder)
						}
						current = folder
					}
				}
			}
		}

		return root
	}

	function renderTreeNodes(childrenMap, depth = 0, isSearchActive = false) {
		const nodes = Array.from(childrenMap.values())
		nodes.sort((a, b) => {
			if (a.type !== b.type) {
				return a.type === "folder" ? -1 : 1
			}
			return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
		})

		let html = ""
		for (const node of nodes) {
			if (node.type === "folder") {
				const isExpanded = isSearchActive || expandedFolders.has(node.path)
				const paddingLeft = 8 + depth * 14
				html += `
					<div class="folder-node ${isExpanded ? "expanded" : ""}" data-folder-path="${escapeHtml(node.path)}">
						<div class="folder-header" data-folder-path="${escapeHtml(node.path)}" style="padding-left: ${paddingLeft}px;" title="${escapeHtml(node.path)}">
							<span class="folder-chevron">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
							</span>
							<span class="folder-icon">
								<svg class="icon-folder-closed" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
								<svg class="icon-folder-open" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"></path></svg>
							</span>
							<span class="folder-name">${escapeHtml(node.name)}</span>
						</div>
						<div class="folder-children">
							${renderTreeNodes(node.children, depth + 1, isSearchActive)}
						</div>
					</div>
				`
			} else {
				const isSelected = selectedPreviewFile === node.path ? "selected" : ""
				const iconInfo = getFileIconInfo(node.path)
				const paddingLeft = 8 + depth * 14 + 19
				html += `
					<div class="file-node ${isSelected}" data-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}" style="padding-left: ${paddingLeft}px;">
						${iconInfo.icon}
						<span class="file-name">${escapeHtml(node.name)}</span>
					</div>
				`
			}
		}
		return html
	}

	function renderFilesTree(arg1, arg2, arg3) {
		let files = null
		let filter = null
		let directories = null

		const args = [arg1, arg2, arg3]
		for (const a of args) {
			if (typeof a === "string" && filter === null) {
				filter = a
			} else if (Array.isArray(a)) {
				if (files === null) {
					files = a
				} else if (directories === null) {
					directories = a
				}
			}
		}

		if (!files) {
			files = currentWorkspace?.files || []
		}
		if (!directories) {
			directories = currentWorkspace?.directories || []
		}
		if (typeof filter !== "string") {
			filter = filesSearchInput?.value || ""
		}

		// Guard against TypeError: ensure files and directories are arrays and filter out non-strings
		if (!Array.isArray(files)) {
			files = []
		}
		if (!Array.isArray(directories)) {
			directories = []
		}
		const validFiles = files.filter((f) => typeof f === "string" && f.trim().length > 0)
		const validDirs = directories.filter((d) => typeof d === "string" && d.trim().length > 0)

		if (currentWorkspace) {
			if (Array.isArray(files)) currentWorkspace.files = validFiles
			if (Array.isArray(directories)) currentWorkspace.directories = validDirs
		}

		if (!filesTreeEl) return

		const searchFilter = (filter || "").trim().toLowerCase()
		const isSearchActive = searchFilter.length > 0

		// Filter files and directories if search is active
		const filteredFiles = isSearchActive
			? validFiles.filter((f) => {
				const normalized = f.replace(/\\/g, "/")
				return normalized.toLowerCase().includes(searchFilter)
			})
			: validFiles

		const filteredDirs = isSearchActive
			? validDirs.filter((d) => {
				const normalized = d.replace(/\\/g, "/")
				return normalized.toLowerCase().includes(searchFilter)
			})
			: validDirs

		if (filteredFiles.length === 0 && filteredDirs.length === 0) {
			if (isSearchActive) {
				filesTreeEl.innerHTML = `
					<div class="empty-state">
						<svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
						</svg>
						<div class="empty-title">${escapeHtml(tDesktop("noFilesFound"))}</div>
						<div class="empty-subtitle">Try a different search query</div>
					</div>
				`
			} else {
				filesTreeEl.innerHTML = `
					<div class="empty-state">
						<svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
						</svg>
						<div class="empty-title">${escapeHtml(currentWorkspace?.path ? tDesktop("noFilesFound") : tDesktop("noWorkspaceOpen"))}</div>
						<div class="empty-subtitle">Workspace is empty or files are ignored</div>
					</div>
				`
			}
			return
		}

		const treeRoot = buildTree(filteredFiles, filteredDirs)

		// Folders remain collapsed by default on workspace load

		// If there is an active selected preview file, make sure its enclosing folders are expanded
		if (selectedPreviewFile && !isSearchActive) {
			ensureParentFoldersExpanded(selectedPreviewFile)
		}

		filesTreeEl.innerHTML = renderTreeNodes(treeRoot.children, 0, isSearchActive)
	}

	filesTreeEl?.addEventListener("click", (e) => {
		// 1. Check folder header click
		const folderHeader = e.target.closest(".folder-header")
		if (folderHeader) {
			const folderNode = folderHeader.closest(".folder-node")
			const folderPath = folderHeader.getAttribute("data-folder-path")
			if (folderNode && folderPath) {
				hasUserToggledFolders = true
				const isNowExpanded = folderNode.classList.toggle("expanded")
				if (isNowExpanded) {
					expandedFolders.add(folderPath)
				} else {
					expandedFolders.delete(folderPath)
				}
				saveFolderExpansions()
			}
			return
		}

		// 2. Check file node click
		const fileNode = e.target.closest(".file-node")
		if (fileNode) {
			const rawPath = fileNode.getAttribute("data-path")
			if (!rawPath) return
			const filePath = rawPath.replace(/\\/g, "/")
			selectedPreviewFile = filePath
			filesTreeEl.querySelectorAll(".file-node.selected").forEach((n) => n.classList.remove("selected"))
			fileNode.classList.add("selected")
			if (previewFilenameEl) previewFilenameEl.textContent = filePath
			if (previewContentAreaEl) {
				previewContentAreaEl.innerHTML = `<div class="preview-placeholder"><p>${escapeHtml(tDesktop("loadingFileTree"))}</p></div>`
			}
			sendToServer({ type: "readFile", filePath })
		}
	})

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
		const wrapClass = isCodeWrapped ? "wrapped" : ""
		let linesHtml = ""
		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1
			const lineContent = escapeHtml(lines[i]) || "&nbsp;"
			linesHtml += `<div class="code-line"><span class="code-line-num">${lineNum}</span><span class="code-line-text">${lineContent}</span></div>`
		}

		previewContentAreaEl.innerHTML = `
			<div class="code-editor-view ${wrapClass}" id="code-editor-view">
				${linesHtml}
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
		const view = document.getElementById("code-editor-view")
		if (view) {
			view.classList.toggle("wrapped", isCodeWrapped)
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

	// ==========================================
	// Provider Presets & Quick API Configuration
	// ==========================================
	const PROVIDER_PRESETS = {
		xkiro: {
			name: "xKiro",
			defaultBaseUrl: "https://api.xkiro.com/v1",
			defaultModel: "deepseek/deepseek-chat",
			showBaseUrl: true,
			baseUrlHint: "Default xKiro endpoint: https://api.xkiro.com/v1",
			keyHint: 'For xKiro, sign up at <a href="https://xkiro.com" target="_blank" class="link-accent">xkiro.com</a> to get free tokens.',
			keyPlaceholder: "Enter your xKiro API key...",
			models: [
				{ id: "deepseek/deepseek-chat", label: "xKiro DeepSeek-V3" },
				{ id: "deepseek/deepseek-reasoner", label: "xKiro DeepSeek-R1" },
				{ id: "anthropic/claude-3.7-sonnet", label: "xKiro Claude 3.7 Sonnet" },
				{ id: "anthropic/claude-3.5-sonnet", label: "xKiro Claude 3.5 Sonnet" },
				{ id: "openai/gpt-4o", label: "xKiro GPT-4o" },
				{ id: "openai/o1", label: "xKiro o1" },
				{ id: "openai/o3-mini", label: "xKiro o3-mini" },
				{ id: "google/gemini-2.5-pro", label: "xKiro Gemini 2.5 Pro" },
				{ id: "google/gemini-2.5-flash", label: "xKiro Gemini 2.5 Flash" },
				{ id: "qwen/qwen-2.5-coder-32b", label: "xKiro Qwen 2.5 Coder 32B" },
			],
		},
		openrouter: {
			name: "OpenRouter",
			defaultBaseUrl: "https://openrouter.ai/api/v1",
			defaultModel: "anthropic/claude-3.7-sonnet",
			showBaseUrl: false,
			baseUrlHint: "Default OpenRouter endpoint: https://openrouter.ai/api/v1",
			keyHint: 'Get your key from <a href="https://openrouter.ai/keys" target="_blank" class="link-accent">openrouter.ai/keys</a>',
			keyPlaceholder: "sk-or-v1-...",
			models: [
				{ id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
				{ id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
				{ id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
				{ id: "openai/gpt-4o", label: "GPT-4o" },
				{ id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
			],
		},
		anthropic: {
			name: "Anthropic",
			defaultBaseUrl: "",
			defaultModel: "claude-3-7-sonnet-20250219",
			showBaseUrl: false,
			baseUrlHint: "Official Anthropic API endpoint",
			keyHint: "Get your key from Anthropic Console (sk-ant-...)",
			keyPlaceholder: "sk-ant-api03-...",
			models: [
				{ id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
				{ id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet v2" },
				{ id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
			],
		},
		openai: {
			name: "OpenAI",
			defaultBaseUrl: "",
			defaultModel: "gpt-4o",
			showBaseUrl: false,
			baseUrlHint: "Official OpenAI API endpoint",
			keyHint: "Get your key from OpenAI Platform (sk-...)",
			keyPlaceholder: "sk-...",
			models: [
				{ id: "gpt-4o", label: "GPT-4o" },
				{ id: "gpt-4o-mini", label: "GPT-4o Mini" },
				{ id: "o3-mini", label: "o3-mini" },
			],
		},
		gemini: {
			name: "Google Gemini",
			defaultBaseUrl: "",
			defaultModel: "gemini-2.5-pro",
			showBaseUrl: false,
			baseUrlHint: "Google Generative AI endpoint",
			keyHint: "Get your key from Google AI Studio (AIza...)",
			keyPlaceholder: "AIzaSy...",
			models: [
				{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
				{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
				{ id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
			],
		},
		ollama: {
			name: "Ollama",
			defaultBaseUrl: "http://localhost:11434",
			defaultModel: "llama3.1",
			showBaseUrl: true,
			baseUrlHint: "Default Ollama instance: http://localhost:11434",
			keyHint: "Ollama runs locally on your machine. API key is not required.",
			keyPlaceholder: "(Optional)",
			models: [
				{ id: "llama3.1", label: "Llama 3.1" },
				{ id: "qwen2.5-coder:7b", label: "Qwen 2.5 Coder 7B" },
				{ id: "deepseek-r1:8b", label: "DeepSeek R1 8B" },
			],
		},
		"openai-compatible": {
			name: "OpenAI Compatible",
			defaultBaseUrl: "http://localhost:8000/v1",
			defaultModel: "default",
			showBaseUrl: true,
			baseUrlHint: "Enter full OpenAI-compatible endpoint (ending in /v1)",
			keyHint: "Enter API key required by the server.",
			keyPlaceholder: "API Key...",
			models: [],
		},
	}

	function updateApiPill(config) {
		if (!apiPillLabel) return
		if (!config) {
			apiPillLabel.textContent = "API: Configure"
			return
		}
		const provider = config.apiProvider || "xkiro"
		const model =
			config.xkiroModelId ||
			config.apiModelId ||
			config.openAiModelId ||
			config.openRouterModelId ||
			config.ollamaModelId ||
			""
		const hasKey = !!(
			config.apiKey ||
			config.xkiroApiKey ||
			config.openAiApiKey ||
			config.openRouterApiKey ||
			config.geminiApiKey ||
			provider === "ollama"
		)

		const providerNames = {
			xkiro: "xKiro",
			openrouter: "OpenRouter",
			anthropic: "Anthropic",
			openai: "OpenAI",
			gemini: "Gemini",
			ollama: "Ollama",
		}
		const pName = providerNames[provider] || provider

		let shortModel = ""
		if (model) {
			if (model.includes("deepseek-reasoner") || model.includes("deepseek-r1")) shortModel = "DeepSeek-R1"
			else if (model.includes("deepseek")) shortModel = "DeepSeek"
			else if (model.includes("claude-3-7") || model.includes("claude-3.7")) shortModel = "Claude 3.7"
			else if (model.includes("claude-3-5") || model.includes("claude-3.5")) shortModel = "Claude 3.5"
			else if (model.includes("gpt-4o-mini")) shortModel = "GPT-4o mini"
			else if (model.includes("gpt-4o")) shortModel = "GPT-4o"
			else if (model.includes("gemini-2.5")) shortModel = "Gemini 2.5"
			else if (model.includes("qwen")) shortModel = "Qwen"
			else shortModel = model.split("/").pop().split(":")[0]
		}

		if (!hasKey) {
			apiPillLabel.textContent = `API: ${pName} (No key)`
		} else if (shortModel) {
			apiPillLabel.textContent = `API: ${pName} (${shortModel})`
		} else {
			apiPillLabel.textContent = `API: ${pName}`
		}
	}

	function openSettingsTab() {
		switchDesktopTab("settings", "user", { section: "providers" })
	}

	function openApiModal() {
		if (!apiModalBackdrop) return
		apiModalBackdrop.style.display = "flex"
		populateApiModalFromConfig(currentApiConfig)
	}

	function closeApiModal() {
		if (!apiModalBackdrop) return
		apiModalBackdrop.style.display = "none"
	}

	function populateApiModalFromConfig(config) {
		let provider = config?.apiProvider || "xkiro"
		if (provider === "openai" && config?.openAiBaseUrl && !config.openAiBaseUrl.includes("openai.com")) {
			provider = "openai-compatible"
		}
		if (!PROVIDER_PRESETS[provider]) {
			provider = "xkiro"
		}

		if (apiProviderSelect) {
			apiProviderSelect.value = provider
		}
		updateModalFieldsForProvider(provider)

		if (config) {
			const key =
				config.xkiroApiKey ||
				config.apiKey ||
				config.openAiApiKey ||
				config.openRouterApiKey ||
				config.geminiApiKey ||
				""
			if (key && apiKeyInput) apiKeyInput.value = key

			const baseUrl =
				config.xkiroBaseUrl ||
				config.openAiBaseUrl ||
				config.ollamaBaseUrl ||
				config.openRouterBaseUrl ||
				""
			if (baseUrl && apiBaseUrlInput) apiBaseUrlInput.value = baseUrl

			const model =
				config.xkiroModelId ||
				config.apiModelId ||
				config.openAiModelId ||
				config.openRouterModelId ||
				config.ollamaModelId ||
				""
			if (model && apiModelInput) apiModelInput.value = model
		}
	}

	function updateModalFieldsForProvider(providerKey) {
		const preset = PROVIDER_PRESETS[providerKey] || PROVIDER_PRESETS.xkiro
		if (groupBaseUrl) {
			groupBaseUrl.style.display = preset.showBaseUrl ? "block" : "none"
		}
		if (baseUrlHint) {
			baseUrlHint.innerHTML = preset.baseUrlHint
		}
		if (apiKeyHint) {
			apiKeyHint.innerHTML = preset.keyHint
		}
		if (apiKeyInput) {
			apiKeyInput.placeholder = preset.keyPlaceholder
			let key = ""
			if (providerKey === "xkiro") key = currentApiConfig?.xkiroApiKey || (currentApiConfig?.apiProvider === "xkiro" ? currentApiConfig?.apiKey : "") || ""
			else if (providerKey === "openrouter") key = currentApiConfig?.openRouterApiKey || (currentApiConfig?.apiProvider === "openrouter" ? currentApiConfig?.apiKey : "") || ""
			else if (providerKey === "anthropic") key = (currentApiConfig?.apiProvider === "anthropic" ? currentApiConfig?.apiKey : "") || ""
			else if (providerKey === "openai" || providerKey === "openai-compatible") key = currentApiConfig?.openAiApiKey || (currentApiConfig?.apiProvider === "openai" ? currentApiConfig?.apiKey : "") || ""
			else if (providerKey === "gemini") key = currentApiConfig?.geminiApiKey || (currentApiConfig?.apiProvider === "gemini" ? currentApiConfig?.apiKey : "") || ""
			else if (providerKey === "ollama") key = currentApiConfig?.ollamaApiKey || ""
			apiKeyInput.value = key
		}
		if (apiBaseUrlInput && (!apiBaseUrlInput.value || (groupBaseUrl && groupBaseUrl.style.display !== "none"))) {
			apiBaseUrlInput.value = preset.defaultBaseUrl
		}
		if (apiModelInput && (!apiModelInput.value || !preset.models.some((m) => m.id === apiModelInput.value))) {
			apiModelInput.value = preset.defaultModel
		}

		// Populate datalist options
		if (modelSuggestions) {
			modelSuggestions.innerHTML = preset.models
				.map((m) => `<option value="${m.id}">${m.label}</option>`)
				.join("")
		}
	}

	function saveApiConfig() {
		const provider = apiProviderSelect ? apiProviderSelect.value : "xkiro"
		const baseUrl = apiBaseUrlInput ? apiBaseUrlInput.value.trim() : ""
		const apiKey = apiKeyInput ? apiKeyInput.value.trim() : ""
		const model = apiModelInput ? apiModelInput.value.trim() : ""

		let newConfig = {
			apiProvider: provider === "openai-compatible" ? "openai" : provider,
		}

		if (provider === "xkiro") {
			newConfig.apiKey = apiKey
			newConfig.xkiroApiKey = apiKey
			newConfig.xkiroBaseUrl = baseUrl || "https://api.xkiro.com/v1"
			newConfig.xkiroModelId = model || "deepseek/deepseek-chat"
			newConfig.openAiBaseUrl = baseUrl || "https://api.xkiro.com/v1"
			newConfig.openAiApiKey = apiKey
			newConfig.openAiModelId = model || "deepseek/deepseek-chat"
			newConfig.apiModelId = model || "deepseek/deepseek-chat"
		} else if (provider === "openrouter") {
			newConfig.apiKey = apiKey
			newConfig.openRouterApiKey = apiKey
			newConfig.openRouterModelId = model || "anthropic/claude-3.7-sonnet"
			newConfig.apiModelId = model || "anthropic/claude-3.7-sonnet"
			if (baseUrl) newConfig.openRouterBaseUrl = baseUrl
		} else if (provider === "anthropic") {
			newConfig.apiKey = apiKey
			newConfig.apiModelId = model || "claude-3-7-sonnet-20250219"
			if (baseUrl) newConfig.anthropicBaseUrl = baseUrl
		} else if (provider === "openai" || provider === "openai-compatible") {
			newConfig.apiKey = apiKey
			newConfig.openAiApiKey = apiKey
			newConfig.openAiModelId = model || "gpt-4o"
			newConfig.apiModelId = model || "gpt-4o"
			if (baseUrl) newConfig.openAiBaseUrl = baseUrl
		} else if (provider === "gemini") {
			newConfig.apiKey = apiKey
			newConfig.geminiApiKey = apiKey
			newConfig.apiModelId = model || "gemini-2.5-pro"
		} else if (provider === "ollama") {
			newConfig.ollamaBaseUrl = baseUrl || "http://localhost:11434"
			newConfig.ollamaModelId = model || "llama3.1"
			newConfig.apiModelId = model || "llama3.1"
			if (apiKey) newConfig.ollamaApiKey = apiKey
		}

		currentApiConfig = { ...currentApiConfig, ...newConfig }
		localStorage.setItem("roo-quick-api-config", JSON.stringify(currentApiConfig))

		// Send to server / extension
		sendToServer({
			type: "webviewMessage",
			message: {
				type: "upsertApiConfiguration",
				text: currentApiProfileName || "default",
				apiConfiguration: currentApiConfig,
			},
		})

		// Also forward to webview iframe so it updates state immediately
		forwardToWebview({
			type: "state",
			state: {
				apiConfiguration: currentApiConfig,
			},
		})

		updateApiPill(currentApiConfig)
		closeApiModal()
	}

	// Attach Settings & API Listeners
	settingsOpenBtn?.addEventListener("click", openSettingsTab)
	openFullSettingsFromModalBtn?.addEventListener("click", () => {
		closeApiModal()
		openSettingsTab()
	})

	quickApiBtn?.addEventListener("click", openApiModal)
	closeApiModalBtn?.addEventListener("click", closeApiModal)
	cancelApiModalBtn?.addEventListener("click", closeApiModal)
	saveApiConfigBtn?.addEventListener("click", saveApiConfig)


	apiProviderSelect?.addEventListener("change", (e) => {
		updateModalFieldsForProvider(e.target.value)
	})

	toggleKeyVisibilityBtn?.addEventListener("click", () => {
		if (!apiKeyInput) return
		if (apiKeyInput.type === "password") {
			apiKeyInput.type = "text"
			toggleKeyVisibilityBtn.textContent = "🙈"
		} else {
			apiKeyInput.type = "password"
			toggleKeyVisibilityBtn.textContent = "👁️"
		}
	})

	apiModalBackdrop?.addEventListener("click", (e) => {
		if (e.target === apiModalBackdrop) {
			closeApiModal()
		}
	})

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && apiModalBackdrop && apiModalBackdrop.style.display === "flex") {
			closeApiModal()
		}
	})

	// Initial pill sync
	updateApiPill(currentApiConfig)

	// Initialize
	connectWebSocket()
	loadWorkspaceFiles()
	fetchSidebarData()
})()
