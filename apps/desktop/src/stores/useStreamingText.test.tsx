import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStreamingText } from "./useStreamingText";

describe("useStreamingText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete document.documentElement.dataset.reduceMotion;
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.reduceMotion;
  });

  it("shows historical text immediately and progressively reveals live text in StrictMode", () => {
    const { result, rerender } = renderHook(({ content, active }) => useStreamingText(content, active), {
      initialProps: { content: "历史", active: false }, wrapper: StrictMode,
    });
    expect(result.current).toBe("历史");
    rerender({ content: "历史文字逐字展示", active: true });
    expect(result.current).toBe("历史");
    act(() => vi.advanceTimersByTime(28));
    expect(result.current).toBe("历史文");
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe("历史文字逐字展示");
  });

  it("flushes pending characters immediately when generation completes or stops", () => {
    const { result, rerender } = renderHook(({ active }) => useStreamingText("尚未展示的全部内容", active), {
      initialProps: { active: true },
    });
    expect(result.current).toBe("");
    rerender({ active: false });
    expect(result.current).toBe("尚未展示的全部内容");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("corrects replaced and shortened source text without replaying stale content", () => {
    const { result, rerender } = renderHook(({ content }) => useStreamingText(content, true), {
      initialProps: { content: "原始文本" },
    });
    act(() => vi.advanceTimersByTime(28));
    rerender({ content: "新文本" });
    expect(result.current).toBe("新文本");
    rerender({ content: "新" });
    expect(result.current).toBe("新");
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe("新");
  });

  it("keeps appending during rapid updates without resetting the scheduled reveal", () => {
    const { result, rerender } = renderHook(({ content }) => useStreamingText(content, true), {
      initialProps: { content: "甲" },
    });
    act(() => vi.advanceTimersByTime(14));
    rerender({ content: "甲乙" });
    act(() => vi.advanceTimersByTime(14));
    expect(result.current).toBe("甲");
    rerender({ content: "甲乙丙丁" });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe("甲乙丙丁");
  });

  it("bounds large burst backlog and catches up within one second", () => {
    const text = "字".repeat(10_000);
    const { result } = renderHook(() => useStreamingText(text, true));
    act(() => vi.advanceTimersByTime(28));
    expect(text.length - result.current.length).toBeLessThanOrEqual(240);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(text);
  });

  it("reveals whole emoji and combining graphemes", () => {
    const { result } = renderHook(() => useStreamingText("👨‍👩‍👧‍👦e\u0301👍🏽好", true));
    act(() => vi.advanceTimersByTime(28));
    expect(result.current).toBe("👨‍👩‍👧‍👦");
    act(() => vi.advanceTimersByTime(28));
    expect(result.current).toBe("👨‍👩‍👧‍👦e\u0301");
    act(() => vi.advanceTimersByTime(28));
    expect(result.current).toBe("👨‍👩‍👧‍👦e\u0301👍🏽");
  });

  it("flushes when hidden and does not accumulate background animation", () => {
    const { result, rerender } = renderHook(({ content }) => useStreamingText(content, true), {
      initialProps: { content: "后台之前" },
    });
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe("后台之前");
    rerender({ content: "后台之前与新增内容" });
    expect(result.current).toBe("后台之前与新增内容");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("respects system reduced motion and changes to the app preference", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const system = renderHook(() => useStreamingText("减少动态", true));
    expect(system.result.current).toBe("减少动态");
    system.unmount();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    const app = renderHook(() => useStreamingText("切换偏好后立即完整显示", true));
    expect(app.result.current).toBe("");
    await act(async () => { document.documentElement.dataset.reduceMotion = "true"; });
    expect(app.result.current).toBe("切换偏好后立即完整显示");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans pending timers and listeners on unmount", () => {
    const removeListener = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useStreamingText("卸载前仍在输出", true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
