import { useCallback, useEffect, useRef, useState } from "react"
import type { ProviderLimits as LimitsData } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"

type WindowData = NonNullable<LimitsData["windows"]>[number]

const money = (raw?: string) => {
	if (raw === undefined || !/^\d+(?:\.\d+)?$/.test(raw)) return undefined
	const amount = Number(raw)
	return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount) : undefined
}
const tokens = (value?: number) =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? new Intl.NumberFormat().format(value) : undefined
const percentUsed = (used?: number, cap?: number) => {
	if (used === undefined || cap === undefined || !Number.isFinite(used) || !Number.isFinite(cap) || used < 0 || cap <= 0) return undefined
	const ratio = used / cap
	const percentage = ratio * 100
	return Number.isFinite(percentage) ? Number(percentage.toFixed(1)) : undefined
}
const validDate = (timestamp?: number) =>
	typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 && Number.isFinite(new Date(timestamp).getTime())
		? new Date(timestamp) : undefined

function UsageBar({ percent, label }: { percent?: number; label: string }) {
	if (percent === undefined) return null
	const fill = percent >= 95 ? "bg-destructive" : percent >= 80 ? "bg-vscode-editorWarning-foreground" : "bg-primary"
	return <div className="space-y-1.5">
		<div className="h-2 rounded-full bg-vscode-editor-background overflow-hidden" role="progressbar"
			aria-label={label} aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100}>
			<div className={"h-full rounded-full " + fill} style={{ width: Math.min(percent, 100) + "%" }} />
		</div>
		<p className="m-0 text-xs text-vscode-descriptionForeground text-right">{percent.toFixed(1)}%</p>
	</div>
}

