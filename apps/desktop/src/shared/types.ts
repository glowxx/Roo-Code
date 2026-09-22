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
	ts: number
}

export interface SidebarData {
	recentWorkspaces: string[]
	currentWorkspace: string
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
	| { type: "getDiffs" }
	| { type: "clearTerminalLogs" }
	| { type: "getSidebarData" }
	| { type: "switchChat"; taskId: string; workspacePath?: string }
	| { type: "newChat"; workspacePath?: string }
	| { type: "removeRecentWorkspace"; path: string }

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
	| { type: "error"; message: string }
