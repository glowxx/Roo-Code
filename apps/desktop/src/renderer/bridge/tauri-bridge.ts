/**
 * TauriBridge implementation of IDesktopBridge
 * Bridges desktop calls through Tauri 2.0 Rust commands and events
 */

import type {
	IDesktopBridge,
	IWindowBridge,
	IShellBridge,
	IClipboardBridge,
	IIpcBridge,
	DesktopBridgeCapabilities,
} from "./types.js"
import type { DesktopClientMessage, DesktopServerMessage } from "../../shared/types.js"

function getTauriInvoke(): (<T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null {
	if (typeof window === "undefined") return null
	const tauri = (window as any).__TAURI__
	if (typeof tauri?.core?.invoke === "function") {
		return (cmd, args) => tauri.core.invoke(cmd, args)
	}
	if (typeof tauri?.invoke === "function") {
		return (cmd, args) => tauri.invoke(cmd, args)
	}
	const internals = (window as any).__TAURI_INTERNALS__
	if (typeof internals?.invoke === "function") {
		return (cmd, args) => internals.invoke(cmd, args)
	}
	return null
}

function getTauriEvent(): {
	listen: <T = unknown>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>
	emit: (event: string, payload?: unknown) => Promise<void>
} | null {
	if (typeof window === "undefined") return null
	const tauri = (window as any).__TAURI__
	if (tauri?.event?.listen) {
		return tauri.event
	}
	return null
}

export class TauriBridge implements IDesktopBridge {
	public readonly capabilities: DesktopBridgeCapabilities

	public readonly window: IWindowBridge = {
		minimize: async () => {
			const invoke = getTauriInvoke()
			if (invoke) {
				await invoke("desktop_window_minimize")
			}
		},
		maximize: async () => {
			const invoke = getTauriInvoke()
			if (invoke) {
				await invoke("desktop_window_maximize")
			}
		},
		close: async () => {
			const invoke = getTauriInvoke()
			if (invoke) {
				await invoke("desktop_window_close")
			}
		},
		isMaximized: async () => {
			const invoke = getTauriInvoke()
			if (invoke) {
				return await invoke<boolean>("desktop_window_is_maximized")
			}
			return false
		},
		startDragging: async () => {
			const invoke = getTauriInvoke()
			if (invoke) {
				await invoke("desktop_window_start_dragging")
			}
		},
	}

	public readonly shell: IShellBridge = {
		selectFolder: async (options) => {
			const invoke = getTauriInvoke()
			if (invoke) {
				return await invoke<string | null>("desktop_select_folder", {
					defaultPath: options?.defaultPath,
				})
			}
			return null
		},
		openPath: async (filePath: string) => {
			const invoke = getTauriInvoke()
			if (invoke) {
				return await invoke<boolean>("desktop_open_path", { filePath })
			}
			return false
		},
		showItemInFolder: async (filePath: string) => {
			const invoke = getTauriInvoke()
			if (invoke) {
				return await invoke<boolean>("desktop_show_item_in_folder", { filePath })
			}
			return false
		},
		openExternal: async (url: string) => {
			const invoke = getTauriInvoke()
			if (invoke) {
				await invoke("desktop_open_external", { url })
			} else {
				window.open(url, "_blank", "noopener,noreferrer")
			}
		},
	}

	public readonly clipboard: IClipboardBridge = {
		readText: async () => {
			const invoke = getTauriInvoke()
			if (invoke) {
				try {
					return await invoke<string>("desktop_clipboard_read")
				} catch (err) {
					console.warn("[TauriBridge] Native clipboard read failed, falling back to navigator:", err)
				}
			}
			return await navigator.clipboard.readText()
		},
		writeText: async (text: string) => {
			const invoke = getTauriInvoke()
			if (invoke) {
				try {
					await invoke("desktop_clipboard_write", { text })
					return
				} catch (err) {
					console.warn("[TauriBridge] Native clipboard write failed, falling back to navigator:", err)
				}
			}
			await navigator.clipboard.writeText(text)
		},
	}

	public readonly ipc: IIpcBridge

	constructor(sendSocketFallback?: (msg: DesktopClientMessage) => void) {
		this.capabilities = {
			runtime: "tauri",
			platform: "win32",
			isNative: true,
		}

		this.ipc = {
			send: (msg: DesktopClientMessage) => {
				const invoke = getTauriInvoke()
				if (invoke) {
					invoke("desktop_client_message", { message: msg }).catch((err) => {
						console.error("[TauriBridge] Failed to send client message:", err)
					})
				}
				if (sendSocketFallback) {
					sendSocketFallback(msg)
				}
			},
			onMessage: (callback: (message: DesktopServerMessage) => void) => {
				const event = getTauriEvent()
				if (event?.listen) {
					let unlistenFn: (() => void) | null = null
					event
						.listen<DesktopServerMessage>("desktop-server-message", (ev) => {
							callback(ev.payload)
						})
						.then((unlisten) => {
							unlistenFn = unlisten
						})
						.catch((err) => {
							console.error("[TauriBridge] Failed to listen to desktop-server-message:", err)
						})

					return () => {
						unlistenFn?.()
					}
				}
				return () => {}
			},
			invoke: async <T = unknown>(channel: string, payload?: unknown): Promise<T> => {
				const invoke = getTauriInvoke()
				if (invoke) {
					return await invoke<T>(channel, payload as Record<string, unknown>)
				}
				throw new Error(`[TauriBridge] Cannot invoke ${channel} - Tauri invoke not available`)
			},
		}
	}
}
