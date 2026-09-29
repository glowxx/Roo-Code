import { describe, it, expect, beforeEach } from "vitest"
import fs from "fs"
import path from "path"

describe("Sidebar Chat List Truncation & Progressive Disclosure (Area B)", () => {
	const appJsPath = path.resolve(__dirname, "../../src/renderer/app.js")
	let appJsCode: string

	beforeEach(() => {
		appJsCode = fs.readFileSync(appJsPath, "utf-8")
	})

	it("broadcasts live lifecycle changes to the sidebar renderer", () => {
		const serverCode = fs.readFileSync(path.resolve(__dirname, "../../src/main/server.ts"), "utf-8")
		expect(serverCode).toMatch(/agentHost\.on\("statusChange",[\s\S]*?broadcastSidebarData\(\)/)
		expect(appJsCode).toContain('case "sidebarData":')
		expect(appJsCode).toContain("tryPatchSidebarInPlace(workspaces, curWsNorm)")
	})

	it("defines MAX_VISIBLE_CHATS as 6 and initializes projectChatExpansions Set", () => {
		expect(appJsCode).toContain("const MAX_VISIBLE_CHATS = 6")
		expect(appJsCode).toContain("const projectChatExpansions = new Set()")
	})

	it("implements renderChatsList with 6 chat limit and activeTaskId preservation", () => {
		expect(appJsCode).toContain("function renderChatsList(")
		expect(appJsCode).toContain("chats.slice(0, MAX_VISIBLE_CHATS)")
		expect(appJsCode).toContain("activeIdx >= MAX_VISIBLE_CHATS")
		expect(appJsCode).toContain("visibleChats = [...visibleChats, chats[activeIdx]]")
	})

	it("includes discoverability indicators for hidden running and unread chats on View more button", () => {
		expect(appJsCode).toContain("data-action=\"toggle-chat-list\"")
		expect(appJsCode).toContain("chat-toggle-indicators")
		expect(appJsCode).toContain("hiddenRunning > 0")
		expect(appJsCode).toContain("hiddenUnread > 0")
		expect(appJsCode).toContain("viewMoreChats")
		expect(appJsCode).toContain("viewLessChats")
	})

	it("returns empty string when project is collapsed to avoid rendering DOM nodes", () => {
		// In renderChatsList, if (!isExpanded) return ""
		const renderChatsListMatch = appJsCode.match(/function renderChatsList\([^)]*\)\s*\{([\s\S]*?)const isChatExpanded/)
		expect(renderChatsListMatch).not.toBeNull()
		expect(renderChatsListMatch![1]).toContain("if (!isExpanded)")
		expect(renderChatsListMatch![1]).toContain('return ""')
	})

	it("attaches click and keyboard event handlers for toggle-chat-list", () => {
		expect(appJsCode).toContain("querySelectorAll(\"[data-action='toggle-chat-list']\")")
		expect(appJsCode).toContain("projectChatExpansions.delete(ws)")
		expect(appJsCode).toContain("projectChatExpansions.add(ws)")
	})

	it("auto-expands chat list when switching to a chat outside top 6", () => {
		expect(appJsCode).toContain("if (idx >= MAX_VISIBLE_CHATS) {")
		expect(appJsCode).toContain("projectChatExpansions.add(wsPath)")
	})
})
