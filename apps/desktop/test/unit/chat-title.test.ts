import { describe, it, expect } from "vitest"
import { formatChatTitle } from "../../src/main/agent-host.js"

describe("formatChatTitle - Canonical Conversation Display Title", () => {
	it("returns short plain text title unchanged", () => {
		expect(formatChatTitle("Fix navbar styling bug")).toBe("Fix navbar styling bug")
	})

	it("extracts the first meaningful line from a multiline prompt", () => {
		const multiline = `
# Implement OAuth2 Flow

Here are the detailed steps:
1. Setup client ID
2. Add callback handler
`
		expect(formatChatTitle(multiline)).toBe("Implement OAuth2 Flow")
	})

	it("skips markdown code fences at the start and extracts first real code/text line", () => {
		const codePrompt = "```typescript\nconst authService = new AuthService()\nauthService.login()\n```"
		expect(formatChatTitle(codePrompt)).toBe("const authService = new AuthService()")
	})

	it("sanitizes markdown headers, lists, checkboxes, bold, italic, backticks, links, and HTML", () => {
		const complexMarkdown = "- [x] **Urgent**: Fix `authentication` in [documentation](https://docs.example.com) <span class='badge'>v2</span>"
		expect(formatChatTitle(complexMarkdown)).toBe("Urgent: Fix authentication in documentation v2")
	})

	it("handles the real incident prompt (14k+ chars with SKILLS TO USE)", () => {
		const realIncidentPrompt = `SKILLS TO USE:
/graphify
/context-engineering
/frontend-ui-engineering
/browser-testing-with-devtools
/code-review-and-quality

==================================================
WRITE ACCESS AUTHORIZATION
==================================================

This is a NEW implementation session.
` + "x".repeat(14000)

		const title = formatChatTitle(realIncidentPrompt)
		expect(title).toBe("SKILLS TO USE:")
		expect(title.length).toBeLessThanOrEqual(80)
		expect(title).not.toContain("\n")
	})

	it("defensively clamps extreme single-line titles (50,000 characters) without breaking", () => {
		const giantSingleLine = "A".repeat(50000)
		const title = formatChatTitle(giantSingleLine, undefined, 80)
		expect(title.length).toBe(80)
		expect(title.endsWith("...")).toBe(true)
		expect(title.startsWith("AAAA")).toBe(true)
	})

	it("handles unicode, Polish diacritics, and emojis correctly without glyph corruption", () => {
		const polishPrompt = "### 🚀 Napraw błąd w module płatności użytkownika w Warszawie\nSzczegóły..."
		expect(formatChatTitle(polishPrompt)).toBe("🚀 Napraw błąd w module płatności użytkownika w Warszawie")
	})

	it("falls back to 'Untitled Task' when prompt is empty, whitespace, or pure markdown syntax", () => {
		expect(formatChatTitle("")).toBe("Untitled Task")
		expect(formatChatTitle("   \n\n\t  ")).toBe("Untitled Task")
		expect(formatChatTitle("# \n> \n- [ ] ")).toBe("Untitled Task")
		expect(formatChatTitle(undefined, undefined)).toBe("Untitled Task")
		expect(formatChatTitle(null, null)).toBe("Untitled Task")
	})

	it("respects explicit item.title when provided and clean", () => {
		expect(formatChatTitle("Raw prompt body", "Custom Clean Title")).toBe("Custom Clean Title")
	})
})
