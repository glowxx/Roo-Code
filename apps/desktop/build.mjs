import { build } from "esbuild"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import { execSync } from "child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function runBuild() {
	console.log("🔨 Building @roo-code/desktop...")

	const outDir = path.join(__dirname, "dist")
	if (!fs.existsSync(outDir)) {
		fs.mkdirSync(outDir, { recursive: true })
	}

	// 1. Build Node / Main / CLI scripts
	await build({
		entryPoints: [
			{ in: path.join(__dirname, "src/main/index.ts"), out: "main/index" },
			{ in: path.join(__dirname, "src/main/server.ts"), out: "main/server" },
			{ in: path.join(__dirname, "src/main/agent-host.ts"), out: "main/agent-host" },
			{ in: path.join(__dirname, "src/cli.ts"), out: "cli" },
		],
		outdir: outDir,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		sourcemap: true,
		banner: {
			js: 'import { createRequire as __topLevelCreateRequire } from "module"; const require = __topLevelCreateRequire(import.meta.url);',
		},
		external: [
			"electron",
			"@vscode/ripgrep",
			"fsevents",
		],
	})

	// 2. Build Preload script (CJS for Electron preload compatibility)
	await build({
		entryPoints: [path.join(__dirname, "src/preload/index.ts")],
		outfile: path.join(outDir, "preload/index.js"),
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node20",
		external: ["electron"],
		sourcemap: true,
	})

	// 3. Copy renderer files
	const rendererSrc = path.join(__dirname, "src/renderer")
	const rendererDist = path.join(outDir, "renderer")
	if (!fs.existsSync(rendererDist)) {
		fs.mkdirSync(rendererDist, { recursive: true })
	}

	const files = fs.readdirSync(rendererSrc)
	for (const file of files) {
		const srcPath = path.join(rendererSrc, file)
		if (fs.statSync(srcPath).isFile()) {
			fs.copyFileSync(srcPath, path.join(rendererDist, file))
		}
	}

	function copyDir(src, dest) {
		if (!fs.existsSync(src)) return
		fs.mkdirSync(dest, { recursive: true })
		for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
			const srcEntry = path.join(src, entry.name)
			const destEntry = path.join(dest, entry.name)
			if (entry.isDirectory()) {
				copyDir(srcEntry, destEntry)
			} else if (entry.isFile()) {
				fs.copyFileSync(srcEntry, destEntry)
			}
		}
	}

	// 4. Compile and copy engine
	let rootDir = __dirname
	while (rootDir !== path.dirname(rootDir)) {
		if (fs.existsSync(path.join(rootDir, "pnpm-workspace.yaml"))) break
		rootDir = path.dirname(rootDir)
	}
	if (!fs.existsSync(path.join(rootDir, "pnpm-workspace.yaml"))) {
		rootDir = path.resolve(__dirname, "../..")
	}

	console.log("⚙️ Compiling core engine (roo-cline)...")
	execSync("pnpm --filter roo-cline build", { cwd: rootDir, stdio: "inherit" })

	const engineSrc = path.join(rootDir, "src", "dist")
	if (fs.existsSync(engineSrc)) {
		console.log("📦 Bundling engine files into dist/engine...")
		copyDir(engineSrc, path.join(outDir, "engine"))
		fs.writeFileSync(
			path.join(outDir, "engine", "package.json"),
			JSON.stringify({ name: "@roo-code/engine", type: "commonjs" }, null, 2)
		)
	}

	// 5. Copy webview if built
	const webviewSrc = path.join(rootDir, "src", "webview-ui", "build")
	if (fs.existsSync(webviewSrc)) {
		console.log("🎨 Bundling webview UI into dist/webview...")
		copyDir(webviewSrc, path.join(outDir, "webview"))
	}

	// 6. Deterministyczna lokalizacja i kopiowanie ripgrep binary into dist/node_modules/@vscode/ripgrep/bin/
	const rgBinaryName = process.platform === "win32" ? "rg.exe" : "rg"
	let rgSrc = ""
	let rgSourceType = ""

	// 1. Sprawdzenie @vscode/ripgrep w node_modules za pomocą require.resolve
	const candidateRoots = [
		import.meta.url,
		path.join(rootDir, "apps", "cli", "package.json"),
		path.join(rootDir, "apps", "desktop", "package.json"),
		path.join(rootDir, "src", "package.json"),
		path.join(rootDir, "package.json"),
	]

	for (const candidate of candidateRoots) {
		try {
			const req = createRequire(candidate)
			const rgModule = req("@vscode/ripgrep")
			if (rgModule && rgModule.rgPath && fs.existsSync(rgModule.rgPath)) {
				rgSrc = rgModule.rgPath
				rgSourceType = `@vscode/ripgrep module (${path.relative(rootDir, candidate)})`
				break
			}
			const resolvedPath = req.resolve("@vscode/ripgrep")
			const binCandidate = path.join(path.dirname(resolvedPath), "..", "bin", rgBinaryName)
			if (fs.existsSync(binCandidate)) {
				rgSrc = binCandidate
				rgSourceType = `@vscode/ripgrep resolved bin (${path.relative(rootDir, candidate)})`
				break
			}
		} catch {}
	}

	// 2. Binarka w process.resourcesPath (dla spakowanej aplikacji Electron)
	if (!rgSrc && process.resourcesPath) {
		const resourceCandidates = [
			path.join(process.resourcesPath, "bin", rgBinaryName),
			path.join(process.resourcesPath, "node_modules", "@vscode", "ripgrep", "bin", rgBinaryName),
		]
		for (const resPath of resourceCandidates) {
			if (fs.existsSync(resPath)) {
				rgSrc = resPath
				rgSourceType = "process.resourcesPath"
				break
			}
		}
	}

	// 3. Systemowy rg dostępny w zmiennej środowiskowej PATH jako ostateczny fallback
	if (!rgSrc) {
		try {
			const checkCmd = process.platform === "win32" ? `where ${rgBinaryName}` : `which ${rgBinaryName}`
			const sysRg = execSync(checkCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
				.split(/\r?\n/)[0]
				?.trim()
			if (sysRg && fs.existsSync(sysRg)) {
				rgSrc = sysRg
				rgSourceType = "system PATH"
			}
		} catch {}
	}

	if (rgSrc) {
		console.log(`🔍 Located ripgrep binary via ${rgSourceType}: ${rgSrc}`)
		const rgDestDir = path.join(outDir, "node_modules", "@vscode", "ripgrep", "bin")
		fs.mkdirSync(rgDestDir, { recursive: true })
		fs.copyFileSync(rgSrc, path.join(rgDestDir, rgBinaryName))
		console.log(`📦 Bundled ripgrep into dist/node_modules/@vscode/ripgrep/bin/${rgBinaryName}`)
	} else {
		console.warn(`⚠️ Warning: Could not locate ${rgBinaryName}. Search features may fail without bundled ripgrep.`)
	}

	console.log("✅ @roo-code/desktop build complete!")
}

runBuild().catch((err) => {
	console.error("❌ Build failed:", err)
	process.exit(1)
})
