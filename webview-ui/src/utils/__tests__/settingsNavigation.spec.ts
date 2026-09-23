import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { openSettings } from "../settingsNavigation"
import { vscode } from "../vscode"

vi.mock("../vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("settingsNavigation", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("dispatches canonical switchTab message with default providers section", () => {
		openSettings()

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "switchTab",
			tab: "settings",
			values: {
				section: "providers",
				subsection: undefined,
				source: undefined,
			},
		})
	})

	it("dispatches canonical switchTab message with specified section and source", () => {
		openSettings({ section: "commandSafety", source: "command_safety_warning" })

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "switchTab",
			tab: "settings",
			values: {
				section: "commandSafety",
				subsection: undefined,
				source: "command_safety_warning",
			},
		})
	})

	it("dispatches openSettings to window.parent when running in an iframe / desktop shell", () => {
		const mockParentPostMessage = vi.fn()
		const originalParent = window.parent

		try {
			Object.defineProperty(window, "parent", {
				value: {
					postMessage: mockParentPostMessage,
				},
				configurable: true,
			})

			openSettings({ section: "autoApprove", source: "auto_approve_dropdown" })

			expect(mockParentPostMessage).toHaveBeenCalledWith(
				{
					type: "openSettings",
					section: "autoApprove",
					subsection: undefined,
					source: "auto_approve_dropdown",
				},
				"*",
			)
		} finally {
			Object.defineProperty(window, "parent", {
				value: originalParent,
				configurable: true,
			})
		}
	})
})
