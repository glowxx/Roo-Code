import { render, screen, fireEvent } from "@/utils/test-utils"
import { DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE } from "@roo-code/types"
import { CommandSafetySettings } from "../CommandSafetySettings"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("CommandSafetySettings", () => {
	const mockOnChange = vi.fn()

	beforeEach(() => {
		mockOnChange.mockClear()
	})

	test("renders all security controls and headings", () => {
		render(
			<CommandSafetySettings
				commandSafetyConfig={{
					enabled: false,
					provider: "openai",
					modelId: "gpt-4o",
					apiKey: "secret-key",
					customPromptTemplate: "Custom prompt",
				}}
				onChange={mockOnChange}
			/>,
		)

		expect(
			screen.getByText(/Command Safety Guardrail \(Weryfikator Bezpieczeństwa Poleceń\)/),
		).toBeInTheDocument()
		expect(screen.getByTestId("command-safety-enabled-toggle")).toBeInTheDocument()
		expect(screen.getByTestId("command-safety-provider-select")).toBeInTheDocument()
		expect(screen.getByTestId("command-safety-model-id-input")).toBeInTheDocument()
		expect(screen.getByTestId("command-safety-api-key-input")).toBeInTheDocument()
		expect(screen.getByTestId("command-safety-prompt-template-textarea")).toBeInTheDocument()
		expect(screen.getByTestId("command-safety-reset-prompt-button")).toBeInTheDocument()
	})

	test("calls onChange when enabled checkbox is toggled", () => {
		render(
			<CommandSafetySettings
				commandSafetyConfig={{
					enabled: false,
					provider: "openai",
					modelId: "",
				}}
				onChange={mockOnChange}
			/>,
		)

		const checkbox = screen.getByTestId("command-safety-enabled-toggle")
		fireEvent.click(checkbox)

		expect(mockOnChange).toHaveBeenCalledWith(
			expect.objectContaining({
				enabled: true,
				provider: "openai",
				modelId: "",
			}),
		)
	})

	test("calls onChange when model ID is typed", () => {
		render(
			<CommandSafetySettings
				commandSafetyConfig={{
					enabled: true,
					provider: "openai",
					modelId: "",
				}}
				onChange={mockOnChange}
			/>,
		)

		const modelIdInput = screen.getByTestId("command-safety-model-id-input")
		fireEvent.change(modelIdInput, { target: { value: "claude-3-5-sonnet" } })

		expect(mockOnChange).toHaveBeenCalledWith(
			expect.objectContaining({
				modelId: "claude-3-5-sonnet",
			}),
		)
	})

	test("calls onChange when dedicated API key is typed", () => {
		render(
			<CommandSafetySettings
				commandSafetyConfig={{
					enabled: true,
					provider: "openai",
					modelId: "gpt-4o",
					apiKey: "",
				}}
				onChange={mockOnChange}
			/>,
		)

		const apiKeyInput = screen.getByTestId("command-safety-api-key-input")
		fireEvent.change(apiKeyInput, { target: { value: "custom-api-key" } })

		expect(mockOnChange).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "custom-api-key",
			}),
		)
	})

	test("resets custom prompt template to default when Reset to Default button is clicked", () => {
		render(
			<CommandSafetySettings
				commandSafetyConfig={{
					enabled: true,
					provider: "openai",
					modelId: "gpt-4o",
					customPromptTemplate: "My custom template",
				}}
				onChange={mockOnChange}
			/>,
		)

		const resetButton = screen.getByTestId("command-safety-reset-prompt-button")
		fireEvent.click(resetButton)

		expect(mockOnChange).toHaveBeenCalledWith(
			expect.objectContaining({
				customPromptTemplate: DEFAULT_COMMAND_SAFETY_PROMPT_TEMPLATE,
			}),
		)
	})
})