export function ProviderLimits() {
	const { t } = useAppTranslation()
	const label = (key: string, options?: Record<string, string | number>) => t("settings:limits." + key, options)
	const [limits, setLimits] = useState<LimitsData>()
	const limitsRef = useRef<LimitsData>()
	const [loading, setLoading] = useState(true)
	const [refreshError, setRefreshError] = useState(false)
	const [now, setNow] = useState(Date.now())
	const latestRequestId = useRef("")
	const requestCounter = useRef(0)
	const request = useCallback((refresh = false) => {
		setLoading(true)
		setRefreshError(false)
		const requestId = Date.now() + "-" + ++requestCounter.current
		latestRequestId.current = requestId
		vscode.postMessage({ type: "requestProviderLimits", bool: refresh, requestId })
	}, [])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.data?.type !== "providerLimits" || event.data.requestId !== latestRequestId.current) return
			const next = event.data.providerLimits as LimitsData
			if ((next.status === "error" || next.status === "auth_error") &&
				(limitsRef.current?.status === "supported" || limitsRef.current?.status === "partial")) {
				setRefreshError(true)
			} else {
				limitsRef.current = next
				setLimits(next)
			}
			setNow(Date.now())
			setLoading(false)
		}
		window.addEventListener("message", onMessage)
		request()
		return () => window.removeEventListener("message", onMessage)
	}, [request])

	useEffect(() => {
		if (!limits?.fetchedAt && !limits?.windows?.some((item) => item.resetAt)) return
		const timer = window.setInterval(() => setNow(Date.now()), 60_000)
		return () => window.clearInterval(timer)
	}, [limits])

	const relative = (timestamp?: number, past = false) => {
		const date = validDate(timestamp)
		if (!date) return undefined
		const elapsed = (past ? now - date.getTime() : date.getTime() - now) / 60_000
		const minutes = Math.max(0, past ? Math.floor(elapsed) : Math.ceil(elapsed))
		if (minutes < 1) return label(past ? "justNow" : "lessThanMinute")
		if (minutes < 60) return label("minutes", { value: minutes })
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return label("hoursMinutes", { hours, minutes: minutes % 60 })
		return label("daysHours", { days: Math.floor(hours / 24), hours: hours % 24 })
	}
	const windowTitle = (item: WindowData) => {
		const seconds = item.windowSeconds
		if (seconds && Number.isFinite(seconds) && seconds > 0) {
			if (seconds % 86_400 === 0) return label("windowDays", { value: seconds / 86_400 })
			if (seconds % 3_600 === 0) return label("windowHours", { value: seconds / 3_600 })
			return label("windowMinutes", { value: Math.round(seconds / 60) })
		}
		return item.kind
	}
	const spendingCard = (item: WindowData, index: number) => {
		const spent = money(item.spentUsd)
		const cap = money(item.capUsd)
		const remaining = money(item.remainingUsd)
		const percent = percentUsed(item.spentUsd === undefined ? undefined : Number(item.spentUsd),
			item.capUsd === undefined ? undefined : Number(item.capUsd))
		const reset = validDate(item.resetAt)
		const title = windowTitle(item)
		return <article key={item.kind + index} className="min-w-0 rounded-lg border border-border bg-vscode-input-background p-4 space-y-4">
			<h4 className="m-0 text-sm font-semibold text-vscode-foreground">{title}</h4>
			<div>
				{remaining ? <><p className="m-0 text-[11px] uppercase tracking-wide text-vscode-descriptionForeground">{label("remaining")}</p>
					<p className="m-0 text-2xl font-semibold tabular-nums text-vscode-foreground">{remaining}</p></>
					: <p className="m-0 text-sm text-vscode-descriptionForeground">{label("remainingUnavailable")}</p>}
				{spent && cap ? <p className="m-0 mt-1 text-xs tabular-nums text-vscode-descriptionForeground">{spent} / {cap} {label("used")}</p> : null}
			</div>
			<UsageBar percent={percent} label={title + " " + label("used")} />
			{reset ? <p className="m-0 text-xs text-vscode-descriptionForeground" title={reset.toLocaleString()}>
				{reset.getTime() <= now ? label("resetDue") : label("resetsIn", { time: relative(item.resetAt) || "" })}</p> : null}
			{!spent && !cap && !remaining ? <p className="m-0 text-xs text-vscode-descriptionForeground">{label("usageUnavailable")}</p> : null}
		</article>
	}
	const free = limits?.freeTokens
	const wallet = limits?.wallet
	const hasFreeData = Boolean(free && [free.usedToday, free.limitPerDay, free.remaining].some((value) => tokens(value) !== undefined))
	const hasWalletData = Boolean(wallet && (money(wallet.balanceUsd) || money(wallet.heldUsd)))
	const freePercent = percentUsed(free?.usedToday, free?.limitPerDay)
	const hasUsage = limits?.status === "supported" || limits?.status === "partial"
	const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))", gap: "0.75rem" } as const

	return <section id="section-limits" className="bg-vscode-editor-background border border-border rounded-xl p-5 shadow-xs space-y-5">
		<div className="flex flex-wrap items-start justify-between gap-3">
			<h3 className="text-base font-semibold text-vscode-foreground m-0">{label("title")}</h3>
			<Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => request(true)} aria-busy={loading}>
				{loading && limits ? label("refreshing") + "…" : label("refresh")}</Button>
		</div>
		{loading && !limits ? <p role="status" className="text-sm text-vscode-descriptionForeground">{label("loading")}</p> : null}
		{limits ? <div className="space-y-5">
			<div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-border pb-4">
				<div><p className="m-0 text-[11px] text-vscode-descriptionForeground">{label("provider")}</p>
					<p className="m-0 font-semibold">{limits.provider === "xkiro" ? "xKiro" : limits.provider}</p></div>
				{limits.plan ? <div><p className="m-0 text-[11px] text-vscode-descriptionForeground">{label("plan")}</p>
					<p className="m-0 font-semibold">{limits.plan.split(/[-_\s]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}</p></div> : null}
				{validDate(limits.fetchedAt) ? <div><p className="m-0 text-[11px] text-vscode-descriptionForeground">{label("updated")}</p>
					<p className="m-0 text-sm" title={new Date(limits.fetchedAt!).toLocaleString()}>{now - limits.fetchedAt! < 60_000 ? label("justNow") : label("updatedAgo", { time: relative(limits.fetchedAt, true) || "" })}</p></div> : null}
			</div>
			{refreshError ? <p role="alert" className="m-0 text-sm text-destructive">{label("refreshError")}</p> : null}
			{limits.status === "unsupported" && <p role="status">{label("unsupported")}</p>}
			{limits.status === "missing_auth" && <p role="status">{label("missingAuth")}</p>}
			{limits.status === "auth_error" && <p role="alert">{label("authError")}</p>}
			{limits.status === "error" && <p role="alert">{label("error")}</p>}
			{hasUsage ? <>
				{limits.windows?.length ? <div style={gridStyle}>{limits.windows.map(spendingCard)}</div> : null}
				<div style={gridStyle}>
					{hasFreeData && free ? <article className="min-w-0 rounded-lg border border-border p-4 space-y-4">
						<h4 className="m-0 text-sm font-semibold">{label("freeTokens")}</h4>
						<div>{tokens(free.remaining) ? <><p className="m-0 text-[11px] uppercase tracking-wide text-vscode-descriptionForeground">{label("remaining")}</p>
							<p className="m-0 text-2xl font-semibold tabular-nums">{tokens(free.remaining)}</p></> : null}
							{tokens(free.usedToday) && tokens(free.limitPerDay) ? <p className="m-0 mt-1 text-xs tabular-nums text-vscode-descriptionForeground">{tokens(free.usedToday)} / {tokens(free.limitPerDay)} {label("usedToday")}</p> : null}</div>
						<UsageBar percent={freePercent} label={label("freeTokens")} />
					</article> : null}
					{hasWalletData && wallet ? <article className="min-w-0 rounded-lg border border-border p-4">
						<h4 className="m-0 text-sm font-semibold">{label("wallet")}</h4>
						<div className="flex flex-wrap gap-x-8 gap-y-3 mt-4">
							<div><p className="m-0 text-[11px] text-vscode-descriptionForeground">{label("balance")}</p><p className="m-0 text-xl font-semibold tabular-nums">{money(wallet.balanceUsd) || "—"}</p></div>
							<div><p className="m-0 text-[11px] text-vscode-descriptionForeground">{label("held")}</p><p className="m-0 text-sm tabular-nums">{money(wallet.heldUsd) || "—"}</p></div>
						</div>
					</article> : null}
				</div>
				{!limits.windows?.length && !hasFreeData && !hasWalletData ? <p className="text-sm text-vscode-descriptionForeground">{label("usageUnavailable")}</p> : null}
				<p className="text-xs text-vscode-descriptionForeground m-0">{label("rateLimitUnavailable")}</p>
			</> : null}
		</div> : null}
	</section>
}
