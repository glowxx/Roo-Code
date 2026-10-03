/** Fractions used by the limit bars. Undefined means the provider did not supply enough valid data. */
export function usageProgress(used?: number, cap?: number): number | undefined {
	if (used === undefined || cap === undefined || !Number.isFinite(used) || !Number.isFinite(cap) || used < 0 || cap <= 0) {
		return undefined
	}
	return Math.min(1, used / cap)
}

export function guideProgress(resetAt?: number, windowDurationMs?: number, now = Date.now()): number | undefined {
	if (resetAt === undefined || windowDurationMs === undefined ||
		!Number.isFinite(resetAt) || resetAt <= 0 || !Number.isFinite(new Date(resetAt).getTime()) ||
		!Number.isFinite(windowDurationMs) || windowDurationMs <= 0 ||
		!Number.isFinite(now)) {
		return undefined
	}
	return Math.max(0, Math.min(1, 1 - (resetAt - now) / windowDurationMs))
}
