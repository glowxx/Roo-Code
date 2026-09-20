import React, { Component, type ReactNode, type ErrorInfo } from "react"

export const CRASH_DICTIONARY = {
	en: {
		title: "An error occurred while initializing the view",
		unknownError: "Unknown error occurred while mounting component.",
		description:
			"The application encountered an unexpected problem during view hydration or rendering. We don't leave you with a blank screen — you can safely reload the view or reset state.",
		errorMessage: "Error message",
		reloadView: "Reload view",
		clearAndReload: "Clear state & refresh",
		hideDetails: "Hide technical details ▲",
		showDetails: "Show technical details ▼",
	},
	pl: {
		title: "Wystąpił błąd podczas inicjalizacji widoku",
		unknownError: "Nieznany błąd podczas montowania komponentu.",
		description:
			"Aplikacja napotkała nieoczekiwany problem podczas hydratacji lub renderowania widoku. Nie pozostawiamy Cię z czarnym ekranem — możesz bezpiecznie przeładować widok lub zresetować stan.",
		errorMessage: "Komunikat błędu",
		reloadView: "Przeładuj widok",
		clearAndReload: "Wyczyść stan i odśwież",
		hideDetails: "Ukryj szczegóły techniczne ▲",
		showDetails: "Pokaż szczegóły techniczne ▼",
	},
} as const

export type CrashLanguage = keyof typeof CRASH_DICTIONARY

export function resolveCrashLanguage(explicitLanguage?: string): CrashLanguage {
	if (explicitLanguage) {
		const norm = explicitLanguage.toLowerCase()
		if (norm.startsWith("pl")) return "pl"
		if (norm.startsWith("en")) return "en"
	}

	try {
		const vscodeStateStr = localStorage.getItem("vscodeState")
		if (vscodeStateStr) {
			const parsed = JSON.parse(vscodeStateStr)
			if (typeof parsed?.language === "string") {
				const lang = parsed.language.toLowerCase()
				if (lang.startsWith("pl")) return "pl"
				if (lang.startsWith("en")) return "en"
			}
		}
	} catch {
		// Ignore storage errors
	}

	try {
		const rooLang = localStorage.getItem("roo-language")
		if (rooLang) {
			const lang = rooLang.toLowerCase()
			if (lang.startsWith("pl")) return "pl"
			if (lang.startsWith("en")) return "en"
		}
	} catch {
		// Ignore storage errors
	}

	try {
		if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
			if (navigator.language.toLowerCase().startsWith("pl")) {
				return "pl"
			}
		}
	} catch {
		// Ignore navigator errors
	}

	return "en"
}

interface CrashBoundaryProps {
	children: ReactNode
	fallbackTitle?: string
	language?: string
}

interface CrashBoundaryState {
	hasError: boolean
	error: Error | null
	errorInfo: ErrorInfo | null
	showDetails: boolean
}

export class CrashBoundary extends Component<CrashBoundaryProps, CrashBoundaryState> {
	constructor(props: CrashBoundaryProps) {
		super(props)
		this.state = {
			hasError: false,
			error: null,
			errorInfo: null,
			showDetails: false,
		}
	}

	static getDerivedStateFromError(error: Error): Partial<CrashBoundaryState> {
		return {
			hasError: true,
			error,
		}
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error("[CrashBoundary] Caught unhandled error in React root:", error, errorInfo)
		this.setState({
			error,
			errorInfo,
		})
	}

	handleReload = (): void => {
		try {
			window.location.reload()
		} catch {
			// Fallback if location.reload fails
			window.location.href = window.location.href
		}
	}

	handleResetAndReload = (): void => {
		try {
			localStorage.removeItem("vscodeState")
			localStorage.removeItem("roo-theme")
			sessionStorage.clear()
		} catch (e) {
			console.warn("[CrashBoundary] Failed to clear storage:", e)
		}
		this.handleReload()
	}

	toggleDetails = (): void => {
		this.setState((prev) => ({ showDetails: !prev.showDetails }))
	}

