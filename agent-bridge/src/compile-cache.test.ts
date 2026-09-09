import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import { enableSdkCompileCache } from "./compile-cache.js";

describe("SDK 编译缓存", () => {
  it("使用独立临时目录且不修改进程环境", () => {
    const enable = vi.fn();
    const env = {};
    enableSdkCompileCache({ env, enable, temporaryDirectory: tmpdir });
    expect(enable).toHaveBeenCalledWith(join(tmpdir(), "pi-desktop-compile-cache"));
    expect(env).toEqual({});
  });

  it.each(["PI_DESKTOP_COMPILE_CACHE_DIR", "NODE_COMPILE_CACHE"])("尊重绝对缓存路径 %s", (key) => {
    const enable = vi.fn();
    const directory = join(tmpdir(), "sdk-cache");
    enableSdkCompileCache({ env: { [key]: directory }, enable, temporaryDirectory: tmpdir });
    expect(enable).toHaveBeenCalledWith(directory);
  });

  it.each([{ NODE_DISABLE_COMPILE_CACHE: "1" }, { PI_DESKTOP_COMPILE_CACHE_DIR: "relative" }])("禁用或相对路径时跳过缓存", (env) => {
    const enable = vi.fn();
    enableSdkCompileCache({ env, enable, temporaryDirectory: tmpdir });
    expect(enable).not.toHaveBeenCalled();
  });

  it("旧 Node 和缓存不可写时安静降级", () => {
    expect(() => enableSdkCompileCache({ env: {}, temporaryDirectory: tmpdir })).not.toThrow();
    expect(() => enableSdkCompileCache({
      env: {}, temporaryDirectory: tmpdir, enable: () => { throw new Error("read-only"); },
    })).not.toThrow();
    expect(() => enableSdkCompileCache({
      env: {}, temporaryDirectory: tmpdir, enable: () => ({ status: 0, message: "unavailable" }),
    })).not.toThrow();
  });
});
