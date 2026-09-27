import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRightPanelSessionState } from "../stores/useRightPanelSessionState";

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
    onClose: vi.fn(),
    onWidthChange: vi.fn(),
    onExpandedChange: vi.fn(),
    onActiveTabChange: vi.fn(),
    onOpenFile: vi.fn(),
    onCloseFileTab: vi.fn(),
    onClosePreviewTab: vi.fn(),
    ...overrides,
  };
}

describe("RightPanel", () => {
  beforeEach(() => sessionStorage.clear());
  it("展示固定审查和受控动态标签页", () => {
    const props = panelProps();
    render(<RightPanel {...props}>审查内容</RightPanel>);
    expect(screen.getByRole("tab", { name: "审查" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "index.ts" })).toHaveAttribute("title", "E:\\workspace\\src\\index.ts");
    fireEvent.click(screen.getByRole("tab", { name: "index.ts" }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith("file");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("审查内容");
  });

  it("启动页、关闭、展开走受控回调，快捷键由工作台统一分发", () => {
    const props = panelProps({ activeTab: "file", fileShortcut: "Ctrl+O" });
    const { rerender } = render(<RightPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith(null);
    rerender(<RightPanel {...props} activeTab={null} />);
    expect(screen.getByRole("tab", { name: "新标签页" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /打开文件/ })).toHaveTextContent("Ctrl+O");
    fireEvent.click(screen.getByRole("button", { name: /打开文件/ }));
    expect(props.onOpenFile).toHaveBeenCalledOnce();
    rerender(<RightPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭文件标签页" }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith("preview");
    expect(props.onCloseFileTab).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "展开工作区侧边栏" }));
    expect(props.onExpandedChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭差异侧栏" }));
    expect(props.onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(props.onOpenFile).toHaveBeenCalledOnce();
    expect(screen.queryByRole("tab", { name: "浏览器" })).not.toBeInTheDocument();
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
    const props = panelProps({ width: 400, onWidthCommit: vi.fn() });
    const { unmount } = render(<RightPanel {...props} />);
    const resizer = screen.getByRole("separator");
    fireEvent.pointerDown(resizer, { clientX: 600, pointerId: 1 });
    for (let x = 590; x >= 550; x -= 10) fireEvent.pointerMove(resizer, { clientX: x, pointerId: 1 });
    expect(props.onWidthChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    act(() => { frames.get(sequence)!(0); frames.delete(sequence); });
    expect(props.onWidthChange).toHaveBeenCalledExactlyOnceWith(450);
    expect(props.onWidthCommit).not.toHaveBeenCalled();
    fireEvent.pointerMove(resizer, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(props.onWidthChange).toHaveBeenLastCalledWith(460);
    expect(props.onWidthCommit).toHaveBeenCalledExactlyOnceWith(460);
    expect(frames.size).toBe(0);
    fireEvent.pointerDown(resizer, { clientX: 600, pointerId: 2 });
    fireEvent.pointerMove(resizer, { clientX: 560, pointerId: 2 });
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    vi.restoreAllMocks();
  });

  it("不可用时隐藏，收起时保留关闭过渡状态", () => {
    const { rerender } = render(<RightPanel {...panelProps({ available: false })} />);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    rerender(<RightPanel {...panelProps({ open: false, closing: true })} />);
    expect(document.querySelector(".right-panel")).toHaveClass("right-panel-closing");
    expect(document.querySelector(".right-panel")).toHaveAttribute("aria-hidden", "true");
  });

  it("关闭后保留子组件状态，隐藏面板不抢走外部焦点", () => {
    const props = panelProps();
    const content = <input aria-label="缓存草稿" defaultValue="" />;
    const { rerender } = render(<><button type="button">外部焦点</button><RightPanel {...props}>{content}</RightPanel></>);
    const input = screen.getByRole("textbox", { name: "缓存草稿" });
    fireEvent.change(input, { target: { value: "保留内容" } });
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    rerender(<><button type="button">外部焦点</button><RightPanel {...props} open={false} available={false}>{content}</RightPanel></>);
    const external = screen.getByRole("button", { name: "外部焦点" });
    external.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(external).toHaveFocus();
    expect(input).toBeInTheDocument();
    expect(input).not.toBeVisible();
    expect(document.querySelector(".right-panel")).toHaveAttribute("inert");
    rerender(<><button type="button">外部焦点</button><RightPanel {...props}>{content}</RightPanel></>);
    expect(screen.getByRole("textbox", { name: "缓存草稿" })).toBe(input);
    expect(input).toHaveValue("保留内容");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("动态标签缺失、展开和启动页外点击时维持稳定状态", () => {
    const props = panelProps({ fileTab: null, previewTab: null, expanded: true });
    const { rerender } = render(<><button type="button">外部</button><RightPanel {...props} /></>);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("complementary")).toHaveClass("right-panel-expanded");
    expect(screen.queryByRole("tab", { name: "index.ts" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    expect(props.onActiveTabChange).toHaveBeenCalledWith(null);
    rerender(<><button type="button">外部</button><RightPanel {...props} activeTab={null} /></>);
    expect(screen.getByRole("tabpanel", { name: "新标签页" })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "外部" }));
    expect(screen.getByRole("tabpanel", { name: "新标签页" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("tabpanel", { name: "新标签页" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起工作区侧边栏" }));
    expect(props.onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("只展示已经接线的新增动作，并关联标签与内容", () => {
    const props = panelProps({ onOpenFile: undefined });
    const { rerender } = render(<RightPanel {...props} />);
    const reviewTab = screen.getByRole("tab", { name: "审查" });
    const tabPanel = screen.getByRole("tabpanel");
    expect(reviewTab).toHaveAttribute("aria-controls", tabPanel.id);
    expect(tabPanel).toHaveAttribute("aria-labelledby", reviewTab.id);

    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    rerender(<RightPanel {...props} activeTab={null} />);
    expect(screen.queryByRole("button", { name: /打开文件/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文件列表" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Git 审查" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /终端|浏览器/ })).not.toBeInTheDocument();
  });

  it("支持标签页方向键与首尾键导航", () => {
    const props = panelProps();
    render(<RightPanel {...props} />);
    const reviewTab = screen.getByRole("tab", { name: "审查" });
    fireEvent.keyDown(reviewTab, { key: "ArrowRight" });
    expect(props.onActiveTabChange).toHaveBeenCalledWith("files");
    fireEvent.keyDown(reviewTab, { key: "End" });
    expect(props.onActiveTabChange).toHaveBeenCalledWith("preview");
    fireEvent.keyDown(reviewTab, { key: "ArrowLeft" });
    expect(props.onActiveTabChange).toHaveBeenCalledWith("preview");
    fireEvent.keyDown(reviewTab, { key: "ArrowUp" });
    expect(props.onActiveTabChange).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, altKey: true });
    expect(props.onOpenFile).not.toHaveBeenCalled();
  });

  it("保存每个会话的标签顺序，支持中键关闭和双击重置宽度", () => {
    const props = panelProps({ activeTab: "file", sessionKey: "session-a" });
    const { rerender } = render(<RightPanel {...props} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "index.ts" }), { key: "ArrowLeft", altKey: true });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["审查", "index.ts", "文件", "预览"]);
    expect(JSON.parse(sessionStorage.getItem("pi-desktop.panel-order:session-a")!)).toEqual(["review", "file", "files", "preview"]);
    fireEvent(screen.getByRole("tab", { name: "index.ts" }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(props.onCloseFileTab).toHaveBeenCalledOnce();
    expect(props.onActiveTabChange).toHaveBeenCalledWith("files");
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(props.onWidthChange).toHaveBeenCalledWith(512);
    rerender(<RightPanel {...props} sessionKey="session-b" />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["审查", "文件", "index.ts", "预览"]);
    rerender(<RightPanel {...props} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["审查", "index.ts", "文件", "预览"]);
  });

  it("拖拽边缘滚动，按落点排序且不改变当前标签", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.set(++sequence, callback); return sequence; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
    const props = panelProps();
    render(<RightPanel {...props} />);
    const strip = screen.getByRole("tablist");
    vi.spyOn(strip, "getBoundingClientRect").mockReturnValue({ left: 0, right: 100, width: 100 } as DOMRect);
    const from = screen.getByRole("tab", { name: "审查" }).parentElement!;
    const to = screen.getByRole("tab", { name: "文件" }).parentElement!;
    fireEvent.dragStart(from, { dataTransfer: { setData: vi.fn() } });
    fireEvent(strip, new MouseEvent("dragover", { bubbles: true, clientX: 99 }));
    act(() => { const frame = frames.get(sequence)!; frames.delete(sequence); frame(0); });
    expect(strip.scrollLeft).toBe(12);
    fireEvent(to, new MouseEvent("drop", { bubbles: true, clientX: 99 }));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["文件", "审查", "index.ts", "预览"]);
    expect(props.onActiveTabChange).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(strip).not.toContainElement(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    vi.restoreAllMocks();
  });

  it("关闭所有工具保留启动器，重新打开与关闭后焦点安全", () => {
    function Harness() {
      const state = useRightPanelSessionState("focus-session");
      return <RightPanel {...panelProps({ fileTab: null, previewTab: null })} activeTab={state.activeTab} toolTabs={state.toolTabs} onActiveTabChange={state.setActiveTab} onCloseToolTab={state.closeToolTab} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "文件列表" }));
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("button", { name: "Git 审查" }));
    const review = screen.getByRole("tab", { name: "审查" });
    review.focus();
    fireEvent.keyDown(review, { key: "Delete" });
    expect(screen.queryByRole("tab", { name: "审查" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文件" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "文件" }), { key: "Backspace" });
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "新标签页" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "打开右侧面板标签页" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "新标签页" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("button", { name: "Git 审查" }));
    expect(screen.getByRole("tab", { name: "审查" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("button", { name: "文件列表" }));
    const files = screen.getByRole("tab", { name: "文件" });
    fireEvent.keyDown(files, { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(files).toHaveFocus();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["文件", "审查"]);
  });

  it("启动页保持内容状态且支持键盘返回现有标签", () => {
    const props = panelProps();
    const content = <input aria-label="工作区草稿" defaultValue="保留草稿" />;
    const { rerender } = render(<RightPanel {...props}>{content}</RightPanel>);
    const input = screen.getByRole("textbox", { name: "工作区草稿" });
    rerender(<RightPanel {...props} activeTab={null}>{content}</RightPanel>);
    expect(input).toBeInTheDocument();
    expect(input).not.toBeVisible();
    const launcher = screen.getByRole("tab", { name: "新标签页" });
    fireEvent.keyDown(launcher, { key: "ArrowRight" });
    expect(props.onActiveTabChange).toHaveBeenLastCalledWith("review");
    fireEvent.keyDown(launcher, { key: "End" });
    expect(props.onActiveTabChange).toHaveBeenLastCalledWith("preview");
    fireEvent.click(screen.getByRole("button", { name: "关闭新标签页" }));
    expect(props.onActiveTabChange).toHaveBeenLastCalledWith("review");
    rerender(<RightPanel {...props}>{content}</RightPanel>);
    expect(screen.getByRole("textbox", { name: "工作区草稿" })).toBe(input);
    expect(input).toHaveValue("保留草稿");
  });
});
