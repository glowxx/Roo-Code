import { z } from "zod"

export type JsonParseErrorCategory =
	| "EMPTY_RESPONSE"
	| "TRUNCATED_JSON"
	| "MARKDOWN_WRAPPED_JSON"
	| "PROSE_PLUS_JSON"
	| "VALID_JSON"
	| "SAFE_EXTRACTED_JSON"
	| "INVALID_JSON_SYNTAX"
	| "WRONG_SCHEMA"
	| "WRONG_ENUM"
	| "MISSING_FIELD"
	| "MULTIPLE_OBJECTS"
	| "REASONING_CONTAMINATION"
	| "PROVIDER_FORMAT_VARIANCE"
	| "PARSER_BUG"
	| "OTHER"

export interface SafeJsonExtractResult<T> {
	success: boolean
	data?: T
	error?: Error
	category: JsonParseErrorCategory
	recoveryApplied: boolean
	hadReasoningContamination?: boolean
	diagnostics?: string
}

/**
 * Scans text character by character to find all balanced JSON object candidates `{ ... }`.
 * Handles strings, escaped quotes (`\"`), and nested braces correctly.
 */
export function findBalancedJsonObjects(text: string): string[] {
	const candidates: string[] = []
	let depth = 0
	let inString = false
	let isEscaped = false
	let startIndex = -1

	for (let i = 0; i < text.length; i++) {
		const char = text[i]

		if (isEscaped) {
			isEscaped = false
			continue
		}

		if (inString) {
			if (char === "\\") {
				isEscaped = true
			} else if (char === '"') {
				inString = false
			}
			continue
		}

		if (char === '"') {
			inString = true
			continue
		}

		if (char === "{") {
			if (depth === 0) {
				startIndex = i
			}
			depth++
		} else if (char === "}") {
			if (depth > 0) {
				depth--
				if (depth === 0 && startIndex !== -1) {
					candidates.push(text.substring(startIndex, i + 1))
					startIndex = -1
				}
			}
		}
	}

	return candidates
}

/**
 * Strips reasoning / thought tags (<think>, <thought>, <reasoning>) from text.
 * Also detects unclosed thinking blocks indicative of truncation during reasoning.
 */
export function stripReasoningBlocks(text: string): {
	cleaned: string
	hadReasoning: boolean
	unclosedReasoning: boolean
} {
	const thinkingTagPatterns = [
		/<think>([\s\S]*?)<\/think>/gi,
		/<thought>([\s\S]*?)<\/thought>/gi,
		/<reasoning>([\s\S]*?)<\/reasoning>/gi,
	]

	let hadReasoning = false
	let cleaned = text

	for (const pattern of thinkingTagPatterns) {
		if (pattern.test(cleaned)) {
			hadReasoning = true
			cleaned = cleaned.replace(pattern, "")
		}
	}

	// Check if there is an unclosed opening tag
	const unclosedPattern = /<(?:think|thought|reasoning)>[\s\S]*$/i
	const unclosedReasoning = unclosedPattern.test(cleaned)
	if (unclosedReasoning) {
		hadReasoning = true
		cleaned = cleaned.replace(unclosedPattern, "")
	}

	return {
		cleaned: cleaned.trim(),
		hadReasoning,
		unclosedReasoning,
	}
}

/**
 * Cleans BOM and invisible control characters.
 */
export function sanitizeRawResponse(text: string): string {
	if (!text) return ""
	return text
		.replace(/^\uFEFF/, "") // UTF-8 BOM
		.replace(/[\u200B-\u200D\uFEFF]/g, "") // Zero-width spaces
		.trim()
}

/**
 * Robust, resilient JSON extractor that recovers structured responses
 * from LLMs without altering semantics or hallucinating fields.
 */
