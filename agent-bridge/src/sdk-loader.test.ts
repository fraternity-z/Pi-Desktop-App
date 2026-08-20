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
    importModule: vi.fn(async () => ({ createAgentSession: vi.fn() })),
    ...overrides,
  };
}

describe("loadPiSdk", () => {
  it("校验官方包身份并从规范入口加载", async () => {
    const deps = dependencies();
    const loaded = await loadPiSdk(root, deps);

    expect(loaded.version).toBe("0.84.2");
    expect(loaded.root).toBe(root);
    expect(deps.importModule).toHaveBeenCalledWith(pathToFileURL(entry).href);
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
  ])("加载异常时返回稳定错误码 %s", async (code, sdkRoot, deps) => {
    await expect(loadPiSdk(sdkRoot, deps)).rejects.toEqual(
      expect.objectContaining<Partial<SdkLoadError>>({ code }),
    );
  });
});
