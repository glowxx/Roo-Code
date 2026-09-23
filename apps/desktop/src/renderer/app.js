// Roo Code Desktop Client Application
(() => {
	// State
	let socket = null
	let currentWorkspace = null
	let terminalLogs = []
	let terminalSessions = []
	let selectedTerminalSessionId = null
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
	let latestExtensionState = null
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

	// Settings Modal elements
	const openSettingsBtn = document.getElementById("open-settings-btn")
	const settingsModalBackdrop = document.getElementById("settings-modal-backdrop")
	const closeSettingsModalBtn = document.getElementById("close-settings-modal-btn")
	const settingsWebviewFrame = document.getElementById("settings-webview-frame")
	const settingsModalTitleText = document.getElementById("settings-modal-title-text")

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
	const copyTerminalBtn = document.getElementById("copy-terminal-btn")
	const terminalCopyText = document.getElementById("terminal-copy-text")
	const terminalSidebarTitle = document.getElementById("terminal-sidebar-title")
	const terminalSessionCounter = document.getElementById("terminal-session-counter")
	const terminalSessionsList = document.getElementById("terminal-sessions-list")
	const terminalSessionsEmpty = document.getElementById("terminal-sessions-empty")
	const terminalSessionStatusBadge = document.getElementById("terminal-session-status-badge")

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
			terminalCopy: "Copy",
			terminalCopied: "Copied!",
			terminalEmpty: "Roo Code terminal command executions and logs will appear here.",
			terminalSessionsTitle: "Command Sessions",
			terminalSessionsCount: (count) => `${count} session${count === 1 ? "" : "s"}`,
			terminalSessionsEmpty: "No terminal sessions recorded.",
			sessionRunning: "Running",
			sessionCompleted: "Completed",
			sessionError: "Failed",

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
			terminalCopy: "Kopiuj",
			terminalCopied: "Skopiowano!",
			terminalEmpty: "Wyniki poleceń terminala i dzienniki wykonania Roo Code pojawią się tutaj.",
			terminalSessionsTitle: "Sesje poleceń",
			terminalSessionsCount: (count) => `${count} sesj${count === 1 ? "a" : count < 5 ? "e" : "i"}`,
			terminalSessionsEmpty: "Brak zarejestrowanych sesji terminala.",
			sessionRunning: "W toku",
			sessionCompleted: "Zakończono",
			sessionError: "Błąd",

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
		return "en"
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
		if (settingsModalTitleText) settingsModalTitleText.textContent = tDesktop("tabSettings")
		if (openSettingsBtn) openSettingsBtn.title = tDesktop("tabSettings")
		if (closeSettingsModalBtn) closeSettingsModalBtn.title = currentLanguage === "pl" ? "Zamknij (Esc)" : "Close (Esc)"

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
		if (terminalTitleText && !selectedTerminalSessionId) terminalTitleText.textContent = tDesktop("terminalTitle")
		if (terminalClearText) terminalClearText.textContent = tDesktop("terminalClear")
		if (terminalCopyText) terminalCopyText.textContent = tDesktop("terminalCopy")
		if (terminalEmptyText) terminalEmptyText.textContent = tDesktop("terminalEmpty")
		if (terminalSidebarTitle) terminalSidebarTitle.textContent = tDesktop("terminalSessionsTitle")
		if (terminalSessionCounter) terminalSessionCounter.textContent = tDesktop("terminalSessionsCount", terminalSessions.length)
		if (terminalSessionsEmpty) terminalSessionsEmpty.textContent = tDesktop("terminalSessionsEmpty")

		// 7. Sidebar elements
		if (sidebarHeaderTitleEl) sidebarHeaderTitleEl.textContent = tDesktop("workspaces")
		if (sidebarProjectsLabelEl) sidebarProjectsLabelEl.textContent = tDesktop("projectsSection")
		if (sidebarHintTextEl) sidebarHintTextEl.textContent = tDesktop("toggleSidebarHint")
		if (sidebarToggleBtn) sidebarToggleBtn.title = tDesktop("toggleSidebar")
	}

	// Apply initial desktop translations immediately
	applyDesktopTranslations(currentLanguage)

	// Tab state & performance flags (instant keep-alive)
	let diffsDirty = true
	let diffsRenderedOnce = false
	let terminalDirty = true
	let terminalRenderedOnce = false
	let lastRenderedTerminalSessionId = null
	let filesDirty = true

	function switchDesktopTab(targetTab, origin = "user", values = null) {
		if (!targetTab) return
		if (targetTab === "settings") {
			openSettingsModal()
			return
		}
		// Loop guard / idempotency check
		if (currentDesktopTab === targetTab) return

		const t0 = performance.now()
		const prevTab = currentDesktopTab
		currentDesktopTab = targetTab

		// Update nav tabs active styling (main tabs: chat, diffs, terminal, files)
		tabs.forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === targetTab))

		// Update panels active styling (chat, diffs, terminal, files)
		panels.forEach((p) => {
			p.classList.toggle("active", p.id === `tab-${targetTab}`)
		})

		// If switching to files tab and files tree is empty or requires refresh, load files
		if (targetTab === "files") {
			const isTreeEmpty = !filesTreeEl || filesTreeEl.children.length === 0 || filesTreeEl.querySelector(".empty-state")
			if (filesDirty || !currentWorkspace?.files || currentWorkspace.files.length === 0 || isTreeEmpty) {
				loadWorkspaceFiles()
				filesDirty = false
			}
		}

		if (targetTab === "diffs") {
			if (diffsDirty || !diffsRenderedOnce) {
				renderDiffs()
				diffsDirty = false
				diffsRenderedOnce = true
				sendToServer({ type: "getDiffs" })
			}
		}

		if (targetTab === "terminal") {
			if (terminalDirty || !terminalRenderedOnce || lastRenderedTerminalSessionId !== selectedTerminalSessionId) {
				renderTerminalLogs()
				terminalDirty = false
				terminalRenderedOnce = true
				lastRenderedTerminalSessionId = selectedTerminalSessionId
			}
		}

		// If user clicked in desktop shell, notify webview with origin: "sync"
		if (origin === "user") {
			if (targetTab === "chat") {
				forwardToWebview({
					type: "switchTab",
					tab: "chat",
					origin: "sync",
				})
			}
		}

		const switchDur = performance.now() - t0
		console.debug(`[TabPerf] Switched from ${prevTab || "none"} to ${targetTab} in ${switchDur.toFixed(2)}ms`)
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

	async function startNewChat(workspacePath) {
		if (workspacePath && (!currentWorkspace?.path || pathNormalize(workspacePath) !== pathNormalize(currentWorkspace.path))) {
			await selectWorkspaceFolder(workspacePath)
		}
		activeTaskId = null
		renderSidebar()

		// Reset active terminal logs and diffs for completed task
		terminalLogs = []
		diffFiles = []
		selectedDiffFile = null
		renderTerminalLogs()
		renderDiffs()
		if (terminalCountEl) terminalCountEl.textContent = "0"
		if (diffsCountEl) diffsCountEl.textContent = "0"

		sendToServer({ type: "newChat", workspacePath })
		sendToServer({ type: "webviewMessage", message: { type: "clearTask" } })

		forwardToWebview({ type: "action", action: "chatButtonClicked" })
		forwardToWebview({ type: "action", action: "clearTask" })
		forwardToWebview({ type: "action", action: "focusInput" })

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
		activeTaskId = null
		projectExpansions.add(wsPath)
		forwardToWebview({ type: "action", action: "switchWorkspace", workspacePath: wsPath })
		forwardToWebview({ type: "action", action: "clearTask" })
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
							<button class="project-action-btn project-new-chat-btn" data-action="new-chat-in-ws" data-workspace="${escapeHtml(ws)}" title="${escapeHtml(tDesktop("newChatInProject"))}">
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
				e.preventDefault()
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

	// Terminal Actions
	clearTerminalBtn?.addEventListener("click", () => {
		terminalSessions = []
		terminalLogs = []
		selectedTerminalSessionId = null
		renderTerminalSessions()
		renderActiveTerminalOutput()
		if (terminalCountEl) terminalCountEl.textContent = "0"
		sendToServer({ type: "clearTerminalLogs" })
	})

	copyTerminalBtn?.addEventListener("click", () => {
		const activeSession = terminalSessions.find((s) => s.id === selectedTerminalSessionId)
		if (!activeSession || !activeSession.output) return
		const cleanText = stripAnsi(activeSession.output)
		navigator.clipboard.writeText(cleanText).then(() => {
			if (terminalCopyText) {
				const orig = terminalCopyText.textContent
				terminalCopyText.textContent = tDesktop("terminalCopied")
				setTimeout(() => {
					terminalCopyText.textContent = orig
				}, 1500)
			}
		})
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

	// Setup Bidirectional Bridge with Iframes
	window.addEventListener("message", (event) => {
		if (event.data?.type === "toggleSidebar") {
			toggleSidebar()
			return
		}
		const isFromMainWebview = event.source === webviewFrame?.contentWindow
		const isFromSettingsWebview = Boolean(settingsWebviewFrame?.contentWindow && event.source === settingsWebviewFrame.contentWindow)

		// Listen to messages from both webview iframes
		if (isFromMainWebview || isFromSettingsWebview) {
			const data = event.data
			if (data) {
				if (isFromSettingsWebview && data.type === "webviewDidLaunch") {
					const theme = localStorage.getItem("roo-theme") || "linear-dark"
					settingsWebviewFrame.contentWindow?.postMessage({ type: "themeChange", theme }, "*")
					settingsWebviewFrame.contentWindow?.postMessage({ type: "languageChange", language: currentLanguage }, "*")
					if (latestExtensionState) {
						settingsWebviewFrame.contentWindow?.postMessage({ type: "state", state: latestExtensionState }, "*")
					}
					settingsWebviewFrame.contentWindow?.postMessage({
						type: "switchTab",
						tab: "settings",
						origin: "sync",
						values: { section: currentSettingsSection || "providers" },
					}, "*")
				}
				if (data.type === "languageChange" && data.language) {
					const newLang = (data.language === "pl" || data.language.startsWith("pl")) ? "pl" : "en"
					if (newLang !== currentLanguage) {
						currentLanguage = newLang
						localStorage.setItem("roo-language", currentLanguage)
						applyDesktopTranslations(currentLanguage)
					}
				}
				if (data.type === "state" && data.state) {
					latestExtensionState = { ...(latestExtensionState || {}), ...data.state }
					if (data.state.language) {
						const newLang = (data.state.language === "pl" || data.state.language.startsWith("pl")) ? "pl" : "en"
						if (newLang !== currentLanguage) {
							currentLanguage = newLang
							localStorage.setItem("roo-language", currentLanguage)
							applyDesktopTranslations(currentLanguage)
						}
					}
				}
				if (data.type === "themeChange" && data.theme) {
					applyDesktopTheme(data.theme)
				}
				if (data.type === "openSettings") {
					const targetSection = data.section || data.values?.section || "providers"
					openSettingsModal(targetSection)
					return
				}
				if (data.type === "switchTab" && data.tab) {
					if (isFromSettingsWebview && data.tab === "chat") {
						closeSettingsModal()
						return
					}
					if (data.tab === "settings") {
						const targetSection = data.values?.section || data.section || "providers"
						openSettingsModal(targetSection)
						return
					}
					switchDesktopTab(data.tab, "sync")
					return
				}
				if (data.type === "action" && data.action) {
					if (data.action === "chatButtonClicked" || (data.action === "switchTab" && data.tab === "chat")) {
						if (isFromSettingsWebview) {
							closeSettingsModal()
							return
						}
						switchDesktopTab("chat", "sync")
						return
					}
					if (data.action === "settingsButtonClicked" || (data.action === "switchTab" && data.tab === "settings")) {
						const targetSection = data.values?.section || data.section || "providers"
						openSettingsModal(targetSection)
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
		if (settingsWebviewFrame?.contentWindow && settingsWebviewFrame.getAttribute("src")) {
			settingsWebviewFrame.contentWindow.postMessage(msg, "*")
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
				if (msg.message?.type === "terminalSessionStarted") {
					handleServerMessage({ type: "terminalSessionStarted", ...msg.message })
				} else if (msg.message?.type === "terminalOutput") {
					handleServerMessage({ type: "terminalOutput", ...msg.message })
				} else if (msg.message?.type === "terminalSessionEnded") {
					handleServerMessage({ type: "terminalSessionEnded", ...msg.message })
				} else if (msg.message?.type === "workspaceFilesChanged") {
					handleServerMessage({ type: "workspaceFilesChanged", ...msg.message })
				} else if (msg.message?.type === "clearTask") {
					terminalLogs = []
					diffFiles = []
					selectedDiffFile = null
					renderTerminalLogs()
					renderDiffs()
					if (terminalCountEl) terminalCountEl.textContent = "0"
					if (diffsCountEl) diffsCountEl.textContent = "0"
				}
				if (msg.message?.type === "state" && msg.message.state) {
					latestExtensionState = { ...(latestExtensionState || {}), ...msg.message.state }
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
				if (msg.workspace?.path && (!currentWorkspace?.path || pathNormalize(msg.workspace.path) !== pathNormalize(currentWorkspace.path))) {
					terminalLogs = []
					diffFiles = []
					selectedDiffFile = null
					renderTerminalLogs()
					renderDiffs()
					if (terminalCountEl) terminalCountEl.textContent = "0"
					if (diffsCountEl) diffsCountEl.textContent = "0"
				}
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

			case "terminalSessionStarted": {
				const id = String(msg.id || `cmd-${Date.now()}`)
				let session = terminalSessions.find((s) => s.id === id)
				if (!session) {
					session = {
						id,
						command: msg.command || "",
						cwd: msg.cwd || currentWorkspace?.path || "",
						timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
						output: "",
						status: "running",
					}
					terminalSessions.unshift(session)
					if (terminalSessions.length > 200) terminalSessions.pop()
				} else {
					if (msg.command) session.command = msg.command
					if (msg.cwd) session.cwd = msg.cwd
					session.timestamp = typeof msg.timestamp === "number" ? msg.timestamp : session.timestamp
					session.status = "running"
				}
				if (!selectedTerminalSessionId || terminalSessions.length === 1) {
					selectedTerminalSessionId = id
				}
				renderTerminalSessions()
				if (selectedTerminalSessionId === id) {
					renderActiveTerminalOutput()
				}
				break
			}

			case "terminalOutput": {
				const id = String(msg.id || "")
				let session = id ? terminalSessions.find((s) => s.id === id) : undefined
				if (!session && terminalSessions.length > 0) {
					session = terminalSessions[0]
				}
				if (session) {
					session.output = (session.output || "") + (msg.data || "")
					if (selectedTerminalSessionId === session.id) {
						renderActiveTerminalOutput()
					}
				}
				break
			}

			case "terminalSessionEnded": {
				const id = String(msg.id || "")
				const exitCode = typeof msg.exitCode === "number" ? msg.exitCode : 0
				let session = id ? terminalSessions.find((s) => s.id === id) : undefined
				if (!session && terminalSessions.length > 0) {
					session = terminalSessions[0]
				}
				if (session) {
					session.exitCode = exitCode
					session.status = exitCode === 0 ? "completed" : "error"
					renderTerminalSessions()
					if (selectedTerminalSessionId === session.id) {
						renderActiveTerminalOutput()
					}
				}
				break
			}

			case "terminalLogsCleared":
				terminalSessions = []
				terminalLogs = []
				selectedTerminalSessionId = null
				renderTerminalSessions()
				renderActiveTerminalOutput()
				break

			case "terminalLog": {
				if (msg.entry && msg.entry.id) {
					const id = String(msg.entry.id)
					let session = terminalSessions.find((s) => s.id === id)
					if (!session) {
						session = {
							id,
							command: msg.entry.command || "",
							cwd: msg.entry.cwd || currentWorkspace?.path || "",
							timestamp: typeof msg.entry.timestamp === "number" ? msg.entry.timestamp : Date.now(),
							output: msg.entry.output || "",
							exitCode: msg.entry.exitCode,
							status: msg.entry.status || "running",
						}
						terminalSessions.unshift(session)
						if (terminalSessions.length > 200) terminalSessions.pop()
					} else {
						if (msg.entry.command) session.command = msg.entry.command
						if (msg.entry.cwd) session.cwd = msg.entry.cwd
						if (msg.entry.output) session.output = msg.entry.output
						if (msg.entry.exitCode !== undefined) session.exitCode = msg.entry.exitCode
						if (msg.entry.status) session.status = msg.entry.status
					}
					if (!selectedTerminalSessionId) {
						selectedTerminalSessionId = session.id
					}
					terminalDirty = true
					if (currentDesktopTab === "terminal") {
						renderTerminalSessions()
						if (selectedTerminalSessionId === session.id) {
							renderActiveTerminalOutput()
						}
						terminalDirty = false
						terminalRenderedOnce = true
						lastRenderedTerminalSessionId = selectedTerminalSessionId
					}
				}
				break
			}

			case "diffsUpdated":
				diffFiles = msg.diffs || []
				diffsDirty = true
				if (currentDesktopTab === "diffs") {
					renderDiffs()
					diffsDirty = false
					diffsRenderedOnce = true
				}
				if (diffsCountEl) diffsCountEl.textContent = String(diffFiles.length)
				break

			case "workspaceFilesChanged":
				diffsDirty = true
				filesDirty = true
				if (Array.isArray(msg.files) && msg.files.length > 0) {
					msg.files.forEach((f) => {
						const relPath = (f.path || "").replace(/\\/g, "/")
						if (!relPath) return
						const existingIdx = diffFiles.findIndex((d) => d.filePath.replace(/\\/g, "/") === relPath)
						const entry = {
							filePath: relPath,
							status: f.changeType || "modified",
							additions: typeof f.additions === "number" ? f.additions : 1,
							deletions: typeof f.deletions === "number" ? f.deletions : 0,
						}
						if (existingIdx >= 0) {
							diffFiles[existingIdx] = { ...diffFiles[existingIdx], ...entry }
						} else {
							diffFiles.push(entry)
						}
					})
					if (currentDesktopTab === "diffs") {
						renderDiffs()
						diffsDirty = false
						diffsRenderedOnce = true
					}
					if (diffsCountEl) diffsCountEl.textContent = String(diffFiles.length)
				} else {
					fetch("/api/diffs")
						.then((r) => (r.ok ? r.json() : []))
						.then((data) => {
							if (Array.isArray(data)) {
								diffFiles = data
								if (currentDesktopTab === "diffs") {
									renderDiffs()
									diffsDirty = false
									diffsRenderedOnce = true
								}
								if (diffsCountEl) diffsCountEl.textContent = String(diffFiles.length)
							}
						})
						.catch(() => {})
				}
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
		const count = diffFiles.length
		if (diffsCountEl) diffsCountEl.textContent = String(count)
		if (diffFileCounterEl) diffFileCounterEl.textContent = tDesktop("filesCount", count)

		const listPane = document.getElementById("diffs-list-pane")
		const targetList = diffsFileListEl || listPane?.querySelector(".diffs-list") || listPane

		if (!targetList) return

		if (count === 0) {
			targetList.innerHTML = `<div class="empty-state">${escapeHtml(tDesktop("noChangesAgent"))}</div>`
			if (diffViewerHeaderEl) {
				diffViewerHeaderEl.innerHTML = `<span class="diff-filename">${escapeHtml(tDesktop("selectFileToReview"))}</span>`
			}
			if (diffContentEl) {
				diffContentEl.innerHTML = `
					<div class="diff-placeholder">
						<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<circle cx="18" cy="18" r="3"></circle>
							<circle cx="6" cy="6" r="3"></circle>
							<path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
							<line x1="6" y1="9" x2="6" y2="21"></line>
						</svg>
						<p id="diffs-placeholder-text">${escapeHtml(tDesktop("diffsPlaceholder"))}</p>
					</div>
				`
			}
			return
		}

		// If no file is selected or selected file is no longer in diffFiles, select the first one
		if (!selectedDiffFile || !diffFiles.some((f) => f.filePath === selectedDiffFile)) {
			selectedDiffFile = diffFiles[0].filePath
		}

		targetList.innerHTML = ""
		diffFiles.forEach((file) => {
			const status = (file.status || "modified").toLowerCase()
			const isCreated = status === "created" || status === "added"
			const isDeleted = status === "deleted"
			const statusClass = isCreated ? "created" : isDeleted ? "deleted" : "modified"
			const statusChar = isCreated ? "A" : isDeleted ? "D" : "M"
			const statusTitle = isCreated ? "Created" : isDeleted ? "Deleted" : "Modified"

			const item = document.createElement("div")
			item.className = `diff-item ${selectedDiffFile === file.filePath ? "selected" : ""}`
			item.innerHTML = `
				<div class="diff-item-left">
					<span class="diff-type-badge ${statusClass}" title="${statusTitle}">${statusChar}</span>
					<span class="diff-file-path" title="${escapeHtml(file.filePath)}">${escapeHtml(file.filePath)}</span>
				</div>
				<div class="diff-stats">
					<span class="add">+${file.additions || 0}</span>
					<span class="del">-${file.deletions || 0}</span>
				</div>
			`
			item.addEventListener("click", () => {
				selectedDiffFile = file.filePath
				renderDiffs()
				loadAndRenderSelectedDiff(file)
			})
			targetList.appendChild(item)
		})

		const activeFile = diffFiles.find((f) => f.filePath === selectedDiffFile) || diffFiles[0]
		if (activeFile) {
			loadAndRenderSelectedDiff(activeFile)
		}
	}

	async function loadAndRenderSelectedDiff(file) {
		if (!file) return

		const status = (file.status || "modified").toLowerCase()
		const isCreated = status === "created" || status === "added"
		const isDeleted = status === "deleted"
		const statusClass = isCreated ? "created" : isDeleted ? "deleted" : "modified"
		const statusChar = isCreated ? "A" : isDeleted ? "D" : "M"
		const statusTitle = isCreated ? "Created" : isDeleted ? "Deleted" : "Modified"

		if (diffViewerHeaderEl) {
			diffViewerHeaderEl.innerHTML = `
				<div class="diff-viewer-title-row">
					<span class="diff-type-badge ${statusClass}" title="${statusTitle}">${statusChar}</span>
					<span class="diff-filename" style="font-weight:600; color:var(--text-primary);">${escapeHtml(file.filePath)}</span>
					<span style="font-size:11px; color:var(--text-muted); text-transform:capitalize;">(${escapeHtml(statusTitle)})</span>
				</div>
				<div class="diff-viewer-actions">
					<div class="diff-stats">
						<span class="add">+${file.additions || 0}</span>
						<span class="del">-${file.deletions || 0}</span>
					</div>
				</div>
			`
		}

		let diffData = file

		// If diff text or content not already present, fetch from /api/diff
		if (!diffData.diff && (diffData.newContent === undefined || diffData.oldContent === undefined)) {
			try {
				const res = await fetch(`/api/diff?path=${encodeURIComponent(file.filePath)}`)
				if (res.ok) {
					const data = await res.json()
					diffData = { ...file, ...data }
				}
			} catch (e) {
				console.warn("Error fetching /api/diff:", e)
			}
		}

		renderDiffContent(diffData)
	}

	function renderDiffContent(file) {
		if (!diffContentEl) return

		// 1. If we have unified diff output (from git diff or unified patch)
		if (file.diff && typeof file.diff === "string" && file.diff.trim().length > 0) {
			const lines = file.diff.split("\n")
			let html = ""
			let oldLineNum = 0
			let newLineNum = 0
			let inHunk = false

			for (const line of lines) {
				if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
					continue
				}
				if (line.startsWith("@@")) {
					const match = line.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
					if (match) {
						oldLineNum = parseInt(match[1], 10)
						newLineNum = parseInt(match[2], 10)
					}
					html += `<div class="diff-line hunk-header"><span class="diff-gutter"></span><span class="diff-prefix"></span><span class="diff-text">${escapeHtml(line)}</span></div>`
					inHunk = true
					continue
				}
				if (!inHunk) continue

				if (line.startsWith("+")) {
					html += `<div class="diff-line addition"><span class="diff-gutter">${newLineNum}</span><span class="diff-prefix">+</span><span class="diff-text">${escapeHtml(line.slice(1))}</span></div>`
					newLineNum++
				} else if (line.startsWith("-")) {
					html += `<div class="diff-line deletion"><span class="diff-gutter">${oldLineNum}</span><span class="diff-prefix">-</span><span class="diff-text">${escapeHtml(line.slice(1))}</span></div>`
					oldLineNum++
				} else {
					const text = line.startsWith(" ") ? line.slice(1) : line
					html += `<div class="diff-line same"><span class="diff-gutter">${newLineNum}</span><span class="diff-prefix"> </span><span class="diff-text">${escapeHtml(text)}</span></div>`
					oldLineNum++
					newLineNum++
				}
			}

			if (html) {
				diffContentEl.innerHTML = html
				return
			}
		}

		// 2. If we have oldContent and newContent
		if (file.oldContent !== undefined && file.newContent !== undefined && file.oldContent !== file.newContent) {
			const oldLines = file.oldContent.split("\n")
			const newLines = file.newContent.split("\n")
			const diffItems = computeLCSDiff(oldLines, newLines)
			let html = ""
			diffItems.forEach((item) => {
				if (item.type === "same") {
					html += `<div class="diff-line same"><span class="diff-gutter">${item.newNum || item.oldNum}</span><span class="diff-prefix"> </span><span class="diff-text">${escapeHtml(item.line)}</span></div>`
				} else if (item.type === "del") {
					html += `<div class="diff-line deletion"><span class="diff-gutter">${item.oldNum}</span><span class="diff-prefix">-</span><span class="diff-text">${escapeHtml(item.line)}</span></div>`
				} else if (item.type === "add") {
					html += `<div class="diff-line addition"><span class="diff-gutter">${item.newNum}</span><span class="diff-prefix">+</span><span class="diff-text">${escapeHtml(item.line)}</span></div>`
				}
			})
			diffContentEl.innerHTML = html
			return
		}

		// 3. Brand new file (all additions)
		if (file.status === "added" || file.status === "created" || (!file.oldContent && file.newContent)) {
			const lines = (file.newContent || "").split("\n")
			let html = ""
			lines.forEach((line, idx) => {
				html += `<div class="diff-line addition"><span class="diff-gutter">${idx + 1}</span><span class="diff-prefix">+</span><span class="diff-text">${escapeHtml(line)}</span></div>`
			})
			diffContentEl.innerHTML = html || `<div class="empty-state">Empty new file</div>`
			return
		}

		// 4. Deleted file (all deletions)
		if (file.status === "deleted" || (file.oldContent && !file.newContent)) {
			const lines = (file.oldContent || "").split("\n")
			let html = ""
			lines.forEach((line, idx) => {
				html += `<div class="diff-line deletion"><span class="diff-gutter">${idx + 1}</span><span class="diff-prefix">-</span><span class="diff-text">${escapeHtml(line)}</span></div>`
			})
			diffContentEl.innerHTML = html || `<div class="empty-state">Deleted file</div>`
			return
		}

		// 5. Fallback or no changes
		if (file.newContent || file.oldContent) {
			const lines = (file.newContent || file.oldContent || "").split("\n")
			let html = ""
			lines.forEach((line, idx) => {
				html += `<div class="diff-line same"><span class="diff-gutter">${idx + 1}</span><span class="diff-prefix"> </span><span class="diff-text">${escapeHtml(line)}</span></div>`
			})
			diffContentEl.innerHTML = html
			return
		}

		diffContentEl.innerHTML = `<div class="empty-state">${escapeHtml(tDesktop("fileContentNotAvailable"))}</div>`
	}

	// ANSI escape sequence parser & converter
	const ANSI_FG_COLORS = {
		30: "#4b5563", // Black / Dark gray
		31: "#ef4444", // Red
		32: "#10b981", // Green
		33: "#f59e0b", // Yellow
		34: "#3b82f6", // Blue
		35: "#ec4899", // Magenta
		36: "#06b6d4", // Cyan
		37: "#f1f5f9", // White
		90: "#64748b", // Bright Black (Gray)
		91: "#f87171", // Bright Red
		92: "#34d399", // Bright Green
		93: "#fbbf24", // Bright Yellow
		94: "#60a5fa", // Bright Blue
		95: "#f472b6", // Bright Magenta
		96: "#22d3ee", // Bright Cyan
		97: "#ffffff", // Bright White
	}

	const ANSI_BG_COLORS = {
		40: "#1f2937",
		41: "rgba(239, 68, 68, 0.25)",
		42: "rgba(16, 185, 129, 0.25)",
		43: "rgba(245, 158, 11, 0.25)",
		44: "rgba(59, 130, 246, 0.25)",
		45: "rgba(236, 72, 153, 0.25)",
		46: "rgba(6, 182, 212, 0.25)",
		47: "#f8fafc",
		100: "#374151",
		101: "rgba(248, 113, 113, 0.35)",
		102: "rgba(52, 211, 153, 0.35)",
		103: "rgba(251, 191, 36, 0.35)",
		104: "rgba(96, 165, 250, 0.35)",
		105: "rgba(244, 114, 182, 0.35)",
		106: "rgba(34, 211, 238, 0.35)",
		107: "#ffffff",
	}

	function stripAnsi(text) {
		if (!text || typeof text !== "string") return ""
		return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "")
	}

	function get256Color(n) {
		if (n < 8) return ANSI_FG_COLORS[30 + n] || "#f1f5f9"
		if (n < 16) return ANSI_FG_COLORS[90 + (n - 8)] || "#f1f5f9"
		if (n < 232) {
			const index = n - 16
			const r = Math.floor(index / 36) * 51
			const g = Math.floor((index % 36) / 6) * 51
			const b = (index % 6) * 51
			return `rgb(${r}, ${g}, ${b})`
		}
		const gray = 8 + (n - 232) * 10
		return `rgb(${gray}, ${gray}, ${gray})`
	}

	function ansiToHtml(text) {
		if (!text || typeof text !== "string") return ""
		const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
		const regex = /\x1b\[([0-9;?]*)m/g
		let html = ""
		let lastIndex = 0
		let currentStyles = {
			fg: null,
			bg: null,
			bold: false,
			dim: false,
			italic: false,
			underline: false,
		}

		function getSpanStyle() {
			const styles = []
			if (currentStyles.fg) styles.push(`color: ${currentStyles.fg}`)
			if (currentStyles.bg) styles.push(`background-color: ${currentStyles.bg}`)
			return styles.join("; ")
		}

		function getSpanClasses() {
			const classes = []
			if (currentStyles.bold) classes.push("ansi-bold")
			if (currentStyles.dim) classes.push("ansi-dim")
			if (currentStyles.italic) classes.push("ansi-italic")
			if (currentStyles.underline) classes.push("ansi-underline")
			return classes.join(" ")
		}

		function appendChunk(raw) {
			if (!raw) return
			const escaped = escapeHtml(raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ""))
			const style = getSpanStyle()
			const classes = getSpanClasses()
			if (style || classes) {
				const styleAttr = style ? ` style="${style}"` : ""
				const classAttr = classes ? ` class="${classes}"` : ""
				html += `<span${classAttr}${styleAttr}>${escaped}</span>`
			} else {
				html += escaped
			}
		}

		let match
		while ((match = regex.exec(cleaned)) !== null) {
			const textChunk = cleaned.slice(lastIndex, match.index)
			appendChunk(textChunk)
			lastIndex = regex.lastIndex

			const codes = (match[1] || "0").split(";").map((c) => parseInt(c, 10))
			for (let i = 0; i < codes.length; i++) {
				const code = codes[i]
				if (isNaN(code) || code === 0) {
					currentStyles = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }
				} else if (code === 1) {
					currentStyles.bold = true
				} else if (code === 2) {
					currentStyles.dim = true
				} else if (code === 3) {
					currentStyles.italic = true
				} else if (code === 4) {
					currentStyles.underline = true
				} else if (code === 22) {
					currentStyles.bold = false
					currentStyles.dim = false
				} else if (code === 23) {
					currentStyles.italic = false
				} else if (code === 24) {
					currentStyles.underline = false
				} else if (code === 39) {
					currentStyles.fg = null
				} else if (code === 49) {
					currentStyles.bg = null
				} else if (ANSI_FG_COLORS[code]) {
					currentStyles.fg = ANSI_FG_COLORS[code]
				} else if (ANSI_BG_COLORS[code]) {
					currentStyles.bg = ANSI_BG_COLORS[code]
				} else if (code === 38 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
					const n = codes[i + 2]
					currentStyles.fg = get256Color(n)
					i += 2
				} else if (code === 48 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
					const n = codes[i + 2]
					currentStyles.bg = get256Color(n)
					i += 2
				} else if (code === 38 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
					currentStyles.fg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`
					i += 4
				} else if (code === 48 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
					currentStyles.bg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`
					i += 4
				}
			}
		}

		appendChunk(cleaned.slice(lastIndex))
		return html
	}

	function renderTerminalSessions() {
		if (terminalSessionCounter) {
			terminalSessionCounter.textContent = tDesktop("terminalSessionsCount", terminalSessions.length)
		}
		if (terminalCountEl) {
			terminalCountEl.textContent = String(terminalSessions.length)
		}

		if (!terminalSessionsList) return

		if (terminalSessions.length === 0) {
			terminalSessionsList.innerHTML = `<div class="empty-state" id="terminal-sessions-empty">${escapeHtml(tDesktop("terminalSessionsEmpty"))}</div>`
			return
		}

		let html = ""
		terminalSessions.forEach((session) => {
			const isSelected = session.id === selectedTerminalSessionId
			const timeStr = session.timestamp ? new Date(session.timestamp).toLocaleTimeString() : ""
			const cwdDisplay = session.cwd ? session.cwd.split(/[/\\]/).filter(Boolean).pop() || session.cwd : ""

			let badgeHtml = ""
			if (session.status === "running") {
				badgeHtml = `<span class="session-badge badge-running"><span class="badge-dot"></span>${escapeHtml(tDesktop("sessionRunning"))}</span>`
			} else if (session.status === "error" || (typeof session.exitCode === "number" && session.exitCode !== 0)) {
				badgeHtml = `<span class="session-badge badge-error">exit ${session.exitCode ?? 1}</span>`
			} else {
				badgeHtml = `<span class="session-badge badge-completed">0</span>`
			}

			html += `
				<div class="terminal-session-item ${isSelected ? "selected" : ""}" data-session-id="${escapeHtml(session.id)}">
					<div class="terminal-session-header">
						<span class="terminal-session-cmd" title="${escapeHtml(session.command)}">$ ${escapeHtml(session.command || "command")}</span>
						${badgeHtml}
					</div>
					<div class="terminal-session-footer">
						<span class="terminal-session-cwd" title="${escapeHtml(session.cwd || "")}">${escapeHtml(cwdDisplay)}</span>
						<span class="terminal-session-time">${escapeHtml(timeStr)}</span>
					</div>
				</div>
			`
		})

		terminalSessionsList.innerHTML = html

		terminalSessionsList.querySelectorAll(".terminal-session-item").forEach((el) => {
			el.addEventListener("click", () => {
				const sessionId = el.getAttribute("data-session-id")
				if (sessionId && sessionId !== selectedTerminalSessionId) {
					selectedTerminalSessionId = sessionId
					renderTerminalSessions()
					renderActiveTerminalOutput()
				}
			})
		})
	}

	function renderActiveTerminalOutput() {
		if (!terminalOutputEl) return

		if (terminalSessions.length === 0) {
			terminalOutputEl.innerHTML = `<div class="terminal-empty" id="terminal-empty-text">${escapeHtml(tDesktop("terminalEmpty"))}</div>`
			if (terminalTitleText) terminalTitleText.textContent = tDesktop("terminalTitle")
			if (terminalSessionStatusBadge) terminalSessionStatusBadge.style.display = "none"
			return
		}

		let activeSession = terminalSessions.find((s) => s.id === selectedTerminalSessionId)
		if (!activeSession) {
			activeSession = terminalSessions[0]
			selectedTerminalSessionId = activeSession.id
			renderTerminalSessions()
		}

		if (terminalTitleText) {
			terminalTitleText.textContent = activeSession.command ? `$ ${activeSession.command}` : tDesktop("terminalTitle")
			terminalTitleText.title = activeSession.cwd ? `${activeSession.command} (in ${activeSession.cwd})` : activeSession.command
		}

		if (terminalSessionStatusBadge) {
			terminalSessionStatusBadge.style.display = "inline-flex"
			if (activeSession.status === "running") {
				terminalSessionStatusBadge.className = "terminal-session-status-badge session-badge badge-running"
				terminalSessionStatusBadge.innerHTML = `<span class="badge-dot"></span>${escapeHtml(tDesktop("sessionRunning"))}`
			} else if (activeSession.status === "error" || (typeof activeSession.exitCode === "number" && activeSession.exitCode !== 0)) {
				terminalSessionStatusBadge.className = "terminal-session-status-badge session-badge badge-error"
				terminalSessionStatusBadge.textContent = `exit ${activeSession.exitCode ?? 1}`
			} else {
				terminalSessionStatusBadge.className = "terminal-session-status-badge session-badge badge-completed"
				terminalSessionStatusBadge.textContent = "exit 0"
			}
		}

		const isNearBottom = terminalOutputEl.scrollHeight - terminalOutputEl.scrollTop - terminalOutputEl.clientHeight < 80

		if (!activeSession.output || !activeSession.output.trim()) {
			const emptyHtml = activeSession.status === "running"
				? `<div class="terminal-ansi-pre"><span style="color: var(--text-muted);">$ ${escapeHtml(activeSession.command)}\n[Running command in workspace...]</span></div>`
				: `<div class="terminal-ansi-pre"><span style="color: var(--text-muted);">$ ${escapeHtml(activeSession.command)}\n(Command completed with no output)</span></div>`
			if (terminalOutputEl._lastSessionId !== activeSession.id || terminalOutputEl._lastHtml !== emptyHtml) {
				terminalOutputEl.innerHTML = emptyHtml
				terminalOutputEl._lastSessionId = activeSession.id
				terminalOutputEl._lastHtml = emptyHtml
			}
		} else {
			if (activeSession._cachedOutput !== activeSession.output) {
				activeSession._cachedHtml = ansiToHtml(activeSession.output)
				activeSession._cachedOutput = activeSession.output
			}
			const parsedHtml = activeSession._cachedHtml
			if (terminalOutputEl._lastSessionId !== activeSession.id || terminalOutputEl._lastHtml !== parsedHtml) {
				terminalOutputEl.innerHTML = `<pre class="terminal-ansi-pre"><code>${parsedHtml}</code></pre>`
				terminalOutputEl._lastSessionId = activeSession.id
				terminalOutputEl._lastHtml = parsedHtml
			}
		}

		if (isNearBottom || activeSession.status === "running") {
			terminalOutputEl.scrollTop = terminalOutputEl.scrollHeight
		}
	}

	function renderTerminalLogs() {
		renderTerminalSessions()
		renderActiveTerminalOutput()
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

	let currentSettingsSection = "providers"

	function openSettingsModal(section = "providers") {
		if (section) {
			currentSettingsSection = section
		}
		if (!settingsModalBackdrop) return
		settingsModalBackdrop.classList.remove("hidden")

		if (settingsWebviewFrame) {
			const theme = localStorage.getItem("roo-theme") || "linear-dark"
			const sendInitSettings = () => {
				try {
					settingsWebviewFrame.contentWindow?.postMessage({ type: "themeChange", theme }, "*")
					settingsWebviewFrame.contentWindow?.postMessage({ type: "languageChange", language: currentLanguage }, "*")
					if (latestExtensionState) {
						settingsWebviewFrame.contentWindow?.postMessage({ type: "state", state: latestExtensionState }, "*")
					}
					settingsWebviewFrame.contentWindow?.postMessage({
						type: "switchTab",
						tab: "settings",
						origin: "sync",
						values: { section: currentSettingsSection || "providers" },
					}, "*")
				} catch (err) {
					console.warn("[SettingsModal] Failed to post init message to settings frame:", err)
				}
			}

			if (!settingsWebviewFrame.getAttribute("src") || settingsWebviewFrame.getAttribute("src") === "") {
				settingsWebviewFrame.addEventListener("load", () => {
					setTimeout(sendInitSettings, 50)
				}, { once: true })
				settingsWebviewFrame.src = "/webview/index.html?view=settings"
			} else {
				sendInitSettings()
			}
		}
	}

	function closeSettingsModal() {
		if (!settingsModalBackdrop) return
		settingsModalBackdrop.classList.add("hidden")
	}

	function openSettingsTab() {
		openSettingsModal()
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
	openSettingsBtn?.addEventListener("click", () => openSettingsModal("providers"))
	settingsOpenBtn?.addEventListener("click", () => openSettingsModal("providers"))
	closeSettingsModalBtn?.addEventListener("click", closeSettingsModal)
	settingsModalBackdrop?.addEventListener("click", (e) => {
		if (e.target === settingsModalBackdrop) {
			closeSettingsModal()
		}
	})
	openFullSettingsFromModalBtn?.addEventListener("click", () => {
		closeApiModal()
		openSettingsModal("providers")
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
		if (e.key === "Escape") {
			if (settingsModalBackdrop && !settingsModalBackdrop.classList.contains("hidden")) {
				closeSettingsModal()
				return
			}
			if (apiModalBackdrop && apiModalBackdrop.style.display === "flex") {
				closeApiModal()
			}
		}
	})

	// Initial pill sync
	updateApiPill(currentApiConfig)

	// Electron IPC Bridge
	if (window.__desktopAPI?.onExtensionMessage) {
		window.__desktopAPI.onExtensionMessage((_event, msg) => {
			if (msg && typeof msg === "object") {
				handleServerMessage(msg)
			}
		})
	}

	// Initialize
	connectWebSocket()
	loadWorkspaceFiles()
	fetchSidebarData()
})()
