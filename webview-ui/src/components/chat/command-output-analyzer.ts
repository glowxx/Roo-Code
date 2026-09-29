export interface CommandOutputAnalysis {
	lines: string[]
	totalLines: number
	isLong: boolean
	isFailed: boolean
	summaryBadge: string
	detailText?: string
	errorLines: string[]
	previewContent: string
	hiddenCount: number
}

/**
 * Strips ANSI color and control characters from text for clean regex analysis
 */
export function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
}

/**
 * Analyzes command output to extract test summaries, execution durations,
 * error diagnostics, and generates compact preview folds for long outputs (>12 lines).
 */
export function analyzeCommandOutput(output: string, exitCode?: number): CommandOutputAnalysis {
	if (!output || !output.trim()) {
		return {
			lines: [],
			totalLines: 0,
			isLong: false,
			isFailed: false,
			summaryBadge: "",
			errorLines: [],
			previewContent: "",
			hiddenCount: 0,
		}
	}

	const rawLines = output.split(/\r?\n/)
	// If the last line is empty due to a trailing newline, exclude it from line counting
	const lines = rawLines.length > 1 && rawLines[rawLines.length - 1] === "" ? rawLines.slice(0, -1) : rawLines
	const totalLines = lines.length
	const cleanLines = lines.map(stripAnsi)
	const cleanFullText = cleanLines.join("\n")

	// Test framework detection first to understand test outcomes accurately
	// Pattern 1: WORKFLOW SUMMARY: 82 PASS, 0 FAIL
	const workflowSummaryMatch = cleanFullText.match(/WORKFLOW SUMMARY:\s*(\d+)\s*PASS,\s*(\d+)\s*FAIL/i)
	// Pattern 2: Vitest/Jest Tests: (X failed)? (Y passed)?
	const vitestMatch = cleanFullText.match(/Tests:?\s+(?:(\d+)\s+failed\s*,\s*)?(\d+)\s+passed/i)
	// Pattern 3: Cargo test result: ok. 10 passed; 0 failed
	const cargoMatch = cleanFullText.match(/test result:\s*(ok|FAILED)\.\s*(\d+)\s*passed;\s*(\d+)\s*failed/i)
	// Pattern 4: Generic failed/passed combinations
	const failedFirstMatch = cleanFullText.match(/(\d+)\s+failed\s*,\s*(\d+)\s+passed/i)
	const passedFirstMatch = cleanFullText.match(/(\d+)\s+passed\s*,\s*(\d+)\s+failed/i)
	const simplePassedMatch = cleanFullText.match(/(\d+)\s+passed/i)
	// Pattern 5: Playwright / Mocha: X passing
	const passingMatch = cleanFullText.match(/(\d+)\s+passing(?:,\s*(\d+)\s+failing)?/i)

	// Count checkmark lines (e.g. ✓ or ✔)
	const checkmarkCount = cleanLines.filter((l) => /^\s*[✓✔]/.test(l)).length

	// Duration detection
	let durationText: string | undefined
	const durationMsMatch = cleanFullText.match(/duration_ms\s*[:=]?\s*(\d+)/i)
	if (durationMsMatch) {
		durationText = `${(Number(durationMsMatch[1]) / 1000).toFixed(1)}s`
	} else {
		const timeMatch = cleanFullText.match(/(?:Time|in|Duration):\s*([\d\.]+\s*(?:s|ms|m))/i)
		if (timeMatch) {
			durationText = timeMatch[1].trim()
		}
	}

	// Determine failure status
	const hasExplicitFailExit = exitCode !== undefined && exitCode !== 0
	let isFailed = hasExplicitFailExit

	let summaryBadge = ""

	if (workflowSummaryMatch) {
		const pass = Number(workflowSummaryMatch[1])
		const fail = Number(workflowSummaryMatch[2])
		if (fail > 0 || hasExplicitFailExit) {
			isFailed = true
			summaryBadge = `Tests failed (${fail} failed, ${pass} passed)`
		} else {
			isFailed = false
			summaryBadge = `Tests passed (${pass} checks${durationText ? ` · ${durationText}` : ""})`
		}
	} else if (vitestMatch) {
		const fail = vitestMatch[1] ? Number(vitestMatch[1]) : 0
		const pass = Number(vitestMatch[2])
		if (fail > 0 || hasExplicitFailExit) {
			isFailed = true
			summaryBadge = `Tests failed (${fail} failed, ${pass} passed)`
		} else {
			isFailed = false
			summaryBadge = `Tests passed (${pass} passed${durationText ? ` · ${durationText}` : ""})`
		}
	} else if (failedFirstMatch) {
		const fail = Number(failedFirstMatch[1])
		const pass = Number(failedFirstMatch[2])
		if (fail > 0 || hasExplicitFailExit) {
			isFailed = true
			summaryBadge = `Tests failed (${fail} failed, ${pass} passed)`
		} else {
			isFailed = false
			summaryBadge = `Tests passed (${pass} passed${durationText ? ` · ${durationText}` : ""})`
		}
	} else if (passedFirstMatch) {
		const pass = Number(passedFirstMatch[1])
		const fail = Number(passedFirstMatch[2])
		if (fail > 0 || hasExplicitFailExit) {
			isFailed = true
			summaryBadge = `Tests failed (${fail} failed, ${pass} passed)`
		} else {
			isFailed = false
			summaryBadge = `Tests passed (${pass} passed${durationText ? ` · ${durationText}` : ""})`
		}
	} else if (cargoMatch) {
		const pass = Number(cargoMatch[2])
		const fail = Number(cargoMatch[3])
		if (fail > 0 || hasExplicitFailExit) {
			isFailed = true
			summaryBadge = `Tests failed (${fail} failed, ${pass} passed)`
		} else {
			isFailed = false
			summaryBadge = `Tests passed (${pass} passed${durationText ? ` · ${durationText}` : ""})`
		}
	} else if (passingMatch) {
		const pass = Number(passingMatch[1])
		const fail = passingMatch[2] ? Number(passingMatch[2]) : 0
		if (fail > 0 || hasExplicitFailExit) {
			isFailed = true
			summaryBadge = `Tests failed (${fail} failed, ${pass} passing)`
		} else {
			isFailed = false
			summaryBadge = `Tests passed (${pass} passing${durationText ? ` · ${durationText}` : ""})`
		}
	} else if (checkmarkCount >= 3 && !hasExplicitFailExit) {
		isFailed = false
		summaryBadge = `Checks passed (${checkmarkCount} checks${durationText ? ` · ${durationText}` : ""})`
	} else if (simplePassedMatch && !hasExplicitFailExit) {
		isFailed = false
		summaryBadge = `Tests passed (${simplePassedMatch[1]} passed${durationText ? ` · ${durationText}` : ""})`
	} else {
		// Non-test command
		const errorRegex = /(?:^|\s)(?:FAIL\b|FAILED\b|ERR!\b|npm ERR!|error\[E\d+\]|command failed with exit code)\b/i
		if (hasExplicitFailExit || errorRegex.test(cleanFullText)) {
			isFailed = true
			summaryBadge = `Command failed (exit code ${exitCode ?? 1})`
		} else {
			isFailed = false
			summaryBadge = `Command completed (${totalLines} lines${durationText ? ` · ${durationText}` : ""})`
		}
	}

	// Collect error lines if failed
	const errorLines: string[] = []
	if (isFailed) {
		const lineErrorRegex =
			/(?:^|\s)(?:FAIL\b|FAILED\b|ERR!\b|npm ERR!|error\[E\d+\]|Error:|Exception:|Traceback|✕|✖)/i
		for (let i = 0; i < lines.length && errorLines.length < 5; i++) {
			const clean = cleanLines[i]
			if (lineErrorRegex.test(clean)) {
				errorLines.push(lines[i])
			}
		}
	}

	const isLong = totalLines > 12

	// Build previewContent
	let previewLines: string[] = []
	let hiddenCount = 0

	if (!isLong) {
		previewLines = lines
	} else if (isFailed && errorLines.length > 0) {
		const top = lines.slice(0, 2)
		const bottom = lines.slice(-2)
		previewLines = [
			...top,
			`\n--- [Failures Detected] ---`,
			...errorLines,
			`--- [End of Failures] ---\n`,
			...bottom,
		]
		hiddenCount = Math.max(0, totalLines - (top.length + errorLines.length + bottom.length))
	} else {
		const top = lines.slice(0, 3)
		const bottom = lines.slice(-3)
		hiddenCount = totalLines - (top.length + bottom.length)
		previewLines = [...top, `... [${hiddenCount} lines hidden · click to expand] ...`, ...bottom]
	}

	return {
		lines,
		totalLines,
		isLong,
		isFailed,
		summaryBadge,
		errorLines,
		previewContent: previewLines.join("\n"),
		hiddenCount,
	}
}
