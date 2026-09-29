import { describe, it, expect } from "vitest"
import { analyzeCommandOutput, stripAnsi } from "../command-output-analyzer"

describe("command-output-analyzer", () => {
	it("handles empty or blank output", () => {
		const result = analyzeCommandOutput("")
		expect(result.totalLines).toBe(0)
		expect(result.isLong).toBe(false)
		expect(result.summaryBadge).toBe("")
	})

	it("correctly identifies short output <= 12 lines", () => {
		const output = "Line 1\nLine 2\nLine 3"
		const result = analyzeCommandOutput(output)
		expect(result.totalLines).toBe(3)
		expect(result.isLong).toBe(false)
		expect(result.summaryBadge).toBe("Command completed (3 lines)")
		expect(result.previewContent).toBe(output)
	})

	it("detects WORKFLOW SUMMARY with PASS and duration_ms", () => {
		const lines = Array.from({ length: 82 }, (_, i) => `✓ script ${i + 1} passed`)
		lines.push("WORKFLOW SUMMARY: 82 PASS, 0 FAIL")
		lines.push("duration_ms: 16042")
		const output = lines.join("\n")

		const result = analyzeCommandOutput(output)
		expect(result.totalLines).toBe(84)
		expect(result.isLong).toBe(true)
		expect(result.isFailed).toBe(false)
		expect(result.summaryBadge).toContain("Tests passed (82 checks · 16.0s)")
		expect(result.previewContent).toContain("lines hidden · click to expand")
		expect(result.hiddenCount).toBe(78)
	})

	it("detects Vitest test results and failure", () => {
		const lines = [
			"Running tests in src/index.ts",
			"FAIL src/index.test.ts",
			"  ✕ test math",
			"Tests: 1 failed, 15 passed, 16 total",
			"Time: 2.34s",
		]
		const output = lines.join("\n")

		const result = analyzeCommandOutput(output, 1)
		expect(result.isFailed).toBe(true)
		expect(result.summaryBadge).toContain("Tests failed (1 failed, 15 passed)")
		expect(result.errorLines.length).toBeGreaterThan(0)
	})

	it("extracts error lines when command fails with long output", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `log info ${i}`)
		lines[5] = "ERR! fatal error: compilation failed"
		lines[6] = "Error: Cannot find module 'foo'"
		const output = lines.join("\n")

		const result = analyzeCommandOutput(output, 1)
		expect(result.isLong).toBe(true)
		expect(result.isFailed).toBe(true)
		expect(result.previewContent).toContain("--- [Failures Detected] ---")
		expect(result.previewContent).toContain("ERR! fatal error: compilation failed")
	})

	it("strips ANSI escape codes properly", () => {
		const colored = "\u001b[32m✓\u001b[0m \u001b[1mtest passed\u001b[0m"
		expect(stripAnsi(colored)).toBe("✓ test passed")
	})
})
