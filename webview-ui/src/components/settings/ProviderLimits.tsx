import { useCallback, useEffect, useRef, useState } from "react"
import type { ProviderLimits as ProviderLimitsData } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"

export function ProviderLimits() {
	const { t } = useAppTranslation()
	const [limits, setLimits] = useState<ProviderLimitsData>()
	const [loading, setLoading] = useState(true)
	const latestRequestId = useRef("")
	const requestCounter = useRef(0)
	const request = useCallback((refresh = false) => {
		setLoading(true)
		const requestId = `${Date.now()}-${++requestCounter.current}`
		latestRequestId.current = requestId
		vscode.postMessage({ type: "requestProviderLimits", bool: refresh, requestId })
	}, [])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.data?.type !== "providerLimits" || event.data.requestId !== latestRequestId.current) return
			setLimits(event.data.providerLimits)
			setLoading(false)
		}
		window.addEventListener("message", onMessage)
		request()
		return () => window.removeEventListener("message", onMessage)
	}, [request])

	const label = (field: string) => t(`settings:limits.${field}`)
	return (
		<section id="section-limits" className="bg-card border border-border rounded-xl p-5 shadow-xs space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-sm font-semibold text-vscode-foreground m-0">{label("title")}</h3>
					<p className="text-xs text-vscode-descriptionForeground mt-1 mb-0">{label("description")}</p>
				</div>
				<Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => request(true)}>
					{label("refresh")}
				</Button>
			</div>
			<div aria-live="polite" className="text-sm">
				{loading && !limits ? <p>{label("loading")}</p> : null}
				{limits ? (
					<>
						<p className="m-0 font-medium">
							{label("provider")}: {limits.provider === "xkiro" ? "xKiro" : limits.provider}
						</p>
						{limits.status === "unsupported" && <p>{label("unsupported")}</p>}
						{limits.status === "missing_auth" && <p>{label("missingAuth")}</p>}
						{limits.status === "auth_error" && <p>{label("authError")}</p>}
						{limits.status === "error" && <p role="alert">{label("error")}</p>}
						{(limits.status === "supported" || limits.status === "partial") && (
							<div className="space-y-3 mt-3">
								{limits.plan && (
									<p className="m-0">
										{label("plan")}: {limits.plan}
									</p>
								)}
								{limits.windows?.map((window, index) => (
									<div
										key={`${window.kind}-${index}`}
										className="rounded-md border border-border p-3 space-y-1">
										<p className="font-medium m-0">
											{window.kind}
											{window.windowSeconds ? ` · ${window.windowSeconds / 3600} h` : ""}
										</p>
										{window.spentUsd !== undefined && (
											<p className="m-0">
												{label("spent")}: ${window.spentUsd}
											</p>
										)}
										{window.capUsd !== undefined && (
											<p className="m-0">
												{label("cap")}: ${window.capUsd}
											</p>
										)}
										{window.remainingUsd !== undefined && (
											<p className="m-0">
												{label("remaining")}: ${window.remainingUsd}
											</p>
										)}
										{window.resetAt !== undefined && (
											<p className="m-0">
												{label("reset")}: {new Date(window.resetAt).toLocaleString()}
											</p>
										)}
									</div>
								))}
								{limits.freeTokens && (
									<div className="rounded-md border border-border p-3">
										<p className="font-medium m-0">{label("freeTokens")}</p>
										{limits.freeTokens.usedToday !== undefined && (
											<p className="m-0">
												{label("usedToday")}: {limits.freeTokens.usedToday.toLocaleString()}
											</p>
										)}
										{limits.freeTokens.limitPerDay !== undefined && (
											<p className="m-0">
												{label("dailyLimit")}: {limits.freeTokens.limitPerDay.toLocaleString()}
											</p>
										)}
										{limits.freeTokens.remaining !== undefined && (
											<p className="m-0">
												{label("remaining")}: {limits.freeTokens.remaining.toLocaleString()}
											</p>
										)}
									</div>
								)}
								{limits.wallet && (
									<div className="rounded-md border border-border p-3">
										<p className="font-medium m-0">{label("wallet")}</p>
										{limits.wallet.balanceUsd !== undefined && (
											<p className="m-0">
												{label("balance")}: ${limits.wallet.balanceUsd}
											</p>
										)}
										{limits.wallet.heldUsd !== undefined && (
											<p className="m-0">
												{label("held")}: ${limits.wallet.heldUsd}
											</p>
										)}
									</div>
								)}
								<p className="text-xs text-vscode-descriptionForeground m-0">
									{label("rateLimitUnavailable")}
								</p>
								{limits.fetchedAt && (
									<p className="text-xs text-vscode-descriptionForeground m-0">
										{label("updated")}: {new Date(limits.fetchedAt).toLocaleString()}
									</p>
								)}
							</div>
						)}
					</>
				) : null}
			</div>
		</section>
	)
}
