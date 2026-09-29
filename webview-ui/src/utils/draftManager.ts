export interface ChatDraft {
	text: string
	images: string[]
	updatedAt: number
	modelPreference?: {
		provider?: string
		modelId?: string
		reasoningEffort?: string
	}
}

const STORAGE_PREFIX = "roo_draft_v1_"

function normalizeWorkspace(ws?: string): string {
	if (!ws) return "global"
	return ws.replace(/\\/g, "/").toLowerCase().trim()
}

function buildStorageKey(workspace: string, chatKey: string): string {
	return `${STORAGE_PREFIX}${encodeURIComponent(normalizeWorkspace(workspace))}_${encodeURIComponent(chatKey)}`
}

let pendingSaveTimer: any = null
let pendingSaveArgs: { workspace: string; chatKey: string; draft: Partial<ChatDraft> } | null = null

/**
 * Synchronously writes a draft to localStorage with error handling.
 */
export function saveDraft(workspace: string, chatKey: string, draft: Partial<ChatDraft>): void {
	if (!chatKey) return
	const key = buildStorageKey(workspace, chatKey)
	const entry: ChatDraft = {
		text: draft.text ?? "",
		images: draft.images ?? [],
		updatedAt: Date.now(),
		modelPreference: draft.modelPreference,
	}

	// If draft is completely empty and has no model preference, delete it to save space
	if (!entry.text.trim() && entry.images.length === 0 && !entry.modelPreference) {
		deleteDraft(workspace, chatKey)
		return
	}

	try {
		localStorage.setItem(key, JSON.stringify(entry))
	} catch (e: any) {
		// QuotaExceededError protection: retry without images if images are too large
		if (entry.images.length > 0) {
			try {
				const fallback = { ...entry, images: [] }
				localStorage.setItem(key, JSON.stringify(fallback))
			} catch (_) {}
		}
	}
}

/**
 * Loads a draft from localStorage.
 */
export function loadDraft(workspace: string, chatKey: string): ChatDraft | null {
	if (!chatKey) return null
	const key = buildStorageKey(workspace, chatKey)
	try {
		const raw = localStorage.getItem(key)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		if (typeof parsed === "object" && parsed !== null) {
			return {
				text: typeof parsed.text === "string" ? parsed.text : "",
				images: Array.isArray(parsed.images) ? parsed.images : [],
				updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
				modelPreference: parsed.modelPreference,
			}
		}
	} catch (e) {
		console.warn("[draftManager] Failed to load draft for key:", key, e)
	}
	return null
}

/**
 * Immediately deletes a draft.
 */
export function deleteDraft(workspace: string, chatKey: string): void {
	if (!chatKey) return
	if (pendingSaveArgs && pendingSaveArgs.chatKey === chatKey) {
		if (pendingSaveTimer) clearTimeout(pendingSaveTimer)
		pendingSaveArgs = null
		pendingSaveTimer = null
	}
	const key = buildStorageKey(workspace, chatKey)
	try {
		localStorage.removeItem(key)
	} catch (e) {}
}

/**
 * Deletes all drafts belonging to a specific workspace/project.
 */
export function deleteProjectDrafts(workspace: string): void {
	const prefix = `${STORAGE_PREFIX}${encodeURIComponent(normalizeWorkspace(workspace))}_`
	try {
		const keysToDelete: string[] = []
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i)
			if (k && k.startsWith(prefix)) {
				keysToDelete.push(k)
			}
		}
		for (const k of keysToDelete) {
			localStorage.removeItem(k)
		}
	} catch (e) {}
}

/**
 * Flushes any pending debounced draft save immediately.
 */
export function flushPendingDraft(): void {
	if (pendingSaveTimer) {
		clearTimeout(pendingSaveTimer)
		pendingSaveTimer = null
	}
	if (pendingSaveArgs) {
		saveDraft(pendingSaveArgs.workspace, pendingSaveArgs.chatKey, pendingSaveArgs.draft)
		pendingSaveArgs = null
	}
}

/**
 * Schedules a debounced draft save (default 250ms), capturing parameters.
 */
export function scheduleSaveDraft(
	workspace: string,
	chatKey: string,
	draft: Partial<ChatDraft>,
	delayMs = 250,
): void {
	if (pendingSaveArgs && pendingSaveArgs.chatKey !== chatKey) {
		// Different chat! Flush previous chat immediately
		flushPendingDraft()
	}
	pendingSaveArgs = { workspace, chatKey, draft }
	if (pendingSaveTimer) {
		clearTimeout(pendingSaveTimer)
	}
	pendingSaveTimer = setTimeout(() => {
		flushPendingDraft()
	}, delayMs)
}

/**
 * Lists all provisional draft keys for a given workspace.
 */
export function getProvisionalDraftIds(workspace: string): string[] {
	const prefix = `${STORAGE_PREFIX}${encodeURIComponent(normalizeWorkspace(workspace))}_provisional_`
	const ids: string[] = []
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i)
			if (k && k.startsWith(prefix)) {
				const encodedKey = k.slice(prefix.length)
				ids.push(`provisional_${decodeURIComponent(encodedKey)}`)
			}
		}
	} catch (e) {}
	return ids
}

/**
 * Gets the persisted active provisional chat ID for a workspace.
 */
export function getActiveProvisionalId(workspace: string): string | null {
	const key = `${STORAGE_PREFIX}${encodeURIComponent(normalizeWorkspace(workspace))}_active_provisional`
	try {
		return localStorage.getItem(key)
	} catch (e) {
		return null
	}
}

/**
 * Sets the persisted active provisional chat ID for a workspace.
 */
export function setActiveProvisionalIdKey(workspace: string, id: string): void {
	const key = `${STORAGE_PREFIX}${encodeURIComponent(normalizeWorkspace(workspace))}_active_provisional`
	try {
		localStorage.setItem(key, id)
	} catch (e) {}
}
