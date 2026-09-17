import { build } from "esbuild"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

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

	// 4. Copy engine if built
	let rootDir = __dirname
	while (rootDir !== path.dirname(rootDir)) {
		if (fs.existsSync(path.join(rootDir, "src", "dist", "extension.js"))) break
		rootDir = path.dirname(rootDir)
	}
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

	// 6. Copy ripgrep binary into dist/node_modules/@vscode/ripgrep/bin/
	const rgBinaryName = process.platform === "win32" ? "rg.exe" : "rg"
	let rgSrc = ""
	function findRg(dir, depth = 0) {
		if (depth > 6 || !fs.existsSync(dir)) return
		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true })
			for (const entry of entries) {
				const full = path.join(dir, entry.name)
				if (entry.isFile() && entry.name === rgBinaryName) {
					rgSrc = full
					return
				}
				if (
					entry.isDirectory() &&
					(entry.name === "node_modules" ||
						entry.name.includes("ripgrep") ||
						entry.name === ".pnpm" ||
						entry.name === "bin" ||
						entry.name === "@vscode")
				) {
					findRg(full, depth + 1)
					if (rgSrc) return
				}
			}
		} catch {}
	}
	findRg(path.join(rootDir, "node_modules"))
	if (rgSrc) {
		console.log(`🔍 Found ripgrep binary at: ${rgSrc}`)
		const rgDestDir = path.join(outDir, "node_modules", "@vscode", "ripgrep", "bin")
		fs.mkdirSync(rgDestDir, { recursive: true })
		fs.copyFileSync(rgSrc, path.join(rgDestDir, rgBinaryName))
		console.log(`📦 Bundled ripgrep into dist/node_modules/@vscode/ripgrep/bin/${rgBinaryName}`)
	}

	console.log("✅ @roo-code/desktop build complete!")
}

runBuild().catch((err) => {
	console.error("❌ Build failed:", err)
	process.exit(1)
})
