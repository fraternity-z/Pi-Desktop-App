import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export class ProxyConfigurationError extends Error {
  readonly code = "PROXY_CONFIGURATION_INVALID";
  constructor() {
    super("网络代理配置无效，请检查代理设置或环境变量");
  }
}

export function configureProxy(env: NodeJS.ProcessEnv = process.env): void {
  try {
    const mode = env.PI_DESKTOP_PROXY_MODE ?? "system";
    if (mode === "direct") {
      setGlobalDispatcher(new Agent());
    } else if (mode === "system") {
      const all = env.all_proxy || env.ALL_PROXY;
      setGlobalDispatcher(
        new EnvHttpProxyAgent({
          httpProxy: env.http_proxy || env.HTTP_PROXY || all,
          httpsProxy:
            env.https_proxy ||
            env.HTTPS_PROXY ||
            env.http_proxy ||
            env.HTTP_PROXY ||
            all,
          noProxy: env.no_proxy ?? env.NO_PROXY,
        }),
      );
    } else if (mode === "custom") {
      const raw = env.PI_DESKTOP_PROXY_URL ?? "";
      const url = new URL(raw);
      if (
        raw.length > 2048 ||
        /\s|\\/.test(raw) ||
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/" ||
        url.port === "0"
      ) {
        throw new ProxyConfigurationError();
      }
      setGlobalDispatcher(
        new EnvHttpProxyAgent({
          httpProxy: raw,
          httpsProxy: raw,
          noProxy: env.PI_DESKTOP_NO_PROXY ?? "",
        }),
      );
    } else {
      throw new ProxyConfigurationError();
    }
  } catch {
    // Never return an exception containing a proxy URL or environment credentials.
    throw new ProxyConfigurationError();
  }
}
