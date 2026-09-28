import { describe, it, expect } from "vitest"

describe("Code Viewer Syntax Highlighting Helpers (TDD)", () => {
	const EXTENSION_MAP: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		json: "json",
		py: "python",
		html: "xml",
		htm: "xml",
		xml: "xml",
		svg: "xml",
		css: "css",
		scss: "scss",
		less: "less",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		ps1: "powershell",
		yaml: "yaml",
		yml: "yaml",
		md: "markdown",
		markdown: "markdown",
		sql: "sql",
		rs: "rust",
		go: "go",
		java: "java",
		c: "c",
		h: "c",
		cpp: "cpp",
		hpp: "cpp",
		cs: "csharp",
		txt: "plaintext",
	}

	function detectLanguage(filePath: string): string {
		const ext = filePath.split(".").pop()?.toLowerCase() || ""
		return EXTENSION_MAP[ext] || "plaintext"
	}

	function splitHtmlLinesSafely(html: string): string[] {
		// When highlight.js produces HTML with multi-line spans, e.g. <span class="hljs-string">hello\nworld</span>,
		// splitting purely by \n leaves open tags on the first line and dangling close tags on the next.
		// We track open tags and re-wrap lines so each line is balanced valid HTML.
		const lines = html.split("\n")
		const result: string[] = []
		const openTags: string[] = []

		for (const line of lines) {
			let reconstructed = openTags.join("") + line
			// Update tag stack based on tags opened and closed in this line
			const tagRegex = /<\/?([a-zA-Z0-9-]+)(?:\s+[^>]*?)?>/g
			let match: RegExpExecArray | null
			while ((match = tagRegex.exec(line)) !== null) {
				const fullTag = match[0]
				if (fullTag.startsWith("</")) {
					openTags.pop()
				} else if (!fullTag.endsWith("/>")) {
					openTags.push(fullTag)
				}
			}
			// Close any open tags for this line's display
			for (let i = openTags.length - 1; i >= 0; i--) {
				const tagMatch = /<([a-zA-Z0-9-]+)/.exec(openTags[i]!)
				if (tagMatch) {
					reconstructed += `</${tagMatch[1]}>`
				}
			}
			result.push(reconstructed)
		}
		return result
	}

	it("detects programming language by file extension correctly", () => {
		expect(detectLanguage("src/main.ts")).toBe("typescript")
		expect(detectLanguage("components/Header.tsx")).toBe("typescript")
		expect(detectLanguage("scripts/build.mjs")).toBe("javascript")
		expect(detectLanguage("data/config.json")).toBe("json")
		expect(detectLanguage("server/app.py")).toBe("python")
		expect(detectLanguage("public/index.html")).toBe("xml")
		expect(detectLanguage("styles/theme.scss")).toBe("scss")
		expect(detectLanguage("scripts/deploy.sh")).toBe("bash")
		expect(detectLanguage("scripts/run.ps1")).toBe("powershell")
		expect(detectLanguage("config.yaml")).toBe("yaml")
		expect(detectLanguage("README.md")).toBe("markdown")
		expect(detectLanguage("main.rs")).toBe("rust")
		expect(detectLanguage("main.go")).toBe("go")
		expect(detectLanguage("App.java")).toBe("java")
		expect(detectLanguage("core.cpp")).toBe("cpp")
		expect(detectLanguage("Program.cs")).toBe("csharp")
		expect(detectLanguage("query.sql")).toBe("sql")
		expect(detectLanguage("unknown.xyz123")).toBe("plaintext")
	})

	it("splits multi-line highlighted HTML into valid balanced line strings", () => {
		const rawHighlight = '<span class="hljs-string">line 1\nline 2</span>'
		const lines = splitHtmlLinesSafely(rawHighlight)
		expect(lines).toHaveLength(2)
		expect(lines[0]).toBe('<span class="hljs-string">line 1</span>')
		expect(lines[1]).toBe('<span class="hljs-string">line 2</span>')
	})
})
