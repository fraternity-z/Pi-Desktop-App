import { useCallback, useEffect, useState } from "react";

import elainaMoonlitCityBackground from "../assets/theme-elaina-moonlit-city.webp";
import elainaSpringMeadowBackground from "../assets/theme-elaina-spring-meadow.webp";
import { appearanceBackgroundUrl } from "../ipc/appearance";
import { applyAppearanceColors, DEFAULT_APPEARANCE, getAppearanceProfile, normalizeAppearanceConfiguration, type AppearanceConfiguration } from "./appearancePreferences";

export type InterfaceDensity = "comfortable" | "compact";
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export type AppearancePreset = "default" | "cyan-stage" | "rose-cinema" | "custom";
export type UiScale = 80 | 90 | 100 | 110 | 125;
export type UiFontPreference = "system" | "microsoft-yahei" | "noto-sans";
export type CodeFontPreference = "system" | "cascadia-code" | "consolas";
export type UiFontSize = number;
export type CodeFontSize = number;

export interface AppPreferences {
  schemaVersion: 3;
  appearance: AppearanceConfiguration;
  showSuggestions: boolean;
  showRuntimeStatus: boolean;
  desktopNotifications: boolean;
  taskCompletedNotifications: boolean;
  taskFailedNotifications: boolean;
  hostExceptionNotifications: boolean;
  notifyOnlyWhenUnfocused: boolean;
  notificationSound: boolean;
  sidebarTranslucent: boolean;
  theme: ThemePreference;
  backgroundPreset: AppearancePreset;
  customBackgroundPath: string | null;
  customThemeName: string;
  uiScale: UiScale;
  uiFont: UiFontPreference;
  uiFontSize: UiFontSize;
  codeFont: CodeFontPreference;
  codeFontSize: CodeFontSize;
  interfaceDensity: InterfaceDensity;
  reduceMotion: boolean | "system";
  confirmRemoveWorkspace: boolean;
  closeSidebarOnNavigation: boolean;
}

export const APP_PREFERENCES_STORAGE_KEY = "pi-desktop.app-preferences.v3";
const V2_APP_PREFERENCES_STORAGE_KEY = "pi-desktop.app-preferences.v2";
const LEGACY_APP_PREFERENCES_STORAGE_KEY = "pi-desktop.app-preferences.v1";

const UI_FONT_STACKS: Record<UiFontPreference, string> = {
  system: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "microsoft-yahei": '"Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
  "noto-sans": '"Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif',
};

const CODE_FONT_STACKS: Record<CodeFontPreference, string> = {
  system: 'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
  "cascadia-code": '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  consolas: 'Consolas, "Courier New", monospace',
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  schemaVersion: 3,
  appearance: DEFAULT_APPEARANCE,
  showSuggestions: true,
  showRuntimeStatus: true,
  desktopNotifications: true,
  taskCompletedNotifications: true,
  taskFailedNotifications: true,
  hostExceptionNotifications: true,
  notifyOnlyWhenUnfocused: false,
  notificationSound: true,
  sidebarTranslucent: true,
  theme: "system",
  backgroundPreset: "default",
  customBackgroundPath: null,
  customThemeName: "我的主题",
  uiScale: 100,
  uiFont: "system",
  uiFontSize: 14,
  codeFont: "system",
  codeFontSize: 12,
  interfaceDensity: "comfortable",
  reduceMotion: "system",
  confirmRemoveWorkspace: true,
  closeSidebarOnNavigation: true,
};

