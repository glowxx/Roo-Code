import { describe, expect, it, vi } from "vitest"
import {
	preprocessTitleInput,
	semanticFallbackTitle,
	isBadAutoTitle,
	generateConversationTitle,
	sanitizeTitle,
} from "../../src/main/title-generator.js"

const task = "Napraw spinner sidebara i układ chatu Roo"
const skills = `SKILLS TO USE:\n/graphify\n/using-agent-skills\n/frontend-ui-engineering\n/context-engineering\n\n`
const authorization = `WRITE ACCESS AUTHORIZATION\nYou may edit files in this repository.\n\n`

describe("conversation title intent", () => {
	it("strips slash skills, lists and skills banner", () => {
		const cleaned = preprocessTitleInput(`${skills}${task}`)
		expect(cleaned).toContain(task)
		expect(cleaned).not.toMatch(/graphify|SKILLS TO USE|frontend-ui-engineering/i)
	})
	it("strips authorization, role and XML wrappers", () => {
		const cleaned = preprocessTitleInput(
			`${authorization}<system>Agent setup</system>\nDziałasz jako Senior Engineer.\n${task}`,
		)
		expect(cleaned).toContain(task)
		expect(cleaned).not.toMatch(/WRITE ACCESS|Agent setup|Senior Engineer/i)
	})
	it("finds task intent after a long preamble", () => {
		const prompt = `${skills}${authorization}Pracujesz bezpośrednio na repo.\nMam dwa zadania:\n- ${task}\n- Dodaj testy historii chatu`
		expect(semanticFallbackTitle(prompt)).toMatch(/spinner|sidebara|chatu/i)
		expect(semanticFallbackTitle(prompt)).not.toMatch(/SKILLS|WRITE ACCESS|Pracujesz/i)
	})
	it("never falls back to the raw first line", () => {
		expect(semanticFallbackTitle(`${skills}${task}`)).not.toMatch(/skills|graphify/i)
	})
	it("accepts a valid AI title", async () => {
		const result = await generateConversationTitle({
			taskId: "1",
			prompt: task,
			completeFn: vi.fn().mockResolvedValue("Naprawa interfejsu chatu Roo"),
		})
		expect(result).toEqual({ title: "Naprawa interfejsu chatu Roo", titleSource: "generated_ai" })
	})
	it("rejects a boilerplate AI title", async () => {
		const result = await generateConversationTitle({
			taskId: "1",
			prompt: `${skills}${task}`,
			completeFn: vi.fn().mockResolvedValue("SKILLS TO USE"),
		})
		expect(result.titleSource).toBe("fallback")
		expect(result.title).toMatch(/spinner|sidebara|chatu/i)
	})
	it("uses semantic fallback after request failure", async () => {
		const result = await generateConversationTitle({
			taskId: "1",
			prompt: `${skills}${task}`,
			completeFn: vi.fn().mockRejectedValue(new Error("429")),
		})
		expect(result.titleSource).toBe("fallback")
		expect(result.title).toMatch(/spinner|sidebara|chatu/i)
	})
	it("marks only obvious non-manual auto titles for repair", () => {
		expect(isBadAutoTitle("SKILLS TO USE", "fallback")).toBe(true)
		expect(isBadAutoTitle("WRITE ACCESS AUTHORIZATION", "generated_ai")).toBe(true)
		expect(isBadAutoTitle("SKILLS TO USE", "manual")).toBe(false)
		expect(isBadAutoTitle("Naprawa interfejsu chatu Roo", "fallback")).toBe(false)
	})
	it("sanitizes title length and punctuation", () => {
		const title = sanitizeTitle("Title: **Naprawa błędów działania panelu bocznego aplikacji Roo Code dziś.**")
		expect(title.split(/\s+/).length).toBeLessThanOrEqual(7)
		expect(title).not.toMatch(/[.!?]$/)
	})
})

const fixtures = [
	["UI bug", "Fix the spinner in the chat sidebar after switching conversations"],
	["security audit", "Audit command approval for unsafe shell input"],
	["feature implementation", "Add keyboard shortcuts to the project switcher"],
	["performance", "Optimize rendering of long conversation histories"],
	["multi-part", "Investigate duplicate chat rows and repair sidebar ordering. Then update tests."],
	["four skills", `${skills}Fix the chat composer layout on narrow screens`],
	["authorization", `${authorization}Repair draft persistence when switching chats`],
	["Polish", "Napraw zapisywanie modeli osobno dla każdego chatu"],
	["English", "Improve project reordering with keyboard controls"],
	["very long", `${skills}${"Agent setup instructions. ".repeat(100)}\nFix chat history loading after a cold start`],
] as const

describe("title quality fixture", () => {
	it.each(fixtures)("%s", (_kind, prompt) => {
		const cleaned = preprocessTitleInput(prompt)
		const title = semanticFallbackTitle(prompt)
		expect(cleaned).not.toMatch(/SKILLS TO USE|WRITE ACCESS AUTHORIZATION|\/graphify/i)
		expect(title).not.toMatch(/SKILLS TO USE|WRITE ACCESS|graphify|Agent setup/i)
		expect(title.split(/\s+/).length).toBeGreaterThanOrEqual(3)
		expect(title.split(/\s+/).length).toBeLessThanOrEqual(7)
	})
})
