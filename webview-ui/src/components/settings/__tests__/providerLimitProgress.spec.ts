import { guideProgress, usageProgress } from "../providerLimitProgress"

describe("provider limit progress", () => {
	it("uses the consumed share of the cap and clamps it", () => {
		expect(usageProgress(8.79, 10)).toBeCloseTo(0.879)
		expect(usageProgress(0, 10)).toBe(0)
		expect(usageProgress(12, 10)).toBe(1)
		expect(usageProgress(1e308, 1e-308)).toBe(1)
	})

	it("omits usage when values cannot define a finite limit", () => {
		for (const [used, cap] of [[undefined, 10], [1, undefined], [1, 0], [-1, 10], [NaN, 10], [1, Infinity]]) {
			expect(usageProgress(used, cap)).toBeUndefined()
		}
	})

	it("locates the time guide within a reset window", () => {
		const now = 1_000_000
		expect(guideProgress(now + 2.5 * 3_600_000, 5 * 3_600_000, now)).toBeCloseTo(0.5)
		expect(guideProgress(now + 7 * 86_400_000, 7 * 86_400_000, now)).toBe(0)
		expect(guideProgress(now - 60_000, 5 * 3_600_000, now)).toBe(1)
		expect(guideProgress(now + 8 * 86_400_000, 7 * 86_400_000, now)).toBe(0)
	})

	it("omits the guide when reset or duration is invalid", () => {
		expect(guideProgress(undefined, 3_600_000)).toBeUndefined()
		expect(guideProgress(Date.now(), undefined)).toBeUndefined()
		expect(guideProgress(Date.now(), 0)).toBeUndefined()
		expect(guideProgress(NaN, 3_600_000)).toBeUndefined()
		expect(guideProgress(1e20, 3_600_000)).toBeUndefined()
	})
})
