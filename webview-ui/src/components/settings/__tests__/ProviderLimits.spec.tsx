import { fireEvent, render, screen } from "@/utils/test-utils"
import { act } from "@testing-library/react"
import { ProviderLimits } from "../ProviderLimits"

const { postMessageMock } = vi.hoisted(() => ({ postMessageMock: vi.fn() }))
vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: postMessageMock } }))
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key.split(".").at(-1) }),
}))

describe("ProviderLimits", () => {
	const receive = (providerLimits: unknown, requestId = postMessageMock.mock.lastCall?.[0]?.requestId) =>
		act(() => {
			window.dispatchEvent(new MessageEvent("message", { data: { type: "providerLimits", providerLimits, requestId } }))
		})
	beforeEach(() => postMessageMock.mockClear())

	it("loads once and requests a bounded manual refresh", () => {
		render(<ProviderLimits />)
		expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "requestProviderLimits", bool: false, requestId: expect.any(String) }))
		receive({ provider: "xkiro", status: "partial" })
		fireEvent.click(screen.getByRole("button", { name: "refresh" }))
		expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: "requestProviderLimits", bool: true, requestId: expect.any(String) }))
		receive({ provider: "stale", status: "unsupported" }, postMessageMock.mock.calls[0][0].requestId)
		expect(screen.queryByText("stale")).not.toBeInTheDocument()
	})

	it("shows only returned values and no invented request quota", () => {
		render(<ProviderLimits />)
		receive({
			provider: "xkiro",
			status: "partial",
			windows: [{ kind: "daily", remainingUsd: "3.75" }],
		})
		expect(screen.getByText(/3.75/)).toBeInTheDocument()
		expect(screen.queryByText(/820/)).not.toBeInTheDocument()
		expect(screen.getByText("rateLimitUnavailable")).toBeInTheDocument()
	})

	it("shows unsupported and fetch error states", () => {
		render(<ProviderLimits />)
		receive({ provider: "other", status: "unsupported" })
		expect(screen.getByText("unsupported")).toBeInTheDocument()
		receive({ provider: "xkiro", status: "error" })
		expect(screen.getByRole("alert")).toHaveTextContent("error")
	})
})
