import { render, screen, fireEvent } from "@/utils/test-utils"
import {
	ModelSelector,
	cleanModelDisplayName,
	extractModelFamily,
	extractModelVersion,
	isReasoningModel,
	promoteDynamicFlagships,
	sanitizeCustomModelId,
} from "../ModelSelector"
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
	routerModels: undefined,
	openAiModels: undefined as string[] | undefined,
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

describe("ModelSelector", () => {
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
			routerModels: undefined,
			openAiModels: undefined,
		}
	})

	test("cleanModelDisplayName formats known models and new generations correctly", () => {
		expect(cleanModelDisplayName("deepseek/deepseek-chat")).toBe("DeepSeek V3")
		expect(cleanModelDisplayName("deepseek/deepseek-reasoner")).toBe("DeepSeek R1")
		expect(cleanModelDisplayName("anthropic/claude-3.7-sonnet")).toBe("Claude 3.7 Sonnet")
		expect(cleanModelDisplayName("anthropic/claude-4.5-sonnet")).toBe("Claude 4.5 Sonnet")
		expect(cleanModelDisplayName("openai/gpt-5")).toBe("GPT-5")
		expect(cleanModelDisplayName("openai/gpt-4.5-preview")).toBe("GPT-4.5 Preview")
		expect(cleanModelDisplayName("openai/gpt-4o")).toBe("GPT-4o")
		expect(cleanModelDisplayName("google/gemini-2.5-pro")).toBe("Gemini 2.5 Pro")
		expect(cleanModelDisplayName("google/gemini-3-pro")).toBe("Gemini 3 Pro")
		expect(cleanModelDisplayName("qwen/qwen-3-coder")).toBe("Qwen 3 Coder")
	})

	test("cleanModelDisplayName safely falls back for unusual identifiers", () => {
		expect(cleanModelDisplayName("")).toBe("Select Model")
		expect(cleanModelDisplayName("/")).toBe("/")
		expect(cleanModelDisplayName("vendor/")).toBe("vendor/")
		expect(cleanModelDisplayName(":")).toBe(":")
	})

	test("sanitizeCustomModelId strips spaces, newlines, and special characters (#, ?, &)", () => {
		expect(sanitizeCustomModelId("  my-model #frag ?key=1 &b=2 \n ")).toBe("my-modelfragkey%3D1b%3D2")
		expect(sanitizeCustomModelId("")).toBe("")
		expect(sanitizeCustomModelId("   \n#?&  ")).toBe("")
		expect(sanitizeCustomModelId("provider/model-name:latest")).toBe("provider/model-name:latest")
	})

	test("renders the trigger button with current model display name", () => {
		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		expect(trigger).toBeInTheDocument()
		expect(trigger).toHaveTextContent("DeepSeek V3")
	})

	test("opens the popover and renders available models on click", () => {
		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		// Models for xkiro should be rendered
		expect(screen.getByText("DeepSeek R1")).toBeInTheDocument()
		expect(screen.getByText("Claude 3.7 Sonnet")).toBeInTheDocument()
	})

	test("selecting a model sends upsertApiConfiguration and updates state", () => {
		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		const r1Item = screen.getByText("DeepSeek R1")
		fireEvent.click(r1Item)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiModelId: "deepseek/deepseek-reasoner",
				xkiroModelId: "deepseek/deepseek-reasoner",
			}),
		)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: expect.objectContaining({
					apiModelId: "deepseek/deepseek-reasoner",
				}),
			}),
		)
	})

	test("clicking refresh button sends requestOpenAiModels IPC message", () => {
		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		// Find the single refresh button in the popover header
		const refreshBtn = screen.getByTestId("refresh-models-button")
		expect(refreshBtn).toBeInTheDocument()
		expect(refreshBtn).toHaveAttribute("aria-label", "Refresh models")

		// Redundant footer button should not exist
		expect(screen.queryByText("Refresh Models")).not.toBeInTheDocument()

		fireEvent.click(refreshBtn)

		expect(vscode.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "requestOpenAiModels",
			}),
		)
	})

	test("displays dynamic models from openAiModels in state with flagship and all models sections", () => {
		mockExtensionState.openAiModels = [
			"anthropic/claude-3.7-sonnet",
			"openai/gpt-4o",
			"custom-provider/custom-test-model",
		]

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		// Section headers
		expect(screen.getByText("Recommended / Flagship")).toBeInTheDocument()
		expect(screen.getByText(/All Available Models/)).toBeInTheDocument()

		// Dynamic model rendered
		expect(screen.getByText("custom-test-model")).toBeInTheDocument()
		expect(screen.getByText("custom-provider/custom-test-model")).toBeInTheDocument()
	})

	test("promotes newest generation models dynamically to Flagship section", () => {
		mockExtensionState.openAiModels = [
			"anthropic/claude-4.5-sonnet",
			"anthropic/claude-3.5-sonnet",
			"openai/gpt-5",
			"openai/gpt-4o",
			"google/gemini-3-pro",
			"qwen/qwen-3-coder",
		]

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		// Check that newest generation models are rendered with their formatted names
		expect(screen.getByText("Claude 4.5 Sonnet")).toBeInTheDocument()
		expect(screen.getByText("GPT-5")).toBeInTheDocument()
		expect(screen.getByText("Gemini 3 Pro")).toBeInTheDocument()
		expect(screen.getByText("Qwen 3 Coder")).toBeInTheDocument()
	})

	test("renders smart badges (Reasoning, Fast, Coder, Vision) accurately", () => {
		mockExtensionState.openAiModels = [
			"openai/o3-mini",
			"anthropic/claude-3.5-haiku",
			"qwen/qwen-2.5-coder",
			"openai/gpt-4o-vision",
		]

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		// Badges in document
		expect(screen.getAllByText("Reasoning").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Fast").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Coder").length).toBeGreaterThan(0)
		expect(screen.getAllByText("Vision").length).toBeGreaterThan(0)
	})

	test("submitting custom model form sanitizes model ID and updates state", () => {
		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		const input = screen.getByPlaceholderText("Enter custom model ID...")
		fireEvent.change(input, { target: { value: "  my-org/custom-model #hash ?v=1 \n " } })

		const setButton = screen.getByRole("button", { name: "Set" })
		fireEvent.click(setButton)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiModelId: "my-org/custom-modelhashv%3D1",
				xkiroModelId: "my-org/custom-modelhashv%3D1",
			}),
		)
	})

	test("clicking Use custom model from search input sanitizes model ID and updates state", () => {
		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		const searchInput = screen.getByPlaceholderText("chat:modelSelector.searchPlaceholder")
		fireEvent.change(searchInput, { target: { value: "  new-custom-model #frag &x=2 \n " } })

		const customModelButton = screen.getByText(/Use custom model/)
		fireEvent.click(customModelButton)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiModelId: "new-custom-modelfragx%3D2",
				xkiroModelId: "new-custom-modelfragx%3D2",
			}),
		)
	})

	test("isReasoningModel correctly identifies reasoning models", () => {
		expect(isReasoningModel("openai/o3-mini")).toBe(true)
		expect(isReasoningModel("deepseek/deepseek-reasoner")).toBe(true)
		expect(isReasoningModel("deepseek-r1")).toBe(true)
		expect(isReasoningModel("anthropic/claude-3.7-sonnet")).toBe(true)
		expect(isReasoningModel("any-model", { supportsReasoningEffort: true } as any)).toBe(true)
		expect(isReasoningModel("any-model", { supportsReasoningBudget: true } as any)).toBe(true)
		expect(isReasoningModel("any-model", { maxThinkingTokens: 8192 } as any)).toBe(true)
		expect(isReasoningModel("deepseek/deepseek-chat")).toBe(false)
		expect(isReasoningModel("openai/gpt-4o")).toBe(false)
	})

	test("does not render reasoning effort section when active model does not support reasoning", () => {
		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		expect(screen.queryByTestId("reasoning-effort-section")).not.toBeInTheDocument()
	})

	test("renders reasoning effort section with pills when active model supports reasoning", () => {
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

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
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

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
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

		// Click "Off"
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

	test("switching to a reasoning model preserves reasoningEffort", () => {
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/o3-mini",
			xkiroModelId: "openai/o3-mini",
			reasoningEffort: "high",
			enableReasoningEffort: true,
		}

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		// Target: DeepSeek R1 (reasoning model)
		const r1Item = screen.getByText("DeepSeek R1")
		fireEvent.click(r1Item)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiModelId: "deepseek/deepseek-reasoner",
				reasoningEffort: "high",
			}),
		)
	})

	test("switching to a non-reasoning model deletes reasoningEffort", () => {
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/o3-mini",
			xkiroModelId: "openai/o3-mini",
			reasoningEffort: "high",
			enableReasoningEffort: true,
		}

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		// Target: DeepSeek V3 (non-reasoning model)
		const v3Items = screen.getAllByText("DeepSeek V3")
		fireEvent.click(v3Items[v3Items.length - 1])

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.not.objectContaining({
				reasoningEffort: "high",
			}),
		)
	})
})
