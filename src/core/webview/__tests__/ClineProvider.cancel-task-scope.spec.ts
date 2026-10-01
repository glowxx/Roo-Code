import { describe, expect, it, vi } from "vitest"
import { ClineProvider } from "../ClineProvider"

function makeTask(taskId: string) {
	return {
		taskId,
		instanceId: `${taskId}-instance`,
		isStreaming: true,
		isWaitingForFirstChunk: false,
		abandoned: false,
		cancelCurrentRequest: vi.fn(),
		abortCompaction: vi.fn(),
		abortTask: vi.fn(async function (this: any) { this.isStreaming = false }),
	}
}

function makeProvider() {
	const provider = Object.create(ClineProvider.prototype) as ClineProvider
	const taskA = makeTask("A")
	const taskB = makeTask("B")
	;(provider as any).runningTasks = new Map([["A", taskA], ["B", taskB]])
	;(provider as any).clineStack = [taskA, taskB]
	provider.foregroundTaskId = "B"
	provider.getTaskWithId = vi.fn().mockRejectedValue(new Error("Task not found")) as any
	provider.postStateToWebview = vi.fn().mockResolvedValue(undefined) as any
	;(provider as any).log = vi.fn()
	return { provider, taskA, taskB }
}

describe("targeted task cancellation", () => {
	it("does not cancel the foreground task for an unknown explicit ID", async () => {
		const { provider, taskB } = makeProvider()
		await provider.cancelTask("missing")
		expect(taskB.abortTask).not.toHaveBeenCalled()
	})

	it("stops only the selected background task and repeated stop is harmless", async () => {
		const { provider, taskA, taskB } = makeProvider()
		await provider.cancelTask("A")
		await provider.cancelTask("A")
		expect(taskA.abortTask).toHaveBeenCalledTimes(1)
		expect(taskA.cancelCurrentRequest).toHaveBeenCalledTimes(1)
		expect(taskB.abortTask).not.toHaveBeenCalled()
		expect(taskB.cancelCurrentRequest).not.toHaveBeenCalled()
		expect(taskB.abortCompaction).not.toHaveBeenCalled()
		expect(provider.runningTasks.has("B")).toBe(true)
	})

	it("stops the foreground task without changing the other running task", async () => {
		const { provider, taskA, taskB } = makeProvider()
		await provider.cancelTask("B")
		expect(taskB.abortTask).toHaveBeenCalledTimes(1)
		expect(taskA.abortTask).not.toHaveBeenCalled()
		expect(taskA.cancelCurrentRequest).not.toHaveBeenCalled()
		expect(taskA.abortCompaction).not.toHaveBeenCalled()
		expect(provider.runningTasks.has("A")).toBe(true)
		expect(taskA.isStreaming).toBe(true)
	})

	it("concurrent repeated Stop requests abort the runtime once", async () => {
		const { provider, taskA } = makeProvider()
		let finishAbort!: () => void
		taskA.abortTask = vi.fn(() => new Promise<void>((resolve) => { finishAbort = resolve }))
		const first = provider.cancelTask("A")
		const second = provider.cancelTask("A")
		await second
		expect(taskA.abortTask).toHaveBeenCalledTimes(1)
		finishAbort()
		await first
	})

	it("acknowledges stop only after the target abort completes", async () => {
		const { provider, taskA } = makeProvider()
		let finishAbort!: () => void
		taskA.abortTask = vi.fn(() => new Promise<void>((resolve) => { finishAbort = resolve }))
		let acknowledged = false
		const stop = provider.cancelTask("A").then(() => { acknowledged = true })
		await Promise.resolve()
		expect(acknowledged).toBe(false)
		finishAbort()
		await stop
		expect(acknowledged).toBe(true)
	})
})
