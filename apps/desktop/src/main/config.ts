import fs from "fs"
import path from "path"
import os from "os"
import { createRequire } from "module"

export interface DesktopConfig {
	lastWorkspacePath?: string
	theme?: string
	windowBounds?: {
		width: number
		height: number
		x?: number
		y?: number
		isMaximized?: boolean
	}
}

/**
 * Returns the path to desktop-config.json.
 * Uses app.getPath("userData") in Electron (%APPDATA%\Roo Code\desktop-config.json on Windows),
 * or %USERPROFILE%\.roo-desktop-data\desktop-config.json in non-Electron mode.
 */
export function getConfigFilePath(): string {
	if (process.versions.electron) {
		try {
			const req = createRequire(import.meta.url)
			const electron = req("electron")
			const app = electron?.app || electron?.default?.app
			if (app && typeof app.getPath === "function") {
				return path.join(app.getPath("userData"), "desktop-config.json")
			}
		} catch {
			// Fall back to APPDATA if electron require fails
		}

		if (process.platform === "win32" && process.env.APPDATA) {
			return path.join(process.env.APPDATA, "Roo Code", "desktop-config.json")
		}
	}

	return path.join(os.homedir(), ".roo-desktop-data", "desktop-config.json")
}

/**
 * Loads the desktop configuration from disk.
 * Returns an empty object if the file doesn't exist or cannot be read.
 */
export function loadDesktopConfig(): DesktopConfig {
	try {
		const configPath = getConfigFilePath()
		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, "utf-8")
			return JSON.parse(content) as DesktopConfig
		}
	} catch (err) {
		console.warn("Failed to load desktop config:", err)
	}
	return {}
}

/**
 * Saves or updates the desktop configuration on disk.
 */
export function saveDesktopConfig(updates: Partial<DesktopConfig>): DesktopConfig {
	try {
		const configPath = getConfigFilePath()
		const current = loadDesktopConfig()
		const merged: DesktopConfig = {
			...current,
			...updates,
			windowBounds: updates.windowBounds
				? { ...current.windowBounds, ...updates.windowBounds }
				: current.windowBounds,
		}
		const dir = path.dirname(configPath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8")
		return merged
	} catch (err) {
		console.warn("Failed to save desktop config:", err)
		return {}
	}
}
