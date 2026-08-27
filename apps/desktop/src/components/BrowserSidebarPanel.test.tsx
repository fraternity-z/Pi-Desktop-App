import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hideBrowserSidebar,
  openBrowserSidebar,
  updateBrowserSidebarBounds,
} from "../ipc/browser";
import { BrowserSidebarPanel } from "./BrowserSidebarPanel";

vi.mock("../ipc/browser", () => ({
  hideBrowserSidebar: vi.fn(),
  openBrowserSidebar: vi.fn(),
  updateBrowserSidebarBounds: vi.fn(),
}));

function rectFor(height: number, top = 120): DOMRect {
  return {
    x: 40,
    y: top,
    top,
    left: 40,
    right: 840,
    bottom: top + height,
    width: 800,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("BrowserSidebarPanel", () => {
  beforeEach(() => {
    vi.mocked(hideBrowserSidebar).mockReset().mockResolvedValue(undefined);
    vi.mocked(openBrowserSidebar).mockReset().mockResolvedValue(undefined);
    vi.mocked(updateBrowserSidebarBounds).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("首次打开完成后同步 ResizeObserver 期间积累的最新边界", async () => {
    let animationFrame: FrameRequestCallback | null = null;
    let resizeCallback: ResizeObserverCallback | null = null;
    let surfaceHeight = 220;
    let resolveOpen: (() => void) | null = null;
    const openPromise = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    vi.mocked(openBrowserSidebar).mockReturnValue(openPromise);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("workspace-side-browser-surface")
        ? rectFor(surfaceHeight)
        : rectFor(0);
    });

    render(<BrowserSidebarPanel active />);
    act(() => animationFrame?.(0));
    expect(openBrowserSidebar).toHaveBeenCalledWith(expect.objectContaining({ height: 220, width: 800 }));

    surfaceHeight = 900;
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
      animationFrame?.(16);
    });
    expect(updateBrowserSidebarBounds).not.toHaveBeenCalled();

    await act(async () => {
      resolveOpen?.();
      await openPromise;
    });
    await waitFor(() => {
      expect(updateBrowserSidebarBounds).toHaveBeenCalledWith(
        expect.objectContaining({ height: 900, width: 800 }),
      );
    });
  });

  it("DOM 高度滞后时把原生浏览器边界延伸到右侧面板底部", async () => {
    let animationFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("workspace-side-browser-surface")) return rectFor(220, 120);
      if (this.classList.contains("right-panel")) {
        return { ...rectFor(1_000, 0), right: 900, width: 900 } as DOMRect;
      }
      return rectFor(0);
    });

    const { container, rerender } = render(
      <aside className="right-panel"><BrowserSidebarPanel active={false} /></aside>,
    );
    const browserPanel = container.querySelector<HTMLElement>(".workspace-side-browser");
    expect(browserPanel).not.toBeNull();
    browserPanel!.style.paddingBottom = "12px";
    rerender(<aside className="right-panel"><BrowserSidebarPanel active /></aside>);
    act(() => animationFrame?.(0));

    await waitFor(() => {
      expect(openBrowserSidebar).toHaveBeenCalledWith(
        expect.objectContaining({ height: 868, width: 800 }),
      );
    });
  });

  it("提交地址、展示稳定错误，并在停用时隐藏原生浏览器", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectFor(520));
    vi.mocked(openBrowserSidebar)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: "BROWSER_URL_INVALID", message: "浏览器地址无效" });
    const { rerender } = render(<BrowserSidebarPanel active />);
    await waitFor(() => expect(openBrowserSidebar).toHaveBeenCalled());

    fireEvent.change(screen.getByRole("textbox", { name: "浏览器地址" }), {
      target: { value: "file:///secret.txt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "前往" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("打开浏览器失败：浏览器地址无效");

    rerender(<BrowserSidebarPanel active={false} />);
    await waitFor(() => expect(hideBrowserSidebar).toHaveBeenCalled());
  });

  it("旧实例打开完成后不会隐藏已经接管的浏览器实例", async () => {
    let resolveFirstOpen: (() => void) | undefined;
    const firstOpen = new Promise<void>((resolve) => {
      resolveFirstOpen = resolve;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectFor(520));
    vi.mocked(openBrowserSidebar)
      .mockReturnValueOnce(firstOpen)
      .mockResolvedValueOnce(undefined);

    const firstPanel = render(<BrowserSidebarPanel active />);
    await waitFor(() => expect(openBrowserSidebar).toHaveBeenCalledTimes(1));
    firstPanel.unmount();
    const hidesAfterCleanup = vi.mocked(hideBrowserSidebar).mock.calls.length;
    render(<BrowserSidebarPanel active />);
    await waitFor(() => expect(openBrowserSidebar).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveFirstOpen?.();
      await firstOpen;
    });

    expect(hideBrowserSidebar).toHaveBeenCalledTimes(hidesAfterCleanup);
  });

  it("停用时取消仍在等待首次打开的后续导航", async () => {
    let resolveFirstOpen: (() => void) | undefined;
    const firstOpen = new Promise<void>((resolve) => {
      resolveFirstOpen = resolve;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectFor(520));
    vi.mocked(openBrowserSidebar).mockReturnValueOnce(firstOpen);
    const { rerender } = render(<BrowserSidebarPanel active />);
    await waitFor(() => expect(openBrowserSidebar).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "浏览器地址" }), {
      target: { value: "https://second.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "前往" }));
    rerender(<BrowserSidebarPanel active={false} />);

    await act(async () => {
      resolveFirstOpen?.();
      await firstOpen;
    });

    expect(openBrowserSidebar).toHaveBeenCalledTimes(1);
    expect(hideBrowserSidebar).toHaveBeenCalled();
  });

  it("自动打开失败时显示可定位错误", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectFor(520));
    vi.mocked(openBrowserSidebar).mockRejectedValueOnce({ message: "原生浏览器不可用" });

    render(<BrowserSidebarPanel active />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "打开浏览器失败：原生浏览器不可用",
    );
  });

  it("成功提交时修剪地址并导航到新页面", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectFor(520));
    render(<BrowserSidebarPanel active />);
    await waitFor(() => expect(openBrowserSidebar).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole("textbox", { name: "浏览器地址" }), {
      target: { value: "  example.com/docs  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "前往" }));

    await waitFor(() => {
      expect(openBrowserSidebar).toHaveBeenLastCalledWith(
        expect.objectContaining({ url: "example.com/docs" }),
      );
    });
    expect(screen.getByRole("textbox", { name: "浏览器地址" })).toHaveValue(
      "example.com/docs",
    );
  });

  it("原生浏览器尺寸同步失败时显示错误", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rectFor(520));
    vi.mocked(updateBrowserSidebarBounds).mockRejectedValueOnce({ message: "尺寸更新失败" });

    render(<BrowserSidebarPanel active />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "调整浏览器区域失败：尺寸更新失败",
    );
  });
});
