import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appearanceBackgroundUrl,
  exportAppearanceTheme,
  importAppearanceTheme,
  selectAppearanceBackground,
  type AppearanceThemeTransfer,
} from "./appearance";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const theme: AppearanceThemeTransfer = {
  name: "青葱舞台",
  theme: "system",
  backgroundPreset: "cyan-stage",
  uiScale: 100,
  uiFont: "system",
  uiFontSize: 14,
  codeFont: "system",
  codeFontSize: 12,
  sidebarTranslucent: true,
  sidebarWidth: 300,
  customBackgroundPath: null,
};

describe("appearance ipc", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
    vi.mocked(save).mockReset();
    vi.mocked(invoke).mockReset();
    vi.mocked(convertFileSrc).mockClear();
  });

  it("选择图片后通过 Rust 安装到应用数据目录", async () => {
    vi.mocked(open).mockResolvedValue("C:\\Pictures\\wallpaper.png");
    vi.mocked(invoke).mockResolvedValue({ path: "C:\\AppData\\background.png" });

    await expect(selectAppearanceBackground()).resolves.toEqual({
      path: "C:\\AppData\\background.png",
    });
    expect(open).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      title: "选择背景图片",
      filters: [{ name: "背景图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    expect(invoke).toHaveBeenCalledWith("install_appearance_background", {
      sourcePath: "C:\\Pictures\\wallpaper.png",
    });
  });

  it("取消选择时优雅返回并拒绝畸形结果", async () => {
    vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce([] as never);

    await expect(selectAppearanceBackground()).resolves.toBeNull();
    await expect(selectAppearanceBackground()).rejects.toEqual({
      code: "APPEARANCE_BACKGROUND_SELECTION_INVALID",
      message: "背景图片选择器返回了无效路径",
    });
  });

  it("映射原生选择器错误且不暴露底层异常", async () => {
    vi.mocked(open).mockRejectedValue(new Error("native secret detail"));

    await expect(importAppearanceTheme()).rejects.toEqual({
      code: "APPEARANCE_THEME_IMPORT_SELECTION_FAILED",
      message: "无法打开主题选择器，请重试",
    });
  });

  it("导入主题并把验证交给 Rust 边界", async () => {
    vi.mocked(open).mockResolvedValue("C:\\Themes\\my.pi-theme.json");
    vi.mocked(invoke).mockResolvedValue(theme);

    await expect(importAppearanceTheme()).resolves.toEqual(theme);
    expect(invoke).toHaveBeenCalledWith("import_appearance_theme", {
      sourcePath: "C:\\Themes\\my.pi-theme.json",
    });
  });

  it("导出主题支持取消并清理默认文件名", async () => {
    vi.mocked(save)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("C:\\Themes\\export.pi-theme.json");

    await expect(exportAppearanceTheme({ ...theme, name: '我的/主题:"A"' })).resolves.toBe(false);
    await expect(exportAppearanceTheme(theme)).resolves.toBe(true);
    expect(save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ defaultPath: '我的-主题-A-.pi-theme.json' }),
    );
    expect(invoke).toHaveBeenCalledWith("export_appearance_theme", {
      targetPath: "C:\\Themes\\export.pi-theme.json",
      theme,
    });
  });

  it("只通过 Tauri 资源协议构造背景地址", () => {
    expect(appearanceBackgroundUrl("C:\\AppData\\background.png")).toBe(
      "asset://C:\\AppData\\background.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("C:\\AppData\\background.png");
  });
});
