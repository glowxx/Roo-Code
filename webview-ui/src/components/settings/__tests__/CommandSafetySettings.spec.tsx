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

	describe("API Key Inheritance and Status Indicator", () => {
		test("displays inherited badge and placeholder when key is available in main provider config", () => {
			render(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "openai",
						modelId: "gpt-4o",
					}}
					apiConfiguration={{
						openAiApiKey: "sk-openai-test-key",
					}}
					onChange={mockOnChange}
				/>,
			)

			const badge = screen.getByTestId("command-safety-inherited-badge")
			expect(badge).toBeInTheDocument()
			expect(badge).toHaveTextContent("Pobrano z konfiguracji OpenAI (Gotowy)")

			const apiKeyInput = screen.getByTestId("command-safety-api-key-input")
			expect(apiKeyInput).toHaveAttribute("placeholder", "(Odziedziczono z profilu głównego)")

			expect(screen.queryByTestId("command-safety-api-key-warning")).not.toBeInTheDocument()
		})

		test("displays warning when API key is missing both in dedicated field and main config", () => {
			render(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "openai",
						modelId: "gpt-4o",
					}}
					apiConfiguration={{}}
					onChange={mockOnChange}
				/>,
			)

			const warning = screen.getByTestId("command-safety-api-key-warning")
			expect(warning).toBeInTheDocument()
			expect(warning).toHaveTextContent("Brak klucza API dla OpenAI. Wprowadź klucz tutaj lub w sekcji Dostawcy.")

			expect(screen.queryByTestId("command-safety-inherited-badge")).not.toBeInTheDocument()

			const apiKeyInput = screen.getByTestId("command-safety-api-key-input")
			expect(apiKeyInput).toHaveAttribute("placeholder", "Klucz API (opcjonalnie)")
		})

		test("dedicated API key overrides inheritance and hides badge and warning", () => {
			render(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "openai",
						modelId: "gpt-4o",
						apiKey: "my-dedicated-api-key",
					}}
					apiConfiguration={{
						openAiApiKey: "sk-openai-test-key",
					}}
					onChange={mockOnChange}
				/>,
			)

			expect(screen.queryByTestId("command-safety-inherited-badge")).not.toBeInTheDocument()
			expect(screen.queryByTestId("command-safety-api-key-warning")).not.toBeInTheDocument()

			const apiKeyInput = screen.getByTestId("command-safety-api-key-input")
			expect(apiKeyInput).toHaveValue("my-dedicated-api-key")
			expect(apiKeyInput).toHaveAttribute("placeholder", "Klucz API (opcjonalnie)")
		})

		test("resolves API key correctly for other providers (Anthropic, OpenRouter, xKiro, Gemini)", () => {
			const { rerender } = render(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "anthropic",
						modelId: "claude-3-5-sonnet",
					}}
					apiConfiguration={{
						apiKey: "sk-ant-test-key",
						apiProvider: "anthropic",
					}}
					onChange={mockOnChange}
				/>,
			)

			let badge = screen.getByTestId("command-safety-inherited-badge")
			expect(badge).toHaveTextContent("Pobrano z konfiguracji Anthropic (Gotowy)")

			// OpenRouter
			rerender(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "openrouter",
						modelId: "anthropic/claude-3-5-sonnet",
					}}
					apiConfiguration={{
						openRouterApiKey: "sk-or-test-key",
					}}
					onChange={mockOnChange}
				/>,
			)
			badge = screen.getByTestId("command-safety-inherited-badge")
			expect(badge).toHaveTextContent("Pobrano z konfiguracji OpenRouter (Gotowy)")

			// xKiro
			rerender(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "xkiro",
						modelId: "gpt-4o",
					}}
					apiConfiguration={
						{
							xkiroApiKey: "sk-xkiro-test-key",
						} as any
					}
					onChange={mockOnChange}
				/>,
			)
			badge = screen.getByTestId("command-safety-inherited-badge")
			expect(badge).toHaveTextContent("Pobrano z konfiguracji xKiro (Gotowy)")

			// Gemini
			rerender(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "gemini",
						modelId: "gemini-2.0-flash",
					}}
					apiConfiguration={{
						geminiApiKey: "AIza-gemini-test-key",
					}}
					onChange={mockOnChange}
				/>,
			)
			badge = screen.getByTestId("command-safety-inherited-badge")
			expect(badge).toHaveTextContent("Pobrano z konfiguracji Google Gemini (Gotowy)")
		})

		test("shows warning when switching to provider without configured key", () => {
			render(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "anthropic",
						modelId: "claude-3-5-sonnet",
					}}
					apiConfiguration={{
						openAiApiKey: "sk-openai-only",
					}}
					onChange={mockOnChange}
				/>,
			)

			const warning = screen.getByTestId("command-safety-api-key-warning")
			expect(warning).toBeInTheDocument()
			expect(warning).toHaveTextContent("Brak klucza API dla Anthropic. Wprowadź klucz tutaj lub w sekcji Dostawcy.")
		})
	})

	describe("CommandSafetyModelCombobox integration", () => {
		test("displays recommended audit models when combobox is opened for openai", () => {
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

			const toggle = screen.getByTestId("command-safety-model-combobox-toggle")
			fireEvent.click(toggle)

			expect(screen.getByTestId("command-safety-recommended-models-header")).toBeInTheDocument()
			expect(screen.getByText(/Rekomendowane modele audytowe \(Szybkie i ekonomiczne\)/)).toBeInTheDocument()
			expect(screen.getByTestId("command-safety-model-option-gpt-4o-mini")).toBeInTheDocument()

			// Selecting recommended model calls onChange
			fireEvent.click(screen.getByTestId("command-safety-model-option-gpt-4o-mini"))
			expect(mockOnChange).toHaveBeenCalledWith(
				expect.objectContaining({
					modelId: "gpt-4o-mini",
				}),
			)
		})

		test("displays recommended models for xkiro, anthropic, gemini, and openrouter", () => {
			// Anthropic
			const { rerender } = render(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "anthropic",
						modelId: "",
					}}
					onChange={mockOnChange}
				/>,
			)
			fireEvent.click(screen.getByTestId("command-safety-model-combobox-toggle"))
			expect(screen.getByTestId("command-safety-model-option-claude-3-5-haiku-20241022")).toBeInTheDocument()

			// xKiro
			rerender(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "xkiro",
						modelId: "",
					}}
					onChange={mockOnChange}
				/>,
			)
			expect(screen.getByTestId("command-safety-model-option-deepseek/deepseek-chat")).toBeInTheDocument()
			expect(screen.getByTestId("command-safety-model-option-google/gemini-2.5-flash")).toBeInTheDocument()
			expect(screen.getByTestId("command-safety-model-option-openai/gpt-5-mini")).toBeInTheDocument()

			// Gemini
			rerender(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "gemini",
						modelId: "",
					}}
					onChange={mockOnChange}
				/>,
			)
			expect(screen.getByTestId("command-safety-model-option-gemini-2.5-flash")).toBeInTheDocument()
			expect(screen.getByTestId("command-safety-model-option-gemini-2.0-flash")).toBeInTheDocument()

			// OpenRouter
			rerender(
				<CommandSafetySettings
					commandSafetyConfig={{
						enabled: true,
						provider: "openrouter",
						modelId: "",
					}}
					onChange={mockOnChange}
				/>,
			)
			expect(screen.getByTestId("command-safety-model-option-openai/gpt-4o-mini")).toBeInTheDocument()
			expect(screen.getByTestId("command-safety-model-option-anthropic/claude-3.5-haiku")).toBeInTheDocument()
			expect(screen.getByTestId("command-safety-model-option-google/gemini-2.5-flash")).toBeInTheDocument()
		})

		test("displays custom ID option when non-existent model ID is typed", () => {
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
			fireEvent.change(modelIdInput, { target: { value: "custom-safety-guardrail-v1" } })

			const customOption = screen.getByTestId("command-safety-custom-model-option")
			expect(customOption).toBeInTheDocument()
			expect(customOption).toHaveTextContent(/Użyj niestandardowego ID:\s*"custom-safety-guardrail-v1"/)

			fireEvent.click(customOption)
			expect(mockOnChange).toHaveBeenCalledWith(
				expect.objectContaining({
					modelId: "custom-safety-guardrail-v1",
				}),
			)
		})
	})
})


