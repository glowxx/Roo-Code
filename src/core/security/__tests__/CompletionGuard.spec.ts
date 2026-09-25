import { describe, it, expect, vi, beforeEach } from "vitest"
import { ApprovalOrchestrator } from "../ApprovalOrchestrator"
import { DecisionLogStore } from "../DecisionLogStore"
import { CommandSafetyJudge } from "../CommandSafetyJudge"
import type { UnifiedApprovalRequest, ExtensionState } from "@roo-code/types"

describe("Autonomous Auto-Approve Completion Guard", () => {
	let orchestrator: ApprovalOrchestrator
	let mockState: Partial<ExtensionState>

	beforeEach(() => {
		mockState = {
			approvalMode: "auto",
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-3-7-sonnet",
			} as any,
			commandSafetyConfig: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o-mini",
				apiKey: "sk-mock-approval-key",
			},
		}
		orchestrator = new ApprovalOrchestrator()
		DecisionLogStore.getInstance().clear()
		CommandSafetyJudge.globalCallProviderOverride = undefined
	})

	const createCompletionRequest = (overrides: Partial<UnifiedApprovalRequest["target"]> = {}): UnifiedApprovalRequest => ({
		id: "req-comp-1",
		taskId: "task-completion-1",
		actionType: "attempt_completion",
		timestamp: Date.now(),
		target: {
			completionResult: "Work finished successfully.",
			todoListSnapshot: [],
			completionCriteria: [],
			activeTerminalsCount: 0,
			unresolvedDenialState: null,
			...overrides,
		},
		taskContext: {
			latestUserInstruction: "Complete all required tasks.",
			activeGoal: "Primary project objective",
			workspacePath: "/workspace/project",
			isWithinWorkspace: true,
		},
	})

	it("1. AUTO + no open work -> completion allowed (ALLOW_AUTO)", async () => {
		const request = createCompletionRequest({
			todoListSnapshot: [
				{ id: "1", content: "Implement feature", status: "completed" },
				{ id: "2", content: "Run unit tests", status: "completed" },
			],
			completionCriteria: [],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.taskAligned).toBe(true)
		expect(result.reason).toContain("All required work and todos resolved")

		const entries = DecisionLogStore.getInstance().getEntries()
		expect(entries.length).toBe(1)
		expect(entries[0].actionType).toBe("attempt_completion")
		expect(entries[0].decision).toBe("ALLOW_AUTO")
		expect(entries[0].fastPath).toBe(true)
	})

	it("2. AUTO + in_progress TODO -> completion denied (CONTINUE_WORK)", async () => {
		const request = createCompletionRequest({
			todoListSnapshot: [
				{ id: "1", content: "Setup project", status: "completed" },
				{ id: "2", content: "Run test suite", status: "in_progress" },
				{ id: "3", content: "Verify git status", status: "pending" },
			],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("CONTINUE_WORK")
		expect(result.reason).toContain("in_progress")
		expect(result.unresolvedItems).toBeDefined()
		expect(result.unresolvedItems!.some((i) => i.content === "Run test suite")).toBe(true)
		expect(result.unresolvedItems!.find((i) => i.type === "in_progress_todo")).toBeDefined()
	})

	it("3. AUTO + pending required TODO -> completion denied (CONTINUE_WORK)", async () => {
		const request = createCompletionRequest({
			todoListSnapshot: [
				{ id: "1", content: "Edit math helper", status: "completed" },
				{ id: "2", content: "Verify output formatting", status: "pending" },
			],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("CONTINUE_WORK")
		expect(result.reason).toContain("pending")
		expect(result.unresolvedItems!.some((i) => i.content === "Verify output formatting")).toBe(true)
	})

	it("4. Stale optional TODO -> does not permanently block completion when evaluated by Completion Judge", async () => {
		// Mock Completion Judge response for stale/optional item
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_COMPLETION",
				reason: "All primary deliverables completed; open optional caching todo is obsolete and does not block completion.",
				unresolvedItems: [],
				missingCriteria: [],
			})
		)

		const request = createCompletionRequest({
			completionCriteria: ["Implement calculator", "Pass unit tests"],
			todoListSnapshot: [
				{ id: "1", content: "Implement calculator", status: "completed" },
				{ id: "2", content: "Pass unit tests", status: "completed" },
			],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.reason).toContain("All primary deliverables completed")
		expect(CommandSafetyJudge.globalCallProviderOverride).toHaveBeenCalled()
	})

	it("5. Required report criterion missing -> completion denied (CONTINUE_WORK)", async () => {
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "CONTINUE_WORK",
				reason: "Required deliverable 'SUMMARY.md' report has not been created.",
				unresolvedItems: [
					{
						type: "missing_deliverable",
						content: "SUMMARY.md documentation report",
						guidance: "Create SUMMARY.md before completing the task.",
					},
				],
				missingCriteria: ["Generate SUMMARY.md report"],
			})
		)

		const request = createCompletionRequest({
			completionCriteria: ["Fix math.js bug", "Pass unit tests", "Generate SUMMARY.md report"],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("CONTINUE_WORK")
		expect(result.reason).toContain("SUMMARY.md")
		expect(result.missingCriteria).toContain("Generate SUMMARY.md report")
		expect(result.unresolvedItems![0].guidance).toContain("Create SUMMARY.md")
	})

	it("6. Criterion completed -> completion allowed (ALLOW_AUTO via Completion Judge)", async () => {
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			JSON.stringify({
				decision: "ALLOW_COMPLETION",
				reason: "All criteria including SUMMARY.md report verified and tests pass.",
				unresolvedItems: [],
				missingCriteria: [],
			})
		)

		const request = createCompletionRequest({
			completionResult: "Created SUMMARY.md and verified all tests pass cleanly.",
			completionCriteria: ["Fix math.js bug", "Pass unit tests", "Generate SUMMARY.md report"],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.taskAligned).toBe(true)
		expect(result.reason).toContain("All criteria including SUMMARY.md report verified")
	})

	it("7. DENY_AND_REPLAN unresolved -> completion denied (CONTINUE_WORK)", async () => {
		const request = createCompletionRequest({
			unresolvedDenialState: {
				actionType: "execute_command",
				reason: "Host filesystem escape (/mnt/c) is forbidden.",
				replanGuidance: "Execute commands within guest filesystem only.",
			},
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("CONTINUE_WORK")
		expect(result.reason).toContain("previous action was rejected by safety policy")
		expect(result.replanGuidance).toContain("Execute commands within guest filesystem only.")
		expect(result.unresolvedItems![0].type).toBe("unresolved_safety_denial")
	})

	it("8. Successful replan -> completion allowed later", async () => {
		// First verify that while unresolvedDenialState is active, completion is blocked
		const blockedRequest = createCompletionRequest({
			unresolvedDenialState: {
				actionType: "execute_command",
				reason: "Access to /mnt/c denied",
			},
		})
		const blockedResult = await orchestrator.evaluate(blockedRequest, mockState)
		expect(blockedResult.decision).toBe("CONTINUE_WORK")

		// Later, after replan succeeds (unresolvedDenialState cleared to null)
		const replannedRequest = createCompletionRequest({
			unresolvedDenialState: null,
			todoListSnapshot: [{ id: "1", content: "Alternative safe command executed", status: "completed" }],
		})
		const replannedResult = await orchestrator.evaluate(replannedRequest, mockState)
		expect(replannedResult.decision).toBe("ALLOW_AUTO")
	})

	it("9. In-flight background terminals or tests block completion", async () => {
		const request = createCompletionRequest({
			activeTerminalsCount: 2,
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("CONTINUE_WORK")
		expect(result.reason).toContain("background terminal process(es) or tests are still executing")
		expect(result.unresolvedItems![0].type).toBe("active_process")
	})

	it("10. Approval Model unavailable during ambiguous completion -> fail closed to MANUAL_APPROVAL", async () => {
		const unconfiguredState: Partial<ExtensionState> = {
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-3-7-sonnet",
			} as any,
			commandSafetyConfig: {
				enabled: false,
				provider: "openai",
				modelId: "gpt-4o-mini",
				apiKey: "",
			},
		}

		const request = createCompletionRequest({
			completionCriteria: ["Requires complex verification"],
		})

		const result = await orchestrator.evaluate(request, unconfiguredState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.reason).toContain("Approval Model is not configured or lacks API key")
	})

	it("11. Worker Model cannot be Completion Judge (AI Collusion / Separation Invariant)", async () => {
		const colludingState: Partial<ExtensionState> = {
			apiConfiguration: {
				apiProvider: "openai",
				apiModelId: "gpt-4o",
			} as any,
			commandSafetyConfig: {
				enabled: true,
				provider: "openai",
				modelId: "gpt-4o",
				apiKey: "sk-mock-key",
			},
		}

		const overrideSpy = vi.fn()
		CommandSafetyJudge.globalCallProviderOverride = overrideSpy

		const request = createCompletionRequest({
			completionCriteria: ["Verify self completion"],
		})

		const result = await orchestrator.evaluate(request, colludingState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.reason).toContain("AI Collusion Hazard")
		expect(overrideSpy).not.toHaveBeenCalled()
	})

	it("12. Previous Bug Regression: multiple TODOs with 1 in_progress and 2 pending", async () => {
		const request = createCompletionRequest({
			completionResult: "I am ready to complete the task.",
			todoListSnapshot: [
				{ id: "1", content: "Investigate architecture", status: "completed" },
				{ id: "2", content: "Run full test suite", status: "in_progress" },
				{ id: "3", content: "Generate report", status: "pending" },
				{ id: "4", content: "Commit changes", status: "pending" },
			],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("CONTINUE_WORK")
		expect(result.decision).not.toBe("ALLOW_AUTO")
		expect(result.reason).toContain("in_progress")
		expect(result.unresolvedItems!.some((i) => i.content === "Run full test suite")).toBe(true)
	})

	it("13. Safe extraction: Markdown-wrapped JSON response from Completion Judge allows completion", async () => {
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			"```json\n" +
			JSON.stringify({
				decision: "ALLOW_COMPLETION",
				reason: "All tasks verified inside markdown code block",
				unresolvedItems: [],
				missingCriteria: [],
			}) +
			"\n```"
		)

		const request = createCompletionRequest({
			completionResult: "Work complete.",
			completionCriteria: ["Implement feature"],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.taskAligned).toBe(true)
		expect(result.reason).toContain("All tasks verified inside markdown code block")
		expect(result.auditLog).toContain("workerReinvoked=false")
	})

	it("14. Safe extraction: Prose + JSON response from Completion Judge allows completion", async () => {
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			"Here is my final evaluation of the task completion:\n\n" +
			JSON.stringify({
				decision: "ALLOW_COMPLETION",
				reason: "Prose preceded JSON object safely parsed",
				unresolvedItems: [],
				missingCriteria: [],
			}) +
			"\n\nLet me know if anything else is needed."
		)

		const request = createCompletionRequest({
			completionResult: "Work complete.",
			completionCriteria: ["Implement feature"],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.taskAligned).toBe(true)
		expect(result.reason).toContain("Prose preceded JSON object safely parsed")
		expect(result.auditLog).toContain("workerReinvoked=false")
	})

	it("15. Safe extraction: <think> reasoning contamination from Completion Judge allows completion", async () => {
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockResolvedValue(
			"<think>\n" +
			"The user requested feature X. Worker provided full report and all criteria are met.\n" +
			"I will approve the completion.\n" +
			"</think>\n" +
			JSON.stringify({
				decision: "ALLOW_COMPLETION",
				reason: "Reasoning stripped cleanly and completion accepted",
				unresolvedItems: [],
				missingCriteria: [],
			})
		)

		const request = createCompletionRequest({
			completionResult: "Work complete.",
			completionCriteria: ["Implement feature"],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.taskAligned).toBe(true)
		expect(result.reason).toContain("Reasoning stripped cleanly and completion accepted")
		expect(result.auditLog).toContain("workerReinvoked=false")
	})

	it("16. Bounded retry: Truncated JSON on attempt 1 -> Attempt 2 succeeds with correction prompt", async () => {
		let callCount = 0
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockImplementation(async (params: any) => {
			callCount++
			if (callCount === 1) {
				// Attempt 1: Truncated JSON due to token limit
				return '{"decision": "ALLOW_COMPLETION", "reason": "Cut off mid-'
			}
			// Attempt 2: Valid complete JSON
			expect(params.userPrompt).toContain("[CRITICAL CORRECTION FOR PREVIOUS RESPONSE]")
			return JSON.stringify({
				decision: "ALLOW_COMPLETION",
				reason: "Attempt 2 succeeded after correction",
				unresolvedItems: [],
				missingCriteria: [],
			})
		})

		const request = createCompletionRequest({
			completionResult: "Work complete.",
			completionCriteria: ["Implement feature"],
		})

		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("ALLOW_AUTO")
		expect(result.approvalAttemptCount).toBe(2)
		expect(result.auditLog).toContain("retry=true attempt=2")
		expect(result.auditLog).toContain("workerReinvoked=false")
		expect(callCount).toBe(2)
	})

	it("17. Persistent malformed JSON after retries -> Fails closed to MANUAL_APPROVAL without throwing", async () => {
		let callCount = 0
		CommandSafetyJudge.globalCallProviderOverride = vi.fn().mockImplementation(async () => {
			callCount++
			return "I cannot provide JSON, here is plain text without any structure."
		})

		const request = createCompletionRequest({
			completionResult: "Work complete.",
			completionCriteria: ["Implement feature"],
		})

		// Must NOT throw! Must resolve to MANUAL_APPROVAL fail-closed!
		const result = await orchestrator.evaluate(request, mockState)
		expect(result.decision).toBe("MANUAL_APPROVAL")
		expect(result.risk).toBe("high")
		expect(result.infrastructureFailure).toBe(true)
		expect(result.reason).toContain("Completion Judge verification could not produce a valid decision")
		expect(result.auditLog).toContain("workerReinvoked=false")
		expect(result.auditLog).toContain("finalDecision=MANUAL_APPROVAL")
		expect(callCount).toBe(2) // 1 initial + 1 retry = exactly 2 calls
	})

	it("18. parseCompletionJudgeResponse helper validates various JSON envelopes and throws clear errors", () => {
		// Valid JSON
		const res1 = orchestrator.parseCompletionJudgeResponse(
			JSON.stringify({ decision: "ALLOW_COMPLETION", reason: "Ok", unresolvedItems: [], missingCriteria: [] })
		)
		expect(res1.decision).toBe("ALLOW_COMPLETION")

		// Markdown wrapped
		const res2 = orchestrator.parseCompletionJudgeResponse(
			"```json\n" + JSON.stringify({ decision: "CONTINUE_WORK", reason: "More work", unresolvedItems: [], missingCriteria: [] }) + "\n```"
		)
		expect(res2.decision).toBe("CONTINUE_WORK")

		// Empty throws Empty response
		expect(() => orchestrator.parseCompletionJudgeResponse("")).toThrow("Empty response from Completion Judge model")

		// Wrong schema throws validation failed
		expect(() => orchestrator.parseCompletionJudgeResponse(JSON.stringify({ decision: "INVALID_CHOICE" }))).toThrow("Completion response validation failed")
	})
})
