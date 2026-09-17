import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type XKiroProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
}

export const XKiro = ({ apiConfiguration, setApiConfigurationField }: XKiroProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.xkiroApiKey || apiConfiguration?.apiKey || ""}
				type="password"
				onInput={handleInputChange("xkiroApiKey")}
				placeholder="Wklej klucz API xKiro (xkiro-...)"
				className="w-full">
				<label className="block font-medium mb-1">Klucz API xKiro (xKiro API Key)</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				Klucz API jest bezpiecznie przechowywany w lokalnym magazynie sekretów.
			</div>
			<VSCodeTextField
				value={apiConfiguration?.xkiroBaseUrl || "https://api.xkiro.com/v1"}
				onInput={handleInputChange("xkiroBaseUrl")}
				placeholder="https://api.xkiro.com/v1"
				className="w-full">
				<label className="block font-medium mb-1">Adres Bazowy API (Base URL)</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				Domyślny adres bramki xKiro: <code>https://api.xkiro.com/v1</code>
			</div>
			{!apiConfiguration?.xkiroApiKey && !apiConfiguration?.apiKey && (
				<VSCodeButtonLink href="https://xkiro.com" appearance="secondary">
					🎁 Odbierz darmowe tokeny na xkiro.com
				</VSCodeButtonLink>
			)}
		</>
	)
}
