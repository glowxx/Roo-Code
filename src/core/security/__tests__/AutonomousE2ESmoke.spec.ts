import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "path"
import fs from "fs"
import { execSync } from "child_process"
import { ApprovalOrchestrator } from "../ApprovalOrchestrator"
import { DecisionLogStore } from "../DecisionLogStore"
import { ExecutionBoundaryAnalyzer } from "../ExecutionBoundaryAnalyzer"
import type { UnifiedApprovalRequest, ExtensionState } from "@roo-code/types"

describe("Autonomous Auto-Approve Full Real E2E Smoke Test", () => {
	const workspaceDir = path.resolve(__dirname, "../../../../tmp/autonomous-e2e-test")
	let orchestrator: ApprovalOrchestrator
	let state: Partial<ExtensionState>
	let manualApprovalCount: number

	const resetWorkspace = () => {
		try {
			execSync("git checkout -- .", { cwd: workspaceDir, stdio: "ignore" })
			execSync("git clean -fd", { cwd: workspaceDir, stdio: "ignore" })
		} catch {
			// ignore cleanup errors
		}
	}

	beforeEach(() => {
		resetWorkspace()
		orchestrator = new ApprovalOrchestrator()
		DecisionLogStore.getInstance().clear()
		manualApprovalCount = 0

		state = {
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
	})

	afterEach(() => {
		resetWorkspace()
	})

	it("executes full real E2E lifecycle with 0 manual clicks, controlled denial, replan, negative completion test, and final completion", async () => {
		const taskId = "task-autonomous-e2e-live"
		const mathJsPath = path.join(workspaceDir, "src", "math.js")
		const mathTestPath = path.join(workspaceDir, "test", "math.test.js")

		// Helper to simulate Task's ask approval gate
		const processAction = async (
			req: UnifiedApprovalRequest
		): Promise<{ approved: boolean; decision: string; payload?: string }> => {
			const result = await orchestrator.evaluate(req, state)

			if (result.decision === "MANUAL_APPROVAL") {
				manualApprovalCount++
				return { approved: false, decision: result.decision }
			}

			if (result.decision === "ALLOW_AUTO") {
				return { approved: true, decision: result.decision }
			}

			if (result.decision === "DENY_AND_REPLAN" || result.decision === "HARD_BLOCK") {
				return {
					approved: false,
					decision: result.decision,
					payload: JSON.stringify({
						status: "denied",
						rejection_reason: result.reason,
						replan_guidance: result.replanGuidance,
					}),
				}
			}

			if (result.decision === "CONTINUE_WORK") {
				return {
					approved: false,
					decision: result.decision,
					payload: JSON.stringify({
						status: "continue_work",
						decision: "CONTINUE_WORK",
						reason: result.reason,
						unresolvedItems: result.unresolvedItems || [],
					}),
				}
			}

			manualApprovalCount++
			return { approved: false, decision: "UNKNOWN" }
		}

		// -------------------------------------------------------------
		// ACTION 1: READ FILE
		// -------------------------------------------------------------
		const readReq: UnifiedApprovalRequest = {
			id: "act-1-read",
			taskId,
			actionType: "read_file",
			timestamp: Date.now(),
			target: {
				filePath: mathJsPath,
				isOutsideWorkspace: false,
			},
			taskContext: {
				latestUserInstruction: "Inspect math.js and add power function",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const readRes = await processAction(readReq)
		expect(readRes.approved).toBe(true)
		expect(readRes.decision).toBe("ALLOW_AUTO")
		const fileContent = fs.readFileSync(mathJsPath, "utf-8")
		expect(fileContent).toContain("export function add")

		// -------------------------------------------------------------
		// ACTION 2: EDIT FILE INSIDE WORKSPACE (Add power helper)
		// -------------------------------------------------------------
		const writeReq: UnifiedApprovalRequest = {
			id: "act-2-write",
			taskId,
			actionType: "replace_file_content",
			timestamp: Date.now(),
			target: {
				filePath: mathJsPath,
				isOutsideWorkspace: false,
				isProtected: false,
			},
			taskContext: {
				latestUserInstruction: "Add power function to math.js",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const writeRes = await processAction(writeReq)
		expect(writeRes.approved).toBe(true)
		expect(writeRes.decision).toBe("ALLOW_AUTO")
		// Real file edit
		const updatedMath = `${fileContent}\nexport function power(base, exp) {\n  return Math.pow(base, exp);\n}\n`
		fs.writeFileSync(mathJsPath, updatedMath, "utf-8")
		expect(fs.readFileSync(mathJsPath, "utf-8")).toContain("export function power")

		// Also update test file
		const testFileContent = fs.readFileSync(mathTestPath, "utf-8")
		const updatedTest = testFileContent.replace(
			'import { add, divide, multiply } from "../src/math.js";',
			'import { add, divide, multiply, power } from "../src/math.js";'
		) + `\ntest("power calculates exponentiation", () => {\n  assert.equal(power(2, 3), 8);\n});\n`
		fs.writeFileSync(mathTestPath, updatedTest, "utf-8")

		// -------------------------------------------------------------
		// ACTION 3: RUN TESTS (Safe local command)
		// -------------------------------------------------------------
		const testCmdReq: UnifiedApprovalRequest = {
			id: "act-3-test",
			taskId,
			actionType: "execute_command",
			timestamp: Date.now(),
			target: {
				command: "node --test test/math.test.js",
				cwd: workspaceDir,
			},
			taskContext: {
				latestUserInstruction: "Run unit tests",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const testCmdRes = await processAction(testCmdReq)
		expect(testCmdRes.approved).toBe(true)
		expect(testCmdRes.decision).toBe("ALLOW_AUTO")
		// Real execution of tests
		const testOutput = execSync("node --test test/math.test.js", { cwd: workspaceDir, encoding: "utf-8" })
		expect(testOutput).toContain("power calculates exponentiation")
		expect(testOutput).toContain("pass 5")

		// -------------------------------------------------------------
		// ACTION 4: GIT STATUS (Fast-path safe command)
		// -------------------------------------------------------------
		const gitReq: UnifiedApprovalRequest = {
			id: "act-4-git",
			taskId,
			actionType: "execute_command",
			timestamp: Date.now(),
			target: {
				command: "git status",
				cwd: workspaceDir,
			},
			taskContext: {
				latestUserInstruction: "Check git status",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const gitRes = await processAction(gitReq)
		expect(gitRes.approved).toBe(true)
		expect(gitRes.decision).toBe("ALLOW_AUTO")
		const gitOutput = execSync("git status --porcelain", { cwd: workspaceDir, encoding: "utf-8" })
		expect(gitOutput).toContain("M src/math.js")
		expect(gitOutput).toContain("M test/math.test.js")

		// -------------------------------------------------------------
		// ACTION 5: CONTROLLED DENIAL (Boundary Escape Attempt)
		// -------------------------------------------------------------
		const escapeCmd = 'wsl.exe -d GuildScout-Test -- bash -lc "powershell.exe -Command echo escape_check"'
		const boundary = ExecutionBoundaryAnalyzer.analyze(escapeCmd, {
			userInstruction: "Inspect environment",
			taskGoal: "E2E Autonomous Smoke Test",
			workspacePath: workspaceDir,
		})
		expect(boundary.hostImpact.isHostEscape).toBe(true)

		const denialReq: UnifiedApprovalRequest = {
			id: "act-5-denial",
			taskId,
			actionType: "execute_command",
			timestamp: Date.now(),
			target: {
				command: escapeCmd,
				cwd: workspaceDir,
			},
			taskContext: {
				latestUserInstruction: "Inspect environment",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const denialRes = await processAction(denialReq)
		expect(denialRes.approved).toBe(false)
		expect(denialRes.decision).toBe("DENY_AND_REPLAN")
		expect(denialRes.payload).toBeDefined()
		const parsedDenial = JSON.parse(denialRes.payload!)
		expect(parsedDenial.status).toBe("denied")
		expect(parsedDenial.rejection_reason).toContain("host")
		expect(parsedDenial.replan_guidance).toContain("guest environment filesystem")

		// -------------------------------------------------------------
		// ACTION 6: WORKER REPLANS AUTONOMOUSLY (Safe WSL Command)
		// -------------------------------------------------------------
		const safeWslCmd = 'wsl.exe -d GuildScout-Test -- bash -lc "uname -a"'
		const safeWslReq: UnifiedApprovalRequest = {
			id: "act-6-safe-wsl",
			taskId,
			actionType: "execute_command",
			timestamp: Date.now(),
			target: {
				command: safeWslCmd,
				cwd: workspaceDir,
			},
			taskContext: {
				latestUserInstruction: "Inspect Linux environment within safe guest bounds",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const safeWslRes = await processAction(safeWslReq)
		expect(safeWslRes.approved).toBe(true)
		expect(safeWslRes.decision).toBe("ALLOW_AUTO")
		// Real execution of WSL command live on host!
		const wslOutput = execSync(safeWslCmd, { encoding: "utf-8" })
		expect(wslOutput).toContain("Linux")

		// -------------------------------------------------------------
		// ACTION 7: NEGATIVE COMPLETION TEST (in_progress TODO present)
		// -------------------------------------------------------------
		const prematureCompletionReq: UnifiedApprovalRequest = {
			id: "act-7-premature-completion",
			taskId,
			actionType: "attempt_completion",
			timestamp: Date.now(),
			target: {
				completionResult: "I am ready to complete the task.",
				todoListSnapshot: [
					{ id: "1", content: "Add power function", status: "completed" },
					{ id: "2", content: "Run unit tests", status: "completed" },
					{ id: "3", content: "Verify git status", status: "in_progress" },
				],
				activeTerminalsCount: 0,
				unresolvedDenialState: null,
			},
			taskContext: {
				latestUserInstruction: "Complete only when all items are done",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const prematureRes = await processAction(prematureCompletionReq)
		expect(prematureRes.approved).toBe(false)
		expect(prematureRes.decision).toBe("CONTINUE_WORK")
		expect(prematureRes.payload).toBeDefined()
		const parsedContinueWork = JSON.parse(prematureRes.payload!)
		expect(parsedContinueWork.status).toBe("continue_work")
		expect(parsedContinueWork.reason).toContain("in_progress")
		expect(parsedContinueWork.unresolvedItems[0].content).toBe("Verify git status")

		// -------------------------------------------------------------
		// ACTION 8: FINAL ATTEMPT COMPLETION (All Work Resolved)
		// -------------------------------------------------------------
		const finalCompletionReq: UnifiedApprovalRequest = {
			id: "act-8-final-completion",
			taskId,
			actionType: "attempt_completion",
			timestamp: Date.now(),
			target: {
				completionResult: "All work completed and verified: power function added, 5 tests pass, WSL inspected, git status clean.",
				todoListSnapshot: [
					{ id: "1", content: "Add power function", status: "completed" },
					{ id: "2", content: "Run unit tests", status: "completed" },
					{ id: "3", content: "Verify git status", status: "completed" },
				],
				activeTerminalsCount: 0,
				unresolvedDenialState: null,
			},
			taskContext: {
				latestUserInstruction: "Complete only when all items are done",
				activeGoal: "E2E Autonomous Smoke Test",
				workspacePath: workspaceDir,
				isWithinWorkspace: true,
			},
		}
		const finalRes = await processAction(finalCompletionReq)
		expect(finalRes.approved).toBe(true)
		expect(finalRes.decision).toBe("ALLOW_AUTO")

		// -------------------------------------------------------------
		// VERIFY ZERO MANUAL APPROVAL CLICKS
		// -------------------------------------------------------------
		expect(manualApprovalCount).toBe(0)

		// -------------------------------------------------------------
		// VERIFY DECISION LOG AUDIT TRAIL
		// -------------------------------------------------------------
		const logEntries = DecisionLogStore.getInstance().getEntries(taskId)
		expect(logEntries.length).toBeGreaterThanOrEqual(7)

		const denialEntry = logEntries.find((e) => e.decision === "DENY_AND_REPLAN")
		expect(denialEntry).toBeDefined()
		expect(denialEntry!.replanGuidance).toContain("guest environment filesystem")

		const continueWorkEntry = logEntries.find((e) => e.decision === "CONTINUE_WORK")
		expect(continueWorkEntry).toBeDefined()
		expect(continueWorkEntry!.reason).toContain("in_progress")

		const finalCompletionEntry = logEntries.find((e) => e.id === "act-8-final-completion")
		expect(finalCompletionEntry).toBeDefined()
		expect(finalCompletionEntry!.decision).toBe("ALLOW_AUTO")
	})
})
