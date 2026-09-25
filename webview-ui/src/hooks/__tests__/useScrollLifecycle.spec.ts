import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useScrollLifecycle } from "../useScrollLifecycle"
import type { VirtuosoHandle } from "react-virtuoso"

describe("useScrollLifecycle - message editing scroll lock", () => {
	let mockVirtuosoHandle: VirtuosoHandle
	let virtuosoRef: { current: VirtuosoHandle | null }
	let scrollContainerRef: { current: HTMLDivElement | null }

	beforeEach(() => {
		mockVirtuosoHandle = {
			scrollToIndex: vi.fn(),
			scrollTo: vi.fn(),
			scrollBy: vi.fn(),
		} as unknown as VirtuosoHandle

		virtuosoRef = { current: mockVirtuosoHandle }
		scrollContainerRef = { current: document.createElement("div") }
	})

	it("transitions to USER_BROWSING_HISTORY and disables followOutput when editing begins", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)

		// Initially, followOutputCallback would return "auto" in ANCHORED_FOLLOWING or after hydration
		act(() => {
			result.current.setEditingMessage(true)
		})

		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
		expect(result.current.followOutputCallback()).toBe(false)
		expect(result.current.isEditingMessageRef.current).toBe(true)
	})

	it("prevents atBottomStateChange from re-engaging ANCHORED_FOLLOWING while editing", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)

		act(() => {
			result.current.setEditingMessage(true)
		})

		// Virtuoso reports isAtBottom = true (e.g. row expansion touched bottom threshold)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})

		// Must remain in USER_BROWSING_HISTORY and followOutput must still be false!
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
		expect(result.current.followOutputCallback()).toBe(false)
	})

	it("prevents handleRowHeightChange from scrolling to bottom while editing", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)

		act(() => {
			result.current.setEditingMessage(true)
		})

		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		// Even with isStreaming=true and isTaller=true, handleRowHeightChange must be a no-op
		act(() => {
			result.current.handleRowHeightChange(true)
		})

		expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
	})

	it("releases editing lock when setEditingMessage(false) is called", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)

		act(() => {
			result.current.setEditingMessage(true)
		})
		expect(result.current.isEditingMessageRef.current).toBe(true)

		act(() => {
			result.current.setEditingMessage(false)
		})
		expect(result.current.isEditingMessageRef.current).toBe(false)
	})
})

describe("useScrollLifecycle - sticky bottom auto-follow and regressions", () => {
	let mockVirtuosoHandle: VirtuosoHandle
	let virtuosoRef: { current: VirtuosoHandle | null }
	let scrollContainerRef: { current: HTMLDivElement | null }

	beforeEach(() => {
		mockVirtuosoHandle = {
			scrollToIndex: vi.fn(),
			scrollTo: vi.fn(),
			scrollBy: vi.fn(),
		} as unknown as VirtuosoHandle

		virtuosoRef = { current: mockVirtuosoHandle }
		const container = document.createElement("div")
		document.body.appendChild(container)
		scrollContainerRef = { current: container }
	})

	it("maintains ANCHORED_FOLLOWING and auto-scrolls on content growth when isStreaming is false", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)

		// Transition to ANCHORED_FOLLOWING (user is at bottom)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		// Content grows (e.g. command output line, tool execution, thinking block expands, error appears)
		// Virtuoso emits atBottom = false because bottom was pushed below viewport
		act(() => {
			result.current.atBottomStateChangeCallback(false)
		})

		// Scroll phase must remain ANCHORED_FOLLOWING (not downgraded to USER_BROWSING_HISTORY)
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.showScrollToBottom).toBe(false)

		// When row height change is reported for the growing content, it MUST auto-scroll to bottom
		// even though isStreaming is false and isAtBottomRef is false!
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()
		act(() => {
			result.current.handleRowHeightChange(true)
		})
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
	})

	it("does NOT falsely disengage to USER_BROWSING_HISTORY when pointer is down during content growth", () => {
		const scrollable = document.createElement("div")
		scrollable.className = "scrollable"
		scrollContainerRef.current?.appendChild(scrollable)

		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)

		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")

		// User clicks or presses mouse down in the chat container (e.g. to focus or select text)
		act(() => {
			const event = new MouseEvent("pointerdown", { bubbles: true })
			scrollable.dispatchEvent(event)
		})

		// Content grows while mouse is held down, triggering atBottom = false
		act(() => {
			result.current.atBottomStateChangeCallback(false)
		})

		// Bug: line 357 previously checked pointerScrollActiveRef.current and falsely transitioned to USER_BROWSING_HISTORY
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.followOutputCallback()).toBe("auto")
	})

	it("uses immediate auto behavior for row height changes to avoid animation backlog", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1000,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)

		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		act(() => {
			result.current.handleRowHeightChange(true)
		})

		// Must use behavior: "auto" rather than debounced "smooth" during active following
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
	})

	it("preserves conversation scroll state across switching without clobbering history browsing", () => {
		let currentTaskTs = 1000
		const { result, rerender } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: currentTaskTs,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)

		// In Task 1000, user scrolls up into history
		act(() => {
			result.current.enterUserBrowsingHistory("wheel-up")
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")

		// Switch to Task 2000
		currentTaskTs = 2000
		rerender()

		// Task 2000 enters hydration/pinned
		expect(result.current.scrollPhase).toBe("HYDRATING_PINNED_TO_BOTTOM")

		// Switch back to Task 1000
		currentTaskTs = 1000
		rerender()

		// Task 1000 must restore USER_BROWSING_HISTORY, not jump to bottom!
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
	})
})

