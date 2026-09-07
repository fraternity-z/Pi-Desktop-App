import { invoke } from "@tauri-apps/api/core";

export type ProxyMode = "system" | "direct" | "custom";
export interface ProxyEndpoint {
  mode: ProxyMode;
  url: string;
  noProxy: string;
}
export interface ProxySettings {
  schemaVersion: 1;
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

export function proxyValidationError(settings: ProxySettings): string | null {
  for (const scope of ["ai", "app"] as const) {
    const endpoint = settings[scope];
    if (endpoint.mode !== "custom") continue;
    try {
      const url = new URL(endpoint.url);
      if (
        endpoint.url.length > 2048 ||
        /\s|\\/.test(endpoint.url) ||
        !(scope === "ai" ? ["http:", "https:"] : ["http:"]).includes(
          url.protocol,
        ) ||
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
      return `${scope === "ai" ? "AI" : "应用"}代理地址无效：请输入${scope === "ai" ? " HTTP(S)" : " HTTP"} 代理地址，不含账号、密码、路径、查询或片段。`;
    }
    if (
      endpoint.noProxy.length > 2048 ||
      !/^[a-zA-Z0-9.\-_*,:\[\] ]*$/.test(endpoint.noProxy)
    )
      return "绕过代理列表格式无效，请使用逗号分隔主机名。";
  }
  return null;
}
