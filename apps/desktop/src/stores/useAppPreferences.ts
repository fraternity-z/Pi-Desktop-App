import { useCallback, useEffect, useState } from "react";

export type InterfaceDensity = "comfortable" | "compact";
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface AppPreferences {
  schemaVersion: 1;
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
  interfaceDensity: InterfaceDensity;
  reduceMotion: boolean;
  confirmRemoveWorkspace: boolean;
  closeSidebarOnNavigation: boolean;
}

export const APP_PREFERENCES_STORAGE_KEY = "pi-desktop.app-preferences.v1";

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  schemaVersion: 1,
  showSuggestions: true,
  showRuntimeStatus: true,
  desktopNotifications: true,
  taskCompletedNotifications: true,
  taskFailedNotifications: true,
  hostExceptionNotifications: true,
  notifyOnlyWhenUnfocused: false,
  notificationSound: true,
  sidebarTranslucent: false,
  theme: "system",
  interfaceDensity: "comfortable",
  reduceMotion: false,
  confirmRemoveWorkspace: true,
  closeSidebarOnNavigation: true,
};

type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { ...DEFAULT_APP_PREFERENCES };
  }

  return {
    schemaVersion: 1,
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
    interfaceDensity:
      value.interfaceDensity === "compact" || value.interfaceDensity === "comfortable"
        ? value.interfaceDensity
        : DEFAULT_APP_PREFERENCES.interfaceDensity,
    reduceMotion: readBoolean(value.reduceMotion, DEFAULT_APP_PREFERENCES.reduceMotion),
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
  try {
    const stored = storage.getItem(APP_PREFERENCES_STORAGE_KEY);
    return stored ? normalizeAppPreferences(JSON.parse(stored)) : { ...DEFAULT_APP_PREFERENCES };
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
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
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.themePreference = preferences.theme;
  root.dataset.theme = resolveTheme(preferences.theme, systemPrefersDark);
  root.dataset.interfaceDensity = preferences.interfaceDensity;
  root.dataset.reduceMotion = String(preferences.reduceMotion);
  root.dataset.sidebarTranslucent = String(preferences.sidebarTranslucent);
}

export function useAppPreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>(loadAppPreferences);

  useEffect(() => {
    const normalized = saveAppPreferences(preferences);
    const systemTheme = normalized.theme === "system" ? getSystemThemeQuery() : null;
    const applyTheme = () => applyAppPreferences(normalized, systemTheme?.matches ?? false);

    applyTheme();
    systemTheme?.addEventListener("change", applyTheme);
    return () => systemTheme?.removeEventListener("change", applyTheme);
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

function readThemePreference(value: unknown): ThemePreference {
  return value === "system" || value === "light" || value === "dark"
    ? value
    : DEFAULT_APP_PREFERENCES.theme;
}

function getSystemThemeQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
