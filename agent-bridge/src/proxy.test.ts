import { beforeEach, describe, expect, it, vi } from "vitest";
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { configureProxy, ProxyConfigurationError } from "./proxy.js";

vi.mock("undici", () => ({
  Agent: vi.fn(class {}),
  EnvHttpProxyAgent: vi.fn(class {}),
  setGlobalDispatcher: vi.fn(),
}));
describe("proxy configuration", () => {
  beforeEach(() => vi.clearAllMocks());
  it("supports direct, environment and custom dispatchers", () => {
    configureProxy({
      PI_DESKTOP_PROXY_MODE: "direct",
      HTTPS_PROXY: "http://unused:9",
    });
    expect(Agent).toHaveBeenCalledOnce();
    configureProxy({
      http_proxy: "http://local:1",
      HTTP_PROXY: "http://upper:2",
      HTTPS_PROXY: "http://secure:3",
      NO_PROXY: "localhost",
    });
    expect(EnvHttpProxyAgent).toHaveBeenLastCalledWith({
      httpProxy: "http://local:1",
      httpsProxy: "http://secure:3",
      noProxy: "localhost",
    });
    configureProxy({ ALL_PROXY: "http://all:4" });
    expect(EnvHttpProxyAgent).toHaveBeenLastCalledWith({
      httpProxy: "http://all:4",
      httpsProxy: "http://all:4",
      noProxy: undefined,
    });
    configureProxy({
      PI_DESKTOP_PROXY_MODE: "custom",
      PI_DESKTOP_PROXY_URL: "http://127.0.0.1:7890",
      PI_DESKTOP_NO_PROXY: "localhost",
    });
    expect(EnvHttpProxyAgent).toHaveBeenLastCalledWith({
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7890",
      noProxy: "localhost",
    });
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(4);
  });
  it("rejects invalid modes and URLs without leaking input", () => {
    expect(() => configureProxy({ PI_DESKTOP_PROXY_MODE: "invalid" })).toThrow(
      ProxyConfigurationError,
    );
    for (const url of [
      "",
      "socks5://localhost:1",
      "http://user:private@localhost",
      "http://localhost/path",
      "http://localhost:0",
      "http://localhost?private=x",
    ]) {
      expect(() =>
        configureProxy({
          PI_DESKTOP_PROXY_MODE: "custom",
          PI_DESKTOP_PROXY_URL: url,
        }),
      ).toThrow("网络代理配置无效");
    }
    expect(setGlobalDispatcher).not.toHaveBeenCalled();
  });
  it("sanitizes errors thrown by the network dependency", () => {
    vi.mocked(EnvHttpProxyAgent).mockImplementationOnce(function () {
      throw Error("private credentials");
    });
    expect(() => configureProxy({})).toThrow(new ProxyConfigurationError());
  });
});
