import { describe, expect, it } from "vitest"
import { getConversationRowLayout } from "../conversation-layout"
import { conversationRegressionFixture } from "../__fixtures__/conversation-regression"

describe("conversation layout fixture", () => {
	it("keeps every Roo activity on the left and each user message on the right", () => {
		for (const row of conversationRegressionFixture) {
			expect(getConversationRowLayout(row as any)).toEqual({ lane: row.lane, spacing: row.spacing })
		}
		expect(getConversationRowLayout({ type: "say", say: "user_feedback", text: "x".repeat(10000) } as any).lane).toBe("user")
	})
})
