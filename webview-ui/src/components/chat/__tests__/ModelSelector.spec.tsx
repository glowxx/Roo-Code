import { render, screen, fireEvent } from "@/utils/test-utils"
import { ModelSelector, cleanModelDisplayName } from "../ModelSelector"
import { vscode } from "@/utils/vscode"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const mockSetApiConfiguration = vi.fn()

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: {
			apiProvider: "xkiro",
			apiModelId: "deepseek/deepseek-chat",
			xkiroModelId: "deepseek/deepseek-chat",
		},
		currentApiConfigName: "default",
		setApiConfiguration: mockSetApiConfiguration,
		routerModels: undefined,
	}),
}))

vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({
		id: "deepseek/deepseek-chat",
		info: {
			contextWindow: 128000,
			maxTokens: 8192,
		},
	}),
}))

describe("ModelSelector", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("cleanModelDisplayName formats known models correctly", () => {
		expect(cleanModelDisplayName("deepseek/deepseek-chat")).toBe("DeepSeek V3")
		expect(cleanModelDisplayName("deepseek/deepseek-reasoner")).toBe("DeepSeek R1")
		expect(cleanModelDisplayName("anthropic/claude-3.7-sonnet")).toBe("Claude 3.7 Sonnet")
		expect(cleanModelDisplayName("openai/gpt-4o")).toBe("GPT-4o")
		expect(cleanModelDisplayName("google/gemini-2.5-pro")).toBe("Gemini 2.5 Pro")
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
})
