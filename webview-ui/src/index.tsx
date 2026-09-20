import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./i18n/setup"
import "./index.css"
import App from "./App"
import "../node_modules/@vscode/codicons/dist/codicon.css"
import { CrashBoundary } from "./components/CrashBoundary"

import { getHighlighter } from "./utils/highlighter"

// Initialize Shiki early to hide initialization latency (async)
getHighlighter().catch((error: Error) => console.error("Failed to initialize Shiki highlighter:", error))

// Window-level safety net for errors occurring before or outside React rendering
window.addEventListener("error", (event) => {
	const rootEl = document.getElementById("root")
	if (rootEl && rootEl.childNodes.length === 0) {
		console.error("[Root Error] Uncaught error before React mounted:", event.error || event.message)
		let isPl = false
		try {
			const vscodeStateStr = localStorage.getItem("vscodeState")
			if (vscodeStateStr) {
				const parsed = JSON.parse(vscodeStateStr)
				if (typeof parsed?.language === "string" && parsed.language.toLowerCase().startsWith("pl")) {
					isPl = true
				}
			}
			if (!isPl) {
				const rooLang = localStorage.getItem("roo-language")
				if (rooLang && rooLang.toLowerCase().startsWith("pl")) {
					isPl = true
				}
			}
			if (!isPl && typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pl")) {
				isPl = true
			}
		} catch {
			// ignore storage access errors
		}

		const title = isPl ? "Wystąpił błąd podczas inicjalizacji widoku" : "An error occurred while initializing the view"
		const desc = isPl
			? "Nie udało się uruchomić aplikacji. Kliknij poniżej, aby przeładować stronę."
			: "Failed to start the application. Click below to reload the page."
		const reloadBtn = isPl ? "Przeładuj widok" : "Reload view"

		rootEl.innerHTML = `
			<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;width:100%;background-color:#090a0f;color:#f2f4f7;font-family:-apple-system,sans-serif;padding:24px;box-sizing:border-box;text-align:center;">
				<div style="max-width:480px;background:#12141c;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:28px 24px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
					<div style="font-size:32px;margin-bottom:12px;">⚠️</div>
					<h2 style="font-size:16px;margin:0 0 8px 0;font-weight:600;">${title}</h2>
					<p style="font-size:13px;color:#98a2b3;margin:0 0 16px 0;line-height:1.4;">${desc}</p>
					<button onclick="window.location.reload()" style="padding:8px 18px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">${reloadBtn}</button>
				</div>
			</div>
		`
	}
})

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<CrashBoundary>
			<App />
		</CrashBoundary>
	</StrictMode>,
)
