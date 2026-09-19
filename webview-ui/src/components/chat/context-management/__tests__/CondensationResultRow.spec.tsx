import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { describe, it, expect, vi } from "vitest"
import { CondensationResultRow } from "../CondensationResultRow"

// Mock Markdown component
vi.mock("../../Markdown", () => ({
	Markdown: ({ markdown }: { markdown?: string }) => <div data-testid="markdown-content">{markdown}</div>,
}))

describe("CondensationResultRow", () => {
	it("renders compacted summary card with token counts and percentage", () => {
		const prevTokens = 100000
		const newTokens = 30000

		render(
			<CondensationResultRow
				data={{
					prevContextTokens: prevTokens,
					newContextTokens: newTokens,
					summary: "Compacted history summary",
					cost: 0.05,
				}}
			/>,
		)

		expect(screen.getByText("Context compacted:")).toBeInTheDocument()
		expect(screen.getByText(/tokens \(-70%\)/)).toBeInTheDocument()
		expect(screen.getByText("View Summary ▾")).toBeInTheDocument()
		expect(screen.getByText("$0.05")).toBeInTheDocument()
		expect(screen.queryByTestId("markdown-content")).not.toBeInTheDocument()
	})

	it("toggles summary visibility on click", () => {
		render(
			<CondensationResultRow
				data={{
					prevContextTokens: 50000,
					newContextTokens: 25000,
					cost: 0,
					summary: "## Detailed Summary\n- Item 1\n- Item 2",
				}}
			/>,
		)

		const toggleButton = screen.getByText("View Summary ▾")
		expect(toggleButton).toBeInTheDocument()
		expect(screen.queryByTestId("markdown-content")).not.toBeInTheDocument()

		// Click to expand
		fireEvent.click(toggleButton)
		expect(screen.getByText("Hide Summary ▴")).toBeInTheDocument()
		expect(screen.getByTestId("markdown-content")).toBeInTheDocument()
		expect(screen.getByTestId("markdown-content")).toHaveTextContent("Detailed Summary")

		// Click to collapse
		fireEvent.click(screen.getByText("Hide Summary ▴"))
		expect(screen.getByText("View Summary ▾")).toBeInTheDocument()
		expect(screen.queryByTestId("markdown-content")).not.toBeInTheDocument()
	})

	it("handles 0 or missing tokens safely", () => {
		render(
			<CondensationResultRow
				data={{
					cost: 0,
					summary: "",
					prevContextTokens: undefined as unknown as number,
					newContextTokens: undefined as unknown as number,
				}}
			/>,
		)

		expect(screen.getByText("0 → 0 tokens (-0%)")).toBeInTheDocument()
	})
})