type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!isRecord(value) || ![1, 2, 3].includes(value.schemaVersion as number)) {
    return { ...DEFAULT_APP_PREFERENCES };
  }

  const customBackgroundPath = readOptionalString(value.customBackgroundPath, null, 32_768);
  const requestedBackgroundPreset = readChoice(
    value.backgroundPreset,
    ["default", "cyan-stage", "rose-cinema", "custom"] as const,
    DEFAULT_APP_PREFERENCES.backgroundPreset,
  );

  return {
    schemaVersion: 3,
    appearance: normalizeAppearanceConfiguration(value.appearance),
    showSuggestions: readBoolean(value.showSuggestions, DEFAULT_APP_PREFERENCES.showSuggestions),
    showRuntimeStatus: readBoolean(
      value.showRuntimeStatus,
      DEFAULT_APP_PREFERENCES.showRuntimeStatus,
    ),
    desktopNotifications: readBoolean(
      value.desktopNotifications,
      DEFAULT_APP_PREFERENCES.desktopNotifications,
    ),
    taskCompletedNotifications: readBoolean(
      value.taskCompletedNotifications,
      DEFAULT_APP_PREFERENCES.taskCompletedNotifications,
    ),
    taskFailedNotifications: readBoolean(
      value.taskFailedNotifications,
      DEFAULT_APP_PREFERENCES.taskFailedNotifications,
    ),
    hostExceptionNotifications: readBoolean(
      value.hostExceptionNotifications,
      DEFAULT_APP_PREFERENCES.hostExceptionNotifications,
    ),
    notifyOnlyWhenUnfocused: readBoolean(
      value.notifyOnlyWhenUnfocused,
      DEFAULT_APP_PREFERENCES.notifyOnlyWhenUnfocused,
    ),
    notificationSound: readBoolean(
      value.notificationSound,
      DEFAULT_APP_PREFERENCES.notificationSound,
    ),
    sidebarTranslucent: readBoolean(
      value.sidebarTranslucent,
      DEFAULT_APP_PREFERENCES.sidebarTranslucent,
    ),
    theme: readThemePreference(value.theme),
    backgroundPreset:
      requestedBackgroundPreset === "custom" && !customBackgroundPath
        ? "default"
        : requestedBackgroundPreset,
    customBackgroundPath,
    customThemeName: readOptionalString(
      value.customThemeName,
      DEFAULT_APP_PREFERENCES.customThemeName,
      40,
    )!,
    uiScale: readChoice(
      value.uiScale,
      [80, 90, 100, 110, 125] as const,
      DEFAULT_APP_PREFERENCES.uiScale,
    ),
    uiFont: readChoice(
      value.uiFont,
      ["system", "microsoft-yahei", "noto-sans"] as const,
      DEFAULT_APP_PREFERENCES.uiFont,
    ),
    uiFontSize: readFontSize(value.uiFontSize, DEFAULT_APP_PREFERENCES.uiFontSize),
    codeFont: readChoice(
      value.codeFont,
      ["system", "cascadia-code", "consolas"] as const,
      DEFAULT_APP_PREFERENCES.codeFont,
    ),
    codeFontSize: readFontSize(value.codeFontSize, DEFAULT_APP_PREFERENCES.codeFontSize),
    interfaceDensity:
      value.interfaceDensity === "compact" || value.interfaceDensity === "comfortable"
        ? value.interfaceDensity
        : DEFAULT_APP_PREFERENCES.interfaceDensity,
    reduceMotion: typeof value.reduceMotion === "boolean" ? value.reduceMotion : "system",
    confirmRemoveWorkspace: readBoolean(
      value.confirmRemoveWorkspace,
      DEFAULT_APP_PREFERENCES.confirmRemoveWorkspace,
    ),
    closeSidebarOnNavigation: readBoolean(
      value.closeSidebarOnNavigation,
      DEFAULT_APP_PREFERENCES.closeSidebarOnNavigation,
    ),
  };
}

export function loadAppPreferences(storage = getDefaultStorage()): AppPreferences {
  if (!storage) return { ...DEFAULT_APP_PREFERENCES };
  for (const key of [APP_PREFERENCES_STORAGE_KEY, V2_APP_PREFERENCES_STORAGE_KEY, LEGACY_APP_PREFERENCES_STORAGE_KEY]) {
    try {
      const stored = storage.getItem(key);
      if (stored) return normalizeAppPreferences(JSON.parse(stored));
    } catch {
      // Try the legacy entry before falling back to defaults.
    }
  }
  return { ...DEFAULT_APP_PREFERENCES };
}

