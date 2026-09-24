import { describe, it, expect, beforeEach, vi } from "vitest"
import { ProviderRequestCoordinator } from "../ProviderRequestCoordinator"
import { RequestPriority } from "../types"

describe("ProviderRequestCoordinator", () => {
	let coordinator: ProviderRequestCoordinator

	beforeEach(() => {
		ProviderRequestCoordinator.resetInstance()
		coordinator = ProviderRequestCoordinator.getInstance()
	})

	describe("Provider Key Derivation & Isolation", () => {
		it("hashes API keys securely while isolating different providers", () => {
			const key1 = coordinator.deriveProviderKey("openai", "sk-secret-1")
			const key2 = coordinator.deriveProviderKey("openai", "sk-secret-2")
			const key3 = coordinator.deriveProviderKey("xkiro", "sk-secret-1")

			expect(key1).toContain("openai:")
			expect(key2).toContain("openai:")
			expect(key3).toContain("xkiro:")
			expect(key1).not.toBe(key2)
			expect(key1).not.toBe(key3)
		})

		it("isolates 429 rate limit between different providers", async () => {
			const xkiroKey = coordinator.deriveProviderKey("xkiro", "key-xkiro")
			const openaiKey = coordinator.deriveProviderKey("openai", "key-openai")

			const xkiroTicket = await coordinator.acquireTicket({ providerKey: xkiroKey })
			xkiroTicket.reportRateLimit(5) // Block xkiro for 5s
			xkiroTicket.release()

			const statsXkiro = coordinator.getStats(xkiroKey)
			expect(statsXkiro.blockedUntil).toBeGreaterThan(Date.now())

			// OpenAI ticket should acquire immediately without block!
			const startOpenAi = Date.now()
			const openaiTicket = await coordinator.acquireTicket({ providerKey: openaiKey })
			const elapsedOpenAi = Date.now() - startOpenAi
			expect(elapsedOpenAi).toBeLessThan(100)
			openaiTicket.release()
		})
	})

	describe("Dynamic Concurrency & 429 Backoff", () => {
		it("decrements concurrency on 429 backoff", async () => {
			const key = coordinator.deriveProviderKey("xkiro", "test-key")
			const statsInitial = coordinator.getStats(key)
			const baseline = statsInitial.maxConcurrency

			const ticket = await coordinator.acquireTicket({ providerKey: key })
			ticket.reportRateLimit(2)
			ticket.release()

			const statsAfter = coordinator.getStats(key)
			expect(statsAfter.maxConcurrency).toBe(Math.max(1, baseline - 1))
			expect(statsAfter.consecutiveSuccesses).toBe(0)
		})

		it("shares Retry-After block across all tasks using the same provider key", async () => {
			vi.useFakeTimers()
			try {
				const key = coordinator.deriveProviderKey("anthropic", "test-shared-key")

				const ticket1 = await coordinator.acquireTicket({ providerKey: key, taskId: "task-1" })
				ticket1.reportRateLimit(3) // 3 seconds block
				ticket1.release()

				let ticket2Acquired = false
				const ticket2Promise = coordinator.acquireTicket({ providerKey: key, taskId: "task-2" }).then((t) => {
					ticket2Acquired = true
					t.release()
				})

				expect(ticket2Acquired).toBe(false)

				// Advance 2 seconds - still blocked
				await vi.advanceTimersByTimeAsync(2000)
				expect(ticket2Acquired).toBe(false)

				// Advance past 3 seconds - unblocks!
				await vi.advanceTimersByTimeAsync(1200)
				expect(ticket2Acquired).toBe(true)
			} finally {
				vi.useRealTimers()
			}
		})
	})

	describe("Priority Scheduling & Anti-Starvation", () => {
		it("schedules VERIFIER priority before FOREGROUND and BACKGROUND", async () => {
			const key = coordinator.deriveProviderKey("custom", "test-priority")
			// Saturate concurrency (baseline is 2 for custom)
			const t1 = await coordinator.acquireTicket({ providerKey: key, taskId: "t1" })
			const t2 = await coordinator.acquireTicket({ providerKey: key, taskId: "t2" })

			const order: string[] = []

			// Queue background task first
			const bgPromise = coordinator.acquireTicket({
				providerKey: key,
				taskId: "bg",
				priority: RequestPriority.BACKGROUND,
			}).then((t) => {
				order.push("background")
				t.release()
			})

			// Queue verifier task second
			const verifierPromise = coordinator.acquireTicket({
				providerKey: key,
				taskId: "verifier",
				priority: RequestPriority.VERIFIER,
			}).then((t) => {
				order.push("verifier")
				t.release()
			})

			// Queue foreground task third
			const fgPromise = coordinator.acquireTicket({
				providerKey: key,
				taskId: "fg",
				priority: RequestPriority.FOREGROUND,
			}).then((t) => {
				order.push("foreground")
				t.release()
			})

			// Release one slot
			t1.release()
			await Promise.resolve()
			// Release second slot
			t2.release()
			await Promise.resolve()

			await Promise.all([bgPromise, verifierPromise, fgPromise])

			// Verifier must have executed first despite being queued after background
			expect(order[0]).toBe("verifier")
			expect(order[1]).toBe("foreground")
			expect(order[2]).toBe("background")
		})

		it("cleans up aborted requests without slot leaks", async () => {
			const key = coordinator.deriveProviderKey("openai", "test-abort")
			const t1 = await coordinator.acquireTicket({ providerKey: key })
			const t2 = await coordinator.acquireTicket({ providerKey: key })
			const t3 = await coordinator.acquireTicket({ providerKey: key })
			const t4 = await coordinator.acquireTicket({ providerKey: key })

			const controller = new AbortController()
			const queuedPromise = coordinator.acquireTicket({
				providerKey: key,
				abortSignal: controller.signal,
			})

			// Abort while queued
			controller.abort()
			await expect(queuedPromise).rejects.toThrow("Request aborted while queued")

			// Check that queue is clean
			const stats = coordinator.getStats(key)
			expect(stats.queuedCount).toBe(0)

			// Clean release
			t1.release()
			t2.release()
			t3.release()
			t4.release()
			expect(coordinator.getStats(key).activeCount).toBe(0)
		})
	})
})
