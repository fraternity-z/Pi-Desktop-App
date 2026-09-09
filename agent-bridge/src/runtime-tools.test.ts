import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { configureRuntimeTools, type RuntimeToolDependencies } from "./runtime-tools.js";

vi.mock("node:fs", () => ({ readFileSync: vi.fn(() => { throw new Error("missing fixture marker"); }) }));

function fixture(): RuntimeToolDependencies {
  return {
    executable: join(tmpdir(), "pi-runtime", "node.exe"), version: "22.22.0", platform: "win32", arch: "x64",
    env: { PATH: "C:\\tools" },
    readManifest: () => JSON.stringify({ schemaVersion: 1, node: "22.22.0", platform: "win32", arch: "x64" }),
  };
}

describe("内置工具路径", () => {
  it("默认依赖在本地 Node 无标记时保持环境不变", () => {
    const path = process.env.PATH;
    configureRuntimeTools();
    expect(process.env.PATH).toBe(path);
  });
  it("只修改子进程环境，优先内置 Node/npm 并去重", () => {
    const dependencies = fixture();
    const directory = dirname(dependencies.executable);
    dependencies.env.PATH += `;${directory.toUpperCase()}`;
    configureRuntimeTools(dependencies);
    expect(dependencies.env.PATH).toBe(`${directory};C:\\tools`);
    expect(dependencies.env.Path).toBe(dependencies.env.PATH);
    configureRuntimeTools(dependencies);
    expect(dependencies.env.PATH).toBe(`${directory};C:\\tools`);
  });

  it.each(["missing", "invalid", "version", "platform"])("%s 标记保持本地 PATH", (mode) => {
    const dependencies = fixture();
    if (mode === "missing") dependencies.readManifest = () => { throw new Error("not found"); };
    if (mode === "invalid") dependencies.readManifest = () => "null";
    if (mode === "version") dependencies.version = "24.0.0";
    if (mode === "platform") dependencies.platform = "linux";
    configureRuntimeTools(dependencies);
    expect(dependencies.env).toEqual({ PATH: "C:\\tools" });
  });

  it("支持 Unix 分隔符和空 PATH", () => {
    const dependencies = fixture();
    dependencies.platform = "linux";
    dependencies.env = {};
    dependencies.readManifest = () => JSON.stringify({ schemaVersion: 1, node: "22.22.0", platform: "linux", arch: "x64" });
    configureRuntimeTools(dependencies);
    expect(dependencies.env.PATH).toBe(dirname(dependencies.executable));
    expect(dependencies.env.Path).toBeUndefined();
  });
});