export function saveAppPreferences(
  preferences: AppPreferences,
  storage = getDefaultStorage(),
): AppPreferences {
  const normalized = normalizeAppPreferences(preferences);
  if (!storage) return normalized;
  try {
    storage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preferences remain usable in memory when persistence is unavailable.
  }
  return normalized;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark = false,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyAppPreferences(
  preferences: AppPreferences,
  systemPrefersDark = getSystemThemeQuery()?.matches ?? false,
  customPathToUrl: (path: string) => string = appearanceBackgroundUrl,
  systemReducesMotion = getMotionQuery()?.matches ?? false,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.themePreference = preferences.theme;
  const mode = resolveTheme(preferences.theme, systemPrefersDark);
  const profile = getAppearanceProfile(preferences, mode);
  root.dataset.theme = mode;
  root.dataset.interfaceDensity = preferences.interfaceDensity;
  root.dataset.reduceMotion = String(preferences.reduceMotion === "system" ? systemReducesMotion : preferences.reduceMotion);
  root.dataset.pointerCursor = String(preferences.appearance.pointerCursor);
  root.dataset.diffIndicators = preferences.appearance.diffIndicators;
  root.dataset.sidebarTranslucent = String(preferences.sidebarTranslucent);
  root.dataset.backgroundPreset = preferences.backgroundPreset;
  root.dataset.uiScale = String(preferences.uiScale);
  root.dataset.uiFont = profile.uiFont;
  root.dataset.uiFontSize = String(preferences.uiFontSize);
  root.dataset.codeFont = profile.codeFont;
  root.dataset.codeFontSize = String(preferences.codeFontSize);

  const backgroundUrl = resolveAppearanceBackground(preferences, customPathToUrl);
  root.dataset.backgroundActive = String(Boolean(backgroundUrl));
  root.style.setProperty("--app-background-image", backgroundUrl ? `url(${JSON.stringify(backgroundUrl)})` : "none");
  root.style.setProperty("--app-scale", String(preferences.uiScale / 100));
  root.style.setProperty("--app-scale-inverse", String(100 / preferences.uiScale));
  root.style.setProperty("--app-ui-font", UI_FONT_STACKS[profile.uiFont]);
  root.style.setProperty("--app-ui-font-size", `${preferences.uiFontSize}px`);
  root.style.setProperty("--app-code-font", CODE_FONT_STACKS[profile.codeFont]);
  root.style.setProperty("--app-code-font-size", `${preferences.codeFontSize}px`);
  const weights = { normal: "400", medium: "500", bold: "700" };
  root.style.setProperty("--app-ui-weight", weights[profile.uiFontStyle]);
  root.style.setProperty("--app-content-weight", weights[profile.contentFontStyle]);
  root.style.setProperty("--app-code-weight", weights[profile.codeFontStyle]);
  root.style.setProperty("--app-content-font", profile.contentFont === "inherit"
    ? UI_FONT_STACKS[profile.uiFont] : profile.contentFont === "serif"
      ? '"Noto Serif CJK SC", "Songti SC", SimSun, Georgia, serif' : UI_FONT_STACKS[profile.contentFont]);
  applyAppearanceColors(profile, mode, root);
}

export function resolveAppearanceBackground(
  preferences: AppPreferences,
  customPathToUrl: (path: string) => string = appearanceBackgroundUrl,
): string | null {
  if (preferences.backgroundPreset === "cyan-stage") return elainaMoonlitCityBackground;
  if (preferences.backgroundPreset === "rose-cinema") return elainaSpringMeadowBackground;
  if (preferences.backgroundPreset !== "custom" || !preferences.customBackgroundPath) return null;
  try {
    return customPathToUrl(preferences.customBackgroundPath);
  } catch {
    return null;
  }
}

export function useAppPreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>(loadAppPreferences);

  useEffect(() => {
    const normalized = saveAppPreferences(preferences);
    const systemTheme = normalized.theme === "system" ? getSystemThemeQuery() : null;
    const motionQuery = normalized.reduceMotion === "system" ? getMotionQuery() : null;
    const applyTheme = () => applyAppPreferences(normalized, systemTheme?.matches ?? false, appearanceBackgroundUrl, motionQuery?.matches ?? false);

    applyTheme();
    systemTheme?.addEventListener("change", applyTheme);
    motionQuery?.addEventListener("change", applyTheme);
    return () => {
      systemTheme?.removeEventListener("change", applyTheme);
      motionQuery?.removeEventListener("change", applyTheme);
    };
  }, [preferences]);

  const updatePreferences = useCallback((patch: Partial<AppPreferences>) => {
    setPreferences((current) => normalizeAppPreferences({ ...current, ...patch }));
  }, []);

  return { preferences, updatePreferences };
}

function getDefaultStorage(): PreferencesStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readFontSize(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 24 ? value : fallback;
}

function readThemePreference(value: unknown): ThemePreference {
  return value === "system" || value === "light" || value === "dark"
    ? value
    : DEFAULT_APP_PREFERENCES.theme;
}

function readChoice<const T extends readonly (string | number)[]>(
  value: unknown,
  choices: T,
  fallback: T[number],
): T[number] {
  return choices.some((choice) => choice === value) ? (value as T[number]) : fallback;
}

function readOptionalString(value: unknown, fallback: string | null, maxLength: number): string | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : fallback;
}

export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(() => getSystemThemeQuery()?.matches ?? false);
  useEffect(() => {
    const query = getSystemThemeQuery();
    const update = () => setSystemDark(query?.matches ?? false);
    update();
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  return resolveTheme(preference, systemDark);
}

function getSystemThemeQuery(): MediaQueryList | null {
  return getMediaQuery("(prefers-color-scheme: dark)");
}

function getMotionQuery(): MediaQueryList | null {
  return getMediaQuery("(prefers-reduced-motion: reduce)");
}

function getMediaQuery(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
