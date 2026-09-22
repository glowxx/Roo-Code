import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ClineMessage } from "@roo-code/types"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import ChatView from "../ChatView"

// Scroll harness to record all scrollToIndex calls
const scrollHarness = {
	scrollCalls: 0,
	scrollToIndexArgs: [] as any[],
	reset() {
		this.scrollCalls = 0
		this.scrollToIndexArgs = []
	},
}

vi.mock("react-virtuoso", () => {
	const MockVirtuoso = React.forwardRef(function MockVirtuoso(props: any, ref: any) {
		React.useImperativeHandle(ref, () => ({
			scrollToIndex: (options: any) => {
				scrollHarness.scrollCalls++
				scrollHarness.scrollToIndexArgs.push(options)
			},
			scrollTo: vi.fn(),
			scrollBy: vi.fn(),
		}))
		return (
			<div data-testid="virtuoso-container">
				{props.data.map((item: any, idx: number) => (
					<div key={item.ts} data-testid={`item-${idx}`}>
						{props.itemContent(idx, item)}
					</div>
				))}
			</div>
		)
	})
	return { Virtuoso: MockVirtuoso }
})

// Nullify heavy/unrelated components
function nullModule() {
	return { default: () => null }
}
vi.mock("../../history/HistoryPreview", nullModule)
vi.mock("@src/components/welcome/RooHero", nullModule)
vi.mock("@src/components/welcome/RooTips", nullModule)
vi.mock("../Announcement", nullModule)
vi.mock("./ProfileViolationWarning", nullModule)
vi.mock("./CheckpointWarning", () => ({ CheckpointWarning: () => null }))
vi.mock("./QueuedMessages", () => ({ QueuedMessages: () => null }))
vi.mock("./WorktreeSelector", () => ({ WorktreeSelector: () => null }))

describe("Virtual scroll stability during message editing", () => {
	beforeEach(() => {
		scrollHarness.reset()
	})

	const generateConversation = (promptSize: "small" | "medium" | "large"): ClineMessage[] => {
		const textContent = {
			small: "Short prompt (100 chars): " + "x".repeat(70),
			medium: "Medium prompt (2 KB): " + "y".repeat(2000),
			large: "Large prompt (30 KB): " + "z".repeat(30000),
		}[promptSize]

		return [
			{ type: "say", say: "text", ts: 1000, text: "Initial Task" },
			{ type: "say", say: "text", ts: 1001, text: "Assistant response 1" },
			{ type: "say", say: "user_feedback", ts: 1002, text: textContent },
			{ type: "say", say: "text", ts: 1003, text: "Assistant response 2" },
			{ type: "say", say: "text", ts: 1004, text: "Assistant response 3 (bottom)" },
		]
	}

	const setupChatWithMessages = async (messages: ClineMessage[]) => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})

		const view = render(
			<ExtensionStateContextProvider>
				<QueryClientProvider client={queryClient}>
					<ChatView isHidden={false} showAnnouncement={false} hideAnnouncement={() => {}} />
				</QueryClientProvider>
			</ExtensionStateContextProvider>,
		)

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "state",
						state: {
							clineMessages: messages,
							taskHistory: [],
							shouldShowAnnouncement: false,
						},
					},
				}),
			)
		})

		await waitFor(() => expect(screen.getByTestId("virtuoso-container")).toBeInTheDocument())
		return view
	}

	it.each(["small", "medium", "large"] as const)(
		"entering edit mode on a %s prompt does NOT call scrollToIndex('LAST')",
		async (size) => {
			const messages = generateConversation(size)
			await setupChatWithMessages(messages)

			// Reset any initial hydration scroll calls
			scrollHarness.reset()

			// Locate edit trigger for user_feedback message
			const editTrigger = screen.getByLabelText("Edit message icon")
			expect(editTrigger).toBeDefined()

			await act(async () => {
				fireEvent.click(editTrigger)
			})

			// Verify: No scrollToIndex("LAST") call occurred
			const lastScrollCalls = scrollHarness.scrollToIndexArgs.filter((arg) => arg.index === "LAST")
			expect(lastScrollCalls).toHaveLength(0)

			// Verify: Textarea is rendered
			const textareas = screen.getAllByRole("textbox")
			expect(textareas.length).toBeGreaterThan(0)

			// Focusing textarea does not trigger scrollToIndex("LAST")
			const editArea = textareas[0]
			await act(async () => {
				fireEvent.focus(editArea)
			})
			expect(scrollHarness.scrollToIndexArgs.filter((arg) => arg.index === "LAST")).toHaveLength(0)

			// Clicking Cancel does not trigger scrollToIndex("LAST")
			const cancelBtn = screen.getByLabelText("chat:cancel.title")
			await act(async () => {
				fireEvent.click(cancelBtn)
			})
			expect(scrollHarness.scrollToIndexArgs.filter((arg) => arg.index === "LAST")).toHaveLength(0)
		},
	)
})
