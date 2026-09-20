import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { CrashBoundary } from "../components/CrashBoundary"

const CrashingComponent = ({ shouldCrash = false, message = "Crash in root component" }: { shouldCrash?: boolean; message?: string }) => {
	if (shouldCrash) {
		throw new Error(message)
	}
	return <div data-testid="healthy-root">Healthy Application Root</div>
}

describe("CrashBoundary", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("renders child components without crashing when there is no error", () => {
		render(
			<CrashBoundary>
				<CrashingComponent shouldCrash={false} />
			</CrashBoundary>,
		)

		expect(screen.getByTestId("healthy-root")).toBeInTheDocument()
		expect(screen.getByText("Healthy Application Root")).toBeInTheDocument()
	})

	it("catches errors and displays fallback UI instead of crashing to blank screen", () => {
		render(
			<CrashBoundary>
				<CrashingComponent shouldCrash={true} message="Failed to parse initialState" />
			</CrashBoundary>,
		)

		expect(screen.getByText("Wystąpił błąd podczas inicjalizacji widoku")).toBeInTheDocument()
		expect(screen.getByText("Failed to parse initialState")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Przeładuj widok/i })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Wyczyść stan i odśwież/i })).toBeInTheDocument()
	})

	it("toggles technical details when button is clicked", () => {
		render(
			<CrashBoundary>
				<CrashingComponent shouldCrash={true} message="Hydration failed" />
			</CrashBoundary>,
		)

		const toggleBtn = screen.getByRole("button", { name: /Pokaż szczegóły techniczne/i })
		expect(toggleBtn).toBeInTheDocument()

		// Click to expand
		fireEvent.click(toggleBtn)
		expect(screen.getByText(/Ukryj szczegóły techniczne/i)).toBeInTheDocument()

		// Click to collapse
		fireEvent.click(screen.getByRole("button", { name: /Ukryj szczegóły techniczne/i }))
		expect(screen.getByText(/Pokaż szczegóły techniczne/i)).toBeInTheDocument()
	})
})
