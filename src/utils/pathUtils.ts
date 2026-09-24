import * as vscode from "vscode"
import * as path from "path"

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
		return !(
			normAbsolute === normFolder ||
			normAbsolute.startsWith(normFolder + (normFolder.endsWith(path.sep) ? "" : path.sep))
		)
	}

	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return true
	}

	return !vscode.workspace.workspaceFolders.some((folder) => {
		const folderPath = path.normalize(folder.uri.fsPath)
		const normFolder = process.platform === "win32" ? folderPath.toLowerCase() : folderPath
		return (
			normAbsolute === normFolder ||
			normAbsolute.startsWith(normFolder + (normFolder.endsWith(path.sep) ? "" : path.sep))
		)
	})
}
