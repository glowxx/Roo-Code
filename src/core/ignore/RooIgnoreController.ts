import path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import fs from "fs/promises"
import fsSync from "fs"
import ignore, { Ignore } from "ignore"
import * as vscode from "vscode"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in .rooignore files.
 */
export class RooIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private disposables: vscode.Disposable[] = []
	rooIgnoreContent: string | undefined

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.rooIgnoreContent = undefined
		// Set up file watcher for .rooignore
		this.setupFileWatcher()
	}

	/**
	 * Initialize the controller by loading custom patterns
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		await this.loadRooIgnore()
	}

	/**
	 * Set up the file watcher for .rooignore changes
	 */
	private setupFileWatcher(): void {
		const rooignorePattern = new vscode.RelativePattern(this.cwd, ".rooignore")
		const fileWatcher = vscode.workspace.createFileSystemWatcher(rooignorePattern)

		// Watch for changes and updates
		this.disposables.push(
			fileWatcher.onDidChange(() => {
				this.loadRooIgnore()
			}),
			fileWatcher.onDidCreate(() => {
				this.loadRooIgnore()
			}),
			fileWatcher.onDidDelete(() => {
				this.loadRooIgnore()
			}),
		)

		// Add fileWatcher itself to disposables
		this.disposables.push(fileWatcher)
	}

	/**
	 * Load custom patterns from .rooignore if it exists
	 */
	private async loadRooIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()
			const ignorePath = path.join(this.cwd, ".rooignore")
			if (await fileExistsAtPath(ignorePath)) {
				const content = await fs.readFile(ignorePath, "utf8")
				this.rooIgnoreContent = content
				const normalizedPatterns = content
					.split(/\r?\n/)
					.map((line) => {
						const trimmed = line.trim()
						if (!trimmed || trimmed.startsWith("#")) {
							return line
						}
						return line.replace(/\\/g, "/")
					})
					.join("\n")
				this.ignoreInstance.add(normalizedPatterns)
				this.ignoreInstance.add(".rooignore")
			} else {
				this.rooIgnoreContent = undefined
			}
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			console.error("Unexpected error loading .rooignore:", error)
		}
	}

	/**
	 * Splits a command string into tokens taking quotes into account
	 */
	private splitCommandTokens(command: string): string[] {
		const tokens: string[] = []
		let current = ""
		let inQuote: '"' | "'" | null = null

		for (let i = 0; i < command.length; i++) {
			const char = command[i]

			if (inQuote) {
				current += char
				if (char === inQuote) {
					inQuote = null
				}
			} else {
				if (char === '"' || char === "'") {
					inQuote = char
					current += char
				} else if (/\s/.test(char)) {
					if (current.length > 0) {
						tokens.push(current)
						current = ""
					}
				} else {
					current += char
				}
			}
		}

		if (current.length > 0) {
			tokens.push(current)
		}

		return tokens
	}

	/**
	 * Removes surrounding single or double quotes from a token
	 */
	private stripQuotes(value: string): string {
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			return value.slice(1, -1)
		}
		return value
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * Automatically resolves symlinks
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		// Always allow access if .rooignore does not exist
		if (!this.rooIgnoreContent) {
			return true
		}
		try {
			const absolutePath = path.resolve(this.cwd, filePath)

			// Follow symlinks to get the real path
			let realPath: string
			try {
				realPath = fsSync.realpathSync(absolutePath)
			} catch {
				// If realpath fails (file doesn't exist, broken symlink, etc.),
				// use the original path
				realPath = absolutePath
			}

			// Convert real path to relative for .rooignore checking
			const relativePath = path.relative(this.cwd, realPath).toPosix()

			// Check if the real path is ignored
			return !this.ignoreInstance.ignores(relativePath)
		} catch (error) {
			// Deny access on errors or invalid paths
			return false
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no .rooignore exists
		if (!this.rooIgnoreContent) {
			return undefined
		}

		// Split command into parts taking quotes into account and get the base command
		const parts = this.splitCommandTokens(command.trim())
		if (parts.length === 0) {
			return undefined
		}
		const baseCommand = this.stripQuotes(parts[0]).toLowerCase()

		// Commands that read file contents
		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		if (fileReadingCommands.includes(baseCommand)) {
			// Check each argument that could be a file path
			for (let i = 1; i < parts.length; i++) {
				let arg = parts[i]
				// Skip command flags/options (both Unix and PowerShell style)
				if (arg.startsWith("-") || arg.startsWith("/")) {
					continue
				}
				// Remove surrounding quotes before path validation
				arg = this.stripQuotes(arg)
				if (!arg) {
					continue
				}
				// Ignore PowerShell parameter names, but not Windows drive paths (e.g. C:\)
				if (arg.includes(":") && !/^[a-zA-Z]:[\\/]/.test(arg)) {
					continue
				}
				// Validate file access
				if (!this.validateAccess(arg)) {
					return arg
				}
			}
		}

		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			console.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}

	/**
	 * Get formatted instructions about the .rooignore file for the LLM
	 * @returns Formatted instructions or undefined if .rooignore doesn't exist
	 */
	getInstructions(): string | undefined {
		if (!this.rooIgnoreContent) {
			return undefined
		}

		return `# .rooignore\n\n(The following is provided by a root-level .rooignore file where the user has specified files and directories that should not be accessed. When using list_files, you'll notice a ${LOCK_TEXT_SYMBOL} next to files that are blocked. Attempting to access the file's contents e.g. through read_file will result in an error.)\n\n${this.rooIgnoreContent}\n.rooignore`
	}
}
