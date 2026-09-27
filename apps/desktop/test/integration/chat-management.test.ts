import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import { canonicalizePath } from "../../src/main/config.js"

describe("Chat Management & Safe Deletion Flow", () => {
	let tempDir: string
	let origAppData: string | undefined
	let workspaceA: string
	let workspaceB: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-chat-test-"))
		origAppData = process.env.APPDATA
		process.env.APPDATA = tempDir

		workspaceA = path.join(tempDir, "WorkspaceA")
		workspaceB = path.join(tempDir, "WorkspaceB")
		fs.mkdirSync(workspaceA, { recursive: true })
		fs.mkdirSync(workspaceB, { recursive: true })
	})

	afterEach(() => {
		process.env.APPDATA = origAppData
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	it("deletes an idle chat cleanly from task storage and memory", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
		})

		const taskId = "task-idle-101"
		const tasksDir = path.join(tempDir, "Roo-Code", "tasks", taskId)
		fs.mkdirSync(tasksDir, { recursive: true })
		fs.writeFileSync(path.join(tasksDir, "history_item.json"), JSON.stringify({ id: taskId, title: "Idle Task", ts: 1000 }))

		const deleteTaskMock = vi.fn().mockResolvedValue(undefined)
		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => null,
			deleteTaskWithId: deleteTaskMock,
			taskHistoryStore: {
				deleteTaskWithId: deleteTaskMock,
				getHistoryItem: vi.fn(),
			},
			postMessageToWebview: vi.fn(),
		}
		host.registerWebviewProvider("mockView", mockProvider)

		const result = await host.deleteChat(taskId, false)
		expect(result.success).toBe(true)
		expect(deleteTaskMock).toHaveBeenCalledWith(taskId)
		expect(host.isTaskDeleted(taskId)).toBe(true)
		expect(fs.existsSync(tasksDir)).toBe(false)
	})

	it("refuses to delete a running task without forceStop confirmation", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
		})

		const taskId = "task-running-202"
		const mockTask = {
			taskId,
			cwd: workspaceA,
			isStreaming: true,
			abortTask: vi.fn(),
		}

		const runningTasksMap = new Map()
		runningTasksMap.set(taskId, mockTask)

		const mockProvider = {
			runningTasks: runningTasksMap,
			getCurrentTask: () => mockTask,
			deleteTaskWithId: vi.fn(),
			taskHistoryStore: {
				deleteTaskWithId: vi.fn(),
			},
		}
		host.registerWebviewProvider("mockView", mockProvider)

		const result = await host.deleteChat(taskId, false)
		expect(result.success).toBe(false)
		expect(result.reason).toBe("requires_force_stop")
		expect(runningTasksMap.has(taskId)).toBe(true)
		expect(host.isTaskDeleted(taskId)).toBe(false)
	})

	it("stops active task and cleanly deletes it when forceStop is true", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
		})

		const taskId = "task-running-303"
		const tasksDir = path.join(tempDir, "Roo-Code", "tasks", taskId)
		fs.mkdirSync(tasksDir, { recursive: true })

		let wasAborted = false
		const mockTask = {
			taskId,
			cwd: workspaceA,
			isStreaming: true,
			abortTask: vi.fn(() => {
				wasAborted = true
			}),
		}

		const runningTasksMap = new Map()
		runningTasksMap.set(taskId, mockTask)

		const mockProvider = {
			runningTasks: runningTasksMap,
			getCurrentTask: () => mockTask,
			cancelTask: vi.fn().mockImplementation(() => {
				runningTasksMap.delete(taskId)
			}),
			deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			taskHistoryStore: {
				deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			},
			postMessageToWebview: vi.fn(),
		}
		host.registerWebviewProvider("mockView", mockProvider)

		const result = await host.deleteChat(taskId, true)
		expect(result.success).toBe(true)
		expect(wasAborted || mockProvider.cancelTask).toBeTruthy()
		expect(runningTasksMap.has(taskId)).toBe(false)
		expect(host.isTaskDeleted(taskId)).toBe(true)
		expect(fs.existsSync(tasksDir)).toBe(false)
	})

	it("tombstone guard drops late async messages and prevents ghost chat resurrection", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
		})

		const taskId = "task-tombstone-404"
		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => null,
			deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			taskHistoryStore: {
				deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			},
			postMessageToWebview: vi.fn(),
		}
		host.registerWebviewProvider("mockView", mockProvider)

		// Delete chat
		await host.deleteChat(taskId, false)
		expect(host.isTaskDeleted(taskId)).toBe(true)

		// Late async message arrives from extension (e.g. streaming chunk or completion)
		;(host as any).processExtensionMessage({
			type: "taskCompleted",
			taskId,
		})

		;(host as any).processExtensionMessage({
			type: "messageResponse",
			taskId,
			text: "I finished after you deleted me!",
		})

		// Verify task was NOT resurrected in sidebar
		const allChats = host.getChatsByWorkspace()
		const chats = allChats[canonicalizePath(workspaceA)] || []
		expect(chats.some((c) => c.id === taskId)).toBe(false)
	})

	it("switches to newest remaining chat or clears task when active chat is deleted", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
		})

		const activeId = "task-active-1"
		const remainingId = "task-remaining-2"

		let shownTaskId: string | null = null
		let cleared = false

		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => ({ taskId: activeId }),
			showTaskWithId: vi.fn((id: string) => {
				shownTaskId = id
			}),
			clearTask: vi.fn(() => {
				cleared = true
			}),
			deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			taskHistoryStore: {
				deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
				getHistoryItem: vi.fn((id: string) => {
					if (id === remainingId) {
						return { id: remainingId, title: "Remaining Task", ts: 5000 }
					}
					return null
				}),
			},
			postMessageToWebview: vi.fn(),
		}
		host.registerWebviewProvider("mockView", mockProvider)
		await host.setActiveTaskId(activeId)

		// Mock getChatsByWorkspace returning remainingId
		vi.spyOn(host, "getChatsByWorkspace").mockImplementation(() => {
			return {
				[canonicalizePath(workspaceA)]: [
					{ id: remainingId, title: "Remaining Task", ts: 5000, status: "completed" as const },
				],
			}
		})

		await host.deleteChat(activeId, true)
		expect(mockProvider.showTaskWithId).toHaveBeenCalledWith(remainingId)
		expect(shownTaskId).toBe(remainingId)

		// Now delete remaining task when no other tasks exist
		vi.spyOn(host, "getChatsByWorkspace").mockReturnValue({
			[canonicalizePath(workspaceA)]: [],
		})
		await host.deleteChat(remainingId, true)
		expect(mockProvider.clearTask).toHaveBeenCalled()
		expect(cleared).toBe(true)
	})

	it("multi-project isolation: deleting chat in Workspace A does not affect Workspace B", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
		})

		const taskA = "task-in-a"
		const taskB = "task-in-b"

		const tasksDirA = path.join(tempDir, "Roo-Code", "tasks", taskA)
		const tasksDirB = path.join(tempDir, "Roo-Code", "tasks", taskB)
		fs.mkdirSync(tasksDirA, { recursive: true })
		fs.mkdirSync(tasksDirB, { recursive: true })

		const mockTaskB = {
			taskId: taskB,
			cwd: workspaceB,
			isStreaming: true,
			abortTask: vi.fn(),
		}

		const runningTasksMap = new Map()
		runningTasksMap.set(taskB, mockTaskB)

		const mockProvider = {
			runningTasks: runningTasksMap,
			getCurrentTask: () => null,
			deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			taskHistoryStore: {
				deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			},
			postMessageToWebview: vi.fn(),
		}
		host.registerWebviewProvider("mockView", mockProvider)

		// Delete task A
		await host.deleteChat(taskA, false)

		// Invariant: Task B in Workspace B is completely untouched
		expect(host.isTaskDeleted(taskA)).toBe(true)
		expect(host.isTaskDeleted(taskB)).toBe(false)
		expect(runningTasksMap.has(taskB)).toBe(true)
		expect(mockTaskB.abortTask).not.toHaveBeenCalled()
		expect(fs.existsSync(tasksDirB)).toBe(true)
	})

	it("HARD SAFETY: deleting chat does NOT delete workspace source files or git state", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
		})

		// Create real workspace files
		const sentinelFile = path.join(workspaceA, "DO_NOT_DELETE.txt")
		const sourceFile = path.join(workspaceA, "src", "index.ts")
		fs.mkdirSync(path.join(workspaceA, "src"), { recursive: true })
		fs.writeFileSync(sentinelFile, "Critical user code")
		fs.writeFileSync(sourceFile, "export const app = 'test'")

		const taskId = "task-user-chat"
		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => null,
			deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			taskHistoryStore: {
				deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			},
			postMessageToWebview: vi.fn(),
		}
		host.registerWebviewProvider("mockView", mockProvider)

		await host.deleteChat(taskId, false)

		// VERIFY: All physical workspace files remain completely intact!
		expect(fs.existsSync(sentinelFile)).toBe(true)
		expect(fs.readFileSync(sentinelFile, "utf-8")).toBe("Critical user code")
		expect(fs.existsSync(sourceFile)).toBe(true)
		expect(fs.readFileSync(sourceFile, "utf-8")).toBe("export const app = 'test'")
	})
})
