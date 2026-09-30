import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { DesktopAgentHost } from "../../src/main/agent-host.js"

describe("canonical navigation counters", () => {
	let host: DesktopAgentHost
	let directory: string
	const send = (message: object) => (host as any).processExtensionMessage(message)
	const counts = () => (host as any).getNavigationCounts()
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "roo-counters-"))
		host = new DesktopAgentHost({ workspacePath: directory, extensionPath: directory })
	})
	afterEach(() => {
		vi.restoreAllMocks()
		fs.rmSync(directory, { recursive: true, force: true })
	})
	it("initializes from canonical metadata without reading contents or history", () => {
		const read = vi.spyOn(fs, "readFileSync")
		expect(counts()).toMatchObject({ diffCount: 0, terminalCount: 0 })
		expect(read).not.toHaveBeenCalled()
	})
	it("publishes output-only command creation once and ignores output chunks for counts", () => {
		const changed = vi.fn()
		const output: string[] = []
		host.on("navigationCountsUpdated", changed)
		host.on("terminalLog", (session) => output.push(session.output))
		host.on("terminalOutput", (chunk) => output.push(chunk.data))
		send({ type: "commandExecutionStatus", executionId: "output-only", status: "output", output: "hello" })
		expect(output.join("")).toBe("hello")
		expect(counts().terminalCount).toBe(1)
		send({ type: "terminalOutput", id: "output-only", data: " world" })
		expect(changed).toHaveBeenCalledTimes(1)
	})
	it("publishes unique file counts for 100 rapid changes and resets without a tab request", async () => {
		const changed = vi.fn()
		host.on("navigationCountsUpdated", changed)
		for (let i = 0; i < 100; i++) {
			send({ type: "workspaceFilesChanged", files: [{ path: `${i}.ts`, changeType: "created" }] })
		}
		send({ type: "workspaceFilesChanged", files: [{ path: "0.ts", changeType: "modified" }] })
		expect(counts().diffCount).toBe(100)
		expect(changed.mock.lastCall?.[0].diffCount).toBe(100)
		await host.clearTask()
		expect(changed.mock.lastCall?.[0].diffCount).toBe(0)
	})
	it("preserves active-command semantics through duplicate starts, exits, clear and 100 events", () => {
		const changed = vi.fn()
		host.on("navigationCountsUpdated", changed)
		for (let i = 0; i < 100; i++) send({ type: "terminalSessionStarted", id: String(i), command: "echo" })
		send({ type: "terminalSessionStarted", id: "0", command: "echo" })
		expect(counts().terminalCount).toBe(100)
		for (let i = 0; i < 99; i++) send({ type: "terminalSessionEnded", id: String(i), exitCode: 0 })
		expect(counts().terminalCount).toBe(1)
		send({ type: "terminalSessionEnded", id: "99", exitCode: 0 })
		expect(counts().terminalCount).toBe(100)
		host.clearTerminalLogs()
		expect(changed.mock.lastCall?.[0].terminalCount).toBe(0)
		send({ type: "terminalSessionEnded", id: "99", exitCode: 0 })
		expect(counts().terminalCount).toBe(0)
		send({ type: "terminalSessionStarted", id: "new" })
		send({ type: "terminalSessionEnded", id: "99", exitCode: 0 })
		expect(counts().terminalRunning).toBe(1)
	})

	it("routes background events and late project events to their owning workspace", async () => {
		vi.spyOn(host, "refreshDiffsFromGit").mockImplementation(() => {})
		const second = path.join(directory, "B")
		fs.mkdirSync(second)
		send({ type: "workspaceFilesChanged", workspacePath: second, files: [{ path: "b.ts", changeType: "created" }] })
		send({ type: "terminalSessionStarted", workspacePath: second, id: "b" })
		expect(counts()).toMatchObject({ diffCount: 0, terminalCount: 0 })
		await host.setWorkspace(second)
		expect(counts()).toMatchObject({ diffCount: 1, terminalCount: 1 })
		send({
			type: "workspaceFilesChanged",
			workspacePath: directory,
			files: [{ path: "a.ts", changeType: "created" }],
		})
		expect(counts().diffCount).toBe(1)
		await host.setWorkspace(directory)
		expect(counts().diffCount).toBe(1)
	})
	it.skipIf(process.platform !== "win32")(
		"recognizes Windows workspace casing for foreground and background events",
		async () => {
			vi.spyOn(host, "refreshDiffsFromGit").mockImplementation(() => {})
			send({ type: "terminalSessionStarted", workspacePath: directory.toUpperCase(), id: "a" })
			expect(counts().terminalCount).toBe(1)
			const second = path.join(directory, "B")
			fs.mkdirSync(second)
			send({ type: "terminalSessionStarted", workspacePath: second.toUpperCase(), id: "b" })
			await host.setWorkspace(second)
			expect(counts().terminalCount).toBe(1)
			send({ type: "terminalSessionEnded", workspacePath: second.toLowerCase(), id: "b", exitCode: 0 })
			expect(counts().terminalRunning).toBe(0)
		},
	)
	it("keeps project counts stable on chat switch and restores each workspace", async () => {
		vi.spyOn(host, "refreshDiffsFromGit").mockImplementation(() => {})
		send({ type: "workspaceFilesChanged", files: [{ path: "a.ts", changeType: "created" }] })
		send({ type: "terminalSessionStarted", id: "a" })
		await host.setActiveTaskId("other-chat")
		expect(counts()).toMatchObject({ diffCount: 1, terminalCount: 1 })
		const second = path.join(directory, "B")
		fs.mkdirSync(second)
		await host.setWorkspace(second)
		expect(counts()).toMatchObject({ diffCount: 0, terminalCount: 0 })
		await host.setWorkspace(directory)
		expect(counts()).toMatchObject({ diffCount: 1, terminalCount: 1 })
	})
})
