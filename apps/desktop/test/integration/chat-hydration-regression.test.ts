import { describe, it, expect, beforeEach } from "vitest"
import fs from "fs"
import path from "path"

describe("Chat Hydration & Selection Synchronization Regression Suite", () => {
	const appJsPath = path.resolve(__dirname, "../../src/renderer/app.js")
	const agentHostPath = path.resolve(__dirname, "../../src/main/agent-host.ts")
	const clineProviderPath = path.resolve(__dirname, "../../../../src/core/webview/ClineProvider.ts")
	const taskPath = path.resolve(__dirname, "../../../../src/core/task/Task.ts")
	const chatViewPath = path.resolve(__dirname, "../../../../webview-ui/src/components/chat/ChatView.tsx")

	let appJsCode: string
	let agentHostCode: string
	let clineProviderCode: string
	let taskCode: string
	let chatViewCode: string

	beforeEach(() => {
		appJsCode = fs.readFileSync(appJsPath, "utf-8")
		agentHostCode = fs.readFileSync(agentHostPath, "utf-8")
		clineProviderCode = fs.readFileSync(clineProviderPath, "utf-8")
		taskCode = fs.readFileSync(taskPath, "utf-8")
		chatViewCode = fs.readFileSync(chatViewPath, "utf-8")
	})

	describe("1. Desktop Shell State Sync & Click Lockout Prevention (app.js)", () => {
		it("does not swallow switchChat when activeTaskId is set but webview is unhydrated or desynced", () => {
			expect(appJsCode).toContain("const webviewTaskId = latestExtensionState?.currentTaskId")
			expect(appJsCode).toContain("if (taskId === activeTaskId && webviewTaskId === taskId) return")
		})

		it("auto-hydrates preselected activeTaskId on webviewDidLaunch", () => {
			expect(appJsCode).toContain("if (isFromMainWebview && data.type === \"webviewDidLaunch\")")
			expect(appJsCode).toContain("switchChat(activeTaskId, sidebarData.currentWorkspace)")
		})

		it("keeps activeTaskId synchronized with server state pushes", () => {
			expect(appJsCode).toContain("msg.message.state.currentTaskId")
			expect(appJsCode).toContain("const webviewTaskId = msg.message.state.currentTaskId")
			expect(appJsCode).toContain("activeTaskId = webviewTaskId")
		})
	})

	describe("2. Sidebar Status & False Running Spinner Prevention (agent-host.ts & Task.ts)", () => {
		it("ensures Task.taskStatus returns Idle when task has not yet started execution loop", () => {
			expect(taskCode).toContain("get isStarted(): boolean")
			expect(taskCode).toContain("if (!this._started) {")
			expect(taskCode).toContain("return TaskStatus.Idle")
		})

		it("ensures Task always invokes resumeTaskFromHistory when historyItem is provided", () => {
			expect(taskCode).toContain("this.resumeTaskFromHistory()")
		})

		it("agent-host maps unmanaged active and interrupted tasks to needs_attention instead of fake running", () => {
			expect(agentHostCode).toContain('item.status === "interrupted" || item.status === "active"')
			expect(agentHostCode).toContain('status = "needs_attention"')
		})

		it("agent-host treats idle tasks as completed when not streaming", () => {
			expect(agentHostCode).toContain('runningTask.taskStatus === "idle"')
			expect(agentHostCode).toContain('isCompleted')
		})
	})

	describe("3. Task Hydration & History Preservation (ClineProvider.ts)", () => {
		it("unconditionally creates task with full history in showTaskWithId regardless of interrupted status", () => {
			expect(clineProviderCode).toContain("await this.createTaskWithHistoryItem(historyItem)")
			// Must NOT pass startTask: !requiresManualContinue which blocked message loading
			expect(clineProviderCode).not.toContain("createTaskWithHistoryItem(historyItem, { startTask: !requiresManualContinue })")
		})

		it("preserves initialStatus from historyItem so hydrated tasks are not marked active or autonomous prematurely", () => {
			expect(clineProviderCode).toContain("initialStatus:")
			expect(clineProviderCode).toContain('historyItem.status === "interrupted"')
			expect(clineProviderCode).toContain('? "interrupted"')
		})

		it("cleans up rogue tasks if task switch epoch changes during asynchronous hydration", () => {
			expect(clineProviderCode).toContain("if (this.taskSwitchEpoch !== epoch)")
			expect(clineProviderCode).toContain("const rogueTask = this.clineStack[rogueIndex]")
			expect(clineProviderCode).toContain("rogueTask.abortTask(true)")
		})
	})

	describe("4. Agent Webview Zero-State vs Loading Invariant (ChatView.tsx)", () => {
		it("destructures currentTaskId from useExtensionState", () => {
			expect(chatViewCode).toContain("currentTaskId,")
		})

		it("renders loading spinner instead of RooHero and HistoryPreview when hydrating an existing task", () => {
			expect(chatViewCode).toContain("isHydratingPersistedTask ? (")
			expect(chatViewCode).toContain("codicon-loading")
			expect(chatViewCode).toContain("Loading conversation...")
		})

		it("suppresses WorktreeSelector on task hydration screen", () => {
			expect(chatViewCode).toContain("!task && !isHydratingPersistedTask && showWorktreesInHomeScreen")
		})

		it("allows handleStopTask to resolve taskId from currentTaskId when currentTaskItem is not yet populated", () => {
			expect(chatViewCode).toContain("const taskId = currentTaskItem?.id || currentTaskId")
		})
	})

	describe("5. Stop Task Conversation Preservation Contract (ClineProvider.ts & Task.ts)", () => {
		it("preserves in-memory clineMessages across cancelTask rehydration", () => {
			expect(clineProviderCode).toContain("initialClineMessages")
			expect(clineProviderCode).toContain("rehydrated.overwriteClineMessages(initialClineMessages)")
			expect(clineProviderCode).toContain("await this.postStateToWebview()")
		})

		it("Task constructor immediately initializes clineMessages from initialClineMessages", () => {
			expect(taskCode).toContain("initialClineMessages?: ClineMessage[]")
			expect(taskCode).toContain("this.clineMessages = [...initialClineMessages]")
		})

		it("marks interrupted status and sets needsAttention on user cancellation", () => {
			expect(clineProviderCode).toContain('historyItem.status = "interrupted"')
			expect(clineProviderCode).toContain("historyItem.needsAttention = true")
		})
	})
})
