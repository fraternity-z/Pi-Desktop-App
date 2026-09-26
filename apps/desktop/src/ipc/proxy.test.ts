import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROXY_SETTINGS,
  getProxySettings,
  updateProxySettings,
  proxyValidationError,
  unifyProxySettings,
} from "./proxy";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
describe("proxy IPC", () => {
  it("uses typed commands and propagates stable failures", async () => {
    vi.mocked(invoke).mockResolvedValue(DEFAULT_PROXY_SETTINGS);
    expect(await getProxySettings()).toEqual(DEFAULT_PROXY_SETTINGS);
    expect(invoke).toHaveBeenCalledWith("get_proxy_settings");
    await updateProxySettings(DEFAULT_PROXY_SETTINGS);
    expect(invoke).toHaveBeenCalledWith("update_proxy_settings", {
      settings: DEFAULT_PROXY_SETTINGS,
    });
    vi.mocked(invoke).mockRejectedValueOnce({ code: "PROXY_WRITE_FAILED" });
    await expect(updateProxySettings(DEFAULT_PROXY_SETTINGS)).rejects.toEqual({
      code: "PROXY_WRITE_FAILED",
    });
  });
  it("validates the shared HTTP address without echoing credentials", () => {
    expect(proxyValidationError(DEFAULT_PROXY_SETTINGS)).toBeNull();
    for (const url of [
      "ftp://localhost:9",
      "https://localhost:9",
      "http://local\nhost:9",
      String.raw`http://localhost\path`,
      "http://private:private@localhost:9",
      "http://localhost:0",
      "http://localhost/path",
      "http://localhost/?secret",
      "http://localhost/#secret",
      "x".repeat(2050),
    ]) {
      const error = proxyValidationError({
        ...DEFAULT_PROXY_SETTINGS,
        app: { mode: "custom", url, noProxy: "" },
      });
      expect(error).not.toBeNull();
      expect(error).not.toContain("private");
    }
    expect(
      proxyValidationError({
        ...DEFAULT_PROXY_SETTINGS,
        app: {
          mode: "custom",
          url: "http://localhost:9",
          noProxy: "bad\nname",
        },
      }),
    ).toContain("不支持");
    expect(
      proxyValidationError({
        ...DEFAULT_PROXY_SETTINGS,
        app: { mode: "direct", url: "http://localhost:9", noProxy: "" },
      }),
    ).not.toBeNull();
    expect(proxyValidationError({
      ...DEFAULT_PROXY_SETTINGS,
      app: { mode: "custom", url: "http://[::1]:7890", noProxy: "" },
    })).toBeNull();
  });
  it.each(["system", "direct", "custom"] as const)("unifies legacy scopes using the app %s mode without mutating inputs", (mode) => {
    const legacy = {
      ...DEFAULT_PROXY_SETTINGS,
      ai: { mode: "custom" as const, url: "https://localhost:7890", noProxy: "example.com" },
      app: { mode, url: mode === "custom" ? "http://localhost:8080" : "", noProxy: "" },
    };
    const result = unifyProxySettings(legacy);
    expect(result.ai).toEqual(legacy.app);
    expect(result.app).toEqual(legacy.app);
    expect(result.ai).not.toBe(result.app);
    expect(result.app).not.toBe(legacy.app);
    expect(legacy.ai.noProxy).toBe("example.com");
    expect(unifyProxySettings(result)).toEqual(result);
  });
});
