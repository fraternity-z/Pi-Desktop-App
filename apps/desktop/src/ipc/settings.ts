import { invoke } from "@tauri-apps/api/core";

export type PromptKind = "system" | "append";

export interface PromptDocument {
  content: string | null;
  path: string;
}

export function getPromptDocument(kind: PromptKind): Promise<PromptDocument> {
  return invoke<PromptDocument>("get_prompt_document", { kind });
}

export function savePromptDocument(
  kind: PromptKind,
  content: string | null,
  expectedContent: string | null,
): Promise<PromptDocument> {
  return invoke<PromptDocument>("save_prompt_document", { kind, content, expectedContent });
}

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
