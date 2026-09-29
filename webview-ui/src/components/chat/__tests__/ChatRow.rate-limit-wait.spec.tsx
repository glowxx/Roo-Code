import React from "react"

import { render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import ChatRow, { ChatRowContent } from "../ChatRow"

vi.mock("react-use", async (importOriginal) => ({
	...(await importOriginal<typeof import("react-use")>()),
	useSize: (element: React.ReactElement) => [element, { height: 0 }],
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:apiRequest.rateLimitWait": "Rate limiting",
				"chat:apiRequest.failed": "API Request Failed",
				"chat:apiRequest.errorTitle": "Provider Error",
				"chat:apiRequest.errorMessage.unknown": "Unknown API error. Please report this on GitHub.",
				"chat:apiRequest.errorMessage.docs": "Docs",
			}
			return map[key] ?? key
		},
		i18n: {
			exists: () => false,
		},
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const queryClient = new QueryClient()

function renderChatRow(message: any) {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatRow - rate limit wait", () => {
	it("places runtime events on the assistant lane and user feedback on the right lane", () => {
		const renderFullRow = (message: any) => render(
			<ExtensionStateContextProvider>
				<QueryClientProvider client={queryClient}>
					<ChatRow message={message} isExpanded={false} isLast={true} isStreaming={false} onHeightChange={() => {}} onToggleExpand={() => {}} />
				</QueryClientProvider>
			</ExtensionStateContextProvider>,
		)
		const assistant = renderFullRow({ type: "say", say: "api_req_started", ts: 1, text: "{}" })
		expect(assistant.container.querySelector(".conversation-lane-narrative")).toBeTruthy()
		expect(assistant.container.querySelector(".conversation-row--activity")).toBeTruthy()
		assistant.unmount()
		const user = renderFullRow({ type: "say", say: "user_feedback", ts: 2, text: "a long pasted message" })
		expect(user.container.querySelector(".conversation-lane-user")).toBeTruthy()
		expect(user.container.querySelector(".conversation-row--turn")).toBeTruthy()
		user.unmount()
	})
	it("renders a non-error progress row for api_req_rate_limit_wait", () => {
		const message: any = {
			type: "say",
			say: "api_req_rate_limit_wait",
			ts: Date.now(),
			partial: true,
			text: JSON.stringify({ seconds: 1 }),
		}

		renderChatRow(message)

		expect(screen.getByText("Rate limiting")).toBeInTheDocument()
		// Should show countdown, but should NOT show the error-details affordance.
		expect(screen.getByText("1s")).toBeInTheDocument()
		expect(screen.queryByText("Details")).toBeNull()
	})

	it("renders nothing when rate limit wait is complete", () => {
		const message: any = {
			type: "say",
			say: "api_req_rate_limit_wait",
			ts: Date.now(),
			partial: false,
			text: undefined,
		}

		const { container } = renderChatRow(message)

		// The row should be hidden when rate limiting is complete
		expect(screen.queryByText("Rate limiting")).toBeNull()
		// Nothing should be rendered
		expect(container.firstChild).toBeNull()
	})

	it("links unknown API errors to GitHub issues", () => {
		const message: any = {
			type: "say",
			say: "api_req_retry_delayed",
			ts: Date.now(),
			text: "599 Provider returned an unknown error",
		}

		renderChatRow(message)

		expect(screen.getByText("Unknown API error. Please report this on GitHub.")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /Docs/ })).toHaveAttribute(
			"href",
			"https://github.com/RooCodeInc/Roo-Code/issues/new?template=bug_report.yml",
		)
	})
})
