import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  applyAppPreferences,
  loadAppPreferences,
  normalizeAppPreferences,
  resolveTheme,
  saveAppPreferences,
  useAppPreferences,
} from "./useAppPreferences";

describe("app preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-interface-density");
    document.documentElement.removeAttribute("data-reduce-motion");
    document.documentElement.removeAttribute("data-sidebar-translucent");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-preference");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("在缺失、损坏或版本不兼容时回退默认值", () => {
    expect(loadAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);

    window.localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, "{");
    expect(loadAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);

    expect(normalizeAppPreferences({ schemaVersion: 2, showSuggestions: false })).toEqual(
      DEFAULT_APP_PREFERENCES,
    );
  });

  it("仅接受受支持的字段值并持久化规范结果", () => {
    const saved = saveAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      showSuggestions: false,
      sidebarTranslucent: true,
      theme: "dark",
      interfaceDensity: "compact",
    });

    expect(saved.showSuggestions).toBe(false);
    expect(loadAppPreferences()).toEqual(saved);
    expect(
      normalizeAppPreferences({
        ...saved,
        showRuntimeStatus: "no",
        theme: "sepia",
        interfaceDensity: "dense",
      }),
    ).toMatchObject({
      showRuntimeStatus: true,
      theme: "system",
      interfaceDensity: "comfortable",
    });
  });

  it("将外观偏好应用为稳定的根节点状态", () => {
    applyAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      theme: "dark",
      interfaceDensity: "compact",
      reduceMotion: true,
      sidebarTranslucent: true,
    });

    expect(document.documentElement.dataset.interfaceDensity).toBe("compact");
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    expect(document.documentElement.dataset.sidebarTranslucent).toBe("true");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("跟随系统时解析并应用当前系统主题", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");

    applyAppPreferences(DEFAULT_APP_PREFERENCES, true);
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("跟随系统时响应系统配色变化并在卸载时停止监听", () => {
    let systemPrefersDark = false;
    let changeListener: (() => void) | null = null;
    const mediaQuery = {
      get matches() {
        return systemPrefersDark;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        changeListener = listener;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

    const { unmount } = renderHook(() => useAppPreferences());
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      systemPrefersDark = true;
      changeListener?.();
    });
    expect(document.documentElement.dataset.theme).toBe("dark");

    unmount();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith("change", changeListener);
  });

  it("存储不可用时保留内存中的有效偏好", () => {
    const unavailableStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };

    expect(loadAppPreferences(unavailableStorage)).toEqual(DEFAULT_APP_PREFERENCES);
    expect(
      saveAppPreferences(
        { ...DEFAULT_APP_PREFERENCES, confirmRemoveWorkspace: false },
        unavailableStorage,
      ),
    ).toMatchObject({ confirmRemoveWorkspace: false });
  });
});
