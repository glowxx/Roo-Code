import type { ExtensionMessage, WebviewMessage } from "@roo-code/types"

export interface WorkspaceInfo {
	path: string
	name: string
	branch?: string
	files?: string[]
	directories?: string[]
}

export interface TerminalLogEntry {
	id: string
	timestamp: number
	command: string
	cwd?: string
	taskId?: string
	output: string
	exitCode?: number
	status: "running" | "completed" | "error"
}

export interface DiffFileEntry {
	filePath: string
	oldContent?: string
	newContent?: string
	status: "modified" | "added" | "deleted"
	additions: number
	deletions: number
}

export type AgentStatusType = "idle" | "thinking" | "executing" | "waiting_approval" | "error"

export interface SidebarChatEntry {
	id: string
	title: string
	titleSource?: "generated_ai" | "manual" | "fallback"
	createdAt?: number
	ts: number
	status?: "running" | "needs_attention" | "queued" | "completed" | "failed"
	hasUnread?: boolean
	lastReadTs?: number
}

export interface SidebarData {
	recentWorkspaces: string[]
	projectNames?: Record<string, string>
	currentWorkspace: string
	activeTaskId?: string | null
	chats: Record<string, SidebarChatEntry[]>
}

export interface DesktopState {
	workspace: WorkspaceInfo
	agentStatus: AgentStatusType
	activeTab: "chat" | "diffs" | "terminal" | "files" | "settings"
	terminalLogs: TerminalLogEntry[]
	diffFiles: DiffFileEntry[]
}

export type DesktopClientMessage =
	| { type: "webviewMessage"; message: WebviewMessage }
	| { type: "selectFolder"; path?: string }
	| { type: "getWorkspaceInfo" }
	| { type: "readFile"; filePath: string }
	| { type: "showItem"; filePath: string }
	| { type: "openFile"; filePath: string }
	| { type: "getDiffs"; taskId?: string }
	| { type: "clearTerminalLogs" }
	| { type: "getSidebarData" }
	| { type: "switchChat"; taskId: string; workspacePath?: string }
	| { type: "newChat"; workspacePath?: string }
	| { type: "removeRecentWorkspace"; path: string }
	| { type: "markChatRead"; taskId: string }
	| { type: "deleteChat"; taskId: string; forceStop?: boolean }
	| { type: "removeProject"; path: string; forceStop?: boolean }
	| { type: "renameProject"; path: string; name: string | null }
	| { type: "openProjectFolder"; path: string }
	| { type: "renameChat"; taskId: string; title: string }
	| { type: "reorderWorkspaces"; workspaces: string[] }

export type DesktopServerMessage =
	| { type: "extensionMessage"; message: ExtensionMessage }
	| { type: "workspaceInfo"; workspace: WorkspaceInfo }
	| { type: "agentStatus"; status: AgentStatusType }
	| { type: "terminalLog"; entry: TerminalLogEntry }
	| { type: "terminalSessionStarted"; id: string; command: string; cwd: string; timestamp: number }
	| { type: "terminalOutput"; id: string; data: string }
	| { type: "terminalSessionEnded"; id: string; exitCode: number }
	| {
			type: "workspaceFilesChanged"
			files: Array<{
				path: string
				absolutePath: string
				changeType: "modified" | "created" | "deleted"
				additions?: number
				deletions?: number
			}>
	  }
	| { type: "diffsUpdated"; diffs: DiffFileEntry[] }
	| { type: "sidebarData"; data: SidebarData }
	| {
			type: "fileContent"
			filePath: string
			content: string
			fileName?: string
			ext?: string
			fileType?: string
			mimeType?: string
			size?: number
			rawText?: string
			isTruncated?: boolean
			error?: string
	  }
	| { type: "chatDeleted"; taskId: string; success: boolean; error?: string; requiresStop?: boolean }
	| { type: "projectRemoved"; path: string; success: boolean; error?: string; requiresStop?: boolean; activeTasksCount?: number }
	| { type: "projectRenameResult"; path: string; success: boolean; error?: string }
	| { type: "conversationTitleUpdated"; taskId: string; title: string; titleSource?: "generated_ai" | "manual" | "fallback" }
	| { type: "error"; message: string }
