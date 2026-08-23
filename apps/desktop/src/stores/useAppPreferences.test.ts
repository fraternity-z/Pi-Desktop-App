import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_PREFERENCES_STORAGE_KEY,
  DEFAULT_APP_PREFERENCES,
  applyAppPreferences,
  loadAppPreferences,
  normalizeAppPreferences,
  saveAppPreferences,
} from "./useAppPreferences";

describe("app preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-interface-density");
    document.documentElement.removeAttribute("data-reduce-motion");
    document.documentElement.removeAttribute("data-sidebar-translucent");
  });

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
      interfaceDensity: "compact",
    });

    expect(saved.showSuggestions).toBe(false);
    expect(loadAppPreferences()).toEqual(saved);
    expect(
      normalizeAppPreferences({
        ...saved,
        showRuntimeStatus: "no",
        interfaceDensity: "dense",
      }),
    ).toMatchObject({
      showRuntimeStatus: true,
      interfaceDensity: "comfortable",
    });
  });

  it("将外观偏好应用为稳定的根节点状态", () => {
    applyAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      interfaceDensity: "compact",
      reduceMotion: true,
      sidebarTranslucent: true,
    });

    expect(document.documentElement.dataset.interfaceDensity).toBe("compact");
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    expect(document.documentElement.dataset.sidebarTranslucent).toBe("true");
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
