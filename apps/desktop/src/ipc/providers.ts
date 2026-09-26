import { invoke } from "@tauri-apps/api/core";

export interface ProviderModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  available: boolean;
}
export interface ProviderSummary {
  id: string;
  name: string;
  oauth: boolean;
  connected: boolean;
  authType: "oauth" | "api_key" | null;
  storedCredential: boolean;
  custom: boolean;
  models: ProviderModel[];
}
export interface ProviderSnapshot {
  providers: ProviderSummary[];
  defaultModel: { provider: string; id: string } | null;
  revision: string;
  warning: string | null;
}
export interface ProviderLogin {
  id: string;
  provider: string;
  status: "pending" | "success" | "cancelled" | "error";
  message: string;
  url: string | null;
  userCode: string | null;
  errorCode: string | null;
  prompt: {
    id: string;
    type: "text" | "manual_code" | "select";
    message: string;
    options?: Array<{ id: string; label: string }>;
  } | null;
}
export interface ProviderModelInput {
  provider: string;
  baseUrl: string;
  api:
    | "openai-completions"
    | "openai-responses"
    | "anthropic-messages"
    | "google-generative-ai";
  apiKeyEnv?: string;
  modelId: string;
  modelName: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  expectedRevision: string;
}

export const MODEL_SETTINGS_CHANGED = "pi:model-settings-changed";
export function notifyModelSettingsChanged(): void {
  window.dispatchEvent(new Event(MODEL_SETTINGS_CHANGED));
}
export function getProviderSettings(
  refresh = false,
): Promise<ProviderSnapshot> {
  return invoke("agent_provider_settings", {
    request: { op: "provider.list", refresh },
  });
}
export function startProviderLogin(provider: string): Promise<ProviderLogin> {
  return invoke("agent_provider_settings", {
    request: { op: "provider.login.start", provider },
  });
}
export function getProviderLogin(loginId: string): Promise<ProviderLogin> {
  return invoke("agent_provider_settings", {
    request: { op: "provider.login.status", loginId },
  });
}
export function replyProviderLogin(
  loginId: string,
  promptId: string,
  value: string,
): Promise<ProviderLogin> {
  return invoke("agent_provider_settings", {
    request: { op: "provider.login.reply", loginId, promptId, value },
  });
}
export function cancelProviderLogin(loginId: string): Promise<ProviderLogin> {
  return invoke("agent_provider_settings", {
    request: { op: "provider.login.cancel", loginId },
  });
}
export function openProviderLogin(loginId: string): Promise<void> {
  return invoke("agent_open_provider_login", { loginId });
}
export function logoutProvider(provider: string): Promise<void> {
  return invoke("agent_provider_settings", {
    request: { op: "provider.logout", provider },
  });
}
export function saveProviderModel(input: ProviderModelInput): Promise<void> {
  return invoke("agent_provider_settings", {
    request: { op: "provider.model.save", input },
  });
}
export function setDefaultProviderModel(
  provider: string,
  modelId: string,
): Promise<void> {
  return invoke("agent_provider_settings", {
    request: { op: "model.default.set", provider, modelId },
  });
}
