import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

import { FileMemento } from "../storage/Memento.js"
import { FileSecretStorage } from "../storage/SecretStorage.js"

describe("FileMemento", () => {
	let tempDir: string
	let mementoPath: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "memento-test-"))
		mementoPath = path.join(tempDir, "state.json")
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	it("should store and retrieve values", async () => {
		const memento = new FileMemento(mementoPath)

		await memento.update("key1", "value1")
		await memento.update("key2", 42)

		expect(memento.get("key1")).toBe("value1")
		expect(memento.get("key2")).toBe(42)
	})

	it("should return default value when key doesn't exist", () => {
		const memento = new FileMemento(mementoPath)

		expect(memento.get("nonexistent", "default")).toBe("default")
		expect(memento.get<number>("missing", 0)).toBe(0)
	})

	it("should persist data to file", async () => {
		const memento1 = new FileMemento(mementoPath)
		await memento1.update("persisted", "value")

		// Create new instance to verify persistence
		const memento2 = new FileMemento(mementoPath)
		expect(memento2.get("persisted")).toBe("value")
	})

	it("should delete values when updated with undefined", async () => {
		const memento = new FileMemento(mementoPath)

		await memento.update("key", "value")
		expect(memento.get("key")).toBe("value")

		await memento.update("key", undefined)
		expect(memento.get("key")).toBeUndefined()
	})

	it("should return all keys", async () => {
		const memento = new FileMemento(mementoPath)

		await memento.update("key1", "value1")
		await memento.update("key2", "value2")
		await memento.update("key3", "value3")

		const keys = memento.keys()
		expect(keys).toHaveLength(3)
		expect(keys).toContain("key1")
		expect(keys).toContain("key2")
		expect(keys).toContain("key3")
	})

	it("should clear all data", async () => {
		const memento = new FileMemento(mementoPath)

		await memento.update("key1", "value1")
		await memento.update("key2", "value2")

		memento.clear()

		expect(memento.keys()).toHaveLength(0)
		expect(memento.get("key1")).toBeUndefined()
	})
})

