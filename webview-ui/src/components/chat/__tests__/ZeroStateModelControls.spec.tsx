import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { ChatTextArea } from "../ChatTextArea"
import ChatView from "../ChatView"
import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { defaultModeSlug } from "@roo/modes"

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock use-sound hook
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [vi.fn()]),
}))

// Mock ChatRow and other expensive/virtualized sub-components
vi.mock("../ChatRow", () => ({
	default: () => null,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: () => null,
}))

// Mock selected model with reasoning capability
let mockSelectedModel = {
	id: "anthropic/claude-3.7-sonnet",
	info: {
		contextWindow: 200000,
		maxTokens: 64000,
		supportsReasoningEffort: true,
		reasoningEffort: "medium",
	} as any,
}

vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => mockSelectedModel,
}))

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext")

describe("Zero-State Model and Effort Controls Independence", () => {
	const defaultTextAreaProps = {
		inputValue: "",
		setInputValue: vi.fn(),
		onSend: vi.fn(),
		sendingDisabled: false,
		selectApiConfigDisabled: false,
		onSelectImages: vi.fn(),
		shouldDisableImages: false,
		placeholderText: "Type a message...",
		selectedImages: [],
		setSelectedImages: vi.fn(),
		onHeightChange: vi.fn(),
		mode: defaultModeSlug,
		setMode: vi.fn(),
		modeShortcutText: "(⌘. for next mode)",
		isStreaming: false,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			currentTaskItem: undefined,
			taskHistory: [],
			clineMessages: [],
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "anthropic/claude-3.7-sonnet",
				enableReasoningEffort: true,
				reasoningEffort: "medium",
			},
			currentApiConfigName: "default",
			listApiConfigMeta: [{ id: "default", name: "default", modelId: "anthropic/claude-3.7-sonnet" }],
			pinnedApiConfigs: {},
			filePaths: [],
			openedTabs: [],
			cwd: "/workspace/empty-project",
			setApiConfiguration: vi.fn(),
			organizationAllowList: { allowAll: true },
			showWorktreesInHomeScreen: false,
			mode: defaultModeSlug,
			setMode: vi.fn(),
		})
	})

	test("ModelSelector and ReasoningEffortButton in ChatTextArea are enabled in empty projects (currentTask = undefined, taskHistory = [])", () => {
		render(
			<ChatTextArea
				{...defaultTextAreaProps}
				sendingDisabled={false}
				selectApiConfigDisabled={false}
				isStreaming={false}
			/>,
		)

		// 1. ModelSelector trigger check
		const modelTrigger = screen.getByTestId("dropdown-trigger")
		expect(modelTrigger).toBeInTheDocument()
		expect(modelTrigger).not.toHaveAttribute("disabled")
		expect(modelTrigger.className).not.toContain("pointer-events-none")
		expect(modelTrigger.className).not.toContain("opacity-50")
		expect(modelTrigger.className).toContain("cursor-pointer")

		// 2. ReasoningEffortButton trigger check
		const effortTrigger = screen.getByTestId("reasoning-effort-trigger")
		expect(effortTrigger).toBeInTheDocument()
		expect(effortTrigger).not.toHaveAttribute("disabled")
		expect(effortTrigger.className).not.toContain("pointer-events-none")
		expect(effortTrigger.className).not.toContain("opacity-50")
		expect(effortTrigger.className).toContain("cursor-pointer")
	})

	test("ModelSelector and ReasoningEffortButton remain enabled even if sendingDisabled is true (zero-state independence)", () => {
		// Even if textarea sending is temporarily disabled, model and reasoning controls must stay active when !isStreaming
		render(
			<ChatTextArea
				{...defaultTextAreaProps}
				sendingDisabled={true}
				selectApiConfigDisabled={false}
				isStreaming={false}
			/>,
		)

		const modelTrigger = screen.getByTestId("dropdown-trigger")
		expect(modelTrigger).not.toHaveAttribute("disabled")
		expect(modelTrigger.className).not.toContain("pointer-events-none")
		expect(modelTrigger.className).not.toContain("opacity-50")

		const effortTrigger = screen.getByTestId("reasoning-effort-trigger")
		expect(effortTrigger).not.toHaveAttribute("disabled")
		expect(effortTrigger.className).not.toContain("pointer-events-none")
		expect(effortTrigger.className).not.toContain("opacity-50")
	})

	test("ReasoningEffortButton opens popover on click and selection posts upsertApiConfiguration message", () => {
		render(
			<ChatTextArea
				{...defaultTextAreaProps}
				sendingDisabled={false}
				selectApiConfigDisabled={false}
				isStreaming={false}
			/>,
		)

		const effortTrigger = screen.getByTestId("reasoning-effort-trigger")
		fireEvent.click(effortTrigger)

		// Popover should be open and contain effort options
		const popover = screen.getByTestId("reasoning-effort-popover")
		expect(popover).toBeInTheDocument()

		const highPill = screen.getByTestId("reasoning-effort-pill-high")
		expect(highPill).toBeInTheDocument()

		fireEvent.click(highPill)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "upsertApiConfiguration",
				apiConfiguration: expect.objectContaining({
					reasoningEffort: "high",
					enableReasoningEffort: true,
				}),
			}),
		)
	})

	test("ChatView in an empty project (zero tasks, zero messages) renders ModelSelector and ReasoningEffortButton enabled", () => {
		render(<ChatView isHidden={false} showAnnouncement={false} hideAnnouncement={vi.fn()} />)

		const modelTrigger = screen.getByTestId("dropdown-trigger")
		expect(modelTrigger).toBeInTheDocument()
		expect(modelTrigger).not.toHaveAttribute("disabled")
		expect(modelTrigger.className).not.toContain("pointer-events-none")
		expect(modelTrigger.className).not.toContain("opacity-50")

		const effortTrigger = screen.getByTestId("reasoning-effort-trigger")
		expect(effortTrigger).toBeInTheDocument()
		expect(effortTrigger).not.toHaveAttribute("disabled")
		expect(effortTrigger.className).not.toContain("pointer-events-none")
		expect(effortTrigger.className).not.toContain("opacity-50")
	})
})
