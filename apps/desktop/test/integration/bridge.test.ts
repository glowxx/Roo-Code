import { describe, it, expect, beforeEach } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import type { TerminalLogEntry, DiffFileEntry, DesktopServerMessage } from "../../src/shared/types.js"

describe("Desktop Shell & Agent Host Integration Bridge", () => {
	let tempDir: string
	let host: DesktopAgentHost

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-bridge-test-"))
		host = new DesktopAgentHost({
			workspacePath: tempDir,
			extensionPath: tempDir,
		})
	})

	describe("Terminal Events in DesktopAgentHost", () => {
		it("should record terminalSessionStarted, append terminalOutput, and complete on terminalSessionEnded", async () => {
			const startedEvents: any[] = []
			const outputEvents: any[] = []
			const endedEvents: any[] = []
			const logEvents: TerminalLogEntry[] = []

			host.on("terminalSessionStarted", (e) => startedEvents.push(e))
			host.on("terminalOutput", (e) => outputEvents.push(e))
			host.on("terminalSessionEnded", (e) => endedEvents.push(e))
			host.on("terminalLog", (e) => logEvents.push(e))

			// 1. Session started
			;(host as any).processExtensionMessage({
				type: "terminalSessionStarted",
				id: "term-1",
				command: "pnpm test",
				cwd: tempDir,
				timestamp: 1000,
			})

			expect(startedEvents).toHaveLength(1)
			expect(startedEvents[0]!.id).toBe("term-1")
			expect(startedEvents[0]!.command).toBe("pnpm test")
			expect(host.getTerminalLogs()).toHaveLength(1)
			expect(host.getTerminalLogs()[0]!.status).toBe("running")

			// 2. Terminal output chunk 1
			;(host as any).processExtensionMessage({
				type: "terminalOutput",
				id: "term-1",
				data: "Running test suite...\n",
			})

			expect(outputEvents).toHaveLength(1)
			expect(outputEvents[0]!.data).toBe("Running test suite...\n")
			expect(host.getTerminalLogs()[0]!.output).toBe("Running test suite...\n")

			// 3. Terminal output chunk 2
			;(host as any).processExtensionMessage({
				type: "terminalOutput",
				id: "term-1",
				data: "All tests passed!\n",
			})

			expect(outputEvents).toHaveLength(2)
			expect(host.getTerminalLogs()[0]!.output).toBe("Running test suite...\nAll tests passed!\n")

			// 4. Session ended
			;(host as any).processExtensionMessage({
				type: "terminalSessionEnded",
				id: "term-1",
				exitCode: 0,
			})

			expect(endedEvents).toHaveLength(1)
			expect(endedEvents[0]!.exitCode).toBe(0)
			expect(host.getTerminalLogs()[0]!.status).toBe("completed")
			expect(host.getTerminalLogs()[0]!.exitCode).toBe(0)
		})
	})

	describe("Workspace File Changes in DesktopAgentHost", () => {
		it("should process workspaceFilesChanged and update diffFiles registry", async () => {
			const diffsEvents: DiffFileEntry[][] = []
			const wsChangedEvents: any[] = []

			host.on("diffsUpdated", (diffs) => diffsEvents.push(diffs))
			host.on("workspaceFilesChanged", (e) => wsChangedEvents.push(e))

			// Create a file in workspace
			const testFile = path.join(tempDir, "example.ts")
			fs.writeFileSync(testFile, "export const x = 1\n", "utf-8")

			;(host as any).processExtensionMessage({
				type: "workspaceFilesChanged",
				files: [
					{
						path: "example.ts",
						absolutePath: testFile,
						changeType: "modified",
						additions: 1,
						deletions: 0,
					},
				],
			})

			expect(wsChangedEvents).toHaveLength(1)
			expect(diffsEvents).toHaveLength(1)
			const diffs = host.getDiffFiles()
			expect(diffs).toHaveLength(1)
			expect(diffs[0]!.filePath).toBe("example.ts")
			expect(diffs[0]!.status).toBe("modified")
			expect(diffs[0]!.additions).toBe(1)
			expect(diffs[0]!.newContent).toContain("export const x = 1")
		})
	})

	describe("State Synchronization on Project & Chat Switching", () => {
		it("should archive terminal logs and reset active diffs when switching workspace", async () => {
			// Populate a terminal log
			;(host as any).processExtensionMessage({
				type: "terminalSessionStarted",
				id: "term-old",
				command: "echo old",
			})
			;(host as any).processExtensionMessage({
				type: "workspaceFilesChanged",
				files: [
					{
						path: "old.ts",
						changeType: "added",
						additions: 3,
						deletions: 0,
					},
				],
			})

			expect(host.getTerminalLogs()).toHaveLength(1)
			expect(host.getDiffFiles()).toHaveLength(1)

			const newWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-new-ws-"))

			await host.setWorkspace(newWorkspaceDir)

			// Active terminal logs should be reset
			expect(host.getTerminalLogs()).toHaveLength(0)
			// Old terminal logs should be archived
			expect(host.getArchivedTerminalLogs()).toHaveLength(1)
			expect(host.getArchivedTerminalLogs()[0]!.logs[0]!.id).toBe("term-old")
		})

		it("should reset active terminal logs and diffs on clearTask", async () => {
			;(host as any).processExtensionMessage({
				type: "terminalSessionStarted",
				id: "term-task",
				command: "build",
			})
			;(host as any).processExtensionMessage({
				type: "workspaceFilesChanged",
				files: [
					{
						path: "file.ts",
						changeType: "modified",
						additions: 2,
						deletions: 1,
					},
				],
			})

			expect(host.getTerminalLogs()).toHaveLength(1)
			expect(host.getDiffFiles()).toHaveLength(1)

			await host.clearTask()

			expect(host.getTerminalLogs()).toHaveLength(0)
			expect(host.getDiffFiles()).toHaveLength(0)
			expect(host.getArchivedTerminalLogs().length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("Desktop Shell Renderer Message Handling Simulation", () => {
		it("simulates WebSocket/IPC event reception in desktop renderer shell", () => {
			// Simulate renderer state
			let terminalLogs: TerminalLogEntry[] = []
			let diffFiles: DiffFileEntry[] = []
			let terminalBadge = 0
			let diffsBadge = 0

			// Simulate renderer handleServerMessage function from app.js
			function handleServerMessage(msg: DesktopServerMessage) {
				switch (msg.type) {
					case "terminalSessionStarted": {
						const existing = terminalLogs.find((l) => l.id === msg.id)
						if (!existing) {
							terminalLogs.push({
								id: msg.id,
								timestamp: msg.timestamp || Date.now(),
								command: msg.command || "",
								output: "",
								status: "running",
							})
							terminalBadge = terminalLogs.length
						}
						break
					}
					case "terminalOutput": {
						let target = msg.id ? terminalLogs.find((l) => l.id === msg.id) : null
						if (!target && terminalLogs.length > 0) {
							target = terminalLogs[terminalLogs.length - 1]!
						}
						if (target) {
							target.output = (target.output || "") + (msg.data || "")
						} else {
							terminalLogs.push({
								id: msg.id,
								timestamp: Date.now(),
								command: "Terminal",
								output: msg.data || "",
								status: "running",
							})
							terminalBadge = terminalLogs.length
						}
						break
					}
					case "terminalSessionEnded": {
						let endLog = msg.id ? terminalLogs.find((l) => l.id === msg.id) : null
						if (!endLog && terminalLogs.length > 0) {
							endLog = terminalLogs[terminalLogs.length - 1]!
						}
						if (endLog) {
							endLog.status = msg.exitCode === 0 ? "completed" : "error"
							endLog.exitCode = msg.exitCode
						}
						break
					}
					case "workspaceFilesChanged": {
						if (Array.isArray(msg.files)) {
							msg.files.forEach((f) => {
								const rel = f.path.replace(/\\/g, "/")
								const idx = diffFiles.findIndex((d) => d.filePath.replace(/\\/g, "/") === rel)
								const entry: DiffFileEntry = {
									filePath: rel,
									status: f.changeType === "created" ? "added" : f.changeType || "modified",
									additions: f.additions ?? 1,
									deletions: f.deletions ?? 0,
								}
								if (idx >= 0) diffFiles[idx] = { ...diffFiles[idx]!, ...entry }
								else diffFiles.push(entry)
							})
							diffsBadge = diffFiles.length
						}
						break
					}
					case "diffsUpdated": {
						diffFiles = msg.diffs || []
						diffsBadge = diffFiles.length
						break
					}
				}
			}

			// Simulate receiving terminalOutput
			handleServerMessage({
				type: "terminalSessionStarted",
				id: "s1",
				command: "git status",
				cwd: "/workspace",
				timestamp: Date.now(),
			})
			expect(terminalBadge).toBe(1)

			handleServerMessage({
				type: "terminalOutput",
				id: "s1",
				data: "On branch main\n",
			})
			expect(terminalLogs[0]!.output).toBe("On branch main\n")

			handleServerMessage({
				type: "terminalSessionEnded",
				id: "s1",
				exitCode: 0,
			})
			expect(terminalLogs[0]!.status).toBe("completed")

			// Simulate receiving workspaceFilesChanged
			handleServerMessage({
				type: "workspaceFilesChanged",
				files: [
					{
						path: "src/main.ts",
						absolutePath: "/workspace/src/main.ts",
						changeType: "modified",
						additions: 10,
						deletions: 2,
					},
					{
						path: "src/utils.ts",
						absolutePath: "/workspace/src/utils.ts",
						changeType: "created",
						additions: 40,
						deletions: 0,
					},
				],
			})

			expect(diffsBadge).toBe(2)
			expect(diffFiles).toHaveLength(2)
			expect(diffFiles[0]!.filePath).toBe("src/main.ts")
			expect(diffFiles[1]!.filePath).toBe("src/utils.ts")
		})
	})

	describe("Sidebar Chat Indicators, Precedence & Unread State Persistence", () => {
		it("should accurately classify running tasks without false needs_attention", () => {
			const mockRunningTasks = new Map<string, any>()
			const fakeProvider = {
				runningTasks: mockRunningTasks,
				taskHistoryStore: {
					getAll: () => [
						{ id: "task-running-1", task: "Task 1", ts: 1000, workspace: tempDir },
						{ id: "task-completed-1", task: "Task 2", ts: 2000, workspace: tempDir },
						{ id: "task-attention-1", task: "Task 3", ts: 3000, workspace: tempDir },
					],
				},
			}

			// Task 1: actively streaming
			mockRunningTasks.set("task-running-1", {
				taskId: "task-running-1",
				isStreaming: true,
				isTaskCompleted: false,
			})

			// Task 2: completed, blocked on resume_completed_task (must NOT be needs_attention!)
			mockRunningTasks.set("task-completed-1", {
				taskId: "task-completed-1",
				isStreaming: false,
				isTaskCompleted: true,
				currentAskType: "resume_completed_task",
				askResponse: undefined,
			})

			// Task 3: genuinely waiting on user followup question
			mockRunningTasks.set("task-attention-1", {
				taskId: "task-attention-1",
				isStreaming: false,
				isTaskCompleted: false,
				currentAskType: "followup",
				askResponse: undefined,
			})

			host.registerWebviewProvider("test-view", fakeProvider)
			const chatsByWs = host.getChatsByWorkspace()
			const chats = chatsByWs[path.normalize(path.resolve(tempDir))]!

			expect(chats).toBeDefined()
			const t1 = chats.find((c) => c.id === "task-running-1")
			const t2 = chats.find((c) => c.id === "task-completed-1")
			const t3 = chats.find((c) => c.id === "task-attention-1")

			expect(t1?.status).toBe("running")
			expect(t2?.status).toBe("completed") // NOT needs_attention!
			expect(t3?.status).toBe("needs_attention")
		})

		it("should flag background task completion as hasUnread=true and foreground completion as hasUnread=false", async () => {
			const storeItems = new Map<string, any>([
				["bg-task", { id: "bg-task", task: "Background Work", ts: 1000, workspace: tempDir }],
				["fg-task", { id: "fg-task", task: "Foreground Work", ts: 2000, workspace: tempDir }],
			])

			const fakeProvider = {
				runningTasks: new Map(),
				taskHistoryStore: {
					getAll: () => Array.from(storeItems.values()),
					get: (id: string) => storeItems.get(id),
					upsert: async (item: any) => {
						storeItems.set(item.id, item)
						return Array.from(storeItems.values())
					},
				},
			}

			host.registerWebviewProvider("test-view", fakeProvider)

			// Set active task to fg-task
			await host.setActiveTaskId("fg-task")
			expect(host.getActiveTaskId()).toBe("fg-task")

			// Background task completes
			await host.handleTaskCompleted("bg-task")
			expect(storeItems.get("bg-task").hasUnread).toBe(true)

			// Foreground task completes while user is viewing it
			await host.handleTaskCompleted("fg-task")
			expect(storeItems.get("fg-task").hasUnread).toBe(false)

			// Verify in chats list
			const chats = host.getChatsByWorkspace()[path.normalize(path.resolve(tempDir))]!
			const bgChat = chats.find((c) => c.id === "bg-task")
			const fgChat = chats.find((c) => c.id === "fg-task")
			expect(bgChat?.hasUnread).toBe(true)
			expect(fgChat?.hasUnread).toBe(false)
		})

		it("should clear hasUnread when user switches to chat or calls markChatRead", async () => {
			const storeItems = new Map<string, any>([
				["bg-task", { id: "bg-task", task: "Background Work", ts: 1000, workspace: tempDir, hasUnread: true }],
			])

			const fakeProvider = {
				runningTasks: new Map(),
				taskHistoryStore: {
					getAll: () => Array.from(storeItems.values()),
					get: (id: string) => storeItems.get(id),
					upsert: async (item: any) => {
						storeItems.set(item.id, item)
						return Array.from(storeItems.values())
					},
				},
			}

			host.registerWebviewProvider("test-view", fakeProvider)

			// Initially unread
			expect(storeItems.get("bg-task").hasUnread).toBe(true)

			// User opens/activates the chat
			await host.showTaskWithId("bg-task")
			expect(host.getActiveTaskId()).toBe("bg-task")
			expect(storeItems.get("bg-task").hasUnread).toBe(false)
			expect(storeItems.get("bg-task").lastReadTs).toBeGreaterThan(0)

			// Verify in chats list
			const chats = host.getChatsByWorkspace()[path.normalize(path.resolve(tempDir))]!
			expect(chats.find((c) => c.id === "bg-task")?.hasUnread).toBe(false)
		})

		it("should persist unread state to disk and survive host restart", async () => {
			const storageDir = path.join(tempDir, "storage")
			const tasksDir = path.join(storageDir, "global-storage", "tasks", "task-disk-1")
			fs.mkdirSync(tasksDir, { recursive: true })

			const historyItem = {
				id: "task-disk-1",
				task: "Disk Persisted Task",
				ts: Date.now(),
				workspace: tempDir,
				status: "completed",
				hasUnread: true,
				lastAssistantMessageTs: Date.now(),
			}
			fs.writeFileSync(path.join(tasksDir, "history_item.json"), JSON.stringify(historyItem, null, 2), "utf-8")

			// Create a brand new host instance pointing to same storageDir (simulating app restart)
			const host2 = new DesktopAgentHost({
				workspacePath: tempDir,
				extensionPath: tempDir,
				storageDir,
			})

			const chats = host2.getChatsByWorkspace()[path.normalize(path.resolve(tempDir))]!
			const chat = chats.find((c) => c.id === "task-disk-1")
			expect(chat).toBeDefined()
			expect(chat?.hasUnread).toBe(true)
			expect(chat?.status).toBe("completed")

			// Marking read updates disk
			await host2.markChatRead("task-disk-1")
			const onDisk = JSON.parse(fs.readFileSync(path.join(tasksDir, "history_item.json"), "utf-8"))
			expect(onDisk.hasUnread).toBe(false)
			expect(onDisk.lastReadTs).toBeGreaterThan(0)
		})

		it("should verify status precedence in UI rendering: running > needs_attention > completed_unread > completed_read", () => {
			// Helper mimicking app.js status slot calculation
			function computeIndicator(chat: { status?: string; hasUnread?: boolean }) {
				if (chat.status === "running") return "SPINNER"
				if (chat.status === "needs_attention") return "EXCLAMATION"
				if (chat.hasUnread) return "BLUE_DOT"
				return "EMPTY"
			}

			// Precedence 1: Running overrides unread and needs_attention
			expect(computeIndicator({ status: "running", hasUnread: true })).toBe("SPINNER")
			expect(computeIndicator({ status: "running", hasUnread: false })).toBe("SPINNER")

			// Precedence 2: Needs attention overrides unread
			expect(computeIndicator({ status: "needs_attention", hasUnread: true })).toBe("EXCLAMATION")
			expect(computeIndicator({ status: "needs_attention", hasUnread: false })).toBe("EXCLAMATION")

			// Precedence 3: Completed with unread shows Blue Dot
			expect(computeIndicator({ status: "completed", hasUnread: true })).toBe("BLUE_DOT")

			// Precedence 4: Completed and read is empty
			expect(computeIndicator({ status: "completed", hasUnread: false })).toBe("EMPTY")
		})
	})
})
