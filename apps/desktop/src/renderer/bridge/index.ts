/**
 * DesktopBridge Factory & Singleton Entrypoint
 * Detects the active desktop runtime (Tauri 2 vs Electron vs Web)
 * and returns the appropriate IDesktopBridge implementation.
 */

import type { IDesktopBridge } from "./types.js"
import { ElectronBridge } from "./electron-bridge.js"
import { TauriBridge } from "./tauri-bridge.js"
import { WebSocketBridge } from "./websocket-bridge.js"
import type { DesktopClientMessage } from "../../shared/types.js"

export * from "./types.js"
export { ElectronBridge } from "./electron-bridge.js"
export { TauriBridge } from "./tauri-bridge.js"
export { WebSocketBridge } from "./websocket-bridge.js"

let activeBridge: IDesktopBridge | null = null

export function getDesktopBridge(sendSocketFallback?: (msg: DesktopClientMessage) => void): IDesktopBridge {
	if (activeBridge) return activeBridge

	// 1. Detect Tauri 2 environment
	if (typeof window !== "undefined" && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)) {
		activeBridge = new TauriBridge(sendSocketFallback)
		return activeBridge
	}

	// 2. Detect Electron environment
	if (typeof window !== "undefined" && (window as any).__desktopAPI?.isElectron) {
		activeBridge = new ElectronBridge(sendSocketFallback)
		return activeBridge
	}

	// 3. Fallback to Web Desktop mode
	activeBridge = new WebSocketBridge(sendSocketFallback)
	return activeBridge
}