	render(): ReactNode {
		if (!this.state.hasError) {
			return this.props.children
		}

		const { error, errorInfo, showDetails } = this.state
		const lang = resolveCrashLanguage(this.props.language)
		const dict = CRASH_DICTIONARY[lang] || CRASH_DICTIONARY.en

		const title = this.props.fallbackTitle || dict.title
		const errorMessage = error?.message || (error ? String(error) : dict.unknownError)
		const errorStack = error?.stack || ""
		const componentStack = errorInfo?.componentStack || ""

		return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					minHeight: "100vh",
					width: "100%",
					backgroundColor: "var(--vscode-editor-background, #090a0f)",
					color: "var(--vscode-foreground, #f2f4f7)",
					fontFamily:
						'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
					fontSize: "var(--vscode-font-size, 13px)",
					padding: "32px 20px",
					boxSizing: "border-box",
					textAlign: "center",
				}}>
				<div
					style={{
						maxWidth: "540px",
						width: "100%",
						backgroundColor: "var(--vscode-input-background, #12141c)",
						border: "1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.1))",
						borderRadius: "12px",
						padding: "28px 24px",
						boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
					}}>
					{/* Error Icon */}
					<div
						style={{
							width: "48px",
							height: "48px",
							borderRadius: "12px",
							backgroundColor: "rgba(240, 68, 56, 0.15)",
							color: "var(--vscode-errorForeground, #f04438)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							marginBottom: "16px",
							border: "1px solid rgba(240, 68, 56, 0.3)",
						}}>
						<svg
							width="26"
							height="26"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round">
							<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
							<line x1="12" y1="9" x2="12" y2="13" />
							<line x1="12" y1="17" x2="12.01" y2="17" />
						</svg>
					</div>

					{/* Title */}
					<h2
						style={{
							fontSize: "17px",
							fontWeight: 600,
							margin: "0 0 8px 0",
							color: "var(--vscode-foreground, #f8fafc)",
							letterSpacing: "-0.01em",
						}}>
						{title}
					</h2>

					{/* Description */}
					<p
						style={{
							fontSize: "13px",
							color: "var(--vscode-descriptionForeground, #98a2b3)",
							margin: "0 0 20px 0",
							lineHeight: "1.5",
						}}>
						{dict.description}
					</p>

					{/* Error snippet */}
					<div
						style={{
							width: "100%",
							backgroundColor: "rgba(0, 0, 0, 0.25)",
							border: "1px solid rgba(255, 255, 255, 0.08)",
							borderRadius: "8px",
							padding: "10px 14px",
							marginBottom: "20px",
							textAlign: "left",
							overflow: "hidden",
						}}>
						<div
							style={{
								fontSize: "11px",
								fontWeight: 600,
								textTransform: "uppercase",
								color: "var(--vscode-errorForeground, #f04438)",
								marginBottom: "4px",
							}}>
							{dict.errorMessage}
						</div>
						<div
							style={{
								fontFamily:
									'var(--vscode-editor-font-family, "JetBrains Mono", Menlo, Consolas, monospace)',
								fontSize: "12px",
								color: "var(--vscode-foreground, #e4e7ec)",
								wordBreak: "break-word",
								lineHeight: "1.4",
							}}>
							{errorMessage}
						</div>
					</div>

					{/* Action Buttons */}
					<div
						style={{
							display: "flex",
							gap: "10px",
							width: "100%",
							justifyContent: "center",
							flexWrap: "wrap",
						}}>
						<button
							type="button"
							onClick={this.handleReload}
							style={{
								minHeight: "36px",
								padding: "8px 18px",
								fontSize: "13px",
								fontWeight: 600,
								backgroundColor: "var(--vscode-button-background, #2563eb)",
								color: "var(--vscode-button-foreground, #ffffff)",
								border: "none",
								borderRadius: "8px",
								cursor: "pointer",
								display: "inline-flex",
								alignItems: "center",
								gap: "6px",
								transition: "opacity 0.15s ease",
							}}>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round">
								<polyline points="23 4 23 10 17 10" />
								<polyline points="1 20 1 14 7 14" />
								<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
							</svg>
							<span>{dict.reloadView}</span>
						</button>

						<button
							type="button"
							onClick={this.handleResetAndReload}
							style={{
								minHeight: "36px",
								padding: "8px 16px",
								fontSize: "13px",
								fontWeight: 500,
								backgroundColor: "var(--vscode-button-secondaryBackground, #181b26)",
								color: "var(--vscode-button-secondaryForeground, #f2f4f7)",
								border: "1px solid rgba(255, 255, 255, 0.1)",
								borderRadius: "8px",
								cursor: "pointer",
								transition: "background 0.15s ease",
							}}>
							{dict.clearAndReload}
						</button>
					</div>

					{/* Toggle Technical Details */}
					{(errorStack || componentStack) && (
						<div style={{ marginTop: "18px", width: "100%" }}>
							<button
								type="button"
								onClick={this.toggleDetails}
								style={{
									background: "none",
									border: "none",
									color: "var(--vscode-textLink-foreground, #60a5fa)",
									fontSize: "11.5px",
									cursor: "pointer",
									textDecoration: "underline",
									padding: "4px",
								}}>
								{showDetails ? dict.hideDetails : dict.showDetails}
							</button>

							{showDetails && (
								<div
									style={{
										marginTop: "10px",
										maxHeight: "180px",
										overflowY: "auto",
										backgroundColor: "rgba(0, 0, 0, 0.4)",
										borderRadius: "6px",
										padding: "10px",
										textAlign: "left",
										fontFamily:
											'var(--vscode-editor-font-family, "JetBrains Mono", Menlo, Consolas, monospace)',
										fontSize: "11px",
										color: "var(--vscode-descriptionForeground, #98a2b3)",
										lineHeight: "1.4",
										border: "1px solid rgba(255, 255, 255, 0.06)",
									}}>
									{errorStack && (
										<div>
											<strong style={{ color: "var(--vscode-foreground, #f8fafc)" }}>
												Error Stack:
											</strong>
											<pre style={{ margin: "4px 0 10px 0", whiteSpace: "pre-wrap" }}>
												{errorStack}
											</pre>
										</div>
									)}
									{componentStack && (
										<div>
											<strong style={{ color: "var(--vscode-foreground, #f8fafc)" }}>
												Component Stack:
											</strong>
											<pre style={{ margin: "4px 0 0 0", whiteSpace: "pre-wrap" }}>
												{componentStack}
											</pre>
										</div>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		)
	}
}

export default CrashBoundary
