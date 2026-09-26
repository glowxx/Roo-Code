import fs from "fs"
import path from "path"
import os from "os"
import { createRequire } from "module"

export interface DesktopConfig {
	lastWorkspacePath?: string
	recentWorkspaces?: string[]
	theme?: string
	windowBounds?: {
		width: number
		height: number
		x?: number
		y?: number
		isMaximized?: boolean
	}
	openAiModelInfos?: Record<string, any>
	openAiModels?: string[]
}

/**
 * Returns the canonical path to desktop-config.json.
 * Consistent across all execution contexts (Electron pre-ready, post-ready, Web server, CLI, and scripts):
 * - Windows: %APPDATA%\Roo Code\desktop-config.json
 * - macOS: ~/Library/Application Support/Roo Code/desktop-config.json
 * - Linux: ~/.config/Roo Code/desktop-config.json
 */
export function getConfigFilePath(): string {
	try {
		if (process.platform === "win32") {
			const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
			return path.join(appData, "Roo Code", "desktop-config.json")
		}
		if (process.platform === "darwin") {
			return path.join(os.homedir(), "Library", "Application Support", "Roo Code", "desktop-config.json")
		}
		const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
		return path.join(configHome, "Roo Code", "desktop-config.json")
	} catch {
		return path.join(os.homedir(), ".roo-desktop-data", "desktop-config.json")
	}
}

/**
 * Loads the desktop configuration from disk.
 * If canonical config doesn't exist, checks and migrates legacy locations automatically.
 * Returns an empty object if the file doesn't exist or cannot be read.
 */
export function loadDesktopConfig(): DesktopConfig {
	try {
		const configPath = getConfigFilePath()
		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, "utf-8")
			const parsed = JSON.parse(content) as DesktopConfig
			if (parsed.lastWorkspacePath) {
				parsed.lastWorkspacePath = canonicalizePath(parsed.lastWorkspacePath)
			}
			if (parsed.lastWorkspacePath && (!parsed.recentWorkspaces || !Array.isArray(parsed.recentWorkspaces) || parsed.recentWorkspaces.length === 0)) {
				parsed.recentWorkspaces = [parsed.lastWorkspacePath]
			}
			if (Array.isArray(parsed.recentWorkspaces)) {
				const deduped: string[] = []
				for (const p of parsed.recentWorkspaces) {
					if (!p || typeof p !== "string") continue
					const canon = canonicalizePath(p)
					if (!deduped.some((existing) => arePathsEqual(existing, canon))) {
						deduped.push(canon)
					}
				}
				parsed.recentWorkspaces = deduped
			}
			return parsed
		}

		// Fallback & automatic migration from legacy locations (e.g. %APPDATA%\@roo-code\desktop\desktop-config.json)
		const legacyCandidates: string[] = []
		if (process.platform === "win32" && process.env.APPDATA) {
			legacyCandidates.push(path.join(process.env.APPDATA, "@roo-code", "desktop", "desktop-config.json"))
		}
		legacyCandidates.push(path.join(os.homedir(), ".roo-desktop-data", "desktop-config.json"))

		for (const legacyPath of legacyCandidates) {
			if (fs.existsSync(legacyPath)) {
				try {
					const content = fs.readFileSync(legacyPath, "utf-8")
					const parsed = JSON.parse(content) as DesktopConfig
					if (parsed.lastWorkspacePath && (!parsed.recentWorkspaces || !Array.isArray(parsed.recentWorkspaces) || parsed.recentWorkspaces.length === 0)) {
						parsed.recentWorkspaces = [parsed.lastWorkspacePath]
					}
					const dir = path.dirname(configPath)
					if (!fs.existsSync(dir)) {
						fs.mkdirSync(dir, { recursive: true })
					}
					fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), "utf-8")
					return parsed
				} catch {}
			}
		}
	} catch (err) {
		console.warn("Failed to load desktop config:", err)
	}
	return {}
}

/**
 * Canonicalizes a filesystem path for consistent cross-platform and Windows storage/lookup.
 * - Resolves relative paths
 * - On Windows: normalizes drive letter to uppercase, handles UNC paths, strips \\?\ prefixes
 * - Removes trailing slashes (except root paths like C:\ or /)
 */
export function canonicalizePath(p: string): string {
	if (!p || typeof p !== "string" || !p.trim()) return ""
	let normalized = path.normalize(path.resolve(p.trim()))
	if (process.platform === "win32") {
		if (normalized.startsWith("\\\\?\\UNC\\")) {
			normalized = "\\\\" + normalized.slice(8)
		} else if (normalized.startsWith("\\\\?\\")) {
			normalized = normalized.slice(4)
		}
		if (/^[a-z]:/i.test(normalized)) {
			normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1)
		}
	}
	if (normalized.length > 3 && (normalized.endsWith("\\") || normalized.endsWith("/"))) {
		normalized = normalized.slice(0, -1)
	}
	return normalized
}

/**
 * Compares two filesystem paths for equality.
 * On Windows, comparison is case-insensitive.
 */
export function arePathsEqual(p1: string, p2: string): boolean {
	const c1 = canonicalizePath(p1)
	const c2 = canonicalizePath(p2)
	if (!c1 || !c2) return false
	if (process.platform === "win32") {
		return c1.toLowerCase() === c2.toLowerCase()
	}
	return c1 === c2
}

/**
 * Saves or updates the desktop configuration on disk.
 * Includes a Zero-State Guard to prevent erasing lastWorkspacePath with empty or undefined values.
 * Automatically adds any selected or changed lastWorkspacePath to recentWorkspaces (max 25, no duplicates).
 */
export function saveDesktopConfig(updates: Partial<DesktopConfig>): DesktopConfig {
	try {
		const configPath = getConfigFilePath()
		const current = loadDesktopConfig()

		// Zero-State Guard: Never overwrite an existing valid lastWorkspacePath with an empty, whitespace, or undefined value
		let finalWorkspacePath = current.lastWorkspacePath
		if (typeof updates.lastWorkspacePath === "string" && updates.lastWorkspacePath.trim().length > 0) {
			finalWorkspacePath = canonicalizePath(updates.lastWorkspacePath)
		}

		// Manage recentWorkspaces list (up to 25 items, no duplicates)
		let recent: string[] = []
		if (Array.isArray(updates.recentWorkspaces)) {
			recent = [...updates.recentWorkspaces]
		} else if (Array.isArray(current.recentWorkspaces)) {
			recent = [...current.recentWorkspaces]
		} else if (finalWorkspacePath) {
			recent = [finalWorkspacePath]
		}

		// If a new lastWorkspacePath was explicitly updated, ensure it's at the front of recentWorkspaces
		if (updates.lastWorkspacePath && finalWorkspacePath) {
			recent = [finalWorkspacePath, ...recent.filter((p) => !arePathsEqual(p, finalWorkspacePath!))]
		}

		// Deduplicate recentWorkspaces using arePathsEqual
		const dedupedRecent: string[] = []
		for (const p of recent) {
			if (!p || typeof p !== "string" || !p.trim()) continue
			const canon = canonicalizePath(p)
			if (!dedupedRecent.some((existing) => arePathsEqual(existing, canon))) {
				dedupedRecent.push(canon)
			}
		}

		const merged: DesktopConfig = {
			...current,
			...updates,
			lastWorkspacePath: finalWorkspacePath,
			recentWorkspaces: dedupedRecent.slice(0, 25),
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
