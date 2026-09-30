import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@roo-code/types"
import { buildTaskContract } from "../TaskContract"

const reply = (text: string, ask: ClineMessage["ask"] = "followup"): ClineMessage[] => [
	{ ts: 1, type: "ask", ask, text: "Which option?" },
	{ ts: 2, type: "say", say: "user_feedback", text },
]

describe("buildTaskContract", () => {
	it.each(["B", "opcja 2", "tak", "kontynuuj", "ok", "zrób to"])("keeps the original task after %s", (answer) => {
		const originalGoal = "Fix A, B, and C, edit the necessary files, and run tests."
		const contract = buildTaskContract(originalGoal, reply(answer))
		expect(contract.originalGoal).toBe(originalGoal)
		expect(contract.currentGoal).toBe(originalGoal)
		expect(contract.decisions).toHaveLength(1)
		expect(contract.decisions[0].answer).toBe(answer)
	})

	it("preserves the original requirements after a decision", () => {
		const contract = buildTaskContract("Fix A, B, and C:\n- Fix A\n- Fix B\n- Fix C\n- Run tests", reply("2"))
		expect(contract.completionCriteria).toEqual(["Fix A", "Fix B", "Fix C", "Run tests"])
	})

	it("keeps read-only scope after an acknowledgement", () => {
		const contract = buildTaskContract("Only analyze; do not modify files.", reply("ok"))
		expect(contract.currentGoal).toContain("do not modify files")
	})

	it("records an explicit task amendment without losing the original", () => {
		const contract = buildTaskContract("Only analyze the bug.", reply("Now you may fix it."))
		expect(contract.originalGoal).toBe("Only analyze the bug.")
		expect(contract.currentGoal).toContain("Now you may fix it.")
		expect(contract.amendments).toEqual(["Now you may fix it."])
	})

	it("treats a scoped prohibition as an amendment even when answering an ask", () => {
		const contract = buildTaskContract(
			"Fix frontend and backend.",
			reply("Do not touch backend; continue frontend."),
		)
		expect(contract.currentGoal).toContain("Fix frontend and backend.")
		expect(contract.amendments).toEqual(["Do not touch backend; continue frontend."])
	})

	it("recognizes Polish amendments ending in accented letters", () => {
		const contract = buildTaskContract("Napraw błąd.", reply("Zmień też nazwy projektów."))
		expect(contract.amendments).toEqual(["Zmień też nazwy projektów."])
	})

	it("carries the canonical authorization projection alongside intent", () => {
		const authorization = {
			explicitConstraints: ["DO NOT modify files in backend"],
			scopedWriteAllows: [],
			supplementalWriteAllows: ["packages/shared"],
			scopedWriteDenies: ["backend"],
			canonicalConstraints: [],
		}
		const contract = buildTaskContract("Fix frontend and backend", reply("B"), authorization)
		expect(contract.authorization).toBe(authorization)
		expect(contract.currentGoal).toBe("Fix frontend and backend")
	})
})
