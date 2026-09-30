import { fireEvent, render, screen } from "@/utils/test-utils"
import { act } from "@testing-library/react"
import { ProviderLimits } from "../ProviderLimits"

const { postMessageMock } = vi.hoisted(() => ({ postMessageMock: vi.fn() }))
vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: postMessageMock } }))
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string, options?: Record<string, number | string>) => {
		const name = key.split(".").at(-1)!
		const templates: Record<string, string> = {
			windowHours: "{{value}}-hour usage", windowDays: "{{value}}-day usage",
			hoursMinutes: "{{hours}}h {{minutes}}m", daysHours: "{{days}}d {{hours}}h",
			resetsIn: "Resets in {{time}}", justNow: "Just now",
		}
		return (templates[name] || name).replace(/{{(\w+)}}/g, (_, field) => String(options?.[field] ?? ""))
	} }),
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

	it("formats spending, reset, free tokens and wallet without raw precision", () => {
		const currentTime = Date.now()
		render(<ProviderLimits />)
		receive({
			provider: "xkiro", status: "supported", plan: "pro-plus", fetchedAt: currentTime,
			windows: [
				{ kind: "short", windowSeconds: 18000, spentUsd: "0.190000", capUsd: "10.000000", remainingUsd: "9.810000", resetAt: currentTime + 3 * 3600000 + 41 * 60000 + 30000 },
				{ kind: "long", windowSeconds: 604800, spentUsd: "68.695355", capUsd: "70.000000", remainingUsd: "1.304645", resetAt: currentTime + 6 * 86400000 + 2 * 3600000 + 30000 },
			],
			freeTokens: { usedToday: 973635, limitPerDay: 16000000, remaining: 15026365 },
			wallet: { balanceUsd: "5.000000", heldUsd: "0.000000" },
		})
		expect(screen.getByText("5-hour usage")).toBeInTheDocument()
		expect(screen.getByText("7-day usage")).toBeInTheDocument()
		expect(screen.getByText("$9.81")).toBeInTheDocument()
		expect(screen.getByText("$1.30")).toBeInTheDocument()
		expect(screen.getByText("Resets in 3h 42m")).toBeInTheDocument()
		expect(screen.getByText("Resets in 6d 2h")).toBeInTheDocument()
		expect(screen.getAllByRole("progressbar")).toHaveLength(3)
		expect(screen.getByText("98.1%")).toBeInTheDocument()
		expect(screen.queryByText(/68\.695355|10\.000000|NaN|undefined/)).not.toBeInTheDocument()
	})

	it("keeps previous data visible during refresh and reports a failed refresh", () => {
		render(<ProviderLimits />)
		receive({ provider: "xkiro", status: "partial", windows: [{ kind: "short", remainingUsd: "3.75", capUsd: "0" }] })
		fireEvent.click(screen.getByRole("button", { name: "refresh" }))
		expect(screen.getByText("$3.75")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /refreshing/ })).toBeDisabled()
		receive({ provider: "xkiro", status: "error" })
		expect(screen.getByText("$3.75")).toBeInTheDocument()
		expect(screen.getByRole("alert")).toHaveTextContent("refreshError")
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
	})

	it("does not render an invalid percentage or stale reset countdown", () => {
		render(<ProviderLimits />)
		receive({
			provider: "xkiro", status: "partial",
			windows: [{ kind: "short", windowSeconds: 18_000, spentUsd: "1", capUsd: "0.00000000000000000001", resetAt: Date.now() - 60_000 }],
			freeTokens: { usedToday: 1e308, limitPerDay: 1e-308, remaining: 0 },
		})
		expect(screen.getByText("resetDue")).toBeInTheDocument()
		expect(screen.queryByText(/Infinity%|NaN%/)).not.toBeInTheDocument()
		expect(screen.getAllByRole("progressbar")).toHaveLength(1)
	})
})
