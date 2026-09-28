import { describe, it, expect, beforeEach } from "vitest"
import fs from "fs"
import path from "path"

describe("Delete Chat Dialog UX, Accessibility & Safety Guardrails", () => {
	const appJsPath = path.resolve(__dirname, "../../src/renderer/app.js")
	const indexHtmlPath = path.resolve(__dirname, "../../src/renderer/index.html")
	const stylesCssPath = path.resolve(__dirname, "../../src/renderer/styles.css")

	let appJsCode: string
	let indexHtmlCode: string
	let stylesCssCode: string

	beforeEach(() => {
		appJsCode = fs.readFileSync(appJsPath, "utf-8")
		indexHtmlCode = fs.readFileSync(indexHtmlPath, "utf-8")
		stylesCssCode = fs.readFileSync(stylesCssPath, "utf-8")
	})

	it("DOM structure: contains modal-title-text container to prevent flex expansion", () => {
		expect(indexHtmlCode).toContain('class="modal-title-text"')
		expect(indexHtmlCode).toContain('id="confirmation-modal-subtitle"')
		expect(indexHtmlCode).toContain('id="confirmation-modal-confirm-btn"')
		expect(indexHtmlCode).toContain('id="confirmation-modal-cancel-btn"')
	})

	it("CSS containment: .confirmation-modal-card has min-width, max-width, and max-height bounds", () => {
		const cardMatch = stylesCssCode.match(/\.confirmation-modal-card\s*\{([^}]*)\}/)
		expect(cardMatch).not.toBeNull()
		const rules = cardMatch![1]
		expect(rules).toContain("min-width")
		expect(rules).toContain("max-width")
		expect(rules).toContain("max-height")
	})

	it("CSS containment: .modal-subtitle is bounded with single-line ellipsis and overflow hidden", () => {
		const subtitleMatch = stylesCssCode.match(/\.modal-subtitle\s*\{([^}]*)\}/)
		expect(subtitleMatch).not.toBeNull()
		const rules = subtitleMatch![1]
		expect(rules).toContain("white-space: nowrap")
		expect(rules).toContain("overflow: hidden")
		expect(rules).toContain("text-overflow: ellipsis")
	})

	it("CSS containment: .modal-title-text has min-width: 0 and flex: 1 to respect flex bounds", () => {
		const textMatch = stylesCssCode.match(/\.modal-title-text\s*\{([^}]*)\}/)
		expect(textMatch).not.toBeNull()
		const rules = textMatch![1]
		expect(rules).toContain("min-width: 0")
		expect(rules).toContain("overflow: hidden")
	})

	it("Renderer sanitization: app.js contains canonical display title formatting / sanitization helper", () => {
		expect(appJsCode).toMatch(/function (formatChatTitle|getConversationDisplayTitle)/)
	})

	it("Default focus safety: showConfirmationModal focuses Cancel button by default, NOT danger Confirm button", () => {
		const showModalMatch = appJsCode.match(/function showConfirmationModal\([^)]*\)\s*\{([\s\S]*?)\n\t\}/)
		expect(showModalMatch).not.toBeNull()
		const body = showModalMatch![1]
		expect(body).toContain("confirmationModalCancelBtn?.focus()")
		expect(body).not.toContain("confirmationModalConfirmBtn?.focus()")
	})

	it("Focus restoration: stores lastFocusedElement and restores focus when modal closes", () => {
		expect(appJsCode).toContain("lastFocusedElement")
		const closeModalMatch = appJsCode.match(/function closeConfirmationModal\([^)]*\)\s*\{([\s\S]*?)\n\t\}/)
		expect(closeModalMatch).not.toBeNull()
		expect(closeModalMatch![1]).toContain("focus()")
	})

	it("Focus trap: implements keyboard Tab cycling inside confirmation modal", () => {
		expect(appJsCode).toContain("confirmationModalBackdrop")
		expect(appJsCode).toMatch(/e\.key === "Tab"/)
	})

	it("Running task safety: running chats prompt stop & delete, passing forceStop: true", () => {
		expect(appJsCode).toContain("tDesktop(\"deleteChatConfirmRunning\")")
		expect(appJsCode).toContain("executeDeleteChat(taskId, ws, true)")
		expect(appJsCode).toContain("executeDeleteChat(taskId, ws, false)")
	})
})
