import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  applyAppPreferences,
  loadAppPreferences,
  normalizeAppPreferences,
  resolveAppearanceBackground,
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
    document.documentElement.removeAttribute("data-background-active");
    document.documentElement.removeAttribute("data-background-preset");
    document.documentElement.removeAttribute("data-ui-scale");
    document.documentElement.removeAttribute("data-ui-font");
    document.documentElement.removeAttribute("data-ui-font-size");
    document.documentElement.removeAttribute("data-code-font");
    document.documentElement.removeAttribute("data-code-font-size");
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("在缺失、损坏或版本不兼容时回退默认值", () => {
    expect(loadAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);

    window.localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, "{");
    expect(loadAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);

    expect(normalizeAppPreferences({ schemaVersion: 3, showSuggestions: false })).toEqual(
      DEFAULT_APP_PREFERENCES,
    );
  });

  it("仅接受受支持的字段值并持久化规范结果", () => {
    const saved = saveAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      showSuggestions: false,
      desktopNotifications: false,
      taskCompletedNotifications: false,
      sidebarTranslucent: true,
      theme: "dark",
      backgroundPreset: "cyan-stage",
      uiScale: 110,
      uiFont: "microsoft-yahei",
      uiFontSize: 15,
      codeFont: "cascadia-code",
      codeFontSize: 13,
      interfaceDensity: "compact",
    });

    expect(saved.showSuggestions).toBe(false);
    expect(saved.desktopNotifications).toBe(false);
    expect(saved.taskCompletedNotifications).toBe(false);
    expect(loadAppPreferences()).toEqual(saved);
    expect(
      normalizeAppPreferences({
        ...saved,
        showRuntimeStatus: "no",
        taskFailedNotifications: "sometimes",
        notifyOnlyWhenUnfocused: null,
        theme: "sepia",
        backgroundPreset: "custom",
        customBackgroundPath: null,
        uiScale: 101,
        uiFont: "comic-sans",
        uiFontSize: 72,
        codeFont: "papyrus",
        codeFontSize: 3,
        interfaceDensity: "dense",
      }),
    ).toMatchObject({
      showRuntimeStatus: true,
      taskFailedNotifications: true,
      notifyOnlyWhenUnfocused: false,
      theme: "system",
      backgroundPreset: "default",
      uiScale: 100,
      uiFont: "system",
      uiFontSize: 14,
      codeFont: "system",
      codeFontSize: 12,
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
      backgroundPreset: "cyan-stage",
      uiScale: 125,
      uiFont: "microsoft-yahei",
      uiFontSize: 16,
      codeFont: "consolas",
      codeFontSize: 14,
    });

    expect(document.documentElement.dataset.interfaceDensity).toBe("compact");
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    expect(document.documentElement.dataset.sidebarTranslucent).toBe("true");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.backgroundActive).toBe("true");
    expect(document.documentElement.dataset.backgroundPreset).toBe("cyan-stage");
    expect(document.documentElement.dataset.uiScale).toBe("125");
    expect(document.documentElement.style.getPropertyValue("--app-scale")).toBe("1.25");
    expect(document.documentElement.style.getPropertyValue("--app-ui-font-size")).toBe("16px");
    expect(document.documentElement.style.getPropertyValue("--app-code-font-size")).toBe("14px");
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

  it("迁移 v1 偏好并为新增外观字段补齐默认值", () => {
    window.localStorage.setItem(
      "pi-desktop.app-preferences.v1",
      JSON.stringify({
        ...DEFAULT_APP_PREFERENCES,
        schemaVersion: 1,
        showSuggestions: false,
        theme: "dark",
        backgroundPreset: undefined,
      }),
    );

    expect(loadAppPreferences()).toMatchObject({
      schemaVersion: 2,
      showSuggestions: false,
      theme: "dark",
      backgroundPreset: "default",
      uiScale: 100,
      uiFontSize: 14,
      codeFontSize: 12,
    });
  });

  it("解析自定义背景时使用受控资源地址并在失败时降级", () => {
    const preferences = {
      ...DEFAULT_APP_PREFERENCES,
      backgroundPreset: "custom" as const,
      customBackgroundPath: "C:\\AppData\\wallpaper.png",
    };
    const resolver = vi.fn(() => "asset://wallpaper.png");

    expect(resolveAppearanceBackground(preferences, resolver)).toBe("asset://wallpaper.png");
    expect(resolver).toHaveBeenCalledWith("C:\\AppData\\wallpaper.png");
    expect(
      resolveAppearanceBackground(preferences, () => {
        throw new Error("asset protocol unavailable");
      }),
    ).toBeNull();
  });
});
