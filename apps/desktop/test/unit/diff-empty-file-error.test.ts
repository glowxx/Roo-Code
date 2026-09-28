import { describe, it, expect, vi } from "vitest"
import * as fs from "fs"

describe("Diff Error vs Actual Empty File Handling (TDD)", () => {
	it("distinguishes truly empty 0-byte file from unreadable/missing file", () => {
		// Truly empty file: exists on disk with 0 bytes
		const emptyFileStat = { size: 0, isFile: () => true } as fs.Stats
		expect(emptyFileStat.size).toBe(0)

		// A helper to determine diff availability state
		function resolveDiffContentState(params: {
			fileExists: boolean
			fileSize?: number
			oldContent?: string | null
			newContent?: string | null
			readError?: string | null
		}) {
			if (params.readError) {
				return { state: "CONTENT_UNAVAILABLE", reason: params.readError }
			}
			if (!params.fileExists && params.oldContent === null) {
				return { state: "CONTENT_UNAVAILABLE", reason: "File not found" }
			}
			if (params.fileExists && params.fileSize === 0) {
				return { state: "ACTUALLY_EMPTY", reason: "Empty file (0 bytes)" }
			}
			if (params.newContent !== null || params.oldContent !== null) {
				return { state: "CONTENT_AVAILABLE", reason: null }
			}
			return { state: "CONTENT_UNAVAILABLE", reason: "Content unavailable" }
		}

		// When file read fails (e.g. permission or unreadable):
		const unreadable = resolveDiffContentState({
			fileExists: false,
			readError: "Failed to read file",
		})
		expect(unreadable.state).toBe("CONTENT_UNAVAILABLE")
		expect(unreadable.state).not.toBe("ACTUALLY_EMPTY")

		// When file is genuinely 0 bytes:
		const zeroByte = resolveDiffContentState({
			fileExists: true,
			fileSize: 0,
			newContent: "",
		})
		expect(zeroByte.state).toBe("ACTUALLY_EMPTY")
	})
})
