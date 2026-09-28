/**
 * ElectronBridge implementation of IDesktopBridge
 * Bridges desktop calls through window.__desktopAPI (Electron preload)
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

interface ElectronDesktopApi {
	isElectron?: boolean
	platform?: string
	selectFolder?: () => Promise<string | null>
	showItemInFolder?: (filePath: string) => Promise<boolean>
	openPath?: (filePath: string) => Promise<boolean>
	sendToExtension?: (message: unknown) => void
	minimize?: () => void
	maximize?: () => void
	close?: () => void
	onExtensionMessage?: (callback: (message: unknown) => void) => () => void
}

declare global {
	interface Window {
		__desktopAPI?: ElectronDesktopApi
	}
}

export class ElectronBridge implements IDesktopBridge {
	public readonly capabilities: DesktopBridgeCapabilities

	public readonly window: IWindowBridge = {
		minimize: async () => {
			window.__desktopAPI?.minimize?.()
		},
		maximize: async () => {
			window.__desktopAPI?.maximize?.()
		},
		close: async () => {
			window.__desktopAPI?.close?.()
		},
		isMaximized: async () => {
			return false
		},
		startDragging: async () => {
			// Electron handles dragging via CSS -webkit-app-region: drag
		},
	}

	public readonly shell: IShellBridge = {
		selectFolder: async () => {
			if (window.__desktopAPI?.selectFolder) {
				return await window.__desktopAPI.selectFolder()
			}
			return null
		},
		openPath: async (filePath: string) => {
			if (window.__desktopAPI?.openPath) {
				return await window.__desktopAPI.openPath(filePath)
			}
			return false
		},
		showItemInFolder: async (filePath: string) => {
			if (window.__desktopAPI?.showItemInFolder) {
				return await window.__desktopAPI.showItemInFolder(filePath)
			}
			return false
		},
		openExternal: async (url: string) => {
			if (window.__desktopAPI?.openPath) {
				await window.__desktopAPI.openPath(url)
			} else {
				window.open(url, "_blank", "noopener,noreferrer")
			}
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
		const api = window.__desktopAPI
		const platform = (api?.platform as "win32" | "darwin" | "linux") || "win32"

		this.capabilities = {
			runtime: "electron",
			platform,
			isNative: true,
		}

		this.ipc = {
			send: (msg: DesktopClientMessage) => {
				if (msg.type === "webviewMessage" && api?.sendToExtension) {
					api.sendToExtension(msg.message)
				} else if (sendSocketFn) {
					sendSocketFn(msg)
				}
			},
			onMessage: (callback: (message: DesktopServerMessage) => void) => {
				if (api?.onExtensionMessage) {
					return api.onExtensionMessage((msg) => {
						callback(msg as DesktopServerMessage)
					})
				}
				return () => {}
			},
			invoke: async <T = unknown>(_channel: string, _payload?: unknown): Promise<T> => {
				throw new Error("Generic invoke not implemented in legacy Electron bridge")
			},
		}
	}
}
