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
