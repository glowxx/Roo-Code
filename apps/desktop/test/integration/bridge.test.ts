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
})
