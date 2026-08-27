import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS,
  RIGHT_PANEL_STORAGE_KEYS,
  RIGHT_PANEL_TRANSITION_MS,
  clampRightPanelWidth,
  readRightPanelDiffStyle,
  readRightPanelDisplayOptions,
  readRightPanelExpanded,
  readRightPanelWidth,
  resolveRightPanelMaxWidth,
  useRightPanelLayout,
  useRightPanelVisibility,
} from "./useRightPanelLayout";

describe("右侧面板布局", () => {
  beforeEach(() => window.localStorage.clear());

  it("约束宽度并根据视口计算上限", () => {
    expect(clampRightPanelWidth(1)).toBe(320);
    expect(clampRightPanelWidth(1500)).toBe(1200);
    expect(clampRightPanelWidth(Number.NaN)).toBe(560);
    expect(resolveRightPanelMaxWidth(900)).toBe(450);
    expect(resolveRightPanelMaxWidth(200)).toBe(320);
    expect(resolveRightPanelMaxWidth(null)).toBe(1200);
  });

  it("忽略损坏或不可用的持久化值", () => {
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEYS.width, "broken");
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEYS.expanded, "unknown");
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEYS.diffStyle, "other");
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEYS.displayOptions, "{");
    expect(readRightPanelWidth()).toBe(560);
    expect(readRightPanelExpanded()).toBe(false);
    expect(readRightPanelDiffStyle()).toBe("unified");
    expect(readRightPanelDisplayOptions()).toEqual(DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS);

    const storage = { getItem: vi.fn(() => { throw new Error("blocked"); }), setItem: vi.fn() };
    expect(readRightPanelWidth(storage)).toBe(560);
  });

  it("更新并持久化布局与审查选项", () => {
    const { result } = renderHook(() => useRightPanelLayout());
    act(() => result.current.setWidth(340));
    act(() => result.current.setExpanded(true));
    act(() => result.current.toggleDiffStyle());
    act(() => result.current.toggleDisplayOption("wordWrap"));
    expect(result.current.width).toBe(340);
    expect(result.current.expanded).toBe(true);
    expect(result.current.diffStyle).toBe("split");
    expect(result.current.displayOptions.wordWrap).toBe(true);
    expect(window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEYS.width)).toBe("340");
    expect(window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEYS.expanded)).toBe("1");
    expect(window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEYS.diffStyle)).toBe("split");
  });

  it("补齐部分展示选项并支持显式设置与重置", () => {
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEYS.displayOptions, JSON.stringify({ wordWrap: true, richPreview: "yes" }));
    expect(readRightPanelDisplayOptions()).toEqual({ ...DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS, wordWrap: true });
    const { result } = renderHook(() => useRightPanelLayout());
    act(() => result.current.setDisplayOption("hideWhitespace", true));
    act(() => result.current.setDiffStyle("unified"));
    act(() => result.current.resetWidth());
    expect(result.current.displayOptions.hideWhitespace).toBe(true);
    expect(result.current.diffStyle).toBe("unified");
    expect(result.current.width).toBeLessThanOrEqual(result.current.maxWidth);
  });

  it("在打开与关闭期间保留面板以完成过渡", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ enabled }) => useRightPanelVisibility(enabled), {
      initialProps: { enabled: true },
    });

    act(() => result.current.closePanel());
    expect(result.current.available).toBe(false);
    act(() => result.current.togglePanel());
    expect(result.current).toMatchObject({ open: true, available: true, opening: true, closing: false });
    act(() => vi.advanceTimersByTime(RIGHT_PANEL_TRANSITION_MS));
    expect(result.current.opening).toBe(false);

    act(() => result.current.togglePanel());
    expect(result.current).toMatchObject({ open: false, available: true, opening: false, closing: true });
    act(() => vi.advanceTimersByTime(RIGHT_PANEL_TRANSITION_MS));
    expect(result.current).toMatchObject({ open: false, available: false, closing: false });

    act(() => result.current.openPanel());
    rerender({ enabled: false });
    expect(result.current).toMatchObject({ open: false, available: false, opening: false, closing: false });
    act(() => result.current.openPanel());
    expect(result.current.available).toBe(false);
    vi.useRealTimers();
  });
});
