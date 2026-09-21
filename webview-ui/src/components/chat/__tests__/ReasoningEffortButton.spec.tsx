import { render, screen, fireEvent } from "@/utils/test-utils"
import { ReasoningEffortButton } from "../ReasoningEffortButton"
import { vscode } from "@/utils/vscode"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const mockSetApiConfiguration = vi.fn()

let mockExtensionState: any = {
	apiConfiguration: {
		apiProvider: "xkiro",
		apiModelId: "deepseek/deepseek-chat",
		xkiroModelId: "deepseek/deepseek-chat",
		apiKey: "test-api-key",
	},
	currentApiConfigName: "default",
	setApiConfiguration: mockSetApiConfiguration,
}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

let mockSelectedModel = {
	id: "deepseek/deepseek-chat",
	info: {
		contextWindow: 128000,
		maxTokens: 8192,
	} as any,
}

vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => mockSelectedModel,
}))

describe("ReasoningEffortButton", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSelectedModel = {
			id: "deepseek/deepseek-chat",
			info: {
				contextWindow: 128000,
				maxTokens: 8192,
			},
		}
		mockExtensionState = {
			apiConfiguration: {
				apiProvider: "xkiro",
				apiModelId: "deepseek/deepseek-chat",
				xkiroModelId: "deepseek/deepseek-chat",
				apiKey: "test-api-key",
			},
			currentApiConfigName: "default",
			setApiConfiguration: mockSetApiConfiguration,
		}
	})

	test("does not render when active model does not support reasoning", () => {
		render(<ReasoningEffortButton />)
		expect(screen.queryByTestId("reasoning-effort-trigger")).not.toBeInTheDocument()
		expect(screen.queryByTestId("reasoning-effort-section")).not.toBeInTheDocument()
	})

	test("renders effort trigger button when active model supports reasoning", () => {
		mockSelectedModel = {
			id: "openai/o3-mini",
			info: {
				contextWindow: 200000,
				maxTokens: 100000,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			},
		}
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/o3-mini",
			xkiroModelId: "openai/o3-mini",
			reasoningEffort: "medium",
			enableReasoningEffort: true,
		}

		render(<ReasoningEffortButton />)

		const trigger = screen.getByTestId("reasoning-effort-trigger")
		expect(trigger).toBeInTheDocument()
		expect(trigger).toHaveTextContent("Effort: Medium")
	})

	test("opens popover with effort pills when clicked", () => {
		mockSelectedModel = {
			id: "openai/o3-mini",
			info: {
				contextWindow: 200000,
				maxTokens: 100000,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			},
		}
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/o3-mini",
			xkiroModelId: "openai/o3-mini",
			reasoningEffort: "medium",
			enableReasoningEffort: true,
		}

		render(<ReasoningEffortButton />)

		const trigger = screen.getByTestId("reasoning-effort-trigger")
		fireEvent.click(trigger)

		expect(screen.getByTestId("reasoning-effort-section")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-off")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-low")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-medium")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-high")).toBeInTheDocument()
	})

	test("selecting a reasoning effort pill immediately updates apiConfiguration and synchronizes via IPC", () => {
		mockSelectedModel = {
			id: "openai/o3-mini",
			info: {
				contextWindow: 200000,
				maxTokens: 100000,
				supportsReasoningEffort: true,
				reasoningEffort: "medium",
			},
		}
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/o3-mini",
			xkiroModelId: "openai/o3-mini",
			reasoningEffort: "medium",
			enableReasoningEffort: true,
		}

		render(<ReasoningEffortButton />)

		const trigger = screen.getByTestId("reasoning-effort-trigger")
		fireEvent.click(trigger)

		// Click "High"
		const highPill = screen.getByTestId("reasoning-effort-pill-high")
		fireEvent.click(highPill)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoningEffort: "high",
				enableReasoningEffort: true,
			}),
		)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: expect.objectContaining({
					reasoningEffort: "high",
					enableReasoningEffort: true,
				}),
			}),
		)

		// Reopen popover and click "Off"
		fireEvent.click(screen.getByTestId("reasoning-effort-trigger"))
		const offPill = screen.getByTestId("reasoning-effort-pill-off")
		fireEvent.click(offPill)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoningEffort: "disable",
				enableReasoningEffort: false,
			}),
		)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: expect.objectContaining({
					reasoningEffort: "disable",
					enableReasoningEffort: false,
				}),
			}),
		)
	})

	test("renders reasoning effort button for GPT-5 on xKiro even without explicit ModelInfo reasoning flag", () => {
		mockSelectedModel = {
			id: "openai/gpt-5",
			info: {
				contextWindow: 400000,
				maxTokens: 128000,
			},
		}
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiProvider: "xkiro",
			apiModelId: "openai/gpt-5",
			xkiroModelId: "openai/gpt-5",
		}

		render(<ReasoningEffortButton />)

		const trigger = screen.getByTestId("reasoning-effort-trigger")
		expect(trigger).toBeInTheDocument()
		expect(trigger).toHaveTextContent("Effort: Medium")

		fireEvent.click(trigger)
		expect(screen.getByTestId("reasoning-effort-section")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-medium")).toBeInTheDocument()
	})

	test("dynamically renders only the specified levels and Off when supportsReasoningEffort is an array", () => {
		mockSelectedModel = {
			id: "google/gemini-3-pro-preview",
			info: {
				contextWindow: 1000000,
				supportsReasoningEffort: ["low", "high"],
			},
		}
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "google/gemini-3-pro-preview",
			xkiroModelId: "google/gemini-3-pro-preview",
			reasoningEffort: "high",
			enableReasoningEffort: true,
		}

		render(<ReasoningEffortButton />)

		const trigger = screen.getByTestId("reasoning-effort-trigger")
		expect(trigger).toBeInTheDocument()
		expect(trigger).toHaveTextContent("Effort: High")

		fireEvent.click(trigger)

		expect(screen.getByTestId("reasoning-effort-section")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-off")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-low")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-high")).toBeInTheDocument()
		expect(screen.queryByTestId("reasoning-effort-pill-medium")).not.toBeInTheDocument()
	})

	test("dynamically renders only the specified levels and Off when reasoningEffortLevels is defined", () => {
		mockSelectedModel = {
			id: "custom/extended-reasoning-model",
			info: {
				contextWindow: 400000,
				reasoningEffortLevels: ["minimal", "low", "medium", "high", "xhigh"],
			},
		}
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "custom/extended-reasoning-model",
			reasoningEffort: "xhigh",
			enableReasoningEffort: true,
		}

		render(<ReasoningEffortButton />)

		const trigger = screen.getByTestId("reasoning-effort-trigger")
		expect(trigger).toBeInTheDocument()
		expect(trigger).toHaveTextContent("Effort: XHigh")

		fireEvent.click(trigger)

		expect(screen.getByTestId("reasoning-effort-pill-off")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-minimal")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-low")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-medium")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-high")).toBeInTheDocument()
		expect(screen.getByTestId("reasoning-effort-pill-xhigh")).toBeInTheDocument()

		// Clicking minimal sets reasoningEffort to "minimal"
		fireEvent.click(screen.getByTestId("reasoning-effort-pill-minimal"))
		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoningEffort: "minimal",
				enableReasoningEffort: true,
			}),
		)
	})

	test("disabled prop disables the trigger button", () => {
		mockSelectedModel = {
			id: "openai/o3-mini",
			info: {
				supportsReasoningEffort: true,
			},
		}

		render(<ReasoningEffortButton disabled={true} />)

		const trigger = screen.getByTestId("reasoning-effort-trigger")
		expect(trigger).toBeDisabled()
	})
})
