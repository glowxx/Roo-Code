import { describe, it, expect, vi, beforeEach } from "vitest"
import { openSettings } from "@/utils/settingsNavigation"
import { vscode } from "@/utils/vscode"
import { resolveCategory, resolveSectionDomId, SECTION_TO_CATEGORY } from "@/components/settings/SettingsView"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("Settings Navigation Invariant & Consistency", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const auditedEntryPoints = [
		{
			name: "Main Settings button (Desktop Header)",
			targetSection: "providers",
			expectedCategory: "providers",
			expectedDomId: "section-providers",
		},
		{
			name: "Configure Safety Guardrail (ChatRow warning)",
			targetSection: "commandSafety",
			expectedCategory: "permissions",
			expectedDomId: "section-commandSafety",
		},
		{
			name: "Configure Safety Guardrail (safety alias)",
			targetSection: "safety",
			expectedCategory: "permissions",
			expectedDomId: "section-commandSafety",
		},
		{
			name: "Configure Auto-Approve (AutoApproveDropdown)",
			targetSection: "autoApprove",
			expectedCategory: "permissions",
			expectedDomId: "section-autoApprove",
		},
		{
			name: "Configure MCP (ChatRow warning)",
			targetSection: "mcp",
			expectedCategory: "tools",
			expectedDomId: "section-mcp",
		},
		{
			name: "Configure MCP (TooManyToolsWarning)",
			targetSection: "mcp",
			expectedCategory: "tools",
			expectedDomId: "section-mcp",
		},
		{
			name: "Configure Provider (ModelSelector)",
			targetSection: "providers",
			expectedCategory: "providers",
			expectedDomId: "section-providers",
		},
		{
			name: "Configure Model (ModelSelector model alias)",
			targetSection: "model",
			expectedCategory: "providers",
			expectedDomId: "section-model",
		},
		{
			name: "Configure Terminal (CommandExecutionError)",
			targetSection: "terminal",
			expectedCategory: "tools",
			expectedDomId: "section-terminal",
		},
		{
			name: "Configure Checkpoints (CheckpointWarning)",
			targetSection: "checkpoints",
			expectedCategory: "context",
			expectedDomId: "section-checkpoints",
		},
		{
			name: "Configure Modes (ModeSelector)",
			targetSection: "modes",
			expectedCategory: "modes_prompts",
			expectedDomId: "section-modes",
		},
		{
			name: "Configure Worktrees (WorktreeSelector)",
			targetSection: "worktrees",
			expectedCategory: "tools",
			expectedDomId: "section-worktrees",
		},
		{
			name: "Configure Slash Commands (ContextMenu)",
			targetSection: "slashCommands",
			expectedCategory: "modes_prompts",
			expectedDomId: "section-slashCommands",
		},
		{
			name: "Configure Retired Provider (ChatView)",
			targetSection: "providers",
			expectedCategory: "providers",
			expectedDomId: "section-providers",
		},
		{
			name: "Edit Config (ApiConfigSelector)",
			targetSection: "providers",
			expectedCategory: "providers",
			expectedDomId: "section-providers",
		},
		{
			name: "Settings Link (ErrorRow roocode://settings)",
			targetSection: "providers",
			expectedCategory: "providers",
			expectedDomId: "section-providers",
		},
	]

	describe("Entry Points Navigation Consistency Table", () => {
		auditedEntryPoints.forEach(({ name, targetSection, expectedCategory, expectedDomId }) => {
			it(`routes '${name}' to canonical modern section '${targetSection}' in category '${expectedCategory}'`, () => {
				openSettings({ section: targetSection, source: name })

				expect(vscode.postMessage).toHaveBeenCalledWith({
					type: "switchTab",
					tab: "settings",
					values: expect.objectContaining({
						section: targetSection,
						source: name,
					}),
				})

				expect(resolveCategory(targetSection)).toBe(expectedCategory)
				expect(resolveSectionDomId(targetSection)).toBe(expectedDomId)
			})
		})
	})

	describe("Legacy Path Regression Coverage", () => {
		it("ensures openSettings does not emit deprecated window.postMessage settingsButtonClicked events", () => {
			const windowPostMessageSpy = vi.spyOn(window, "postMessage")

			openSettings({ section: "commandSafety", source: "test" })

			// In jsdom (window.parent === window), window.parent.postMessage is not called
			expect(windowPostMessageSpy).not.toHaveBeenCalledWith(
				expect.objectContaining({ action: "settingsButtonClicked" }),
				"*",
			)

			windowPostMessageSpy.mockRestore()
		})

		it("verifies SECTION_TO_CATEGORY includes all modern aliases and never defaults safety to wrong category", () => {
			expect(SECTION_TO_CATEGORY["commandSafety"]).toBe("permissions")
			expect(SECTION_TO_CATEGORY["safety"]).toBe("permissions")
			expect(SECTION_TO_CATEGORY["autoApprove"]).toBe("permissions")
			expect(SECTION_TO_CATEGORY["providers"]).toBe("providers")
			expect(SECTION_TO_CATEGORY["model"]).toBe("providers")
			expect(SECTION_TO_CATEGORY["mcp"]).toBe("tools")
			expect(SECTION_TO_CATEGORY["terminal"]).toBe("tools")
		})
	})
})
