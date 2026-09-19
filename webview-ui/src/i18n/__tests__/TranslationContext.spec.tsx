import React from "react"
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import i18next from "../setup"
import { TranslationProvider, useAppTranslation } from "../TranslationContext"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

const TestConsumer: React.FC<{ keys: string[] }> = ({ keys }) => {
	const { t } = useAppTranslation()
	return (
		<div>
			{keys.map((key) => (
				<div key={key} data-testid={key}>
					{t(key)}
				</div>
			))}
		</div>
	)
}

const renderWithContext = (language: string, keys: string[]) => {
	const mockExtensionState: any = {
		language,
	}

	return render(
		<ExtensionStateContext.Provider
			value={{
				...mockExtensionState,
				didHydrateState: true,
				showWelcome: false,
				theme: {},
				mcpServers: [],
				filePaths: [],
			}}>
			<TranslationProvider>
				<TestConsumer keys={keys} />
			</TranslationProvider>
		</ExtensionStateContext.Provider>,
	)
}

describe("TranslationContext and i18n setup", () => {
	beforeEach(async () => {
		await act(async () => {
			await i18next.changeLanguage("en")
		})
	})

	it("translates footer keys in English with and without settings namespace prefix", async () => {
		const keys = [
			"settings:footer.unsavedChanges",
			"footer.unsavedChanges",
			"settings:footer.allChangesSaved",
			"footer.allChangesSaved",
			"settings:footer.discard",
			"footer.discard",
			"settings:footer.save",
			"footer.save",
		]

		renderWithContext("en", keys)

		expect(screen.getByTestId("settings:footer.unsavedChanges")).toHaveTextContent("Unsaved changes")
		expect(screen.getByTestId("footer.unsavedChanges")).toHaveTextContent("Unsaved changes")
		expect(screen.getByTestId("settings:footer.allChangesSaved")).toHaveTextContent("All changes saved")
		expect(screen.getByTestId("footer.allChangesSaved")).toHaveTextContent("All changes saved")
		expect(screen.getByTestId("settings:footer.discard")).toHaveTextContent("Discard")
		expect(screen.getByTestId("footer.discard")).toHaveTextContent("Discard")
		expect(screen.getByTestId("settings:footer.save")).toHaveTextContent("Save Settings")
		expect(screen.getByTestId("footer.save")).toHaveTextContent("Save Settings")
	})

	it("translates footer keys in Polish with and without settings namespace prefix", async () => {
		const keys = [
			"settings:footer.unsavedChanges",
			"footer.unsavedChanges",
			"settings:footer.allChangesSaved",
			"footer.allChangesSaved",
			"settings:footer.discard",
			"footer.discard",
			"settings:footer.save",
			"footer.save",
		]

		renderWithContext("pl", keys)

		expect(screen.getByTestId("settings:footer.unsavedChanges")).toHaveTextContent("Niezapisane zmiany")
		expect(screen.getByTestId("footer.unsavedChanges")).toHaveTextContent("Niezapisane zmiany")
		expect(screen.getByTestId("settings:footer.allChangesSaved")).toHaveTextContent("Wszystkie zmiany zapisane")
		expect(screen.getByTestId("footer.allChangesSaved")).toHaveTextContent("Wszystkie zmiany zapisane")
		expect(screen.getByTestId("settings:footer.discard")).toHaveTextContent("Odrzuć zmiany")
		expect(screen.getByTestId("footer.discard")).toHaveTextContent("Odrzuć zmiany")
		expect(screen.getByTestId("settings:footer.save")).toHaveTextContent("Zapisz ustawienia")
		expect(screen.getByTestId("footer.save")).toHaveTextContent("Zapisz ustawienia")
	})
})
