import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import path from "path"
import fs from "fs"
import os from "os"

describe("Terminal Performance & Streaming Decoupling (TDD)", () => {
	let tempDir: string
	let host: DesktopAgentHost

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roo-term-test-"))
		host = new DesktopAgentHost({
			workspacePath: tempDir,
			extensionPath: tempDir,
		})
	})

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {}
	})

	it("does not broadcast full terminalLog on every streaming terminalOutput chunk", () => {
		const terminalLogListener = vi.fn()
		const terminalOutputListener = vi.fn()

		host.on("terminalLog", terminalLogListener)
		host.on("terminalOutput", terminalOutputListener)

		// Simulate command starting
		;(host as any).processExtensionMessage({
			type: "commandExecutionStatus",
			status: "started",
			executionId: "exec-101",
			command: "echo hello",
		} as any)

		expect(terminalLogListener).toHaveBeenCalledTimes(1)

		// Simulate 5 streaming output chunks
		for (let i = 0; i < 5; i++) {
			;(host as any).processExtensionMessage({
				type: "terminalOutput",
				id: "exec-101",
				data: `chunk ${i}\n`,
			} as any)
		}

		// terminalOutput should have been emitted for all 5 chunks
		expect(terminalOutputListener).toHaveBeenCalledTimes(5)

		// But terminalLog (which carries the entire cumulative output history) should NOT be emitted on every chunk!
		// It was emitted once at started, and should not be emitted 5 extra times for chunks.
		expect(terminalLogListener).toHaveBeenCalledTimes(1)
	})
})
