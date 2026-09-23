import { useCallback } from "react"
import { useTranslation, Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { buildDocLink } from "../../utils/docLinks"
import { openSettings } from "../../utils/settingsNavigation"

export const CommandExecutionError = () => {
	const { t } = useTranslation()

	const onClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault()
		openSettings({ section: "terminal", source: "command_execution_error" })
	}, [])

	return (
		<div className="text-sm bg-vscode-editor-background border border-vscode-border rounded-lg p-3 ml-6">
			<div className="flex flex-col gap-2">
				<div className="flex items-center">
					<i className="codicon codicon-warning mr-1 text-vscode-editorWarning-foreground" />
					<span className="text-vscode-editorWarning-foreground font-semibold">
						{t("chat:shellIntegration.title")}
					</span>
				</div>
				<div>
					<Trans
						i18nKey="chat:shellIntegration.description"
						components={{
							settingsLink: <VSCodeLink href="#" onClick={onClick} className="inline" />,
						}}
					/>
				</div>
				<a
					href={buildDocLink("troubleshooting/shell-integration/", "error_tooltip")}
					className="underline"
					style={{ color: "inherit" }}>
					{t("chat:shellIntegration.troubleshooting")}
				</a>
			</div>
		</div>
	)
}
