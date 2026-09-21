import { render, screen, fireEvent } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"
import { AutoApproveDropdown } from "../AutoApproveDropdown"

const mockPostMessage = vi.fn()

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/components/ui/hooks/useRooPortal", () => ({
	useRooPortal: () => document.body,
}))

vi.mock("@/components/ui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/components/ui")>()
	return {
		...actual,
		StandardTooltip: ({ children, content }: any) => (
			<>
				{children}
				<div data-testid="standard-tooltip-content">{content}</div>
			</>
		),
	}
})

let mockState: any = {}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockState,
}))

vi.mock("@/hooks/useAutoApprovalToggles", () => ({
	useAutoApprovalToggles: () => ({
		alwaysAllowReadOnly: !!mockState.alwaysAllowReadOnly,
		alwaysAllowWrite: !!mockState.alwaysAllowWrite,
		alwaysAllowExecute: !!mockState.alwaysAllowExecute,
		alwaysAllowMcp: !!mockState.alwaysAllowMcp,
		alwaysAllowModeSwitch: !!mockState.alwaysAllowModeSwitch,
		alwaysAllowSubtasks: !!mockState.alwaysAllowSubtasks,
		alwaysAllowFollowupQuestions: !!mockState.alwaysAllowFollowupQuestions,
	}),
}))

describe("AutoApproveDropdown", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
		mockState = {
			autoApprovalEnabled: true,
			alwaysAllowReadOnly: false,
			alwaysAllowWrite: false,
			alwaysAllowExecute: false,
			alwaysAllowMcp: false,
			alwaysAllowModeSwitch: false,
			alwaysAllowSubtasks: false,
			alwaysAllowFollowupQuestions: false,
			commandSafetyConfig: {
				enabled: false,
				provider: "openai",
				modelId: "",
			},
			apiConfiguration: {},
			setAutoApprovalEnabled: vi.fn(),
			setAlwaysAllowReadOnly: vi.fn(),
			setAlwaysAllowWrite: vi.fn(),
			setAlwaysAllowExecute: vi.fn(),
			setAlwaysAllowMcp: vi.fn(),
			setAlwaysAllowModeSwitch: vi.fn(),
			setAlwaysAllowSubtasks: vi.fn(),
			setAlwaysAllowFollowupQuestions: vi.fn(),
		}
	})

	test("alwaysAllowExecute toggle is disabled when !isSafetyModelConfigured(state)", () => {
		render(<AutoApproveDropdown />)
		fireEvent.click(screen.getByTestId("auto-approve-dropdown-trigger"))

		const executeToggle = screen.getByTestId("auto-approve-alwaysAllowExecute")
		expect(executeToggle).toBeDisabled()
		expect(screen.getByTestId("requires-safety-model-badge")).toBeInTheDocument()
		expect(screen.getByText("Requires Safety Model")).toBeInTheDocument()
	})

	test("tooltip contains the warning requirement and settings button when safety model is not configured", () => {
		const postMessageSpy = vi.spyOn(window, "postMessage")
		render(<AutoApproveDropdown />)
		fireEvent.click(screen.getByTestId("auto-approve-dropdown-trigger"))

		expect(
			screen.getByText("settings:autoApprove.requiresSafetyModel"),
		).toBeInTheDocument()
		const openSettingsBtn = screen.getByText("chat:openSettings")
		expect(openSettingsBtn).toBeInTheDocument()

		fireEvent.click(openSettingsBtn)
		expect(postMessageSpy).toHaveBeenCalledWith(
			{ type: "action", action: "settingsButtonClicked", values: { section: "autoApprove" } },
			"*",
		)
		postMessageSpy.mockRestore()
	})

	test("Select All does not enable alwaysAllowExecute when safety model is not configured", () => {
		render(<AutoApproveDropdown />)
		fireEvent.click(screen.getByTestId("auto-approve-dropdown-trigger"))

		const selectAllButton = screen.getByLabelText("chat:autoApprove.selectAll")
		fireEvent.click(selectAllButton)

		// Verify alwaysAllowExecute was NOT posted
		const executeCalls = mockPostMessage.mock.calls.filter(
			([msg]: any) => msg?.type === "updateSettings" && msg?.updatedSettings?.alwaysAllowExecute !== undefined,
		)
		expect(executeCalls).toHaveLength(0)

		// Verify other settings were enabled
		const writeCalls = mockPostMessage.mock.calls.filter(
			([msg]: any) => msg?.type === "updateSettings" && msg?.updatedSettings?.alwaysAllowWrite === true,
		)
		expect(writeCalls.length).toBeGreaterThan(0)
	})

	test("Execute toggle is enabled when isSafetyModelConfigured(state) === true", () => {
		mockState.commandSafetyConfig = {
			enabled: true,
			provider: "openai",
			modelId: "gpt-4o-mini",
			apiKey: "test-api-key",
		}

		render(<AutoApproveDropdown />)
		fireEvent.click(screen.getByTestId("auto-approve-dropdown-trigger"))

		const executeToggle = screen.getByTestId("auto-approve-alwaysAllowExecute")
		expect(executeToggle).not.toBeDisabled()
		expect(screen.queryByTestId("requires-safety-model-badge")).not.toBeInTheDocument()

		fireEvent.click(executeToggle)
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: { alwaysAllowExecute: true },
		})
	})
})
