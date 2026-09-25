import { describe, it, expect } from "vitest"
import { safeExtractJson, findBalancedJsonObjects } from "../SafeJsonExtractor"
import { completionJudgeResponseSchema } from "@roo-code/types"

describe("SafeJsonExtractor", () => {
	it("1. extracts clean valid JSON", () => {
		const raw = JSON.stringify({
			decision: "ALLOW_COMPLETION",
			reason: "Task is fully complete.",
			unresolvedItems: [],
			missingCriteria: [],
		})

		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(true)
		expect(result.data?.decision).toBe("ALLOW_COMPLETION")
		expect(result.recoveryApplied).toBe(false)
		expect(result.category).toBe("VALID_JSON")
	})

	it("2. extracts markdown-wrapped JSON (```json ... ```)", () => {
		const raw = `\`\`\`json
{
  "decision": "ALLOW_COMPLETION",
  "reason": "Verified all criteria.",
  "unresolvedItems": [],
  "missingCriteria": []
}
\`\`\``

		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(true)
		expect(result.data?.decision).toBe("ALLOW_COMPLETION")
		expect(result.recoveryApplied).toBe(true)
		expect(result.category).toBe("MARKDOWN_WRAPPED_JSON")
	})

	it("3. extracts JSON with prose before and after", () => {
		const raw = `Based on my review of the changes, here is the decision:
{
  "decision": "ALLOW_COMPLETION",
  "reason": "All 14 review points confirmed clean.",
  "unresolvedItems": [],
  "missingCriteria": []
}
Thank you!`

		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(true)
		expect(result.data?.decision).toBe("ALLOW_COMPLETION")
		expect(result.data?.reason).toContain("14 review points")
		expect(result.recoveryApplied).toBe(true)
		expect(result.category).toBe("PROSE_PLUS_JSON")
	})

	it("4. strips <think> reasoning block containing curly braces", () => {
		const raw = `<think>
Evaluating task { "fake": 123 } and checking requirements.
All criteria pass.
</think>
{
  "decision": "ALLOW_COMPLETION",
  "reason": "Evaluation passed.",
  "unresolvedItems": [],
  "missingCriteria": []
}`

		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(true)
		expect(result.data?.decision).toBe("ALLOW_COMPLETION")
		expect(result.recoveryApplied).toBe(true)
		expect(result.hadReasoningContamination).toBe(true)
	})

	it("5. strips BOM and zero-width spaces", () => {
		const raw = `\uFEFF\u200B{
  "decision": "CONTINUE_WORK",
  "reason": "One test failing.",
  "unresolvedItems": [{ "type": "failed_test", "content": "test_1" }],
  "missingCriteria": []
}\u200C`

		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(true)
		expect(result.data?.decision).toBe("CONTINUE_WORK")
		expect(result.data?.unresolvedItems?.length).toBe(1)
	})

	it("6. identifies EMPTY_RESPONSE on whitespace-only input", () => {
		const raw = "   \n\t  "
		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(false)
		expect(result.category).toBe("EMPTY_RESPONSE")
	})

	it("7. identifies TRUNCATED_JSON on incomplete JSON input", () => {
		const raw = `{"decision": "ALLOW_COMPLETION", "reason": "Task finished but outpu`
		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(false)
		expect(result.category).toBe("TRUNCATED_JSON")
	})

	it("8. identifies REASONING_CONTAMINATION / TRUNCATED when model is cut off inside <think>", () => {
		const raw = `<think>
I am reasoning about the security review but then ran out of token`
		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(false)
		expect(result.category).toBe("REASONING_CONTAMINATION")
	})

	it("9. identifies WRONG_SCHEMA when JSON is valid but types do not match schema", () => {
		const raw = JSON.stringify({
			decision: 123,
			reason: 456,
		})
		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(false)
		expect(result.category).toBe("WRONG_SCHEMA")
	})

	it("10. identifies WRONG_ENUM when decision value is invalid", () => {
		const raw = JSON.stringify({
			decision: "INVALID_DECISION",
			reason: "Testing enum",
		})
		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(false)
		expect(result.category).toBe("WRONG_ENUM")
	})

	it("11. identifies MISSING_FIELD when required reason field is absent", () => {
		const raw = JSON.stringify({
			decision: "ALLOW_COMPLETION",
		})
		const result = safeExtractJson(raw, completionJudgeResponseSchema)
		expect(result.success).toBe(false)
		expect(result.category).toBe("MISSING_FIELD")
	})

	it("12. handles string containing escaped quotes and braces properly in balanced scanner", () => {
		const text = `Some text {"decision": "ALLOW_COMPLETION", "reason": "Has \\"quoted string with {brackets}\\" inside", "unresolvedItems": [], "missingCriteria": []} trailing text`
		const objects = findBalancedJsonObjects(text)
		expect(objects.length).toBe(1)
		const parsed = JSON.parse(objects[0])
		expect(parsed.reason).toBe(`Has "quoted string with {brackets}" inside`)
	})
})