describe("FileSecretStorage", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "secrets-test-"))
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	it("should store and retrieve secrets", async () => {
		const storage = new FileSecretStorage(tempDir)

		await storage.store("apiKey", "sk-test-123")
		const retrieved = await storage.get("apiKey")

		expect(retrieved).toBe("sk-test-123")
	})

	it("should return undefined for non-existent secrets", async () => {
		const storage = new FileSecretStorage(tempDir)
		const result = await storage.get("nonexistent")

		expect(result).toBeUndefined()
	})

	it("should delete secrets", async () => {
		const storage = new FileSecretStorage(tempDir)

		await storage.store("apiKey", "sk-test-123")
		expect(await storage.get("apiKey")).toBe("sk-test-123")

		await storage.delete("apiKey")
		expect(await storage.get("apiKey")).toBeUndefined()
	})

	it("should persist secrets across instances", async () => {
		const storage1 = new FileSecretStorage(tempDir)
		await storage1.store("token", "persistent-value")

		const storage2 = new FileSecretStorage(tempDir)
		const value = await storage2.get("token")

		expect(value).toBe("persistent-value")
	})

	it("should fire onDidChange event when secret changes", async () => {
		const storage = new FileSecretStorage(tempDir)
		const events: string[] = []

		storage.onDidChange((e) => {
			events.push(e.key)
		})

		await storage.store("key1", "value1")
		await storage.store("key2", "value2")
		await storage.delete("key1")

		expect(events).toEqual(["key1", "key2", "key1"])
	})

	it("should clear all secrets", async () => {
		const storage = new FileSecretStorage(tempDir)

		await storage.store("key1", "value1")
		await storage.store("key2", "value2")

		storage.clearAll()

		expect(await storage.get("key1")).toBeUndefined()
		expect(await storage.get("key2")).toBeUndefined()
	})

	it("should create secrets.json file with restrictive permissions on Unix", async () => {
		if (process.platform === "win32") {
			// Skip on Windows
			return
		}

		const storage = new FileSecretStorage(tempDir)
		await storage.store("key", "value")

		const secretsPath = path.join(tempDir, "secrets.json")
		const stats = fs.statSync(secretsPath)
		const mode = stats.mode & 0o777

		// Should be 0600 (owner read/write only)
		expect(mode).toBe(0o600)
	})

	it("should create a backup file when saving existing non-empty secrets", async () => {
		const storage = new FileSecretStorage(tempDir)
		await storage.store("key1", "val1")

		const secretsPath = path.join(tempDir, "secrets.json")
		const backupPath = path.join(tempDir, "secrets.json.bak")

		expect(fs.existsSync(secretsPath)).toBe(true)

		await storage.store("key2", "val2")
		expect(fs.existsSync(backupPath)).toBe(true)

		const backupContent = JSON.parse(fs.readFileSync(backupPath, "utf-8"))
		expect(backupContent).toEqual({ key1: "val1" })
	})

	it("should recover from backup if primary file is corrupted", async () => {
		const secretsPath = path.join(tempDir, "secrets.json")
		const backupPath = path.join(tempDir, "secrets.json.bak")

		// Write valid backup and corrupted primary
		fs.writeFileSync(backupPath, JSON.stringify({ recoveredKey: "recoveredVal" }))
		fs.writeFileSync(secretsPath, "corrupted json {")

		const storage = new FileSecretStorage(tempDir)
		expect(await storage.get("recoveredKey")).toBe("recoveredVal")
	})

	it("should recover from backup if primary file is empty", async () => {
		const secretsPath = path.join(tempDir, "secrets.json")
		const backupPath = path.join(tempDir, "secrets.json.bak")

		fs.writeFileSync(backupPath, JSON.stringify({ fromBak: "ok" }))
		fs.writeFileSync(secretsPath, "   ")

		const storage = new FileSecretStorage(tempDir)
		expect(await storage.get("fromBak")).toBe("ok")
	})

	it("should not reset existing secrets if load fails and secrets already present", async () => {
		const storage = new FileSecretStorage(tempDir)
		await storage.store("existing", "keepMe")

		const secretsPath = path.join(tempDir, "secrets.json")
		const backupPath = path.join(tempDir, "secrets.json.bak")

		// Corrupt both
		fs.writeFileSync(secretsPath, "corrupted {")
		if (fs.existsSync(backupPath)) {
			fs.writeFileSync(backupPath, "corrupted bak {")
		}

		// Re-trigger load
		;(storage as any).loadFromFile()

		// Secrets in memory must not be erased to empty object
		expect(await storage.get("existing")).toBe("keepMe")
	})

	it("should not overwrite backup file if storage is corrupted", async () => {
		const secretsPath = path.join(tempDir, "secrets.json")
		const backupPath = path.join(tempDir, "secrets.json.bak")

		// Both primary and backup are corrupted
		fs.writeFileSync(secretsPath, "corrupted primary {")
		fs.writeFileSync(backupPath, "precious backup content")

		const storage = new FileSecretStorage(tempDir)
		expect((storage as any).isCorrupted).toBe(true)

		// Saving a new secret should NOT overwrite the backup
		await storage.store("key1", "val1")

		expect(fs.readFileSync(backupPath, "utf-8")).toBe("precious backup content")
		expect((storage as any).isCorrupted).toBe(false)
	})

	it("should not create backup if primary file contains invalid JSON", async () => {
		const secretsPath = path.join(tempDir, "secrets.json")
		const backupPath = path.join(tempDir, "secrets.json.bak")

		// Create storage with valid file first
		const storage = new FileSecretStorage(tempDir)
		await storage.store("k1", "v1")

		// Manually remove backup and corrupt the primary file
		if (fs.existsSync(backupPath)) {
			fs.unlinkSync(backupPath)
		}
		fs.writeFileSync(secretsPath, "invalid json {")

		// Attempt saving - should not create backup from invalid JSON
		;(storage as any).saveToFile()
		expect(fs.existsSync(backupPath)).toBe(false)
	})

	it("should not create backup if primary file is empty", async () => {
		const secretsPath = path.join(tempDir, "secrets.json")
		const backupPath = path.join(tempDir, "secrets.json.bak")

		const storage = new FileSecretStorage(tempDir)
		fs.writeFileSync(secretsPath, "   ")

		;(storage as any).saveToFile()
		expect(fs.existsSync(backupPath)).toBe(false)
	})

	it("should clean up orphaned secrets.json.tmp.* files on initialization", async () => {
		const tmpFile1 = path.join(tempDir, "secrets.json.tmp.12345")
		const tmpFile2 = path.join(tempDir, "secrets.json.tmp.67890")
		const otherFile = path.join(tempDir, "other.tmp")

		fs.writeFileSync(tmpFile1, "tmp1")
		fs.writeFileSync(tmpFile2, "tmp2")
		fs.writeFileSync(otherFile, "keep")

		new FileSecretStorage(tempDir)

		expect(fs.existsSync(tmpFile1)).toBe(false)
		expect(fs.existsSync(tmpFile2)).toBe(false)
		expect(fs.existsSync(otherFile)).toBe(true)
	})
})
