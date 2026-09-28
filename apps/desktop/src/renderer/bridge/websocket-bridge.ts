/**
 * WebSocketBridge implementation of IDesktopBridge
 * Fallback bridge for web desktop mode (browser / no native shell)
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

export class WebSocketBridge implements IDesktopBridge {
	public readonly capabilities: DesktopBridgeCapabilities = {
		runtime: "web",
		platform: "web",
		isNative: false,
	}

	public readonly window: IWindowBridge = {
		minimize: async () => {},
		maximize: async () => {},
		close: async () => {},
		isMaximized: async () => false,
		startDragging: async () => {},
	}

	public readonly shell: IShellBridge = {
		selectFolder: async () => null,
		openPath: async () => false,
		showItemInFolder: async () => false,
		openExternal: async (url: string) => {
			window.open(url, "_blank", "noopener,noreferrer")
		},
	}

	public readonly clipboard: IClipboardBridge = {
		readText: async () => {
			return await navigator.clipboard.readText()
		},
		writeText: async (text: string) => {
			await navigator.clipboard.writeText(text)
		},
	}

	public readonly ipc: IIpcBridge

	constructor(sendSocketFn?: (msg: DesktopClientMessage) => void) {
		this.ipc = {
			send: (msg: DesktopClientMessage) => {
				sendSocketFn?.(msg)
			},
			onMessage: () => () => {},
			invoke: async () => {
				throw new Error("Invoke not supported on pure WebSocket bridge")
			},
		}
	}
}
