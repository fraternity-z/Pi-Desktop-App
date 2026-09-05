import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeferredView } from "./createDeferredView";

function Page({ title }: { title: string }) {
  return <h1>{title}</h1>;
}

describe("createDeferredView", () => {
  afterEach(() => vi.useRealTimers());

  it("在页面打开时加载模块，透传最新参数并缓存成功结果", async () => {
    let resolve!: (module: { default: typeof Page }) => void;
    const load = vi.fn(() => new Promise<{ default: typeof Page }>((done) => { resolve = done; }));
    const View = createDeferredView(load);
    expect(load).not.toHaveBeenCalled();

    const first = render(<View title="设置" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载页面");
    first.rerender(<View title="外观" />);
    await act(async () => {
      await Promise.resolve();
      resolve({ default: Page });
    });
    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
    first.unmount();

    render(<View title="设置" />);
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();
  });

  it("加载失败时隐藏内部错误并允许局部重试", async () => {
    const load = vi.fn<() => Promise<{ default: typeof Page }>>()
      .mockRejectedValueOnce(new Error("internal module path"))
      .mockResolvedValueOnce({ default: Page });
    const View = createDeferredView(load);
    render(<View title="资源" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("PAGE_LOAD_FAILED");
    expect(screen.queryByText(/internal module path/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "资源" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each(["loading", "error"] as const)(
    "侧栏关闭时 %s 占位页仍可返回会话或打开侧栏",
    async (phase) => {
      const View = createDeferredView((): Promise<{ default: typeof Page }> =>
        phase === "loading"
          ? new Promise<{ default: typeof Page }>(() => undefined)
          : Promise.reject(new Error("module unavailable")),
      );
      const onBack = vi.fn();
      const onOpenSidebar = vi.fn();
      render(
        <View title="设置" sidebarOpen={false} onBack={onBack} onOpenSidebar={onOpenSidebar} />,
      );

      if (phase === "error") {
        expect(await screen.findByRole("alert")).toHaveTextContent("PAGE_LOAD_FAILED");
      } else {
        expect(screen.getByRole("status")).toHaveTextContent("正在加载页面");
      }
      fireEvent.click(screen.getByRole("button", { name: "返回会话工作台" }));
      fireEvent.click(screen.getByRole("button", { name: "打开侧边栏" }));
      expect(onBack).toHaveBeenCalledOnce();
      expect(onOpenSidebar).toHaveBeenCalledOnce();
    },
  );

  it("同步加载异常也进入可重试错误状态", async () => {
    const View = createDeferredView(() => { throw new Error("module unavailable"); });
    render(<View />);
    expect(await screen.findByRole("alert")).toHaveTextContent("PAGE_LOAD_FAILED");
  });

  it("超时后可重试并忽略旧请求的迟到结果", async () => {
    vi.useFakeTimers();
    let resolve!: (module: { default: typeof Page }) => void;
    const load = vi.fn<() => Promise<{ default: typeof Page }>>()
      .mockImplementationOnce(() => new Promise<{ default: typeof Page }>((done) => { resolve = done; }))
      .mockResolvedValueOnce({ default: Page });
    const View = createDeferredView(load);
    render(<View title="当前页面" />);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("PAGE_LOAD_TIMEOUT");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "当前页面" })).toBeInTheDocument();

    await act(async () => { resolve({ default: () => <h1>过期页面</h1> }); });
    expect(screen.queryByRole("heading", { name: "过期页面" })).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("离开页面后清理计时器并忽略迟到的加载失败", async () => {
    vi.useFakeTimers();
    let reject!: (reason: Error) => void;
    const View = createDeferredView(() => new Promise<{ default: typeof Page }>((_resolve, fail) => { reject = fail; }));
    const { unmount } = render(<View title="插件" />);
    await act(async () => {});
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { reject(new Error("late failure")); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
