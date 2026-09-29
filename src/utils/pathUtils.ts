import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

const gitRootCache = new Map<string, string | null>()

export function findGitRoot(startDir: string): string | null {
	const resolved = path.resolve(startDir)
	if (gitRootCache.has(resolved)) {
		return gitRootCache.get(resolved)!
	}

	let current = resolved
	while (true) {
		const gitPath = path.join(current, ".git")
		try {
			if (fs.existsSync(gitPath)) {
				gitRootCache.set(resolved, current)
				return current
			}
		} catch (_) {}

		const parent = path.dirname(current)
		if (parent === current) {
			break
		}
		current = parent
	}

	gitRootCache.set(resolved, null)
	return null
}

/**
 * Checks if a file path is outside all workspace folders
 * @param filePath The file path to check
 * @returns true if the path is outside all workspace folders, false otherwise
 */
export function isPathOutsideWorkspace(filePath: string, customWorkspacePath?: string): boolean {
	const absolutePath = path.resolve(filePath)
	const normAbsolute =
		process.platform === "win32" ? path.normalize(absolutePath).toLowerCase() : path.normalize(absolutePath)

	if (customWorkspacePath && customWorkspacePath.trim()) {
		const folderPath = path.normalize(path.resolve(customWorkspacePath))
		const normFolder = process.platform === "win32" ? folderPath.toLowerCase() : folderPath
		const isDirect =
			normAbsolute === normFolder ||
			normAbsolute.startsWith(normFolder + (normFolder.endsWith(path.sep) ? "" : path.sep))
		if (isDirect) {
			return false
		}

		// Sibling packages in same monorepo / git worktree
		const repoRoot = findGitRoot(folderPath)
		if (repoRoot) {
			const normRepo =
				process.platform === "win32" ? path.normalize(repoRoot).toLowerCase() : path.normalize(repoRoot)
			if (
				normAbsolute === normRepo ||
				normAbsolute.startsWith(normRepo + (normRepo.endsWith(path.sep) ? "" : path.sep))
			) {
				return false
			}
		}

		return true
	}

	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return true
	}

	return !vscode.workspace.workspaceFolders.some((folder) => {
		const folderPath = path.normalize(folder.uri.fsPath)
		const normFolder = process.platform === "win32" ? folderPath.toLowerCase() : folderPath
		const isDirect =
			normAbsolute === normFolder ||
			normAbsolute.startsWith(normFolder + (normFolder.endsWith(path.sep) ? "" : path.sep))
		if (isDirect) {
			return true
		}

		const repoRoot = findGitRoot(folderPath)
		if (repoRoot) {
			const normRepo =
				process.platform === "win32" ? path.normalize(repoRoot).toLowerCase() : path.normalize(repoRoot)
			if (
				normAbsolute === normRepo ||
				normAbsolute.startsWith(normRepo + (normRepo.endsWith(path.sep) ? "" : path.sep))
			) {
				return true
			}
		}

		return false
	})
}
