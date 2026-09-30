import { render, screen } from "@testing-library/react"
import { XKiro } from "../providers/XKiro"

vi.mock("@src/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t: (key: string) => key }) }))

describe("xKiro settings", () => {
	it("has no promo field or description with legacy settings", () => {
		render(
			<XKiro
				apiConfiguration={{ apiProvider: "xkiro", xkiroApiKey: "key", ...{ xkiroDiscountMultiplier: 0.5 } }}
				setApiConfigurationField={vi.fn()}
			/>,
		)
		expect(screen.queryByText(/Promo \/ Discount Multiplier/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Multiplier applied to token prices/)).not.toBeInTheDocument()
		expect(screen.getByText("Custom Context Window (Optional)")).toBeInTheDocument()
		expect(screen.getByText("Test Connection")).toBeInTheDocument()
	})
})
