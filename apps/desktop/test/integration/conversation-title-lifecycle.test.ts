import { describe, expect, it, vi } from "vitest"
import { DesktopAgentHost } from "../../src/main/agent-host.js"

const task = "Fix the sidebar spinner when switching chats"

function setup(
	initial: Array<Record<string, any>>,
	completePrompt = vi.fn().mockResolvedValue("Fix sidebar spinner during chat switching"),
) {
	const items = new Map(initial.map((item) => [item.id, { ...item }]))
	let deleted = false
	const api = { completePrompt }
	const currentTask = {
		taskId: initial[0]?.id,
		api,
		apiConfiguration: { apiProvider: "test" },
		isStreaming: false,
		taskStatus: "idle",
	}
	const provider = {
		getCurrentTask: () => currentTask,
		runningTasks: new Map([[currentTask.taskId, currentTask]]),
		on: vi.fn(),
		off: vi.fn(),
		taskHistoryStore: {
			get: (id: string) => items.get(id),
			getAll: () => [...items.values()],
			isDeleted: () => deleted,
			upsert: vi.fn(async (incoming: any) => {
				const prior = items.get(incoming.id)
				if (deleted || !prior) return [...items.values()]
				if (prior.titleSource === "manual" && incoming.titleSource !== "manual") return [...items.values()]
				items.set(incoming.id, { ...prior, ...incoming })
				return [...items.values()]
			}),
		},
	}
	const host = new DesktopAgentHost({
		workspacePath: "C:\\roo-test",
		extensionPath: "C:\\roo-test",
		storageDir: "C:\\roo-test-no-data",
	})
	host.registerWebviewProvider("test", provider)
	return {
		host,
		provider,
		items,
		currentTask,
		completePrompt,
		markDeleted: () => {
			deleted = true
			items.clear()
		},
	}
}

describe("conversation title lifecycle", () => {
	it("uses the task API handler and patches only the matching row", async () => {
		const env = setup([
			{ id: "chat-a", task, workspace: "C:\\roo-test", ts: 200, createdAt: 200 },
			{
				id: "chat-b",
				task: "Review project reordering in the sidebar",
				workspace: "C:\\roo-test",
				ts: 100,
				createdAt: 100,
				title: "Review project sidebar ordering",
				titleSource: "manual",
			},
		])
		const event = vi.fn()
		env.host.on("conversationTitleUpdated", event)
		const before = Object.values(env.host.getChatsByWorkspace())
			.flat()
			.map((c) => c.id)
		env.host.triggerBackgroundTitleGeneration("chat-a", task)
		await vi.waitFor(() => expect(env.items.get("chat-a")?.titleSource).toBe("generated_ai"))
		expect(env.completePrompt).toHaveBeenCalledTimes(1)
		expect(event).toHaveBeenCalledWith(expect.objectContaining({ taskId: "chat-a" }))
		expect(
			Object.values(env.host.getChatsByWorkspace())
				.flat()
				.map((c) => c.id),
		).toEqual(before)
		expect(env.host.getActiveTaskId()).toBeNull()
		expect(env.items.get("chat-b")?.title).toBe("Review project sidebar ordering")
	})

	it("manual rename wins over an in-flight model response", async () => {
		let finish!: (title: string) => void
		const env = setup(
			[{ id: "chat-a", task, ts: 1 }],
			vi.fn(
				() =>
					new Promise<string>((resolve) => {
						finish = resolve
					}),
			),
		)
		env.host.triggerBackgroundTitleGeneration("chat-a", task)
		await vi.waitFor(() => expect(env.completePrompt).toHaveBeenCalledTimes(1))
		await env.host.renameChat("chat-a", "My manual title")
		finish("Generated sidebar spinner title")
		await vi.waitFor(() => expect(env.items.get("chat-a")?.title).toBe("My manual title"))
		expect(env.items.get("chat-a")?.titleSource).toBe("manual")
	})

	it("ignores a late result for a deleted chat", async () => {
		let finish!: (title: string) => void
		const env = setup(
			[{ id: "chat-a", task, ts: 1 }],
			vi.fn(
				() =>
					new Promise<string>((resolve) => {
						finish = resolve
					}),
			),
		)
		const event = vi.fn()
		env.host.on("conversationTitleUpdated", event)
		env.host.triggerBackgroundTitleGeneration("chat-a", task)
		await vi.waitFor(() => expect(env.completePrompt).toHaveBeenCalledTimes(1))
		event.mockClear()
		env.markDeleted()
		finish("Generated sidebar spinner title")
		await new Promise((resolve) => setTimeout(resolve, 5))
		expect(env.items.size).toBe(0)
		expect(event).not.toHaveBeenCalled()
	})

	it("repairs only old non-manual boilerplate titles without model requests", async () => {
		const env = setup([
			{
				id: "chat-a",
				task: `SKILLS TO USE:\n/graphify\n${task}`,
				title: "SKILLS TO USE",
				titleSource: "fallback",
				ts: 2,
			},
			{ id: "chat-b", task, title: "SKILLS TO USE", titleSource: "manual", ts: 1 },
		])
		await vi.waitFor(() => expect(env.items.get("chat-a")?.title).toMatch(/sidebar|spinner/i))
		expect(env.items.get("chat-a")?.title).not.toMatch(/SKILLS/i)
		expect(env.items.get("chat-b")?.title).toBe("SKILLS TO USE")
		expect(env.completePrompt).not.toHaveBeenCalled()
	})

	it("does not title a provisional chat before the first accepted task", () => {
		const env = setup([])
		env.host.triggerBackgroundTitleGeneration("provisional_1", task)
		expect(env.completePrompt).not.toHaveBeenCalled()
	})
})