describe("useScrollLifecycle - 17 canonical regression cases and stress simulations", () => {
	let mockVirtuosoHandle: VirtuosoHandle
	let virtuosoRef: { current: VirtuosoHandle | null }
	let scrollContainerRef: { current: HTMLDivElement | null }
	let resizeCallback: ((entries: ResizeObserverEntry[]) => void) | null = null

	beforeEach(() => {
		mockVirtuosoHandle = {
			scrollToIndex: vi.fn(),
			scrollTo: vi.fn(),
			scrollBy: vi.fn(),
		} as unknown as VirtuosoHandle

		virtuosoRef = { current: mockVirtuosoHandle }
		const container = document.createElement("div")
		document.body.appendChild(container)
		scrollContainerRef = { current: container }

		resizeCallback = null
		global.ResizeObserver = class {
			constructor(cb: any) {
				resizeCallback = cb
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		} as any
	})

	// Case 1: user at bottom + append message → remains bottom
	it("Case 1: user at bottom + append message keeps followOutput auto", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1001,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.followOutputCallback()).toBe("auto")
	})

	// Case 2: user at bottom + existing final row grows → remains bottom
	it("Case 2: user at bottom + existing final row grows auto-scrolls to bottom", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1002,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		act(() => {
			result.current.handleRowHeightChange(true)
		})
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
	})

	// Case 3: assistant streaming same message → follows bottom
	it("Case 3: assistant streaming same message repeatedly triggers auto-scroll to bottom", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1003,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		for (let i = 0; i < 10; i++) {
			act(() => {
				result.current.handleRowHeightChange(true)
			})
		}
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(10)
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
	})

	// Case 4: Thinking row grows → follows bottom
	it("Case 4: thinking row growth triggers auto-scroll even when isStreaming is false", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1004,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		act(() => {
			result.current.handleRowHeightChange(true)
		})
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
	})

	// Case 5: Command output grows → follows bottom
	it("Case 5: command output streaming triggers auto-scroll while in ANCHORED_FOLLOWING", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1005,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		act(() => {
			result.current.handleRowHeightChange(true)
		})
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
	})

	// Case 6: composer height grows → latest content remains visible via ResizeObserver
	it("Case 6: container resizing while anchored triggers auto-scroll", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1006,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		// Initial height was 500, container shrinks to 450 (e.g. composer expands or action buttons appear)
		act(() => {
			resizeCallback?.([
				{
					contentRect: { height: 500 } as DOMRectReadOnly,
				} as ResizeObserverEntry,
			])
		})

		act(() => {
			resizeCallback?.([
				{
					contentRect: { height: 450 } as DOMRectReadOnly,
				} as ResizeObserverEntry,
			])
		})
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
	})

	// Case 7: user manually scrolls up → no auto-follow
	it("Case 7: manual wheel upward scroll disengages followOutput", () => {
		const scrollable = document.createElement("div")
		scrollable.className = "scrollable"
		scrollContainerRef.current?.appendChild(scrollable)

		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1007,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")

		// Wheel up event
		act(() => {
			const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true })
			scrollable.dispatchEvent(wheel)
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
		expect(result.current.followOutputCallback()).toBe(false)
		expect(result.current.showScrollToBottom).toBe(true)
	})

	// Case 8: new messages while browsing history → position preserved
	it("Case 8: new messages while browsing history do NOT force scroll", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1008,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.enterUserBrowsingHistory("wheel-up")
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		act(() => {
			result.current.handleRowHeightChange(true)
		})
		expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
		expect(result.current.followOutputCallback()).toBe(false)
	})

	// Case 9: user manually returns bottom → follow re-enabled
	it("Case 9: user returns to bottom re-enables ANCHORED_FOLLOWING and auto follow", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1009,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)
		// Step 1: User is at bottom
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")

		// Step 2: User manually scrolls up
		act(() => {
			result.current.enterUserBrowsingHistory("wheel-up")
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")

		// Step 3: User manually returns to bottom
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.showScrollToBottom).toBe(false)
		expect(result.current.followOutputCallback()).toBe("auto")
	})

	// Case 10: temporary atBottom=false caused by content growth → does NOT mark user browsing
	it("Case 10: atBottom=false from content growth maintains ANCHORED_FOLLOWING", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1010,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")

		// Content pushes bottom
		act(() => {
			result.current.atBottomStateChangeCallback(false)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.showScrollToBottom).toBe(false)
	})

	// Case 11: actual wheel scroll upward → DOES mark user browsing
	it("Case 11: wheel scroll upward marks user browsing", () => {
		const scrollable = document.createElement("div")
		scrollable.className = "scrollable"
		scrollContainerRef.current?.appendChild(scrollable)

		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1011,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})

		act(() => {
			const event = new WheelEvent("wheel", { deltaY: -50, bubbles: true })
			scrollable.dispatchEvent(event)
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
	})

	// Case 12: prompt editing → no forced bottom
	it("Case 12: prompt editing prevents forced bottom and auto-scrolling", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1012,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.setEditingMessage(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		act(() => {
			result.current.handleRowHeightChange(true)
		})
		expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
		expect(result.current.followOutputCallback()).toBe(false)
	})

	// Case 13: editing ends while bottom → normal follow restored
	it("Case 13: editing ends while at bottom restores ANCHORED_FOLLOWING", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1013,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
			result.current.setEditingMessage(true)
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")

		// Finish editing while at bottom
		act(() => {
			result.current.setEditingMessage(false)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.followOutputCallback()).toBe("auto")
	})

	// Case 14: switch conversation and return → correct per-chat state
	it("Case 14: switching conversations isolates scroll state between tasks", () => {
		let currentTaskTs = 1014
		const { result, rerender } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: currentTaskTs,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		// Task 1014 user scrolls up
		act(() => {
			result.current.enterUserBrowsingHistory("wheel-up")
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")

		// Switch to Task 2014
		currentTaskTs = 2014
		rerender()
		expect(result.current.scrollPhase).toBe("HYDRATING_PINNED_TO_BOTTOM")

		// Switch back to Task 1014
		currentTaskTs = 1014
		rerender()
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
	})

	// Case 15: background chat receives updates → correct state on return
	it("Case 15: returning to anchored background task preserves follow mode", () => {
		let currentTaskTs = 1015
		const { result, rerender } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: currentTaskTs,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")

		// Switch away
		currentTaskTs = 2015
		rerender()

		// Switch back
		currentTaskTs = 1015
		rerender()
		// Returns in hydration pinning then anchors
		expect(result.current.scrollPhase).toBe("HYDRATING_PINNED_TO_BOTTOM")
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
	})

	// Case 16: Retry/Error row appears → visible if following bottom
	it("Case 16: Retry/Error row appearance auto-scrolls to bottom when following", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1016,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		// Error row mounts / expands
		act(() => {
			result.current.handleRowHeightChange(true)
		})
		expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
	})

	// Case 17: final completion → scroll stable
	it("Case 17: final completion preserves ANCHORED_FOLLOWING without spurious jumps", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1017,
				isStreaming: false,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")

		act(() => {
			result.current.handleRowHeightChange(false)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
	})

	// Item 28: 500+ update stress test
	it("Item 28: 500+ updates without user scroll maintains ANCHORED_FOLLOWING with zero drops", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1028,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")

		for (let i = 0; i < 500; i++) {
			act(() => {
				result.current.handleRowHeightChange(i % 2 === 0)
			})
			expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
			expect(result.current.showScrollToBottom).toBe(false)
		}
	})

	// Item 29: User scroll stress test (500 updates with user scroll at 200, return at 350)
	it("Item 29: 500-update simulation with user scroll at 200 and return at 350", () => {
		const { result } = renderHook(() =>
			useScrollLifecycle({
				virtuosoRef,
				scrollContainerRef,
				taskTs: 1029,
				isStreaming: true,
				isHidden: false,
				hasTask: true,
			}),
		)
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})

		// 1..199: Streaming follows bottom
		for (let i = 1; i < 200; i++) {
			act(() => {
				result.current.handleRowHeightChange(true)
			})
			expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		}

		// At update 200: User scrolls upward
		act(() => {
			result.current.enterUserBrowsingHistory("wheel-up")
		})
		expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
		expect(result.current.showScrollToBottom).toBe(true)
		vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()

		// 200..349: 150 updates arrive while browsing -> zero forced scrolls
		for (let i = 200; i < 350; i++) {
			act(() => {
				result.current.handleRowHeightChange(true)
			})
			expect(result.current.scrollPhase).toBe("USER_BROWSING_HISTORY")
			expect(mockVirtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
		}

		// At update 350: User returns to bottom
		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
		expect(result.current.showScrollToBottom).toBe(false)

		// 351..500: Sticky follow resumes for final 150 updates
		for (let i = 351; i <= 500; i++) {
			vi.mocked(mockVirtuosoHandle.scrollToIndex).mockClear()
			act(() => {
				result.current.handleRowHeightChange(true)
			})
			expect(result.current.scrollPhase).toBe("ANCHORED_FOLLOWING")
			expect(mockVirtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
				index: "LAST",
				align: "end",
				behavior: "auto",
			})
		}
	})
})


