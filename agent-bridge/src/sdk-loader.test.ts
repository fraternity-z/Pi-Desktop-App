import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { loadPiSdk, SdkLoadError, type SdkLoaderDependencies } from "./sdk-loader.js";

const root = "C:\\pi\\node_modules\\@earendil-works\\pi-coding-agent";
const entry = `${root}\\dist\\index.js`;

function dependencies(overrides: Partial<SdkLoaderDependencies> = {}): SdkLoaderDependencies {
  return {
    realpath: vi.fn(async (path: string) => (path.endsWith("index.js") ? entry : root)),
    readFile: vi.fn(async () =>
      JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.2" }),
    ),
    importModule: vi.fn(async () => ({
      createAgentSession: vi.fn(),
      ModelRuntime: { create: vi.fn() },
      SessionManager: { create: vi.fn(), open: vi.fn(), listAll: vi.fn() },
    })),
    ...overrides,
  };
}

describe("loadPiSdk", () => {
  it("完整 SDK 导入完成之前不会返回就绪，首次会话不触发二次导入", async () => {
    let complete!: (module: unknown) => void;
    let signalImport!: () => void;
    const importStarted = new Promise<void>((resolve) => { signalImport = resolve; });
    const createAgentSession = vi.fn(async () => ({ session: {} }));
    const full = {
      ...(await dependencies().importModule("fixture") as object),
      createAgentSession,
      DefaultResourceLoader: class {},
      DefaultPackageManager: class {},
    };
    const deps = dependencies({
      importModule: vi.fn(() => {
        signalImport();
        return new Promise((resolve) => { complete = resolve; });
      }),
    });
    let ready = false;
    const loading = loadPiSdk(root, deps).then((result) => { ready = true; return result; });
    await importStarted;
    expect(ready).toBe(false);
    complete(full);
    const loaded = await loading;
    expect(loaded.sdk).toBe(full);
    await loaded.sdk.createAgentSession({ agentDir: "C:\\agent", modelRuntime: { getModel: vi.fn() }, sessionManager: {} });
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(deps.importModule).toHaveBeenCalledExactlyOnceWith(pathToFileURL(entry).href);
  });

  it("旧内置目录标记不会启用延迟入口", async () => {
    const standard = dependencies();
    const deps = dependencies({
      readFile: vi.fn(async (path) => path.endsWith(".pi-desktop-runtime.json")
        ? JSON.stringify({ schemaVersion: 1, piVersion: "0.84.2", startup: "catalog-first" })
        : standard.readFile(path, "utf8")),
    });
    await loadPiSdk(root, deps);
    expect(deps.importModule).toHaveBeenCalledExactlyOnceWith(pathToFileURL(entry).href);
    expect(deps.readFile).toHaveBeenCalledTimes(1);
  });

  it("校验官方包身份并从规范入口加载", async () => {
    const deps = dependencies();
    const loaded = await loadPiSdk(root, deps);

    expect(loaded.version).toBe("0.84.2");
    expect(loaded.root).toBe(root);
    expect(deps.importModule).toHaveBeenCalledWith(pathToFileURL(entry).href);
  });

  it("在 SDK 动态导入之前启用编译缓存", async () => {
    const order: string[] = [];
    const deps = dependencies({ enableCompileCache: () => { order.push("cache"); } });
    const importModule = deps.importModule;
    deps.importModule = async (specifier) => {
      order.push("import");
      return importModule(specifier);
    };
    await loadPiSdk(root, deps);
    expect(order).toEqual(["cache", "import"]);
  });

  it("兼容官方 SDK 使用 class 暴露静态运行时 API", async () => {
    class ModelRuntime {
      static create = vi.fn();
    }
    class SessionManager {
      static create = vi.fn();
      static open = vi.fn();
      static listAll = vi.fn();
    }
    const deps = dependencies({
      importModule: vi.fn(async () => ({
        createAgentSession: vi.fn(),
        ModelRuntime,
        SessionManager,
      })),
    });

    await expect(loadPiSdk(root, deps)).resolves.toEqual(
      expect.objectContaining({ version: "0.84.2" }),
    );
  });

  it.each([
    ["INVALID_SDK_ROOT", "relative", dependencies()],
    [
      "SDK_LAYOUT_INVALID",
      root,
      dependencies({ readFile: vi.fn(async () => Promise.reject(new Error("denied"))) }),
    ],
    [
      "SDK_ENTRY_OUTSIDE_ROOT",
      root,
      dependencies({
        realpath: vi.fn(async (path: string) =>
          path.endsWith("index.js") ? "C:\\other\\index.js" : root,
        ),
      }),
    ],
    [
      "SDK_IDENTITY_MISMATCH",
      root,
      dependencies({ readFile: vi.fn(async () => JSON.stringify({ name: "fake", version: "1" })) }),
    ],
    [
      "SDK_METADATA_INVALID",
      root,
      dependencies({
        readFile: vi.fn(async () => JSON.stringify({ name: "@earendil-works/pi-coding-agent" })),
      }),
    ],
    [
      "SDK_METADATA_INVALID",
      root,
      dependencies({ readFile: vi.fn(async () => "null") }),
    ],
    [
      "SDK_IMPORT_FAILED",
      root,
      dependencies({ importModule: vi.fn(async () => Promise.reject(new Error("bad module"))) }),
    ],
    ["SDK_EXPORT_MISSING", root, dependencies({ importModule: vi.fn(async () => ({})) })],
    [
      "SDK_EXPORT_MISSING",
      root,
      dependencies({ importModule: vi.fn(async () => ({ createAgentSession: vi.fn() })) }),
    ],
  ])("加载异常时返回稳定错误码 %s", async (code, sdkRoot, deps) => {
    await expect(loadPiSdk(sdkRoot, deps)).rejects.toEqual(
      expect.objectContaining<Partial<SdkLoadError>>({ code }),
    );
  });
});
