import { readFileSync } from "fs"
import { resolve } from "path"
import { createRequire } from "module"
import { describe, expect, it } from "vitest"

const { JSDOM } = createRequire(import.meta.url)(resolve(__dirname, "../../../../webview-ui/node_modules/jsdom")) as {
	JSDOM: new (html: string) => { window: { document: Document } }
}

describe("desktop project rename rendering", () => {
	it("updates both custom names in the existing sidebar rows without changing paths, chats or order", () => {
		const source = readFileSync(resolve(__dirname, "../../src/renderer/app.js"), "utf8")
		const start = source.indexOf("\tfunction tryPatchSidebarInPlace(")
		const end = source.indexOf("\n\tlet isDraggingProject", start)
		const patchSource = source.slice(start, end)
		const dom = new JSDOM(`<div id="projects">
			<div class="sidebar-project-item" data-workspace="C:\\A"><div class="project-header"><span class="project-name" title="A">A</span><span class="project-path">C:\\A</span></div><div class="project-chats-list"></div></div>
			<div class="sidebar-project-item" data-workspace="C:\\B"><div class="project-header"><span class="project-name" title="B">B</span><span class="project-path">C:\\B</span></div><div class="project-chats-list"></div></div>
		</div>`)
		const projectList = dom.window.document.getElementById("projects")!
		const workspaceA = "C:\\A"
		const workspaceB = "C:\\B"
		const names: Record<string, string> = { [workspaceA]: "Roo A", [workspaceB]: "Roo B" }
		const patch = new Function("sidebarProjectsListEl", "projectExpansions", "sidebarData", "pathNormalize", "getProjectDisplayName", "tDesktop", "document",
			patchSource + "\nreturn tryPatchSidebarInPlace")(
			projectList, new Set(), { chats: {} }, (path: string) => path.toLowerCase(), (path: string) => names[path], () => "Active", dom.window.document,
		) as (workspaces: string[], current: string) => boolean
		expect(patch([workspaceA, workspaceB], "")).toBe(true)
		expect([...projectList.querySelectorAll(".project-name")].map((el) => el.textContent)).toEqual(["Roo A", "Roo B"])
		expect([...projectList.querySelectorAll(".project-path")].map((el) => el.textContent)).toEqual([workspaceA, workspaceB])
		expect([...projectList.children].map((el) => el.getAttribute("data-workspace"))).toEqual([workspaceA, workspaceB])
	})
})
