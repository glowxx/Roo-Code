import path from "path"
import fs from "fs"
import os from "os"

const LOG_FILE = path.join(process.env.APPDATA || os.homedir(), "Roo Code", "startup-debug.log")

export function getLogFilePath(): string {
	return LOG_FILE
}

export function logStartupDebug(msg: string) {
	try {
		const dir = path.dirname(LOG_FILE)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		const timestamp = new Date().toISOString()
		const line = `[${timestamp}] ${msg}\n`
		fs.appendFileSync(LOG_FILE, line, "utf-8")
		console.log(`[STARTUP-DEBUG] ${msg}`)
	} catch (e) {
		console.error("Failed to write to startup-debug.log:", e)
	}
}

export function setupGlobalCrashHandlers(contextName = "Main") {
	process.on("uncaughtException", (err) => {
		const stack = err instanceof Error ? err.stack : String(err)
		const msg = `[FATAL CRASH] [${contextName}] uncaughtException: ${stack}`
		console.error(msg)
		logStartupDebug(msg)
	})
	process.on("unhandledRejection", (reason: any) => {
		const stack = reason instanceof Error ? reason.stack : String(reason?.stack || reason)
		const msg = `[UNHANDLED REJECTION] [${contextName}] unhandledRejection: ${stack}`
		console.error(msg)
		logStartupDebug(msg)
	})
}
