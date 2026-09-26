import { invoke } from "@tauri-apps/api/core";

export type ProxyMode = "system" | "direct" | "custom";
export interface ProxyEndpoint {
  mode: ProxyMode;
  url: string;
  noProxy: string;
}
export interface ProxySettings {
  schemaVersion: 1;
  // Keep the v1 wire format; both endpoints mirror the shared app configuration.
  ai: ProxyEndpoint;
  app: ProxyEndpoint;
}
export const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  schemaVersion: 1,
  ai: { mode: "system", url: "", noProxy: "" },
  app: { mode: "system", url: "", noProxy: "" },
};
export function getProxySettings(): Promise<ProxySettings> {
  return invoke("get_proxy_settings");
}
export function updateProxySettings(
  settings: ProxySettings,
): Promise<ProxySettings> {
  return invoke("update_proxy_settings", { settings });
}

export function unifyProxySettings(settings: ProxySettings): ProxySettings {
  return { ...settings, ai: { ...settings.app }, app: { ...settings.app } };
}

export function proxyValidationError(settings: ProxySettings): string | null {
  const endpoint = settings.app;
  if (endpoint.noProxy !== "") return "统一代理不支持单独的绕过列表。";
  if (endpoint.mode !== "custom") {
    return endpoint.url === "" ? null : "系统或直连模式不能保留自定义代理地址。";
  }
  try {
    const url = new URL(endpoint.url);
    if (
      endpoint.url.length > 2048 ||
      /\s|\\/.test(endpoint.url) ||
      url.protocol !== "http:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.port === "0"
    )
      throw Error();
  } catch {
    return "代理地址无效：请输入 HTTP 代理地址，不含账号、密码、路径、查询或片段。";
  }
  return null;
}
