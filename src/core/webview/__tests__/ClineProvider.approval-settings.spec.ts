import { describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"

describe("effective command approval settings", () => {
	it("uses the same workspace command rules in task runtime as in the UI", async () => {
		const configuration = vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: (key: string, fallback: string[]) => {
				if (key === "deniedCommands") return ["git diff"]
				if (key === "allowedCommands") return ["git status"]
				return fallback
			},
		} as any)
		try {
			const provider = Object.create(ClineProvider.prototype) as ClineProvider
			;(provider as any).contextProxy = {
				getValues: () => ({ approvalMode: "auto", allowedCommands: [], deniedCommands: [] }),
				getValue: () => undefined,
				getProviderSettings: () => ({ apiProvider: "xkiro" }),
			}
			;(provider as any).customModesManager = { getCustomModes: async () => [] }
			;(provider as any).taskHistoryStore = { getAll: () => [] }
			;(provider as any).context = { workspaceState: { get: () => false } }
			provider.getGlobalState = vi.fn().mockResolvedValue(undefined) as any

			const state = await provider.getState()
			expect(state.allowedCommands).toContain("git status")
			expect(state.deniedCommands).toContain("git diff")
		} finally {
			configuration.mockRestore()
		}
	})
})
