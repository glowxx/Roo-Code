/**
 * DesktopBridge Interface
 * Platform-neutral abstraction layer for Roo Code Desktop GUI
 * Isolates the frontend from specific desktop runtimes (Electron vs Tauri 2 / Rust vs Web).
 */

import type { DesktopClientMessage, DesktopServerMessage } from "../../shared/types.js"

export interface IWindowBridge {
	minimize(): Promise<void>
	maximize(): Promise<void>
	close(): Promise<void>
	isMaximized(): Promise<boolean>
	startDragging(): Promise<void>
}

export interface IShellBridge {
	selectFolder(options?: { defaultPath?: string }): Promise<string | null>
	openPath(filePath: string): Promise<boolean>
	showItemInFolder(filePath: string): Promise<boolean>
	openExternal(url: string): Promise<void>
}

export interface IClipboardBridge {
	readText(): Promise<string>
	writeText(text: string): Promise<void>
}

export interface IIpcBridge {
	send(message: DesktopClientMessage): void
	onMessage(callback: (message: DesktopServerMessage) => void): () => void
	invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>
}

export interface DesktopBridgeCapabilities {
	readonly runtime: "tauri" | "electron" | "web"
	readonly platform: "win32" | "darwin" | "linux" | "web"
	readonly isNative: boolean
}

export interface IDesktopBridge {
	readonly capabilities: DesktopBridgeCapabilities
	readonly window: IWindowBridge
	readonly shell: IShellBridge
	readonly clipboard: IClipboardBridge
	readonly ipc: IIpcBridge
}
