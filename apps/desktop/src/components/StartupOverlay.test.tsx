import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STARTUP_EXIT_DURATION_MS,
  STARTUP_SLOW_NOTICE_MS,
  StartupOverlay,
} from "./StartupOverlay";

let frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
});

function paintFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(performance.now()));
  });
}

function presentOverlay() {
  paintFrame();
  paintFrame();
}

function finishWriting(target = document.querySelector('[data-final="true"]')!, name = "startup-mask-finish") {
  // jsdom lacks AnimationEvent, so React can select the WebKit event name.
  for (const type of ["animationend", "webkitAnimationEnd"]) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "animationName", { value: name });
    fireEvent(target, event);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.reduceMotion;
});

describe("StartupOverlay", () => {
  it("展示真实阶段，并在显式指定的最短时长后退出", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onFinished = vi.fn();
    const { container, rerender } = render(
      <StartupOverlay
        ready={false}
        stage="runtime"
        error={null}
        onRetry={vi.fn()}
        onExit={vi.fn()}
        onFinished={onFinished}
        minimumDurationMs={1_000}
        exitDurationMs={200}
      />,
    );

    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "PI Desktop" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "正在连接本机 Pi 运行时" })).toHaveTextContent(
      "正在连接本机 Pi 运行时",
    );
    expect(container.querySelector(".startup-brand-icon img")).toHaveAttribute(
      "src",
      expect.stringContaining("128x128@2x.png"),
    );
    presentOverlay();
    finishWriting();

    rerender(
      <StartupOverlay
        ready
        stage="catalog"
        error={null}
        onRetry={vi.fn()}
        onExit={vi.fn()}
        onFinished={onFinished}
        minimumDurationMs={1_000}
        exitDurationMs={200}
      />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toHaveAttribute(
      "data-state",
      "loading",
    );
    expect(onFinished).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toHaveAttribute(
      "data-state",
      "leaving",
    );
    await act(async () => vi.advanceTimersByTimeAsync(199));
    expect(onFinished).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("快速初始化也等待可见绘制与最后笔迹完成后再淡出", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onFinished = vi.fn();
    render(
      <StartupOverlay ready stage="catalog" error={null} onRetry={vi.fn()}
        onExit={vi.fn()} onFinished={onFinished} />,
    );
    const wordmark = document.querySelector(".startup-handwriting");
    expect(wordmark).toHaveAttribute("data-playing", "false");
    paintFrame();
    expect(wordmark).toHaveAttribute("data-playing", "false");
    paintFrame();
    expect(wordmark).toHaveAttribute("data-playing", "true");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "loading");
    finishWriting(document.querySelector(".startup-handwriting-mask-finish")!);
    finishWriting(undefined, "unrelated-animation");
    expect(wordmark).toHaveAttribute("data-complete", "false");
    finishWriting();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "leaving");
    expect(screen.getByRole("status")).toHaveTextContent("准备就绪");
    for (const step of within(screen.getByRole("list", { name: "启动进度" })).getAllByRole("listitem")) {
      expect(step).toHaveAttribute("data-state", "complete");
      expect(step).not.toHaveAttribute("aria-current");
    }
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_EXIT_DURATION_MS));
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("等待阶段变化不会触发退出，卸载后清理待执行回调", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onFinished = vi.fn();
    const props = { ready: false, error: null, onRetry: vi.fn(), onExit: vi.fn(), onFinished };
    const { rerender, unmount } = render(<StartupOverlay {...props} stage="runtime" />);
    presentOverlay();
    finishWriting();
    rerender(<StartupOverlay {...props} stage="events" />);
    expect(screen.getByRole("status")).toHaveTextContent("正在准备会话事件通道");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(onFinished).not.toHaveBeenCalled();
    rerender(<StartupOverlay {...props} stage="catalog" ready />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    unmount();
    await act(async () => vi.runAllTimersAsync());
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("进度只随实际阶段推进，未就绪时不会提前退出", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onFinished = vi.fn();
    const props = { ready: false, error: null, onRetry: vi.fn(), onExit: vi.fn(), onFinished };
    const { rerender } = render(<StartupOverlay {...props} stage="runtime" />);
    const progress = screen.getByRole("list", { name: "启动进度" });
    expect(progress.tagName).toBe("OL");
    const steps = within(progress).getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    ["本机运行时", "事件连接", "工作区与会话"].forEach((label, index) => {
      expect(steps[index]).toHaveTextContent(label);
    });

    for (const [stage, label, states] of [
      ["runtime", "正在连接本机 Pi 运行时", ["active", "pending", "pending"]],
      ["events", "正在准备会话事件通道", ["complete", "active", "pending"]],
      ["catalog", "正在同步工作区与会话数据", ["complete", "complete", "active"]],
    ] as const) {
      rerender(<StartupOverlay {...props} stage={stage} />);
      expect(screen.getByRole("status", { name: label })).toHaveTextContent(label);
      states.forEach((state, index) => {
        expect(steps[index]).toHaveAttribute("data-state", state);
        if (state === "active") {
          expect(steps[index]).toHaveAttribute("aria-current", "step");
        } else {
          expect(steps[index]).not.toHaveAttribute("aria-current");
        }
      });
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "loading");
      expect(onFinished).not.toHaveBeenCalled();
    }
  });

  it.each([false, true])("ready=%s 时错误优先于完成状态", async (ready) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onFinished = vi.fn();
    render(
      <StartupOverlay ready={ready} stage="events" error="EVENT_CHANNEL_FAILED: 事件连接失败"
        onRetry={vi.fn()} onExit={vi.fn()} onFinished={onFinished} />,
    );

    const steps = within(screen.getByRole("list", { name: "启动进度" })).getAllByRole("listitem");
    ["complete", "error", "pending"].forEach((state, index) => {
      expect(steps[index]).toHaveAttribute("data-state", state);
      expect(steps[index]).not.toHaveAttribute("aria-current");
    });
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "error");
    expect(screen.getByRole("alert")).toHaveTextContent("EVENT_CHANNEL_FAILED: 事件连接失败");
    expect(screen.queryByText("准备就绪")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS));
    expect(screen.queryByText("启动耗时较长，仍在等待本机响应")).not.toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("连续等待满 8 秒才提示耗时，阶段变化不重置计时或触发初始化操作", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onRetry = vi.fn();
    const onExit = vi.fn();
    const onFinished = vi.fn();
    const props = { ready: false, error: null, onRetry, onExit, onFinished };
    const { rerender } = render(<StartupOverlay {...props} stage="runtime" />);

    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    rerender(<StartupOverlay {...props} stage="events" />);
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS - 4_001));
    expect(screen.queryByText("启动耗时较长，仍在等待本机响应")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole("status")).toHaveTextContent("启动耗时较长，仍在等待本机响应");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "loading");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*%/)).not.toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("失败会清除等待提示，重试后从零开始计算等待时间", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onRetry = vi.fn();
    const onFinished = vi.fn();
    const props = { ready: false, onRetry, onExit: vi.fn(), onFinished };
    const { rerender } = render(<StartupOverlay {...props} stage="runtime" error={null} />);
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS));
    expect(screen.getByText("启动耗时较长，仍在等待本机响应")).toBeInTheDocument();

    rerender(<StartupOverlay {...props} stage="runtime" error="RUNTIME_UNAVAILABLE: 运行时不可用" />);
    expect(screen.queryByText("启动耗时较长，仍在等待本机响应")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS));
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试启动" }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<StartupOverlay {...props} stage="runtime" error={null} />);

    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS - 1));
    expect(screen.queryByText("启动耗时较长，仍在等待本机响应")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText("启动耗时较长，仍在等待本机响应")).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("就绪后清除等待提示，恢复等待会取消退出并重新计时", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onFinished = vi.fn();
    const props = { stage: "catalog" as const, error: null, onRetry: vi.fn(), onExit: vi.fn(), onFinished };
    const { rerender } = render(<StartupOverlay {...props} ready={false} />);
    presentOverlay();
    finishWriting();
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS));
    expect(screen.getByText("启动耗时较长，仍在等待本机响应")).toBeInTheDocument();

    rerender(<StartupOverlay {...props} ready />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "leaving");
    expect(screen.queryByText("启动耗时较长，仍在等待本机响应")).not.toBeInTheDocument();
    rerender(<StartupOverlay {...props} ready={false} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "loading");

    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS - 1));
    expect(screen.queryByText("启动耗时较长，仍在等待本机响应")).not.toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText("启动耗时较长，仍在等待本机响应")).toBeInTheDocument();

    rerender(<StartupOverlay {...props} ready />);
    await act(async () => vi.runAllTimersAsync());
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("等待期间卸载会清理慢启动提示计时器", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onRetry = vi.fn();
    const onFinished = vi.fn();
    const { unmount } = render(
      <StartupOverlay ready={false} stage="runtime" error={null} onRetry={onRetry}
        onExit={vi.fn()} onFinished={onFinished} />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_SLOW_NOTICE_MS - 1));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.runAllTimersAsync());
    expect(onRetry).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("初始化失败会取消退出并提供可聚焦的重试和退出操作", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const onRetry = vi.fn();
    const onExit = vi.fn();
    const onFinished = vi.fn();
    const { rerender } = render(
      <StartupOverlay
        ready
        stage="catalog"
        error={null}
        onRetry={onRetry}
        onExit={onExit}
        onFinished={onFinished}
        minimumDurationMs={0}
        exitDurationMs={300}
      />,
    );
    presentOverlay();
    finishWriting();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toHaveAttribute(
      "data-state",
      "leaving",
    );

    rerender(
      <StartupOverlay
        ready={false}
        stage="catalog"
        error="SESSION_LIST_FAILED: 无法读取会话目录"
        onRetry={onRetry}
        onExit={onExit}
        onFinished={onFinished}
        minimumDurationMs={0}
        exitDurationMs={300}
      />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "SESSION_LIST_FAILED: 无法读取会话目录",
    );
    expect(screen.getByRole("heading", { name: "PI Desktop 启动失败" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试启动" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toHaveAttribute(
      "data-state",
      "error",
    );
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(onFinished).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重试启动" }));
    fireEvent.click(screen.getByRole("button", { name: "退出应用" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("隐藏挂载不消耗展示时长，恢复后从暂停处继续，隐藏时不退出", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let visibility: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const onFinished = vi.fn();
    render(<StartupOverlay ready stage="catalog" error={null} onRetry={vi.fn()}
      onExit={vi.fn()} onFinished={onFinished} minimumDurationMs={1_000} />);
    const wordmark = document.querySelector(".startup-handwriting")!;
    expect(frames.size).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(wordmark).toHaveAttribute("data-playing", "false");
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    presentOverlay();
    expect(wordmark).toHaveAttribute("data-playing", "true");
    finishWriting();
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "loading");
    visibility = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    expect(wordmark).toHaveAttribute("data-playing", "false");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(onFinished).not.toHaveBeenCalled();
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    paintFrame();
    expect(wordmark).toHaveAttribute("data-playing", "false");
    paintFrame();
    expect(wordmark).toHaveAttribute("data-complete", "true");
    await act(async () => vi.runAllTimersAsync());
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("播放中隐藏暂停且不重建笔迹，隐藏会取消淡出", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const onFinished = vi.fn();
    render(<StartupOverlay ready stage="catalog" error={null} onRetry={vi.fn()}
      onExit={vi.fn()} onFinished={onFinished} />);
    presentOverlay();
    const finalStroke = document.querySelector('[data-final="true"]')!;
    visibility = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    expect(document.querySelector(".startup-handwriting")).toHaveAttribute("data-playing", "false");
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    presentOverlay();
    expect(document.querySelector('[data-final="true"]')).toBe(finalStroke);
    finishWriting();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "leaving");
    visibility = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "loading");
  });

  it("StrictMode、重复完成事件和回调变更不会重播或重复退出", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const oldFinished = vi.fn();
    const onFinished = vi.fn();
    const props = { ready: true, stage: "catalog" as const, error: null, onRetry: vi.fn(), onExit: vi.fn() };
    const { rerender } = render(<StrictMode><StartupOverlay {...props} onFinished={oldFinished} /></StrictMode>);
    expect(frames.size).toBe(1);
    presentOverlay();
    finishWriting();
    finishWriting();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    rerender(<StrictMode><StartupOverlay {...props} onFinished={onFinished} /></StrictMode>);
    await act(async () => vi.advanceTimersByTimeAsync(STARTUP_EXIT_DURATION_MS));
    finishWriting();
    rerender(<StrictMode><StartupOverlay {...props} onFinished={vi.fn()} /></StrictMode>);
    await act(async () => vi.runAllTimersAsync());
    expect(oldFinished).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("绘制前卸载取消帧，重新挂载开始新一轮动画", () => {
    const props = { ready: true, stage: "catalog" as const, error: null, onRetry: vi.fn(), onExit: vi.fn(), onFinished: vi.fn() };
    const first = render(<StartupOverlay {...props} />);
    paintFrame();
    first.unmount();
    expect(frames.size).toBe(0);
    render(<StartupOverlay {...props} />);
    expect(document.querySelector(".startup-handwriting")).toHaveAttribute("data-complete", "false");
    presentOverlay();
    expect(document.querySelector(".startup-handwriting")).toHaveAttribute("data-playing", "true");
    expect(props.onFinished).not.toHaveBeenCalled();
  });

  it("失败展示完整标志，重试成功无需等待已取消的动画事件", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const props = { stage: "runtime" as const, onRetry: vi.fn(), onExit: vi.fn(), onFinished: vi.fn() };
    const { rerender } = render(<StartupOverlay {...props} ready={false} error={null} />);
    presentOverlay();
    rerender(<StartupOverlay {...props} ready={false} error="初始化失败" />);
    expect(document.querySelector(".startup-handwriting")).toHaveAttribute("data-complete", "true");
    fireEvent.click(screen.getByRole("button", { name: "重试启动" }));
    rerender(<StartupOverlay {...props} ready={false} error={null} />);
    expect(document.querySelector(".startup-handwriting")).toHaveAttribute("data-complete", "true");
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(props.onFinished).not.toHaveBeenCalled();
    rerender(<StartupOverlay {...props} ready error={null} />);
    await act(async () => vi.runAllTimersAsync());
    expect(props.onFinished).toHaveBeenCalledOnce();
  });

  it.each(["app", "system"])("播放中启用 %s 减少动态效果不会卡住或在恢复偏好时重播", async (source) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const media = new EventTarget();
    let matches = false;
    Object.defineProperty(media, "matches", { get: () => matches });
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    const onFinished = vi.fn();
    const props = { stage: "catalog" as const, error: null, onRetry: vi.fn(), onExit: vi.fn(), onFinished };
    const { rerender } = render(<StartupOverlay {...props} ready={false} />);
    presentOverlay();
    await act(async () => {
      if (source === "app") document.documentElement.dataset.reduceMotion = "true";
      else { matches = true; media.dispatchEvent(new Event("change")); }
    });
    expect(document.querySelector(".startup-handwriting")).toHaveAttribute("data-complete", "true");
    await act(async () => {
      delete document.documentElement.dataset.reduceMotion;
      matches = false;
      media.dispatchEvent(new Event("change"));
    });
    expect(document.querySelector(".startup-handwriting")).toHaveAttribute("data-complete", "true");
    rerender(<StartupOverlay {...props} ready />);
    await act(async () => vi.runAllTimersAsync());
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("减少动态效果时跳过退出过渡等待", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    document.documentElement.dataset.reduceMotion = "true";
    const onFinished = vi.fn();
    render(
      <StartupOverlay
        ready
        stage="catalog"
        error={null}
        onRetry={vi.fn()}
        onExit={vi.fn()}
        onFinished={onFinished}
        minimumDurationMs={0}
        exitDurationMs={320}
      />,
    );

    presentOverlay();
    await act(async () => vi.runAllTimersAsync());
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("遵循系统减少动态效果偏好，立即完成退出过渡", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    const onFinished = vi.fn();
    render(
      <StartupOverlay ready stage="catalog" error={null} onRetry={vi.fn()}
        onExit={vi.fn()} onFinished={onFinished} exitDurationMs={320} />,
    );

    presentOverlay();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(onFinished).toHaveBeenCalledOnce();
  });
});
