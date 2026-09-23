import { vscode } from "./vscode"

export interface OpenSettingsOptions {
	section?: string
	subsection?: string
	source?: string
}

/**
 * Canonical helper for opening Settings across both Desktop and Extension contexts.
 *
 * In Desktop:
 * - Directs the Desktop host window to open the modern settings modal shell
 *   deep-linked to the specified section.
 * - Prevents the chat webview from erroneously mounting an in-place settings view.
 *
 * In VSCode Extension:
 * - Dispatches a switchTab event to the extension host/provider to transition
 *   to the canonical settings tab with the target section.
 */
export const openSettings = (options: OpenSettingsOptions = {}) => {
	const section = options.section || "providers"
	const payload = {
		section,
		subsection: options.subsection,
		source: options.source,
	}

	// Post canonical switchTab message to vscode API wrapper (which routes to window.parent in Desktop)
	vscode.postMessage({
		type: "switchTab",
		tab: "settings",
		values: payload,
	})

	// If embedded inside Desktop iframe, also post explicit openSettings event to window.parent
	if (typeof window !== "undefined" && window.parent && window.parent !== window) {
		window.parent.postMessage(
			{
				type: "openSettings",
				...payload,
			},
			"*",
		)
	}
}