export function safeExtractJson<T>(raw: string, schema: z.ZodSchema<T>): SafeJsonExtractResult<T> {
	if (!raw || typeof raw !== "string") {
		return {
			success: false,
			category: "EMPTY_RESPONSE",
			recoveryApplied: false,
			error: new Error("Empty response string provided to SafeJsonExtractor"),
		}
	}

	const sanitized = sanitizeRawResponse(raw)
	if (sanitized.length === 0) {
		return {
			success: false,
			category: "EMPTY_RESPONSE",
			recoveryApplied: false,
			error: new Error("Empty response after sanitization"),
		}
	}

	// 1. Check for reasoning cutoff before attempting parse
	const { cleaned: reasoningStripped, hadReasoning, unclosedReasoning } = stripReasoningBlocks(sanitized)
	if (unclosedReasoning && reasoningStripped.length === 0) {
		return {
			success: false,
			category: "REASONING_CONTAMINATION",
			recoveryApplied: true,
			hadReasoningContamination: true,
			error: new Error("Response truncated during reasoning phase (<think> block unclosed without JSON payload)"),
		}
	}

	// 2. Direct JSON parse (clean path)
	try {
		const parsed = JSON.parse(sanitized)
		const validation = schema.safeParse(parsed)
		if (validation.success) {
			return {
				success: true,
				data: validation.data,
				category: "VALID_JSON",
				recoveryApplied: false,
			}
		}
		// Direct parse succeeded as JSON, but failed schema validation
		return classifySchemaFailure(validation.error, parsed)
	} catch {
		// Fall through to recovery paths
	}

	// 3. Markdown code block extraction (```json ... ```)
	const markdownRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi
	let mdMatch: RegExpExecArray | null
	const mdCandidates: string[] = []
	while ((mdMatch = markdownRegex.exec(sanitized)) !== null) {
		if (mdMatch[1] && mdMatch[1].trim().length > 0) {
			mdCandidates.push(mdMatch[1].trim())
		}
	}

	for (const candidate of mdCandidates) {
		try {
			const parsed = JSON.parse(candidate)
			const validation = schema.safeParse(parsed)
			if (validation.success) {
				return {
					success: true,
					data: validation.data,
					category: "MARKDOWN_WRAPPED_JSON",
					recoveryApplied: true,
					hadReasoningContamination: hadReasoning,
				}
			}
		} catch {
			// Try other candidates
		}
	}

	// 4. Try parsing reasoning-stripped text directly
	if (hadReasoning && reasoningStripped.length > 0) {
		try {
			const parsed = JSON.parse(reasoningStripped)
			const validation = schema.safeParse(parsed)
			if (validation.success) {
				return {
					success: true,
					data: validation.data,
					category: "PROSE_PLUS_JSON",
					recoveryApplied: true,
					hadReasoningContamination: true,
				}
			}
		} catch {
			// Continue to balanced object scanner
		}
	}

	// 5. Balanced braces scan on reasoning-stripped (or sanitized) text
	const textToScan = hadReasoning ? reasoningStripped : sanitized
	const objectCandidates = findBalancedJsonObjects(textToScan)

	const validParsedCandidates: { parsed: any; raw: string }[] = []
	for (const cand of objectCandidates) {
		try {
			const p = JSON.parse(cand)
			if (typeof p === "object" && p !== null && !Array.isArray(p)) {
				validParsedCandidates.push({ parsed: p, raw: cand })
			}
		} catch {
			// Ignore invalid syntax candidates
		}
	}

	// Check which candidates pass schema
	const schemaPassingCandidates: { data: T; raw: string }[] = []
	let lastSchemaError: z.ZodError | null = null

	for (const cand of validParsedCandidates) {
		const validation = schema.safeParse(cand.parsed)
		if (validation.success) {
			schemaPassingCandidates.push({ data: validation.data, raw: cand.raw })
		} else {
			lastSchemaError = validation.error
		}
	}

	if (schemaPassingCandidates.length === 1) {
		const isProse = textToScan.trim().length > schemaPassingCandidates[0].raw.length
		return {
			success: true,
			data: schemaPassingCandidates[0].data,
			category: isProse ? "PROSE_PLUS_JSON" : "SAFE_EXTRACTED_JSON",
			recoveryApplied: true,
			hadReasoningContamination: hadReasoning,
		}
	}

	if (schemaPassingCandidates.length > 1) {
		return {
			success: false,
			category: "MULTIPLE_OBJECTS",
			recoveryApplied: true,
			hadReasoningContamination: hadReasoning,
			error: new Error(`Found multiple distinct JSON objects (${schemaPassingCandidates.length}) matching schema`),
		}
	}

	// If we found valid JSON objects but none passed the schema
	if (validParsedCandidates.length > 0 && lastSchemaError) {
		return classifySchemaFailure(lastSchemaError, validParsedCandidates[0].parsed)
	}

	// If no valid JSON objects were found, check if it was truncated
	if (looksLikeTruncatedJson(textToScan)) {
		return {
			success: false,
			category: "TRUNCATED_JSON",
			recoveryApplied: true,
			hadReasoningContamination: hadReasoning,
			error: new Error("Response appears to be truncated JSON (open braces without closing delimiter)"),
		}
	}

	if (unclosedReasoning) {
		return {
			success: false,
			category: "REASONING_CONTAMINATION",
			recoveryApplied: true,
			hadReasoningContamination: true,
			error: new Error("Response was cut off inside reasoning tags without completing JSON"),
		}
	}

	return {
		success: false,
		category: "INVALID_JSON_SYNTAX",
		recoveryApplied: true,
		hadReasoningContamination: hadReasoning,
		error: new Error("Could not extract a valid JSON object from response"),
	}
}

function classifySchemaFailure(error: z.ZodError, parsed: any): SafeJsonExtractResult<any> {
	const issues = error.issues
	let category: JsonParseErrorCategory = "WRONG_SCHEMA"

	for (const issue of issues) {
		if (issue.code === "invalid_enum_value") {
			category = "WRONG_ENUM"
			break
		}
		if (issue.code === "invalid_type" && (issue as any).received === "undefined") {
			category = "MISSING_FIELD"
			break
		}
	}

	return {
		success: false,
		category,
		recoveryApplied: true,
		error: new Error(`JSON schema validation failed: ${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`),
		diagnostics: JSON.stringify({ issues, parsedSample: parsed }),
	}
}

function looksLikeTruncatedJson(text: string): boolean {
	const trimmed = text.trim()
	const openBraces = (trimmed.match(/\{/g) || []).length
	const closeBraces = (trimmed.match(/\}/g) || []).length
	if (openBraces > closeBraces) return true

	// Check if ends with hanging key or comma
	if (/["'{\[,:]\s*$/.test(trimmed)) return true

	return false
}
