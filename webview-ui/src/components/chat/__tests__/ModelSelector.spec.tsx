import { render, screen, fireEvent } from "@/utils/test-utils"
import {
	ModelSelector,
	cleanModelDisplayName,
	extractModelFamily,
	extractModelVersion,
	isReasoningModel,
	promoteDynamicFlagships,
	sanitizeCustomModelId,
	getCanonicalModelKey,
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
	useSelectedModel: (config?: any) => {
		if (config && config.apiModelId) {
			return {
				id: config.apiModelId,
				info: {
					contextWindow: 128000,
					maxTokens: 8192,
				},
			}
		}
		return mockSelectedModel
	},
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
		expect(cleanModelDisplayName("anthropic/claude-sonnet-4-5")).toBe("Claude 4.5 Sonnet")
		expect(cleanModelDisplayName("openai/gpt-5")).toBe("GPT-5")
		expect(cleanModelDisplayName("openai/gpt-5.6-terra")).toBe("GPT-5.6 Terra")
		expect(cleanModelDisplayName("openai/gpt-5.6-sol")).toBe("GPT-5.6 Sol")
		expect(cleanModelDisplayName("openai/gpt-5.6-luna")).toBe("GPT-5.6 Luna")
		expect(cleanModelDisplayName("openai/gpt-6-astra")).toBe("GPT-6 Astra")
		expect(cleanModelDisplayName("openai/gpt-6-luna")).toBe("GPT-6 Luna")
		expect(cleanModelDisplayName("openai/gpt-6-sol")).toBe("GPT-6 Sol")
		expect(cleanModelDisplayName("unknown-provider/gpt-6.1-nebula")).toBe("GPT-6.1 Nebula")
		expect(cleanModelDisplayName("unknown-provider/gpt-7-orion")).toBe("GPT-7 Orion")
		expect(cleanModelDisplayName("unknown-provider/model-x-coder-preview")).toBe("Model X Coder Preview")
		expect(cleanModelDisplayName("openai/gpt-4.5-preview")).toBe("GPT-4.5 Preview")
		expect(cleanModelDisplayName("openai/gpt-4o")).toBe("GPT-4o")
		expect(cleanModelDisplayName("google/gemini-2.5-pro")).toBe("Gemini 2.5 Pro")
		expect(cleanModelDisplayName("google/gemini-3-pro")).toBe("Gemini 3 Pro")
		expect(cleanModelDisplayName("qwen/qwen-3-coder")).toBe("Qwen 3 Coder")
	})

	test("cleanModelDisplayName preserves variant suffixes and never collapses distinct variants to the same name", () => {
		const gpt6Variants = [
			cleanModelDisplayName("openai/gpt-6-astra"),
			cleanModelDisplayName("openai/gpt-6-luna"),
			cleanModelDisplayName("openai/gpt-6-sol"),
		]
		expect(gpt6Variants).toEqual(["GPT-6 Astra", "GPT-6 Luna", "GPT-6 Sol"])
		expect(new Set(gpt6Variants).size).toBe(3)

		const gpt56Variants = [
			cleanModelDisplayName("openai/gpt-5.6-terra"),
			cleanModelDisplayName("openai/gpt-5.6-sol"),
			cleanModelDisplayName("openai/gpt-5.6-luna"),
		]
		expect(gpt56Variants).toEqual(["GPT-5.6 Terra", "GPT-5.6 Sol", "GPT-5.6 Luna"])
		expect(new Set(gpt56Variants).size).toBe(3)
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
		expect(screen.getByText("Custom Test Model")).toBeInTheDocument()
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
		expect(isReasoningModel("openai/gpt-5")).toBe(true)
		expect(isReasoningModel("gpt-5")).toBe(true)
		expect(isReasoningModel("openai/gpt-5-mini")).toBe(true)
		expect(isReasoningModel("my-custom-o4-model")).toBe(true)
		expect(isReasoningModel("deepseek/deepseek-reasoner")).toBe(true)
		expect(isReasoningModel("deepseek-r1")).toBe(true)
		expect(isReasoningModel("anthropic/claude-3.7-sonnet")).toBe(true)
		expect(isReasoningModel("any-model", { supportsReasoningEffort: true } as any)).toBe(true)
		expect(isReasoningModel("any-model", { supportsReasoningBudget: true } as any)).toBe(true)
		expect(isReasoningModel("any-model", { maxThinkingTokens: 8192 } as any)).toBe(true)
		expect(isReasoningModel("deepseek/deepseek-chat")).toBe(false)
		expect(isReasoningModel("openai/gpt-4o")).toBe(false)
	})

	test("does not render reasoning effort section in popover as it has been moved to dedicated toolbar button", () => {
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

		expect(screen.queryByTestId("reasoning-effort-section")).not.toBeInTheDocument()
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

	test("switching to a non-reasoning model deletes reasoningEffort and sets enableReasoningEffort to false", () => {
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
			expect.objectContaining({
				enableReasoningEffort: false,
			}),
		)
		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.not.objectContaining({
				reasoningEffort: "high",
			}),
		)
	})

	test("switching to a model with restricted levels clamps effort to medium if allowed", () => {
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/gpt-5.1-codex-max",
			xkiroModelId: "openai/gpt-5.1-codex-max",
			reasoningEffort: "xhigh",
			enableReasoningEffort: true,
		}
		mockExtensionState.openAiModels = ["custom/restricted-model-medium"]
		mockExtensionState.openAiModelInfos = {
			"custom/restricted-model-medium": {
				contextWindow: 128000,
				supportsReasoningEffort: ["low", "medium"],
			},
		}

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		const targetItem = screen.getByText("Restricted Model Medium")
		fireEvent.click(targetItem)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiModelId: "custom/restricted-model-medium",
				reasoningEffort: "medium",
				enableReasoningEffort: true,
			}),
		)
	})

	test("switching to a model with restricted levels clamps effort to first available if medium is not allowed", () => {
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/o3-mini",
			xkiroModelId: "openai/o3-mini",
			reasoningEffort: "medium",
			enableReasoningEffort: true,
		}
		mockExtensionState.openAiModels = ["custom/restricted-model-low-high"]
		mockExtensionState.openAiModelInfos = {
			"custom/restricted-model-low-high": {
				contextWindow: 128000,
				supportsReasoningEffort: ["low", "high"],
			},
		}

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		const targetItem = screen.getByText("Restricted Model Low High")
		fireEvent.click(targetItem)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiModelId: "custom/restricted-model-low-high",
				reasoningEffort: "low",
				enableReasoningEffort: true,
			}),
		)
	})

	test("switching to a model with reasoningEffortLevels clamps effort to first available if medium is not allowed", () => {
		mockExtensionState.apiConfiguration = {
			...mockExtensionState.apiConfiguration,
			apiModelId: "openai/o3-mini",
			xkiroModelId: "openai/o3-mini",
			reasoningEffort: "high",
			enableReasoningEffort: true,
		}
		mockExtensionState.openAiModels = ["custom/minimal-low-model"]
		mockExtensionState.openAiModelInfos = {
			"custom/minimal-low-model": {
				contextWindow: 128000,
				reasoningEffortLevels: ["minimal", "low"],
			},
		}

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		fireEvent.click(trigger)

		const targetItem = screen.getByText("Minimal Low Model")
		fireEvent.click(targetItem)

		expect(mockSetApiConfiguration).toHaveBeenCalledWith(
			expect.objectContaining({
				apiModelId: "custom/minimal-low-model",
				reasoningEffort: "minimal",
				enableReasoningEffort: true,
			}),
		)
	})

	test("displays selected model directly in trigger without deferred badge or notice", () => {
		mockExtensionState.apiConfiguration = {
			apiProvider: "openai",
			apiModelId: "openai/gpt-5",
			apiKey: "test-key",
		}

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		expect(trigger).toHaveTextContent("GPT-5")
		expect(screen.queryByTestId("next-task-model-badge")).toBeNull()

		fireEvent.click(trigger)
		expect(screen.queryByTestId("active-task-model-notice")).toBeNull()
	})

	test("displays clean active model info in tooltip", () => {
		mockExtensionState.apiConfiguration = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-7-sonnet",
			apiKey: "test-key",
		}

		render(<ModelSelector />)
		const trigger = screen.getByTestId("model-selector-trigger")
		expect(trigger).toHaveTextContent("Claude 3.7 Sonnet")
		expect(screen.queryByTestId("next-task-model-badge")).toBeNull()
	})

	describe("One-click atomic model and reasoning effort selection", () => {
		test("1. Model A High -> Model B High-compatible: ONE CLICK preserves High and selects Model B", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "openai",
				apiModelId: "openai/o3-mini",
				openAiModelId: "openai/o3-mini",
				reasoningEffort: "high",
				enableReasoningEffort: true,
			}
			mockExtensionState.openAiModels = ["openai/o3-mini", "openai/gpt-5"]
			mockExtensionState.openAiModelInfos = {
				"openai/o3-mini": { supportsReasoningEffort: true },
				"openai/gpt-5": { supportsReasoningEffort: true },
			}

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			// Click GPT-5 once
			fireEvent.click(screen.getByText("GPT-5"))

			expect(mockSetApiConfiguration).toHaveBeenCalledTimes(1)
			expect(mockSetApiConfiguration).toHaveBeenCalledWith(
				expect.objectContaining({
					apiModelId: "openai/gpt-5",
					openAiModelId: "openai/gpt-5",
					reasoningEffort: "high",
					enableReasoningEffort: true,
				}),
			)
			expect(vscode.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "upsertApiConfiguration",
					apiConfiguration: expect.objectContaining({
						apiModelId: "openai/gpt-5",
						reasoningEffort: "high",
						enableReasoningEffort: true,
					}),
				}),
			)
		})

		test("2. Model A High -> Model C unsupported-High: ONE CLICK clamps effort and selects Model C", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "openai",
				apiModelId: "openai/o3-mini",
				openAiModelId: "openai/o3-mini",
				reasoningEffort: "high",
				enableReasoningEffort: true,
			}
			mockExtensionState.openAiModels = ["openai/o3-mini", "custom/low-only-model"]
			mockExtensionState.openAiModelInfos = {
				"openai/o3-mini": { supportsReasoningEffort: true },
				"custom/low-only-model": { supportsReasoningEffort: ["low"] },
			}

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			fireEvent.click(screen.getByText("Low Only Model"))

			expect(mockSetApiConfiguration).toHaveBeenCalledTimes(1)
			expect(mockSetApiConfiguration).toHaveBeenCalledWith(
				expect.objectContaining({
					apiModelId: "custom/low-only-model",
					reasoningEffort: "low",
					enableReasoningEffort: true,
				}),
			)
		})

		test("3. Non-reasoning model -> reasoning model: ONE CLICK initializes default reasoning effort", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "openai",
				apiModelId: "openai/gpt-4o",
				openAiModelId: "openai/gpt-4o",
			}
			mockExtensionState.openAiModels = ["openai/gpt-4o", "custom/reasoning-target-model"]
			mockExtensionState.openAiModelInfos = {
				"openai/gpt-4o": { supportsReasoningEffort: false },
				"custom/reasoning-target-model": { supportsReasoningEffort: true },
			}

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			fireEvent.click(screen.getByText("Reasoning Target Model"))

			expect(mockSetApiConfiguration).toHaveBeenCalledTimes(1)
			expect(mockSetApiConfiguration).toHaveBeenCalledWith(
				expect.objectContaining({
					apiModelId: "custom/reasoning-target-model",
					reasoningEffort: "medium",
					enableReasoningEffort: true,
				}),
			)
		})

		test("4. 10 consecutive model switches: each succeeds on a single click without dropped selection", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "xkiro",
				apiModelId: "model-0",
				xkiroModelId: "model-0",
			}
			const modelList = Array.from({ length: 10 }, (_, i) => `custom/batch-model-${i}`)
			mockExtensionState.openAiModels = modelList

			const { unmount } = render(<ModelSelector />)

			for (let i = 0; i < 10; i++) {
				fireEvent.click(screen.getByTestId("model-selector-trigger"))
				const item = screen.getByText(`Batch Model ${i}`)
				fireEvent.click(item)

				expect(mockSetApiConfiguration).toHaveBeenLastCalledWith(
					expect.objectContaining({
						apiModelId: `custom/batch-model-${i}`,
					}),
				)
			}

			expect(mockSetApiConfiguration).toHaveBeenCalledTimes(10)
			unmount()
		})

		test("5. Exact regression test: Model A High -> Model B click once never requires second click and preserves High", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "openai",
				apiModelId: "openai/o3-mini",
				openAiModelId: "openai/o3-mini",
				reasoningEffort: "high",
				enableReasoningEffort: true,
			}
			mockExtensionState.openAiModels = ["openai/o3-mini", "anthropic/claude-3.7-sonnet"]
			mockExtensionState.openAiModelInfos = {
				"openai/o3-mini": { supportsReasoningEffort: true },
				"anthropic/claude-3.7-sonnet": { supportsReasoningEffort: true },
			}

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			// FIRST CLICK on Claude 3.7 Sonnet
			const claudeItem = screen.getByText("Claude 3.7 Sonnet")
			fireEvent.click(claudeItem)

			// Must IMMEDIATELY switch to Claude 3.7 Sonnet with High effort in a single dispatch
			expect(mockSetApiConfiguration).toHaveBeenCalledTimes(1)
			expect(mockSetApiConfiguration).toHaveBeenCalledWith({
				apiProvider: "openai",
				apiModelId: "anthropic/claude-3.7-sonnet",
				openAiModelId: "anthropic/claude-3.7-sonnet",
				reasoningEffort: "high",
				enableReasoningEffort: true,
			})
			// Must post message to backend with the target model and High effort
			expect(vscode.postMessage).toHaveBeenCalledTimes(1)
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "upsertApiConfiguration",
				text: "default",
				apiConfiguration: {
					apiProvider: "openai",
					apiModelId: "anthropic/claude-3.7-sonnet",
					openAiModelId: "anthropic/claude-3.7-sonnet",
					reasoningEffort: "high",
					enableReasoningEffort: true,
				},
			})
		})
	})

	describe("Canonical Model Deduplication", () => {
		test("getCanonicalModelKey normalizes vendor prefixes and preserves variants/tags", () => {
			expect(getCanonicalModelKey("xkiro", "openai/gpt-6.1-sol")).toBe("xkiro:gpt-6.1-sol")
			expect(getCanonicalModelKey("xkiro", "gpt-6.1-sol")).toBe("xkiro:gpt-6.1-sol")
			expect(getCanonicalModelKey("xkiro", "qwen/qwen3.8-max:free")).toBe("xkiro:qwen3.8-max:free")
			expect(getCanonicalModelKey("xkiro", "qwen3.8-max:free")).toBe("xkiro:qwen3.8-max:free")
			expect(getCanonicalModelKey("xkiro", "qwen/qwen3.8-max")).toBe("xkiro:qwen3.8-max")
			// Tags are preserved and differ
			expect(getCanonicalModelKey("xkiro", "qwen3.8-max:free")).not.toBe(
				getCanonicalModelKey("xkiro", "qwen3.8-max"),
			)
			// Providers are distinguished
			expect(getCanonicalModelKey("xkiro", "gpt-4o")).not.toBe(getCanonicalModelKey("openai", "gpt-4o"))
		})

		test("xKiro deduplicates vendor-namespaced and bare model IDs in available models list", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "xkiro",
				apiModelId: "deepseek/deepseek-chat",
				xkiroModelId: "deepseek/deepseek-chat",
			}
			// Simulate dynamic API returning both namespaced and bare models
			mockExtensionState.openAiModels = [
				"openai/gpt-6.1-sol",
				"gpt-6.1-sol",
				"openai/gpt-6-sol",
				"gpt-6-sol",
			]

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			// Search for "sol"
			const searchInput = screen.getByPlaceholderText("chat:modelSelector.searchPlaceholder")
			fireEvent.change(searchInput, { target: { value: "sol" } })

			// Each unique canonical model should appear exactly once in the rendered list
			const sol61 = screen.getAllByText("GPT-6.1 Sol")
			expect(sol61.length).toBe(1)

			const sol6 = screen.getAllByText("GPT-6 Sol")
			expect(sol6.length).toBe(1)
		})
	})

	describe("Recently Used Models", () => {
		test("displays recently used models under 'Recently used' header", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "xkiro",
				apiModelId: "deepseek/deepseek-chat",
				xkiroModelId: "deepseek/deepseek-chat",
			}
			mockExtensionState.recentModels = [
				{
					id: "anthropic/claude-3.7-sonnet",
					provider: "xkiro",
					name: "Claude 3.7 Sonnet",
					timestamp: Date.now(),
				},
				{
					id: "openai/gpt-6-astra",
					provider: "xkiro",
					name: "GPT-6 Astra",
					timestamp: Date.now() - 1000,
				},
			]

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			expect(screen.getByText("Recently used")).toBeInTheDocument()
			expect(screen.getByText("2 models")).toBeInTheDocument()
		})

		test("caps recently used models at maximum 5 items in MRU order", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "xkiro",
				apiModelId: "deepseek/deepseek-chat",
				xkiroModelId: "deepseek/deepseek-chat",
			}
			mockExtensionState.recentModels = [
				{ id: "anthropic/claude-3.7-sonnet", provider: "xkiro", name: "Claude 3.7 Sonnet", timestamp: 50 },
				{ id: "anthropic/claude-3.5-sonnet", provider: "xkiro", name: "Claude 3.5 Sonnet", timestamp: 40 },
				{ id: "openai/gpt-6-astra", provider: "xkiro", name: "GPT-6 Astra", timestamp: 30 },
				{ id: "openai/gpt-5", provider: "xkiro", name: "GPT-5", timestamp: 20 },
				{ id: "openai/gpt-4o", provider: "xkiro", name: "GPT-4o", timestamp: 10 },
				{ id: "google/gemini-2.5-pro", provider: "xkiro", name: "Gemini 2.5 Pro", timestamp: 5 },
			]

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			expect(screen.getByText("5 models")).toBeInTheDocument()
		})

		test("prunes stale catalog models not present in available models list", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "xkiro",
				apiModelId: "deepseek/deepseek-chat",
				xkiroModelId: "deepseek/deepseek-chat",
			}
			mockExtensionState.recentModels = [
				{
					id: "non-existent-retired-model",
					provider: "xkiro",
					name: "Retired Model",
					timestamp: 10,
				},
				{
					id: "anthropic/claude-3.7-sonnet",
					provider: "xkiro",
					name: "Claude 3.7 Sonnet",
					timestamp: 20,
				},
			]

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			expect(screen.getByText("Recently used")).toBeInTheDocument()
			expect(screen.getByText("1 model")).toBeInTheDocument()
			expect(screen.queryByText("Retired Model")).not.toBeInTheDocument()
		})

		test("filters recently used models when user searches", () => {
			mockExtensionState.apiConfiguration = {
				apiProvider: "xkiro",
				apiModelId: "deepseek/deepseek-chat",
				xkiroModelId: "deepseek/deepseek-chat",
			}
			mockExtensionState.recentModels = [
				{
					id: "anthropic/claude-3.7-sonnet",
					provider: "xkiro",
					name: "Claude 3.7 Sonnet",
					timestamp: 10,
				},
			]

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			expect(screen.getByText("Recently used")).toBeInTheDocument()

			const searchInput = screen.getByPlaceholderText("chat:modelSelector.searchPlaceholder")
			fireEvent.change(searchInput, { target: { value: "gemini" } })

			// When query doesn't match, Recently used header should be completely hidden
			expect(screen.queryByText("Recently used")).not.toBeInTheDocument()
		})
	})

	describe("Legacy API Configuration Removal", () => {
		test("does not render legacy API CONFIGURATION or API Profiles section in model picker", () => {
			mockExtensionState.listApiConfigMeta = [
				{ id: "cfg-1", name: "default", modelId: "deepseek/deepseek-chat" },
				{ id: "cfg-2", name: "custom-profile", modelId: "gpt-4o" },
			]

			render(<ModelSelector />)
			fireEvent.click(screen.getByTestId("model-selector-trigger"))

			expect(screen.queryByText("API Profiles")).not.toBeInTheDocument()
			expect(screen.queryByText("API CONFIGURATION")).not.toBeInTheDocument()
			expect(screen.queryByText(/Configure API & providers in Settings/i)).not.toBeInTheDocument()
			expect(screen.getByPlaceholderText("Enter custom model ID...")).toBeInTheDocument()
		})
	})
})
