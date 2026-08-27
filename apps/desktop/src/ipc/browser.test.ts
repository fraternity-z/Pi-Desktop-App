import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hideBrowserSidebar,
  openBrowserSidebar,
  updateBrowserSidebarBounds,
  type BrowserSidebarBoundsInput,
} from "./browser";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("browser IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  });

  it("只调用固定的浏览器侧栏命令并保留结构化边界参数", async () => {
    const bounds: BrowserSidebarBoundsInput = {
      x: 480,
      y: 92,
      width: 640,
      height: 720,
      visible: true,
    };

    await openBrowserSidebar({ ...bounds, url: "https://example.com/path" });
    await updateBrowserSidebarBounds({ ...bounds, height: 760 });
    await hideBrowserSidebar();

    expect(invoke).toHaveBeenNthCalledWith(1, "browser_sidebar_open", {
      input: { ...bounds, url: "https://example.com/path" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "browser_sidebar_update_bounds", {
      input: { ...bounds, height: 760 },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "browser_sidebar_hide");
  });

  it("跨组件重建也按打开、隐藏、重新打开的顺序执行命令", async () => {
    let resolveFirstOpen: (() => void) | undefined;
    const firstOpen = new Promise<void>((resolve) => {
      resolveFirstOpen = resolve;
    });
    vi.mocked(invoke)
      .mockReturnValueOnce(firstOpen)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const bounds: BrowserSidebarBoundsInput = {
      x: 480,
      y: 92,
      width: 640,
      height: 720,
      visible: true,
    };

    const opening = openBrowserSidebar({ ...bounds, url: "https://first.example" });
    const hiding = hideBrowserSidebar();
    const reopening = openBrowserSidebar({ ...bounds, url: "https://second.example" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    resolveFirstOpen?.();
    await opening;
    await hiding;
    await reopening;

    expect(invoke).toHaveBeenNthCalledWith(1, "browser_sidebar_open", {
      input: { ...bounds, url: "https://first.example" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "browser_sidebar_hide");
    expect(invoke).toHaveBeenNthCalledWith(3, "browser_sidebar_open", {
      input: { ...bounds, url: "https://second.example" },
    });
  });

  it("前一条命令失败后仍继续执行隐藏命令", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error("open failed"))
      .mockResolvedValueOnce(undefined);
    const opening = openBrowserSidebar({
      x: 40,
      y: 80,
      width: 640,
      height: 720,
      visible: true,
    });
    const hiding = hideBrowserSidebar();

    await expect(opening).rejects.toThrow("open failed");
    await expect(hiding).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(2, "browser_sidebar_hide");
  });
});
