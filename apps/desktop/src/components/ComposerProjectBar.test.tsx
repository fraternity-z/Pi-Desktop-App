import { act, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerProjectBar } from "./ComposerProjectBar";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setWidths(viewport: HTMLElement, clientWidth = 220, scrollWidth = 500) {
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
  });
}

function renderBar() {
  const result = render(
    <ComposerProjectBar>
      <button type="button">Pi Desktop App</button>
      <span>本地</span>
      <button type="button">main</button>
    </ComposerProjectBar>,
  );
  const viewport = screen.getByRole("group", { name: "项目上下文" });
  setWidths(viewport);
  fireEvent.resize(window);
  return { ...result, viewport };
}

function expectEdges(viewport: HTMLElement, left: boolean, right: boolean) {
  expect(viewport).toHaveAttribute("data-overflow-left", String(left));
  expect(viewport).toHaveAttribute("data-overflow-right", String(right));
}

describe("ComposerProjectBar", () => {
  it("根据起点、中间和终点只渐隐有隐藏内容的一侧", () => {
    const { viewport } = renderBar();
    expect(viewport).toHaveAttribute("tabindex", "0");
    expectEdges(viewport, false, true);
    viewport.scrollLeft = 100;
    fireEvent.scroll(viewport);
    expectEdges(viewport, true, true);
    viewport.scrollLeft = 279.5;
    fireEvent.scroll(viewport);
    expectEdges(viewport, true, false);
    viewport.scrollLeft = 0;
    fireEvent.scroll(viewport);
    expectEdges(viewport, false, true);
  });

  it("容器变宽或内容缩短后移除不再需要的遮罩", () => {
    const { viewport, rerender } = renderBar();
    setWidths(viewport, 600, 500);
    fireEvent.resize(window);
    expectEdges(viewport, false, false);
    setWidths(viewport, 220, 800);
    rerender(<ComposerProjectBar><button>更长的项目和分支名称</button></ComposerProjectBar>);
    expectEdges(viewport, false, true);
    setWidths(viewport, 220, 220);
    rerender(<ComposerProjectBar><button>短名称</button></ComposerProjectBar>);
    expectEdges(viewport, false, false);
  });

  it("观察容器和内容尺寸以响应侧边栏与字体变化，并在卸载后清理", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let notifyResize = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const { viewport, unmount } = renderBar();
    expect(observe).toHaveBeenCalledWith(viewport);
    expect(observe).toHaveBeenCalledWith(viewport.firstElementChild);
    setWidths(viewport, 600, 500);
    act(() => notifyResize());
    expectEdges(viewport, false, false);
    const removeViewportListener = vi.spyOn(viewport, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeViewportListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(removeViewportListener).toHaveBeenCalledWith("wheel", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("把普通滚轮转换成横向滚动，到达边界后不拦截页面滚动", () => {
    const { viewport } = renderBar();
    expect(fireEvent.wheel(viewport, { deltaY: 100 })).toBe(false);
    expect(viewport.scrollLeft).toBe(100);
    expectEdges(viewport, true, true);
    fireEvent.wheel(viewport, { deltaY: 500 });
    expect(viewport.scrollLeft).toBe(280);
    expectEdges(viewport, true, false);
    expect(fireEvent.wheel(viewport, { deltaY: 100 })).toBe(true);
    fireEvent.wheel(viewport, { deltaY: -500, shiftKey: true });
    expect(viewport.scrollLeft).toBe(0);
    expect(fireEvent.wheel(viewport, { deltaY: -100 })).toBe(true);
  });

  it("处理按行与按页滚动的鼠标事件", () => {
    const { viewport } = renderBar();
    fireEvent.wheel(viewport, { deltaY: 2, deltaMode: 1 });
    expect(viewport.scrollLeft).toBe(32);
    fireEvent.wheel(viewport, { deltaY: 1, deltaMode: 2 });
    expect(viewport.scrollLeft).toBe(252);
  });

  it("缩放导致边界出现小数偏差时不反向跳动或拦截页面滚动", () => {
    const { viewport } = renderBar();
    for (const offset of [279.5, 280.8]) {
      viewport.scrollLeft = offset;
      expect(fireEvent.wheel(viewport, { deltaY: 100 })).toBe(true);
      expect(viewport.scrollLeft).toBe(offset);
    }
    viewport.scrollLeft = 0.5;
    expect(fireEvent.wheel(viewport, { deltaY: -100 })).toBe(true);
    expect(viewport.scrollLeft).toBe(0.5);
    fireEvent.wheel(viewport, { deltaY: 100 });
    expect(viewport.scrollLeft).toBe(100.5);
  });

  it("保留原生横向手势、缩放以及无需溢出时的页面滚动", () => {
    const { viewport } = renderBar();
    for (const options of [
      { deltaX: 100, deltaY: 20 },
      { deltaY: 100, ctrlKey: true },
      { deltaY: 100, metaKey: true },
    ]) {
      expect(fireEvent.wheel(viewport, options)).toBe(true);
      expect(viewport.scrollLeft).toBe(0);
    }
    const prevented = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    prevented.preventDefault();
    fireEvent(viewport, prevented);
    expect(viewport.scrollLeft).toBe(0);
    setWidths(viewport, 600, 500);
    expect(fireEvent.wheel(viewport, { deltaY: 100 })).toBe(true);
    expect(viewport.scrollLeft).toBe(0);
  });

  it("支持方向键并保留按钮激活和修饰键行为", () => {
    const { viewport } = renderBar();
    const project = screen.getByRole("button", { name: "Pi Desktop App" });
    fireEvent.keyDown(project, { key: "ArrowRight" });
    expect(viewport.scrollLeft).toBe(80);
    expectEdges(viewport, true, true);
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(viewport.scrollLeft).toBe(0);
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(viewport.scrollLeft).toBe(0);
    for (const options of [
      { key: "Enter" },
      { key: "ArrowRight", ctrlKey: true },
      { key: "ArrowRight", metaKey: true },
      { key: "ArrowRight", altKey: true },
    ]) {
      expect(fireEvent.keyDown(viewport, options)).toBe(true);
      expect(viewport.scrollLeft).toBe(0);
    }
    viewport.scrollLeft = 270;
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(viewport.scrollLeft).toBe(280);
    expectEdges(viewport, true, false);
    setWidths(viewport, 600, 500);
    expect(fireEvent.keyDown(viewport, { key: "ArrowRight" })).toBe(true);
  });

  it("不拦截 portal 弹出菜单中的方向键", () => {
    render(
      <ComposerProjectBar>
        <button>项目</button>
        {createPortal(<input aria-label="搜索分支" />, document.body)}
      </ComposerProjectBar>,
    );
    const viewport = screen.getByRole("group", { name: "项目上下文" });
    setWidths(viewport);
    const input = screen.getByRole("textbox", { name: "搜索分支" });
    expect(viewport).not.toContainElement(input);
    expect(fireEvent.keyDown(input, { key: "ArrowRight" })).toBe(true);
    expect(viewport.scrollLeft).toBe(0);
  });
});
