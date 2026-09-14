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
		external: [
			"electron",
			"ws",
			"open",
			"commander",
			"p-wait-for",
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

	console.log("✅ @roo-code/desktop build complete!")
}

runBuild().catch((err) => {
	console.error("❌ Build failed:", err)
	process.exit(1)
})
