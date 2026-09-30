import { readFileSync } from "fs"
import { resolve } from "path"
import { createRequire } from "module"
import { describe, expect, it, vi } from "vitest"

const { JSDOM } = createRequire(import.meta.url)(resolve(__dirname, "../../../../webview-ui/node_modules/jsdom"))

function renderer() {
	const source = readFileSync(resolve(__dirname, "../../src/renderer/app.js"), "utf8")
	const handler = source.slice(
		source.indexOf("\tfunction handleServerMessage("),
		source.indexOf("\n\tfunction updateAgentStatus("),
	)
	const counterStart = source.indexOf("\tfunction updateNavigationCounters(")
	const counter =
		counterStart < 0 ? "" : source.slice(counterStart, source.indexOf("\n\tfunction ", counterStart + 1))
	const dom = new JSDOM('<span id="diffs-count">0</span><span id="terminal-count">0</span>')
	const render = vi.fn()
	const fetch = vi.fn()
	const handle = new Function(
		"document",
		"renderTerminalSessions",
		"renderActiveTerminalOutput",
		"renderDiffs",
		"fetch",
		`
		let currentWorkspace = {path: 'C:/A'}, currentDesktopTab = 'chat', terminalSessions = [], terminalLogs = [], diffFiles = [], selectedTerminalSessionId = null;
		let terminalDirty, terminalRenderedOnce, lastRenderedTerminalSessionId, diffsDirty, diffsRenderedOnce, selectedDiffFile;
		const renderTerminalLogs = renderTerminalSessions, renderWorkspaceInfo = () => {}, renderSidebar = () => {}, sendToServer = fetch;
		const sidebarData = {recentWorkspaces: []}, projectExpansions = new Set();
		let navigationCounts = {workspace: 'C:/A', diffCount: 0, terminalCount: 0, terminalTotal: 0, terminalRunning: 0};
		const diffsCountEl = document.getElementById('diffs-count'), terminalCountEl = document.getElementById('terminal-count');
		const pathNormalize = p => (p || '').replace(/\\\\/g, '/').toLowerCase();
		${counter}
		${handler}
		return {handle: handleServerMessage, sessions: () => terminalSessions};
	`,
	)(dom.window.document, render, render, render, fetch)
	return { ...handle, render, fetch, document: dom.window.document }
}

describe("navigation badges with Agent active", () => {
	it("clears previous workspace sessions and badges before receiving new workspace metadata", () => {
		const r = renderer()
		r.handle({ type: "terminalSessionStarted", id: "old" })
		r.handle({
			type: "navigationCounts",
			workspace: "C:/A",
			diffCount: 5,
			terminalCount: 1,
			terminalTotal: 1,
			terminalRunning: 1,
		})
		r.handle({ type: "workspaceInfo", workspace: { path: "C:/B" } })
		expect(r.sessions()).toHaveLength(0)
		expect(r.document.getElementById("diffs-count")!.textContent).toBe("0")
		r.handle({
			type: "navigationCounts",
			workspace: "C:/B",
			diffCount: 2,
			terminalCount: 0,
			terminalTotal: 0,
			terminalRunning: 0,
		})
		expect(r.document.getElementById("diffs-count")!.textContent).toBe("2")
		r.handle({ type: "workspaceInfo", workspace: { path: "" } })
		expect(r.document.getElementById("diffs-count")!.textContent).toBe("0")
	})
	it("does not complete a new session for a late explicit old ID after clear", () => {
		const r = renderer()
		r.handle({ type: "terminalSessionStarted", id: "old" })
		r.handle({ type: "terminalLogsCleared" })
		r.handle({ type: "terminalSessionStarted", id: "new" })
		r.handle({ type: "terminalSessionEnded", id: "old", exitCode: 0 })
		expect(r.sessions()[0].status).toBe("running")
	})
	it("updates terminalLog without rendering or opening Terminal", () => {
		const r = renderer()
		r.handle({ type: "terminalLog", entry: { id: "1", status: "running" } })
		r.handle({
			type: "navigationCounts",
			workspace: "C:/A",
			diffCount: 0,
			terminalCount: 1,
			terminalTotal: 1,
			terminalRunning: 1,
		})
		expect(r.document.getElementById("terminal-count")!.textContent).toBe("1")
		expect(r.render).not.toHaveBeenCalled()
		expect(r.fetch).not.toHaveBeenCalled()
	})
	it("updates 100 metadata events, clear, and ignores another project's late event without hydrating panels", () => {
		const r = renderer()
		for (let i = 1; i <= 100; i++)
			r.handle({
				type: "navigationCounts",
				workspace: "C:/A",
				diffCount: i,
				terminalCount: i,
				terminalTotal: i,
				terminalRunning: i,
			})
		expect(r.document.getElementById("diffs-count")!.textContent).toBe("100")
		expect(r.document.getElementById("terminal-count")!.textContent).toBe("100")
		r.handle({
			type: "navigationCounts",
			workspace: "C:/A",
			diffCount: 0,
			terminalCount: 0,
			terminalTotal: 0,
			terminalRunning: 0,
		})
		r.handle({ type: "navigationCounts", workspace: "C:/B", diffCount: 99, terminalCount: 99 })
		expect(r.document.getElementById("diffs-count")!.textContent).toBe("0")
		expect(r.document.getElementById("terminal-count")!.textContent).toBe("0")
		expect(r.render).not.toHaveBeenCalled()
		expect(r.fetch).not.toHaveBeenCalled()
	})
})
