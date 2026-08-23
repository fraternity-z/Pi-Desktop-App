import { invoke } from "@tauri-apps/api/core";

export type RequestHeaderClient = "claude-code" | "codex";

export interface RequestHeaderSettings {
  enabled: boolean;
  client: RequestHeaderClient;
}

export const DEFAULT_REQUEST_HEADER_SETTINGS: RequestHeaderSettings = {
  enabled: false,
  client: "claude-code",
};

export async function getRequestHeaderSettings(): Promise<RequestHeaderSettings> {
  return invoke<RequestHeaderSettings>("get_request_header_settings");
}

export async function updateRequestHeaderSettings(
  settings: RequestHeaderSettings,
): Promise<RequestHeaderSettings> {
  return invoke<RequestHeaderSettings>("update_request_header_settings", { settings });
}
