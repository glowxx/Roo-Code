import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { DesktopAgentHost, type SidebarChatEntry } from "../../src/main/agent-host.js"

describe("Sidebar Lifecycle State & Indicator Derivation", () => {
	let tmpDir: string
	let tasksDir: string
	let agentHost: DesktopAgentHost

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sidebar-test-"))
		tasksDir = path.join(tmpDir, "global-storage", "tasks")
		fs.mkdirSync(tasksDir, { recursive: true })
		agentHost = new DesktopAgentHost({ workspacePath: "", storageDir: tmpDir, extensionPath: tmpDir })
	})

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		} catch {}
	})

	it("guarantees 0 full transcripts are loaded when deriving sidebar state", () => {
		const indexPath = path.join(tasksDir, "_index.json")
		const task1Dir = path.join(tasksDir, "task-1")
		fs.mkdirSync(task1Dir, { recursive: true })

		const indexData = {
			version: 1,
			updatedAt: Date.now(),
			entries: [
				{
					id: "task-1",
					number: 1,
					ts: Date.now(),
					task: "Test task",
					tokensIn: 100,
					tokensOut: 50,
					totalCost: 0.01,
					workspace: "/test/workspace",
					status: "completed",
					needsAttention: false,
				},
			],
		}
		fs.writeFileSync(indexPath, JSON.stringify(indexData))

		// Spy on fs.readFileSync to verify ui_messages.json is NEVER read
		const readFileSyncSpy = vi.spyOn(fs, "readFileSync")

		const chatsByWs = agentHost.getChatsByWorkspace()

		const transcriptReads = readFileSyncSpy.mock.calls.filter((call) => {
			const filePath = String(call[0])
			return filePath.includes("ui_messages.json") || filePath.includes("api_conversation_history.json")
		})

		expect(transcriptReads.length).toBe(0)
		readFileSyncSpy.mockRestore()
	})

	it("derives canonical indicators correctly on startup without opening chats (Phase 13 fixture)", () => {
		const indexPath = path.join(tasksDir, "_index.json")

		const entries = [
			// CHAT A: WAITING_USER (interrupted/waiting) -> !
			{
				id: "chat-a",
				number: 1,
				ts: 1000,
				task: "Chat A waiting user",
				workspace: "/test/workspace",
				status: "interrupted",
				needsAttention: true,
			},
			// CHAT B: INTERRUPTED_RESUMABLE -> !
			{
				id: "chat-b",
				number: 2,
				ts: 2000,
				task: "Chat B interrupted",
				workspace: "/test/workspace",
				status: "interrupted",
				needsAttention: true,
			},
			// CHAT C: COMPLETED_UNREAD -> blue dot
			{
				id: "chat-c",
				number: 3,
				ts: 3000,
				task: "Chat C completed unread",
				workspace: "/test/workspace",
				status: "completed",
				needsAttention: false,
				hasUnread: true,
			},
			// CHAT D: COMPLETED_READ -> nothing
			{
				id: "chat-d",
				number: 4,
				ts: 4000,
				task: "Chat D completed read",
				workspace: "/test/workspace",
				status: "completed",
				needsAttention: false,
				hasUnread: false,
			},
			// CHAT E: IDLE / NORMAL -> nothing
			{
				id: "chat-e",
				number: 5,
				ts: 5000,
				task: "Chat E idle normal",
				workspace: "/test/workspace",
				status: "completed",
				needsAttention: false,
			},
			// CHAT F: COMPLETED but stale persisted needsAttention=true -> nothing (USER BUG REPRO)
			{
				id: "chat-f",
				number: 6,
				ts: 6000,
				task: "Chat F completed with stale needsAttention",
				workspace: "/test/workspace",
				status: "completed",
				needsAttention: true,
				hasUnread: false,
			},
		]

		fs.writeFileSync(indexPath, JSON.stringify({ version: 1, updatedAt: Date.now(), entries }))

		const chatsByWs = agentHost.getChatsByWorkspace()
		const chats = Object.values(chatsByWs).flat() as SidebarChatEntry[]

		const chatA = chats.find((c) => c.id === "chat-a")
		const chatB = chats.find((c) => c.id === "chat-b")
		const chatC = chats.find((c) => c.id === "chat-c")
		const chatD = chats.find((c) => c.id === "chat-d")
		const chatE = chats.find((c) => c.id === "chat-e")
		const chatF = chats.find((c) => c.id === "chat-f")

		// CHAT A -> !
		expect(chatA?.status).toBe("needs_attention")

		// CHAT B -> !
		expect(chatB?.status).toBe("needs_attention")

		// CHAT C -> blue dot (status=completed, hasUnread=true)
		expect(chatC?.status).toBe("completed")
		expect(chatC?.hasUnread).toBe(true)

		// CHAT D -> nothing (status=completed, hasUnread=false)
		expect(chatD?.status).toBe("completed")
		expect(chatD?.hasUnread).toBe(false)

		// CHAT E -> nothing
		expect(chatE?.status).toBe("completed")
		expect(chatE?.hasUnread).toBe(false)

		// CHAT F -> MUST be "completed" (NOT "needs_attention") even if stale needsAttention=true!
		expect(chatF?.status).toBe("completed")
		expect(chatF?.hasUnread).toBe(false)
	})

	it("preserves running spinner for live running tasks regardless of stale flags", () => {
		const mockProvider: any = {
			runningTasks: new Map([
				[
					"live-task-1",
					{
						taskId: "live-task-1",
						taskStatus: "running",
						isStreaming: true,
						isTaskCompleted: false,
						clineMessages: [],
					},
				],
			]),
			taskHistoryStore: {
				getAll: () => [
					{
						id: "live-task-1",
						number: 1,
						ts: Date.now(),
						task: "Live task",
						workspace: "/test/workspace",
						status: "active",
						needsAttention: true, // Stale flag in index
					},
				],
			},
		}

		agentHost.registerWebviewProvider("test-view", mockProvider)

		const chatsByWs = agentHost.getChatsByWorkspace()
		const liveTask = (Object.values(chatsByWs).flat() as SidebarChatEntry[]).find((c) => c.id === "live-task-1")

		expect(liveTask?.status).toBe("running")
	})

	it("does not clear needs_attention on chat open if the task is still unresolved (READ != RESOLVED)", () => {
		const mockProvider: any = {
			runningTasks: new Map([
				[
					"unresolved-task",
					{
						taskId: "unresolved-task",
						taskStatus: "interactive",
						isStreaming: false,
						isStarted: false,
						currentAskType: "resume_task",
						isTaskCompleted: false,
						clineMessages: [
							{
								type: "ask",
								ask: "resume_task",
								approvalState: "USER_DECISION_REQUIRED",
							},
						],
					},
				],
			]),
			taskHistoryStore: {
				getAll: () => [
					{
						id: "unresolved-task",
						number: 1,
						ts: Date.now(),
						task: "Unresolved task",
						workspace: "/test/workspace",
						status: "interrupted",
						needsAttention: true,
						hasUnread: true,
					},
				],
			},
		}

		agentHost.registerWebviewProvider("test-view", mockProvider)

		// Simulate chat being opened
		agentHost.setActiveTaskId("unresolved-task")

		const chatsByWs = agentHost.getChatsByWorkspace()
		const chat = (Object.values(chatsByWs).flat() as SidebarChatEntry[]).find((c) => c.id === "unresolved-task")

		// READ != RESOLVED: status must remain needs_attention, even though opened and hasUnread cleared
		expect(chat?.status).toBe("needs_attention")
		expect(chat?.hasUnread).toBe(false) // active chat has no unread dot
	})

	it("transitions ! -> running spinner immediately when user approves decision (USER_DECISION_REQUIRED -> answered)", () => {
		const taskObj: any = {
			taskId: "approval-task",
			taskStatus: "interactive",
			isStreaming: false,
			isStarted: true,
			currentAskType: "command",
			isTaskCompleted: false,
			askResponse: undefined,
			clineMessages: [
				{
					type: "ask",
					ask: "command",
					approvalState: "USER_DECISION_REQUIRED",
					isAnswered: false,
				},
			],
		}

		const mockProvider: any = {
			runningTasks: new Map([["approval-task", taskObj]]),
			taskHistoryStore: {
				getAll: () => [
					{
						id: "approval-task",
						number: 1,
						ts: Date.now(),
						task: "Approval task",
						workspace: "/test/workspace",
						status: "active",
						needsAttention: false,
					},
				],
			},
		}

		agentHost.registerWebviewProvider("test-view", mockProvider)

		// 1. Prior to user decision -> needs_attention (!)
		let chats = Object.values(agentHost.getChatsByWorkspace()).flat() as SidebarChatEntry[]
		let chat = chats.find((c) => c.id === "approval-task")
		expect(chat?.status).toBe("needs_attention")

		// 2. User clicks Run / Approve -> task gets askResponse = 'yesButtonClicked'
		taskObj.askResponse = "yesButtonClicked"
		taskObj.taskStatus = "running"

		// Immediately status must become 'running' (spinner), without switching chat
		chats = Object.values(agentHost.getChatsByWorkspace()).flat() as SidebarChatEntry[]
		chat = chats.find((c) => c.id === "approval-task")
		expect(chat?.status).toBe("running")
	})

	it("maintains multi-chat isolation: approving Chat A does not alter Chat B waiting on approval", () => {
		const taskA: any = {
			taskId: "chat-a",
			taskStatus: "interactive",
			isStreaming: false,
			isStarted: true,
			currentAskType: "command",
			isTaskCompleted: false,
			askResponse: undefined,
			clineMessages: [
				{
					type: "ask",
					ask: "command",
					approvalState: "USER_DECISION_REQUIRED",
					isAnswered: false,
				},
			],
		}

		const taskB: any = {
			taskId: "chat-b",
			taskStatus: "interactive",
			isStreaming: false,
			isStarted: true,
			currentAskType: "followup",
			isTaskCompleted: false,
			askResponse: undefined,
			clineMessages: [
				{
					type: "ask",
					ask: "followup",
					approvalState: "USER_DECISION_REQUIRED",
					isAnswered: false,
				},
			],
		}

		const mockProvider: any = {
			runningTasks: new Map([
				["chat-a", taskA],
				["chat-b", taskB],
			]),
			taskHistoryStore: {
				getAll: () => [
					{ id: "chat-a", number: 1, ts: 1000, task: "Task A", workspace: "/test/workspace", status: "active" },
					{ id: "chat-b", number: 2, ts: 2000, task: "Task B", workspace: "/test/workspace", status: "active" },
				],
			},
		}

		agentHost.registerWebviewProvider("test-view", mockProvider)

		// Both are waiting for user
		let chats = Object.values(agentHost.getChatsByWorkspace()).flat() as SidebarChatEntry[]
		expect(chats.find((c) => c.id === "chat-a")?.status).toBe("needs_attention")
		expect(chats.find((c) => c.id === "chat-b")?.status).toBe("needs_attention")

		// Approve Chat A only
		taskA.askResponse = "yesButtonClicked"
		taskA.taskStatus = "running"

		chats = Object.values(agentHost.getChatsByWorkspace()).flat() as SidebarChatEntry[]
		// Chat A is now running (spinner)
		expect(chats.find((c) => c.id === "chat-a")?.status).toBe("running")
		// Chat B MUST remain needs_attention (!)
		expect(chats.find((c) => c.id === "chat-b")?.status).toBe("needs_attention")
	})

	it("emits taskHistoryChanged when sendToExtension receives askResponse", () => {
		const historySpy = vi.fn()
		agentHost.on("taskHistoryChanged", historySpy)

		agentHost.sendToExtension({
			type: "askResponse",
			askResponse: "yesButtonClicked",
		} as any)

		expect(historySpy).toHaveBeenCalled()
	})

	it("maps delegated parent to neutral completed status without attention while child runs", () => {
		const childTask = {
			taskId: "child-task-1",
			taskStatus: "running",
			isStreaming: true,
			isStarted: true,
			isTaskRunning: true,
			isTaskCompleted: false,
			askResponse: undefined,
			clineMessages: [],
		}

		const mockProvider: any = {
			runningTasks: new Map([["child-task-1", childTask]]),
			taskHistoryStore: {
				getAll: () => [
					{
						id: "parent-task-1",
						number: 1,
						ts: 1000,
						task: "Parent task",
						workspace: "/test/workspace",
						status: "delegated",
						awaitingChildId: "child-task-1",
						needsAttention: false,
					},
					{
						id: "child-task-1",
						number: 2,
						ts: 2000,
						task: "Child task",
						workspace: "/test/workspace",
						status: "active",
						parentTaskId: "parent-task-1",
					},
				],
			},
		}

		agentHost.registerWebviewProvider("test-view", mockProvider)

		const chats = Object.values(agentHost.getChatsByWorkspace()).flat() as SidebarChatEntry[]
		const parentChat = chats.find((c) => c.id === "parent-task-1")
		const childChat = chats.find((c) => c.id === "child-task-1")

		// Parent must NOT be needs_attention (no '!') and hasUnread must be false
		expect(parentChat?.status).toBe("completed")
		expect(parentChat?.hasUnread).toBe(false)

		// Child is running (spinner)
		expect(childChat?.status).toBe("running")
	})

	it("keeps delegated parent neutral when child task becomes interrupted with needs_attention", () => {
		const mockProvider: any = {
			runningTasks: new Map(),
			taskHistoryStore: {
				getAll: () => [
					{
						id: "parent-task-2",
						number: 1,
						ts: 1000,
						task: "Parent task",
						workspace: "/test/workspace",
						status: "delegated",
						awaitingChildId: "child-task-2",
						needsAttention: false,
					},
					{
						id: "child-task-2",
						number: 2,
						ts: 2000,
						task: "Child task",
						workspace: "/test/workspace",
						status: "interrupted",
						needsAttention: true,
						parentTaskId: "parent-task-2",
					},
				],
			},
		}

		agentHost.registerWebviewProvider("test-view", mockProvider)

		const chats = Object.values(agentHost.getChatsByWorkspace()).flat() as SidebarChatEntry[]
		const parentChat = chats.find((c) => c.id === "parent-task-2")
		const childChat = chats.find((c) => c.id === "child-task-2")

		// Parent remains neutral (no '!')
		expect(parentChat?.status).toBe("completed")
		expect(parentChat?.hasUnread).toBe(false)

		// Child has attention badge ('!')
		expect(childChat?.status).toBe("needs_attention")
	})
})

