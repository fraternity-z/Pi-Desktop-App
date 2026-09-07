import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RightPanel, type RightPanelProps } from "./RightPanel";

function panelProps(overrides: Partial<RightPanelProps> = {}): RightPanelProps {
  return {
    open: true,
    available: true,
    width: 560,
    expanded: false,
    activeTab: "review",
    fileTab: { label: "index.ts", title: "E:\\workspace\\src\\index.ts" },
    previewTab: { label: "预览" },
    browserTab: { label: "浏览器" },
    onClose: vi.fn(),
    onWidthChange: vi.fn(),
    onExpandedChange: vi.fn(),
    onActiveTabChange: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenBrowser: vi.fn(),
    onCloseFileTab: vi.fn(),
    onClosePreviewTab: vi.fn(),
    onCloseBrowserTab: vi.fn(),
    ...overrides,
  };
}

describe("RightPanel", () => {
  it("展示固定审查和受控动态标签页", () => {
    const props = panelProps();
    render(<RightPanel {...props}>审查内容</RightPanel>);
    expect(screen.getByRole("tab", { name: "审查" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "index.ts" })).toHaveAttribute("title", "E:\\workspace\\src\\index.ts");
    fireEvent.click(screen.getByRole("tab", { name: "index.ts" }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith("file");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("审查内容");
  });

  it("菜单、关闭、展开走受控回调，快捷键由工作台统一分发", () => {
    const props = panelProps({ activeTab: "file", fileShortcut: "Ctrl+O" });
    render(<RightPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    expect(screen.getByRole("menuitem", { name: /打开文件/ })).toHaveTextContent("Ctrl+O");
    fireEvent.click(screen.getByRole("menuitem", { name: /打开文件/ }));
    expect(props.onOpenFile).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "关闭文件标签页" }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith("review");
    expect(props.onCloseFileTab).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "展开工作区侧边栏" }));
    expect(props.onExpandedChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭差异侧栏" }));
    expect(props.onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(props.onOpenFile).toHaveBeenCalledOnce();
    expect(props.onOpenBrowser).not.toHaveBeenCalled();
  });

  it("支持可访问的指针和键盘宽度调整", () => {
    const props = panelProps({ width: 560 });
    render(<RightPanel {...props} />);
    const resizer = screen.getByRole("separator", { name: "调整右侧面板宽度" });
    fireEvent.pointerDown(resizer, { clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(props.onWidthChange).toHaveBeenCalledWith(512);
    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(props.onWidthChange).toHaveBeenCalledWith(512);
    fireEvent.keyDown(resizer, { key: "Home" });
    expect(props.onWidthChange).toHaveBeenCalledWith(320);
  });

  it("每帧只提交最新宽度，结束和卸载时清理待执行帧", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    const props = panelProps({ width: 400 });
    const { unmount } = render(<RightPanel {...props} />);
    const resizer = screen.getByRole("separator");
    fireEvent.pointerDown(resizer, { clientX: 600, pointerId: 1 });
    for (let x = 590; x >= 550; x -= 10) fireEvent.pointerMove(resizer, { clientX: x, pointerId: 1 });
    expect(props.onWidthChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    act(() => { frames.get(sequence)!(0); frames.delete(sequence); });
    expect(props.onWidthChange).toHaveBeenCalledExactlyOnceWith(450);
    fireEvent.pointerMove(resizer, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(props.onWidthChange).toHaveBeenLastCalledWith(460);
    expect(frames.size).toBe(0);
    fireEvent.pointerDown(resizer, { clientX: 600, pointerId: 2 });
    fireEvent.pointerMove(resizer, { clientX: 560, pointerId: 2 });
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    vi.restoreAllMocks();
  });

  it("不可用时不渲染，收起时保留关闭过渡状态", () => {
    const { rerender } = render(<RightPanel {...panelProps({ available: false })} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    rerender(<RightPanel {...panelProps({ open: false, closing: true })} />);
    expect(document.querySelector(".right-panel")).toHaveClass("right-panel-closing");
    expect(document.querySelector(".right-panel")).toHaveAttribute("aria-hidden", "true");
  });

  it("动态标签缺失、展开和菜单外点击时维持稳定状态", () => {
    const props = panelProps({ fileTab: null, previewTab: null, browserTab: null, expanded: true });
    render(<><button type="button">外部</button><RightPanel {...props} /></>);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "index.ts" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "外部" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起工作区侧边栏" }));
    expect(props.onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("只展示已经接线的新增动作，并关联标签与内容", () => {
    const props = panelProps({ onOpenFile: undefined });
    render(<RightPanel {...props} />);
    const reviewTab = screen.getByRole("tab", { name: "审查" });
    const tabPanel = screen.getByRole("tabpanel");
    expect(reviewTab).toHaveAttribute("aria-controls", tabPanel.id);
    expect(tabPanel).toHaveAttribute("aria-labelledby", reviewTab.id);

    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    expect(screen.queryByRole("menuitem", { name: /打开文件/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /浏览器/ })).toBeInTheDocument();
  });

  it("支持标签页方向键与首尾键导航", () => {
    const props = panelProps();
    render(<RightPanel {...props} />);
    const reviewTab = screen.getByRole("tab", { name: "审查" });
    fireEvent.keyDown(reviewTab, { key: "ArrowRight" });
    expect(props.onActiveTabChange).toHaveBeenCalledWith("file");
    fireEvent.keyDown(reviewTab, { key: "End" });
    expect(props.onActiveTabChange).toHaveBeenCalledWith("browser");
    fireEvent.keyDown(reviewTab, { key: "ArrowLeft" });
    expect(props.onActiveTabChange).toHaveBeenCalledWith("browser");
    fireEvent.keyDown(reviewTab, { key: "ArrowUp" });
    expect(props.onActiveTabChange).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, altKey: true });
    expect(props.onOpenFile).not.toHaveBeenCalled();
  });
});
