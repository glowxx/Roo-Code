import fs from "fs"
import path from "path"
import os from "os"

const STATE_FILE = path.join(process.cwd(), ".build-timer-state.json")

function loadState() {
	if (fs.existsSync(STATE_FILE)) {
		try {
			return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"))
		} catch {}
	}
	return { startTime: Date.now(), stages: {} }
}

function saveState(state) {
	try {
		fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8")
	} catch {}
}

function removeState() {
	if (fs.existsSync(STATE_FILE)) {
		try {
			fs.unlinkSync(STATE_FILE)
		} catch {}
	}
}

function formatDuration(ms) {
	const sec = (ms / 1000).toFixed(1)
	return `${sec}s`
}

const command = process.argv[2]
const arg1 = process.argv[3]
const arg2 = process.argv[4]
const arg3 = process.argv[5]

switch (command) {
	case "header": {
		const isCI = process.env.CI === "true" || process.env.CI === "1" || process.env.NON_INTERACTIVE === "1"
		const mode = isCI ? "Release (CI)" : "Release"
		const platform = `Windows ${process.arch || "x64"}`
		const now = new Date()
		const started = now.toTimeString().split(" ")[0]

		const state = {
			startTime: Date.now(),
			mode,
			platform,
			started,
			stages: {},
		}
		saveState(state)

		console.log("============================================================")
		console.log(" Roo Code Desktop — Windows Installer Build")
		console.log("============================================================")
		console.log(`Mode: ${mode}`)
		console.log(`Platform: ${platform}`)
		console.log(`Started: ${started}`)
		console.log("------------------------------------------------------------\n")
		break
	}

	case "start": {
		const stageNum = arg1 || "1"
		const stageName = arg2 || `Stage ${stageNum}`
		const state = loadState()
		state.stages[stageNum] = {
			name: stageName,
			start: Date.now(),
			status: "running",
		}
		saveState(state)

		console.log(`[${stageNum}/5] ${stageName}`)
		break
	}

	case "pass": {
		const stageNum = arg1 || "1"
		const stageName = arg2 || `Stage ${stageNum}`
		const state = loadState()
		const stage = state.stages[stageNum] || { name: stageName, start: Date.now() }
		const elapsed = Date.now() - stage.start
		stage.duration = elapsed
		stage.durationStr = formatDuration(elapsed)
		stage.status = "ok"
		saveState(state)

		const stageLabel = `[OK] ${stageName}`
		console.log(`${stageLabel.padEnd(36)} ${stage.durationStr.padStart(8)}\n`)
		break
	}

	case "fail": {
		const stageNum = arg1 || "1"
		const failedStep = arg2 || "Unknown step"
		const exitCode = arg3 || "1"
		const state = loadState()
		const stage = state.stages[stageNum] || { name: `Stage ${stageNum}`, start: Date.now() }
		const stageElapsed = Date.now() - stage.start

		console.log(`\n[FAILED] ${stage.name}`)
		console.log(`Exit code: ${exitCode}`)
		console.log("============================================================")
		console.log(" BUILD FAILED")
		console.log("============================================================")
		console.log(`Stage: ${stage.name}`)
		console.log(`Step:  ${failedStep}`)
		console.log(`Exit code: ${exitCode}`)
		console.log(`Elapsed: ${formatDuration(stageElapsed)}`)
		console.log("============================================================\n")
		removeState()
		break
	}

	case "summary": {
		const state = loadState()
		const totalElapsed = Date.now() - state.startTime

		console.log("============================================================")
		console.log(" BUILD SUCCESSFUL")
		console.log("============================================================")

		const stageLabels = {
			"1": "Prerequisites",
			"2": "Internal packages",
			"3": "Desktop build",
			"4": "NSIS packaging",
			"5": "Artifacts",
		}

		for (let i = 1; i <= 5; i++) {
			const key = String(i)
			const s = state.stages[key]
			const label = stageLabels[key] || s?.name || `Stage ${key}`
			const dur = s?.duration ? formatDuration(s.duration) : "0.0s"
			console.log(`${label.padEnd(25)} ${dur.padStart(8)}`)
		}
		console.log("------------------------------------------------------------")
		console.log(`TOTAL${formatDuration(totalElapsed).padStart(29)}`)
		console.log("")

		// Dynamic search for installer in release directory
		const releaseDir = path.join(process.cwd(), "release")
		let installerFile = null

		if (fs.existsSync(releaseDir)) {
			const candidates = fs
				.readdirSync(releaseDir)
				.filter((f) => f.endsWith(".exe") && !f.toLowerCase().includes("unpacked"))
				.map((f) => {
					const fullPath = path.join(releaseDir, f)
					const stat = fs.statSync(fullPath)
					return { name: f, fullPath, stat }
				})
				.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)

			if (candidates.length > 0) {
				installerFile = candidates[0]
			}
		}

		if (installerFile) {
			const sizeMB = (installerFile.stat.size / (1024 * 1024)).toFixed(1)
			const relativePath = path.relative(process.cwd(), installerFile.fullPath)
			console.log("Installer:")
			console.log(relativePath)
			console.log("")
			console.log("Size:")
			console.log(`${sizeMB} MB`)
		} else {
			console.log("Installer:")
			console.log("Not found in release\\")
		}
		console.log("============================================================\n")

		removeState()
		break
	}

	case "check-icon": {
		const icoPath = path.join(process.cwd(), "apps/desktop/assets/icon.ico")
		const pngPath = path.join(process.cwd(), "apps/desktop/assets/icon.png")

		if (!fs.existsSync(icoPath)) {
			console.log("[ICON] icon.ico does not exist - regenerating...")
			process.exit(1)
		}

		if (fs.existsSync(pngPath)) {
			const icoStat = fs.statSync(icoPath)
			const pngStat = fs.statSync(pngPath)
			if (pngStat.mtimeMs > icoStat.mtimeMs) {
				console.log("[ICON] icon.png is newer than icon.ico - regenerating...")
				process.exit(1)
			}
		}

		console.log("[ICON] Up to date - skipped")
		process.exit(0)
		break
	}

	default: {
		console.error(`Unknown timer action: ${command}`)
		process.exit(1)
	}
}
