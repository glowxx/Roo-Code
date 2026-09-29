import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import { canonicalizePath } from "../../src/main/config.js"

describe("Sidebar Concurrency & Spatial Stability (Problem 2)", () => {
	let tempDir: string
	let origAppData: string | undefined
	let workspaceA: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-stability-test-"))
		origAppData = process.env.APPDATA
		process.env.APPDATA = tempDir

		workspaceA = path.join(tempDir, "WorkspaceA")
		fs.mkdirSync(workspaceA, { recursive: true })
	})

	afterEach(() => {
		process.env.APPDATA = origAppData
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	it("1. Multiple chats created with distinct timestamps preserve exact descending creation order", () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
			storageDir: tempDir,
		})

		const t1 = 1700000000000
		const t2 = 1700000010000
		const t3 = 1700000020000

		const storedItems = [
			{ id: "task-1", task: "Chat 1", workspace: workspaceA, createdAt: t1, ts: t1 },
			{ id: "task-2", task: "Chat 2", workspace: workspaceA, createdAt: t2, ts: t2 },
			{ id: "task-3", task: "Chat 3", workspace: workspaceA, createdAt: t3, ts: t3 },
		]

		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => null,
			taskHistoryStore: {
				getAll: () => [...storedItems],
				get: (id: string) => storedItems.find((i) => i.id === id),
				isDeleted: () => false,
			},
		}
		host.registerWebviewProvider("mockView", mockProvider)

		const chats = host.getChatsByWorkspace()[canonicalizePath(workspaceA)] || []
		expect(chats).toHaveLength(3)
		// Descending creation order: task-3 (newest), task-2, task-1 (oldest)
		expect(chats[0]!.id).toBe("task-3")
		expect(chats[1]!.id).toBe("task-2")
		expect(chats[2]!.id).toBe("task-1")
	})

	it("2. Simulating 50 internal agent activity events on an older chat never changes its position in getChatsByWorkspace()", () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
			storageDir: tempDir,
		})

		const t1 = 1700000000000
		const t2 = 1700000010000
		const t3 = 1700000020000

		const item1 = { id: "task-1", task: "Chat 1", workspace: workspaceA, createdAt: t1, ts: t1 }
		const item2 = { id: "task-2", task: "Chat 2", workspace: workspaceA, createdAt: t2, ts: t2 }
		const item3 = { id: "task-3", task: "Chat 3", workspace: workspaceA, createdAt: t3, ts: t3 }

		const storedItems = [item1, item2, item3]

		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => null,
			taskHistoryStore: {
				getAll: () => [...storedItems],
				get: (id: string) => storedItems.find((i) => i.id === id),
				isDeleted: () => false,
			},
		}
		host.registerWebviewProvider("mockView", mockProvider)

		// Verify initial order: task-3, task-2, task-1
		let chats = host.getChatsByWorkspace()[canonicalizePath(workspaceA)] || []
		expect(chats.map((c) => c.id)).toEqual(["task-3", "task-2", "task-1"])

		// Simulate 50 internal agent events (thinking, tool execution, chunks, completions) on task-1
		// Each event bumps item1.ts far beyond task-3's creation time!
		for (let step = 1; step <= 50; step++) {
			item1.ts = t3 + step * 1000 // ts goes from 1700000021000 to 1700000070000

			chats = host.getChatsByWorkspace()[canonicalizePath(workspaceA)] || []
			// Order MUST REMAIN rock-solid: task-3, task-2, task-1
			expect(chats.map((c) => c.id)).toEqual(["task-3", "task-2", "task-1"])
			expect(chats[2]!.id).toBe("task-1")
			// Runtime ts should update for timeago calculation without altering position
			expect(chats[2]!.ts).toBe(item1.ts)
		}
	})

	it("3. Background title generation updates the title without reordering or moving the chat", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
			storageDir: tempDir,
		})

		const t1 = 1700000000000
		const t2 = 1700000010000
		const t3 = 1700000020000

		const item1 = { id: "task-1", task: "Initial prompt 1", workspace: workspaceA, createdAt: t1, ts: t1 }
		const item2 = { id: "task-2", task: "Initial prompt 2", workspace: workspaceA, createdAt: t2, ts: t2 }
		const item3 = { id: "task-3", task: "Initial prompt 3", workspace: workspaceA, createdAt: t3, ts: t3 }

		const storedItems = [item1, item2, item3]
		const completePrompt = vi.fn().mockResolvedValue("Generated Semantic Title")
		const currentTask = { taskId: "task-1", api: { completePrompt }, isStreaming: false, taskStatus: "idle" }

		const mockProvider = {
			runningTasks: new Map([["task-1", currentTask]]),
			getCurrentTask: () => currentTask,
			taskHistoryStore: {
				getAll: () => [...storedItems],
				get: (id: string) => storedItems.find((i) => i.id === id),
				upsert: vi.fn(async (item) => {
					const idx = storedItems.findIndex((i) => i.id === item.id)
					if (idx !== -1) {
						storedItems[idx] = { ...storedItems[idx], ...item }
					}
					return [...storedItems]
				}),
				isDeleted: () => false,
			},
		}
		host.registerWebviewProvider("mockView", mockProvider)

		const historyChangedSpy = vi.fn()
		host.on("taskHistoryChanged", historyChangedSpy)

		// Trigger background title generation on task-1 (at the bottom)
		host.triggerBackgroundTitleGeneration("task-1", "Initial prompt 1")

		await vi.waitFor(() => {
			expect(completePrompt).toHaveBeenCalled()
			expect((storedItems[0] as any).title).toBe("Generated Semantic Title")
		})

		// Critical: background title generation must NOT emit taskHistoryChanged
		expect(historyChangedSpy).not.toHaveBeenCalled()

		// Verify order is strictly maintained
		const chats = host.getChatsByWorkspace()[canonicalizePath(workspaceA)] || []
		expect(chats.map((c) => c.id)).toEqual(["task-3", "task-2", "task-1"])
		expect(chats[2]!.title).toBe("Generated Semantic Title")
	})

	it("4. Deleting a chat removes only that chat; remaining chats maintain identical relative order", async () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
			storageDir: tempDir,
		})

		const t1 = 1700000000000
		const t2 = 1700000010000
		const t3 = 1700000020000

		let storedItems = [
			{ id: "task-1", task: "Chat 1", workspace: workspaceA, createdAt: t1, ts: t1 },
			{ id: "task-2", task: "Chat 2", workspace: workspaceA, createdAt: t2, ts: t2 },
			{ id: "task-3", task: "Chat 3", workspace: workspaceA, createdAt: t3, ts: t3 },
		]

		const deleteTaskMock = vi.fn().mockImplementation(async (id: string) => {
			storedItems = storedItems.filter((i) => i.id !== id)
		})

		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => null,
			deleteTaskWithId: deleteTaskMock,
			taskHistoryStore: {
				getAll: () => [...storedItems],
				get: (id: string) => storedItems.find((i) => i.id === id),
				deleteTaskWithId: deleteTaskMock,
				isDeleted: (id: string) => !storedItems.some((i) => i.id === id),
			},
			postMessageToWebview: vi.fn(),
		}
		host.registerWebviewProvider("mockView", mockProvider)

		// Delete task-2 (middle chat)
		await host.deleteChat("task-2", false)

		const chats = host.getChatsByWorkspace()[canonicalizePath(workspaceA)] || []
		expect(chats.map((c) => c.id)).toEqual(["task-3", "task-1"])
	})

	it("5. Legacy tasks with missing createdAt sort deterministically by UUIDv7 timestamp / ID tie-breaker", () => {
		const host = new DesktopAgentHost({
			workspacePath: workspaceA,
			extensionPath: tempDir,
			storageDir: tempDir,
		})

		// UUIDv7 IDs: first 48 bits encode milliseconds
		// 018d3b8f0000 = 1706079092736 ms
		// 018d3b8f03e8 = 1706079093736 ms (1 sec later)
		// 018d3b8f07d0 = 1706079094736 ms (2 sec later)
		const uuid1 = "018d3b8f-0000-7000-8000-000000000001"
		const uuid2 = "018d3b8f-03e8-7000-8000-000000000002"
		const uuid3 = "018d3b8f-07d0-7000-8000-000000000003"

		// Legacy tasks without createdAt, all having identical or scrambled `ts`
		const legacyItems = [
			{ id: uuid1, task: "Legacy 1", workspace: workspaceA, ts: 1000 },
			{ id: uuid2, task: "Legacy 2", workspace: workspaceA, ts: 1000 },
			{ id: uuid3, task: "Legacy 3", workspace: workspaceA, ts: 1000 },
		]

		const mockProvider = {
			runningTasks: new Map(),
			getCurrentTask: () => null,
			taskHistoryStore: {
				getAll: () => [...legacyItems],
				get: (id: string) => legacyItems.find((i) => i.id === id),
				isDeleted: () => false,
			},
		}
		host.registerWebviewProvider("mockView", mockProvider)

		const chats = host.getChatsByWorkspace()[canonicalizePath(workspaceA)] || []
		// Must sort by derived UUIDv7 creation time descending: uuid3 > uuid2 > uuid1
		expect(chats.map((c) => c.id)).toEqual([uuid3, uuid2, uuid1])
	})

	it("6. DOM & Event pipeline preserves stable in-place elements and ignores item updates for sidebar data fetching", () => {
		const appJsPath = path.resolve(__dirname, "../../src/renderer/app.js")
		const appJsCode = fs.readFileSync(appJsPath, "utf-8")

		// Verify tryPatchSidebarInPlace is implemented
		expect(appJsCode).toContain("function tryPatchSidebarInPlace(workspaces, curWsNorm)")
		expect(appJsCode).toContain("if (tryPatchSidebarInPlace(workspaces, curWsNorm)) {")

		// Verify taskHistoryItemUpdated does NOT call fetchSidebarData
		expect(appJsCode).not.toContain("msg.message?.type === \"taskHistoryItemUpdated\" ||")
	})
})
