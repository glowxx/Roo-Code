import { describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { WebSocket } from "ws"
import { DesktopAgentHost } from "../../src/main/agent-host.js"
import { createDesktopServer } from "../../src/main/server.js"

describe("navigation counter WebSocket bridge", () => {
	it("initializes badges and sends live metadata without hydrating terminal history or rescanning on tab requests", async () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "roo-counter-ws-"))
		const host = new DesktopAgentHost({ workspacePath: directory, extensionPath: directory, storageDir: directory })
		const send = (message: object) => (host as any).processExtensionMessage(message)
		send({ type: "workspaceFilesChanged", files: [{ path: "a.ts", changeType: "created" }] })
		send({ type: "terminalSessionStarted", id: "one", command: "echo" })
		const refresh = vi.spyOn(host, "refreshDiffsFromGit").mockImplementation(() => {})
		const history = vi.spyOn(host, "getTerminalLogs")
		const server = createDesktopServer({ port: 0, agentHost: host })
		let socket: WebSocket | undefined
		try {
			const port = await server.start()
			socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
			const messages: any[] = []
			const waitFor = (type: string) =>
				new Promise<any>((resolve, reject) => {
					const onError = (error: Error) => {
						socket!.off("message", listener)
						reject(error)
					}
					const listener = (data: any) => {
						const message = JSON.parse(String(data))
						if (message.type === type) {
							socket!.off("message", listener)
							socket!.off("error", onError)
							resolve(message)
						}
					}
					socket!.on("message", listener)
					socket!.once("error", onError)
				})
			socket.on("message", (data) => messages.push(JSON.parse(String(data))))
			await waitFor("sidebarData")
			expect(messages.find((m) => m.type === "navigationCounts")).toMatchObject({
				diffCount: 1,
				terminalCount: 1,
			})
			expect(history).not.toHaveBeenCalled()
			expect(messages.some((m) => m.type === "terminalLogsUpdated")).toBe(false)
			const live = waitFor("navigationCounts")
			send({ type: "terminalSessionStarted", id: "two" })
			expect(await live).toMatchObject({ terminalCount: 2 })
			const diffs = waitFor("diffsUpdated")
			socket.send(JSON.stringify({ type: "getDiffs" }))
			await diffs
			expect(refresh).toHaveBeenCalledTimes(1)
			expect(history).not.toHaveBeenCalled()
			const panel = waitFor("terminalLogsUpdated")
			socket.send(JSON.stringify({ type: "getTerminalLogs" }))
			expect((await panel).entries).toHaveLength(2)
			expect(history).toHaveBeenCalledTimes(1)
		} finally {
			socket?.terminate()
			await server.stop()
			expect(host.listenerCount("navigationCountsUpdated")).toBe(0)
			expect(host.listenerCount("terminalLogsUpdated")).toBe(1)
			vi.restoreAllMocks()
			fs.rmSync(directory, { recursive: true, force: true })
		}
	})
})
