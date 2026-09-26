import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"
import os from "os"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import {
	canonicalizePath,
	arePathsEqual,
	loadDesktopConfig,
	saveDesktopConfig,
	getConfigFilePath,
} from "../../src/main/config.js"

describe("Project Management & Sidebar Creation Flow (TDD)", () => {
	let tempDir: string
	let tempConfigPath: string
	let origAppData: string | undefined

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-proj-test-"))
		// Redirect config file to isolated test directory
		origAppData = process.env.APPDATA
		process.env.APPDATA = tempDir
	})

	afterEach(() => {
		process.env.APPDATA = origAppData
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	describe("1. DOM Structure & Accessibility: Add Project Control in Sidebar Header", () => {
		it("index.html contains #sidebar-add-project-btn inside .sidebar-section-header with accessible attributes", () => {
			const indexPath = path.resolve(__dirname, "../../src/renderer/index.html")
			expect(fs.existsSync(indexPath)).toBe(true)
			const html = fs.readFileSync(indexPath, "utf-8")

			// Check for sidebar-section-header
			expect(html).toContain("sidebar-section-header")

			// Must contain the dedicated #sidebar-add-project-btn
			expect(html).toContain('id="sidebar-add-project-btn"')

			// Must be a button element with type="button" and accessibility attributes
			const btnPattern = /<button[^>]*id="sidebar-add-project-btn"[^>]*>/i
			const match = html.match(btnPattern)
			expect(match).not.toBeNull()

			const btnTag = match![0]
			expect(btnTag).toContain('aria-label="Add project"')
			expect(btnTag).toContain('title="Add project"')
			expect(btnTag).toContain('tabindex="0"')

			// Must contain SVG plus icon
			const iconSlice = html.substring(html.indexOf('id="sidebar-add-project-btn"'), html.indexOf('id="sidebar-add-project-btn"') + 400)
			expect(iconSlice).toContain("<svg")
			expect(iconSlice).toContain("<line")

			// Preferred composition: PROJECTS label, then actions cluster containing the button and count badge
			expect(html).toContain("sidebar-section-actions")
			expect(html).toContain("sidebar-projects-count")
		})
	})

	describe("2. Windows Path Normalization & Equality", () => {
		it("normalizes drive letter, separators, and trailing slashes", () => {
			const p1 = "c:\\projects\\myapp"
			const p2 = "C:\\projects\\myapp\\"
			const p3 = "c:/projects/myapp/"

			const norm1 = canonicalizePath(p1)
			const norm2 = canonicalizePath(p2)
			const norm3 = canonicalizePath(p3)

			// Both should standardize drive letter to uppercase on Windows
			if (process.platform === "win32") {
				expect(norm1.startsWith("C:")).toBe(true)
				expect(norm2.startsWith("C:")).toBe(true)
				expect(norm3.startsWith("C:")).toBe(true)
				// Should strip trailing slash
				expect(norm2.endsWith("\\")).toBe(false)
				expect(norm3.endsWith("/")).toBe(false)
			}
		})

		it("arePathsEqual returns true regardless of casing or slash format on Windows", () => {
			const pUpper = "C:\\Projects\\MyAwesomeApp"
			const pLower = "c:\\projects\\myawesomeapp\\"
			const pForward = "C:/Projects/MyAwesomeApp/"

			if (process.platform === "win32") {
				expect(arePathsEqual(pUpper, pLower)).toBe(true)
				expect(arePathsEqual(pUpper, pForward)).toBe(true)
				expect(arePathsEqual(pLower, pForward)).toBe(true)
			} else {
				expect(arePathsEqual(pUpper, pUpper)).toBe(true)
			}

			// Different paths must not match
			expect(arePathsEqual("C:\\Projects\\App1", "C:\\Projects\\App2")).toBe(false)
		})
	})

	describe("3. Config Persistence & Duplicate Prevention", () => {
		it("deduplicates recentWorkspaces even when added with varied casing on Windows", () => {
			const dir1 = path.join(tempDir, "ProjectA")
			fs.mkdirSync(dir1, { recursive: true })

			// Save ProjectA with uppercase
			saveDesktopConfig({
				lastWorkspacePath: dir1,
				recentWorkspaces: [dir1],
			})

			const config1 = loadDesktopConfig()
			expect(config1.recentWorkspaces).toHaveLength(1)

			// Try adding the same directory with lowercase / trailing slash
			const dir1Variation = process.platform === "win32"
				? dir1.toLowerCase() + "\\"
				: dir1 + "/"

			saveDesktopConfig({
				lastWorkspacePath: dir1Variation,
			})

			const config2 = loadDesktopConfig()
			// Should still have only 1 entry, not 2
			expect(config2.recentWorkspaces).toHaveLength(1)
			expect(arePathsEqual(config2.recentWorkspaces![0]!, dir1)).toBe(true)
		})

		it("allows removing recent workspace without it being re-added by zero-state guard", () => {
			const dir1 = path.join(tempDir, "Proj1")
			const dir2 = path.join(tempDir, "Proj2")
			fs.mkdirSync(dir1, { recursive: true })
			fs.mkdirSync(dir2, { recursive: true })

			saveDesktopConfig({
				lastWorkspacePath: dir1,
				recentWorkspaces: [dir1, dir2],
			})

			// Remove dir1 from recentWorkspaces
			saveDesktopConfig({
				recentWorkspaces: [dir2],
			})

			const updated = loadDesktopConfig()
			expect(updated.recentWorkspaces).toHaveLength(1)
			expect(arePathsEqual(updated.recentWorkspaces![0]!, dir2)).toBe(true)
		})
	})

	describe("4. Multi-Project Runtime Concurrency & Task Preservation", () => {
		it("switching workspace or adding a project does not abort tasks from other projects", async () => {
			const projA = path.join(tempDir, "ProjectA")
			const projB = path.join(tempDir, "ProjectB")
			fs.mkdirSync(projA, { recursive: true })
			fs.mkdirSync(projB, { recursive: true })

			const host = new DesktopAgentHost({
				workspacePath: projA,
				extensionPath: tempDir,
			})

			// Mock provider with runningTasks map
			let taskUnfocusedEmitted = false
			let taskAborted = false

			const mockTaskA = {
				taskId: "task-a-123",
				cwd: projA,
				isStreaming: false,
				isWaitingForFirstChunk: false,
				askResponse: undefined,
				emit: vi.fn((event: string) => {
					if (event === "taskUnfocused") taskUnfocusedEmitted = true
				}),
				abortTask: vi.fn(() => {
					taskAborted = true
				}),
			}

			const runningTasksMap = new Map<string, any>()
			runningTasksMap.set("task-a-123", mockTaskA)

			const mockProvider = {
				runningTasks: runningTasksMap,
				getCurrentTask: () => mockTaskA,
				foregroundTaskId: "task-a-123",
				handleWorkspaceChanged: vi.fn(async (newPath: string) => {
					// ClineProvider logic simulation:
					const currentTask = mockProvider.getCurrentTask()
					if (currentTask && newPath && currentTask.cwd !== newPath) {
						currentTask.emit("taskUnfocused")
						mockProvider.foregroundTaskId = undefined as any
					}
				}),
			}

			host.registerWebviewProvider("mockView", mockProvider)

			// Record terminal log in Project A
			;(host as any).processExtensionMessage({
				type: "terminalSessionStarted",
				id: "term-proj-a",
				command: "npm run dev",
				cwd: projA,
			})

			expect(host.getTerminalLogs()).toHaveLength(1)

			// User adds/switches to Project B
			await host.setWorkspace(projB)

			// Invariant 1: Task A in Project A was NOT aborted
			expect(taskAborted).toBe(false)
			expect(runningTasksMap.has("task-a-123")).toBe(true)

			// Invariant 2: Task A was unfocused from foreground UI
			expect(taskUnfocusedEmitted).toBe(true)
			expect(mockProvider.foregroundTaskId).toBeUndefined()

			// Invariant 3: Project A's terminal logs are saved in host's workspace cache
			expect(host.getTerminalLogs()).toHaveLength(0) // Project B has no logs yet

			// Switching back to Project A restores its terminal logs
			await host.setWorkspace(projA)
			expect(host.getTerminalLogs()).toHaveLength(1)
			expect(host.getTerminalLogs()[0]!.id).toBe("term-proj-a")
		})
	})

	describe("5. Engine Is Not Reloaded on Workspace Changes", () => {
		it("setWorkspace does not re-invoke init() or re-instantiate extensionModule", async () => {
			const projA = path.join(tempDir, "ProjectA")
			const projB = path.join(tempDir, "ProjectB")
			fs.mkdirSync(projA, { recursive: true })
			fs.mkdirSync(projB, { recursive: true })

			const host = new DesktopAgentHost({
				workspacePath: projA,
				extensionPath: tempDir,
			})

			const initSpy = vi.spyOn(host, "init")

			await host.setWorkspace(projB)
			expect(host.getWorkspace()).toBe(projB)
			expect(initSpy).not.toHaveBeenCalled()

			await host.setWorkspace(projA)
			expect(host.getWorkspace()).toBe(projA)
			expect(initSpy).not.toHaveBeenCalled()
		})
	})

	describe("6. Zero-Project State & First Project Addition", () => {
		it("handles zero workspace state and successfully transitions to 1 project", async () => {
			const host = new DesktopAgentHost({
				workspacePath: "",
				extensionPath: tempDir,
			})

			expect(host.getWorkspace()).toBe("")

			const firstProj = path.join(tempDir, "FirstProject")
			fs.mkdirSync(firstProj, { recursive: true })

			await host.setWorkspace(firstProj)
			expect(host.getWorkspace()).toBe(firstProj)

			saveDesktopConfig({
				lastWorkspacePath: firstProj,
				recentWorkspaces: [firstProj],
			})

			const config = loadDesktopConfig()
			expect(config.recentWorkspaces).toHaveLength(1)
			expect(arePathsEqual(config.recentWorkspaces![0]!, firstProj)).toBe(true)
		})
	})
})
