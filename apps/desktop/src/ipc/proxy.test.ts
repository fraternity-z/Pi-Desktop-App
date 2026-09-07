import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROXY_SETTINGS,
  getProxySettings,
  updateProxySettings,
  proxyValidationError,
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
  it("validates URLs and bypass lists without echoing credentials", () => {
    expect(proxyValidationError(DEFAULT_PROXY_SETTINGS)).toBeNull();
    for (const url of [
      "ftp://localhost:9",
      "http://private:private@localhost:9",
      "http://localhost:0",
      "http://localhost/path",
      "http://localhost/?secret",
      "http://localhost/#secret",
      "x".repeat(2050),
    ]) {
      const error = proxyValidationError({
        ...DEFAULT_PROXY_SETTINGS,
        ai: { mode: "custom", url, noProxy: "" },
      });
      expect(error).not.toBeNull();
      expect(error).not.toContain("private");
    }
    expect(
      proxyValidationError({
        ...DEFAULT_PROXY_SETTINGS,
        ai: {
          mode: "custom",
          url: "https://localhost:9",
          noProxy: "bad\nname",
        },
      }),
    ).toContain("列表格式无效");
    expect(
      proxyValidationError({
        ...DEFAULT_PROXY_SETTINGS,
        app: { mode: "custom", url: "https://localhost:9", noProxy: "" },
      }),
    ).not.toBeNull();
  });
});
