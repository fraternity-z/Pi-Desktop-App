import { invoke } from "@tauri-apps/api/core";

export interface GeneralSettings {
  schemaVersion: 1;
  relaxedNetwork: boolean;
  keepAwakeWhileRunning: boolean;
  preventScreenSleep: boolean;
}

export interface GeneralSettingsState {
  settings: GeneralSettings;
  powerSupported: boolean;
  powerError: { code: string; message: string } | null;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  schemaVersion: 1,
  relaxedNetwork: true,
  keepAwakeWhileRunning: false,
  preventScreenSleep: false,
};

export function getGeneralSettings(): Promise<GeneralSettingsState> {
  return invoke("get_general_settings");
}

export function updateGeneralSettings(
  settings: GeneralSettings,
): Promise<GeneralSettingsState> {
  return invoke("update_general_settings", { settings });
}
