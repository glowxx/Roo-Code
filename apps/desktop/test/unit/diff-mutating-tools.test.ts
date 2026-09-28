import { describe, it, expect } from "vitest"

describe("Diff Mutating Tools & Filter Logic (TDD)", () => {
	const MUTATING_TOOLS = new Set([
		"writeToFile",
		"write_to_file",
		"apply_diff",
		"newFileCreated",
		"editedExistingFile",
		"appliedDiff",
	])

	function isMutatingTool(toolName?: string): boolean {
		if (!toolName) return false
		return MUTATING_TOOLS.has(toolName)
	}

	it("filters out read-only tools like readFile and searchFiles from diff list", () => {
		const toolCalls = [
			{ tool: "readFile", path: "graphify-out/cache/last_query_stamp" },
			{ tool: "read_file", path: "src/main/server.ts" },
			{ tool: "searchFiles", path: "src" },
			{ tool: "listFilesRecursive", path: "docs" },
			{ tool: "write_to_file", path: "src/utils/math.ts" },
			{ tool: "newFileCreated", path: "src/components/NewView.tsx" },
			{ tool: "appliedDiff", path: "src/main/agent-host.ts" },
		]

		const mutatingOnly = toolCalls.filter((tc) => isMutatingTool(tc.tool))
		expect(mutatingOnly).toHaveLength(3)
		expect(mutatingOnly.map((m) => m.path)).toEqual([
			"src/utils/math.ts",
			"src/components/NewView.tsx",
			"src/main/agent-host.ts",
		])
	})

	it("correctly identifies gitignored or untracked file as added when file exists on disk", () => {
		interface DiffResolution {
			filePath: string
			status: "modified" | "added" | "deleted"
			oldContent: string | null
			newContent: string | null
			contentUnavailable?: boolean
			reason?: string
		}

		function resolveDiffForFile(params: {
			filePath: string
			gitTracked: boolean
			isGitIgnored: boolean
			fileExistsOnDisk: boolean
			diskContent: string | null
		}): DiffResolution {
			if (!params.fileExistsOnDisk) {
				return {
					filePath: params.filePath,
					status: "deleted",
					oldContent: null,
					newContent: null,
					contentUnavailable: true,
					reason: "File does not exist on disk",
				}
			}

			if (!params.gitTracked || params.isGitIgnored) {
				return {
					filePath: params.filePath,
					status: "added",
					oldContent: "",
					newContent: params.diskContent ?? "",
					contentUnavailable: false,
				}
			}

			return {
				filePath: params.filePath,
				status: "modified",
				oldContent: "old",
				newContent: params.diskContent ?? "",
			}
		}

		const result = resolveDiffForFile({
			filePath: "graphify-out/cache/last_query_stamp",
			gitTracked: false,
			isGitIgnored: true,
			fileExistsOnDisk: true,
			diskContent: "1727546400000\n",
		})

		expect(result.status).toBe("added")
		expect(result.oldContent).toBe("")
		expect(result.newContent).toBe("1727546400000\n")
		expect(result.contentUnavailable).toBe(false)
	})
})
