import * as fs from "fs/promises"
import * as path from "path"
import type { DecisionLogEntry } from "@roo-code/types"
import { getTaskDirectoryPath } from "../../utils/storage"
import { sanitizeForSafetyPrompt } from "./safetyPromptTemplate"

export class DecisionLogStore {
	private static instance?: DecisionLogStore
	private entries: DecisionLogEntry[] = []
	private readonly maxMemoryEntries: number = 500

	public static getInstance(): DecisionLogStore {
		if (!DecisionLogStore.instance) {
			DecisionLogStore.instance = new DecisionLogStore()
		}
		return DecisionLogStore.instance
	}

	public addEntry(entry: DecisionLogEntry, knownSecrets?: string[]): void {
		// Ensure all sensitive text is redacted before recording
		const sanitizedTarget = sanitizeForSafetyPrompt(entry.target, knownSecrets)
		const sanitizedReason = sanitizeForSafetyPrompt(entry.reason, knownSecrets)
		const sanitizedGuidance = entry.replanGuidance
			? sanitizeForSafetyPrompt(entry.replanGuidance, knownSecrets)
			: entry.replanGuidance

		const safeEntry: DecisionLogEntry = {
			...entry,
			target: sanitizedTarget,
			reason: sanitizedReason,
			replanGuidance: sanitizedGuidance,
		}

		this.entries.push(safeEntry)
		if (this.entries.length > this.maxMemoryEntries) {
			this.entries.shift()
		}

		// Asynchronously persist to task log if taskId exists
		if (safeEntry.taskId && safeEntry.taskId !== "unknown") {
			this.persistEntryToTask(safeEntry).catch((err) => {
				console.error("[DecisionLogStore] Failed to persist entry:", err)
			})
		}
	}

	private globalStoragePath?: string

	public setGlobalStoragePath(path: string): void {
		this.globalStoragePath = path
	}

	public getEntries(taskId?: string): DecisionLogEntry[] {
		if (!taskId) {
			return [...this.entries]
		}
		return this.entries.filter((e) => e.taskId === taskId)
	}

	public clear(): void {
		this.entries = []
	}

	private async persistEntryToTask(entry: DecisionLogEntry): Promise<void> {
		try {
			if (!this.globalStoragePath || !entry.taskId) {
				return
			}
			const taskDir = await getTaskDirectoryPath(this.globalStoragePath, entry.taskId)
			const logFile = path.join(taskDir, "decision_log.jsonl")
			const line = JSON.stringify(entry) + "\n"
			await fs.appendFile(logFile, line, "utf-8")
		} catch (error) {
			// Non-blocking error logging
			console.warn("[DecisionLogStore] Could not append to task log:", error)
		}
	}
}
