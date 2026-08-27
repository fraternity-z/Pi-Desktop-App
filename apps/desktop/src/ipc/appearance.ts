import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface InstalledAppearanceBackground {
  path: string;
}

export interface AppearanceThemeTransfer {
  name: string;
  theme: "system" | "light" | "dark";
  backgroundPreset: "default" | "cyan-stage" | "rose-cinema" | "custom";
  uiScale: 80 | 90 | 100 | 110 | 125;
  uiFont: "system" | "microsoft-yahei" | "noto-sans";
  uiFontSize: 12 | 13 | 14 | 15 | 16;
  codeFont: "system" | "cascadia-code" | "consolas";
  codeFontSize: 11 | 12 | 13 | 14 | 15;
  sidebarTranslucent: boolean;
  sidebarWidth: number;
  customBackgroundPath: string | null;
}

export interface AppearanceSelectionError {
  code:
    | "APPEARANCE_BACKGROUND_SELECTION_FAILED"
    | "APPEARANCE_BACKGROUND_SELECTION_INVALID"
    | "APPEARANCE_THEME_IMPORT_SELECTION_FAILED"
    | "APPEARANCE_THEME_IMPORT_SELECTION_INVALID"
    | "APPEARANCE_THEME_EXPORT_SELECTION_FAILED"
    | "APPEARANCE_THEME_EXPORT_SELECTION_INVALID";
  message: string;
}

const IMAGE_FILTER = {
  name: "背景图片",
  extensions: ["png", "jpg", "jpeg", "webp"],
};

const THEME_FILTER = {
  name: "Pi Desktop 主题",
  extensions: ["json"],
};

export async function selectAppearanceBackground(): Promise<InstalledAppearanceBackground | null> {
  const selected = await selectSinglePath(
    {
      directory: false,
      multiple: false,
      title: "选择背景图片",
      filters: [IMAGE_FILTER],
    },
    "APPEARANCE_BACKGROUND_SELECTION_FAILED",
    "无法打开背景图片选择器，请重试",
    "APPEARANCE_BACKGROUND_SELECTION_INVALID",
    "背景图片选择器返回了无效路径",
  );
  if (!selected) return null;
  return invoke<InstalledAppearanceBackground>("install_appearance_background", {
    sourcePath: selected,
  });
}

export async function importAppearanceTheme(): Promise<AppearanceThemeTransfer | null> {
  const selected = await selectSinglePath(
    {
      directory: false,
      multiple: false,
      title: "导入外观主题",
      filters: [THEME_FILTER],
    },
    "APPEARANCE_THEME_IMPORT_SELECTION_FAILED",
    "无法打开主题选择器，请重试",
    "APPEARANCE_THEME_IMPORT_SELECTION_INVALID",
    "主题选择器返回了无效路径",
  );
  if (!selected) return null;
  return invoke<AppearanceThemeTransfer>("import_appearance_theme", { sourcePath: selected });
}

export async function exportAppearanceTheme(theme: AppearanceThemeTransfer): Promise<boolean> {
  let target: unknown;
  try {
    target = await save({
      title: "导出外观主题",
      defaultPath: `${safeThemeFileName(theme.name)}.pi-theme.json`,
      filters: [THEME_FILTER],
    });
  } catch {
    throw selectionError(
      "APPEARANCE_THEME_EXPORT_SELECTION_FAILED",
      "无法打开主题导出位置选择器，请重试",
    );
  }
  if (target === null) return false;
  if (typeof target !== "string" || !target.trim()) {
    throw selectionError(
      "APPEARANCE_THEME_EXPORT_SELECTION_INVALID",
      "主题导出位置选择器返回了无效路径",
    );
  }
  await invoke("export_appearance_theme", { targetPath: target, theme });
  return true;
}

export function appearanceBackgroundUrl(path: string): string {
  return convertFileSrc(path);
}

async function selectSinglePath(
  options: Parameters<typeof open>[0],
  failureCode: AppearanceSelectionError["code"],
  failureMessage: string,
  invalidCode: AppearanceSelectionError["code"],
  invalidMessage: string,
): Promise<string | null> {
  let selected: unknown;
  try {
    selected = await open(options);
  } catch {
    throw selectionError(failureCode, failureMessage);
  }
  if (selected === null) return null;
  if (typeof selected !== "string" || !selected.trim()) {
    throw selectionError(invalidCode, invalidMessage);
  }
  return selected;
}

function safeThemeFileName(value: string): string {
  const name = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return name || "外观主题";
}

function selectionError(
  code: AppearanceSelectionError["code"],
  message: string,
): AppearanceSelectionError {
  return { code, message };
}
