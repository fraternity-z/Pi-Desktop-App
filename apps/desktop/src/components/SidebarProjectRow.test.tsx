import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProjectRow } from "./SidebarProjectRow";

type RowProps = ComponentProps<typeof SidebarProjectRow>;

function rowProps(overrides: Partial<RowProps> = {}): RowProps {
  return {
    name: "Alpha",
    cwd: "C:\\projects\\alpha",
    expanded: true,
    active: true,
    pinned: false,
    sessionCount: 7,
    runningCount: 2,
    creationDisabled: false,
    previewEnabled: true,
    onToggle: vi.fn(),
    onNewSession: vi.fn(),
    onMenu: vi.fn(),
    onContextMenu: vi.fn(),
    onTogglePinned: vi.fn(),
    onEdit: vi.fn(),
    onPreviewEnter: vi.fn(),
    onPreviewLeave: vi.fn(),
    ...overrides,
  };
}

function hoverRow() {
  fireEvent.pointerEnter(screen.getByRole("button", { name: /^(折叠|展开)Alpha$/ }));
  act(() => vi.advanceTimersByTime(400));
  return screen.getByRole("dialog", { name: "Alpha" });
}

describe("SidebarProjectRow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("通过独立笔形按钮新建会话，鼠标与键盘均不会折叠项目", () => {
    const props = rowProps();
    render(<SidebarProjectRow {...props} />);
    const compose = screen.getByRole("button", { name: "在Alpha中新建会话" });
    expect(compose.querySelector("svg")).toHaveClass("lucide-square-pen");
    fireEvent.keyDown(compose, { key: "Enter" });
    fireEvent.keyDown(compose, { key: " " });
    fireEvent.click(compose);
    expect(props.onNewSession).toHaveBeenCalledOnce();
    expect(props.onToggle).not.toHaveBeenCalled();
    const menu = screen.getByRole("button", { name: "Alpha更多操作" });
    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(menu);
    expect(props.onMenu).toHaveBeenCalledOnce();
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it("保留项目行鼠标、Enter 和空格的展开切换", () => {
    const props = rowProps({ expanded: false, active: false });
    render(<SidebarProjectRow {...props} />);
    const row = screen.getByRole("button", { name: "展开Alpha" });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row).not.toHaveAttribute("data-active");
    expect(row.querySelector("svg")).toHaveClass("lucide-folder");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "Home" });
    expect(props.onToggle).toHaveBeenCalledTimes(3);
  });

  it("创建禁用时不触发会话回调", () => {
    const props = rowProps({ creationDisabled: true });
    render(<SidebarProjectRow {...props} />);
    const compose = screen.getByRole("button", { name: "在Alpha中新建会话" });
    expect(compose).toBeDisabled();
    fireEvent.click(compose);
    expect(props.onNewSession).not.toHaveBeenCalled();
  });

  it("略过短暂经过，在持续悬停后显示完整工作区信息", () => {
    const props = rowProps();
    const { container } = render(<SidebarProjectRow {...props} />);
    const row = screen.getByRole("button", { name: "折叠Alpha" });
    fireEvent.pointerEnter(row);
    act(() => vi.advanceTimersByTime(399));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.pointerLeave(row);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const card = hoverRow();
    expect(container).not.toContainElement(card);
    expect(within(card).getByText(props.cwd)).toBeInTheDocument();
    expect(card).toHaveTextContent("7 个会话 · 2 个运行中");
    expect(row).toHaveAttribute("aria-describedby");
    expect(row).toHaveAttribute("data-preview-open", "true");
  });

  it("允许从项目行移入右侧卡片操作，移出后延迟关闭", () => {
    const props = rowProps();
    render(<SidebarProjectRow {...props} />);
    const card = hoverRow();
    fireEvent.pointerLeave(screen.getByRole("button", { name: "折叠Alpha" }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(400));
    expect(card).toBeInTheDocument();
    expect(props.onPreviewEnter).toHaveBeenCalledOnce();
    fireEvent.click(within(card).getByRole("button", { name: "置顶Alpha" }));
    expect(props.onTogglePinned).toHaveBeenCalledOnce();
    expect(props.onToggle).not.toHaveBeenCalled();
    fireEvent.pointerLeave(card);
    expect(props.onPreviewLeave).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(159));
    expect(card).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(card).not.toBeInTheDocument();
  });

  it("置顶、编辑操作复用外部回调并提供准确状态", () => {
    const props = rowProps({ pinned: true });
    render(<SidebarProjectRow {...props} />);
    const card = hoverRow();
    expect(within(card).getByRole("button", { name: "取消置顶Alpha" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(card).getByRole("button", { name: "编辑项目" }));
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("支持键盘进入信息卡，Escape 关闭并恢复到工作区行", () => {
    render(<SidebarProjectRow {...rowProps()} />);
    const row = screen.getByRole("button", { name: "折叠Alpha" });
    act(() => row.focus());
    const card = screen.getByRole("dialog", { name: "Alpha" });
    fireEvent.pointerLeave(row);
    act(() => vi.advanceTimersByTime(400));
    expect(card).toBeInTheDocument();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(within(card).getByRole("button", { name: "置顶Alpha" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Home" });
    expect(card).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(row).toHaveFocus();
    act(() => row.blur());
    act(() => row.focus());
    fireEvent.blur(row, { relatedTarget: document.body });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["resize", "scroll", "outside", "Escape"])("%s 关闭卡片并清理监听", (action) => {
    const { unmount } = render(<SidebarProjectRow {...rowProps()} />);
    hoverRow();
    if (action === "outside") fireEvent.pointerDown(document.body);
    else if (action === "Escape") fireEvent.keyDown(document, { key: action });
    else fireEvent(window, new Event(action));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("信息卡内滚动或按下不会误关闭", () => {
    render(<SidebarProjectRow {...rowProps()} />);
    const card = hoverRow();
    fireEvent.scroll(card);
    fireEvent.pointerDown(card);
    expect(card).toBeInTheDocument();
  });

  it("右键或更多操作打开时立即关闭信息卡", () => {
    const props = rowProps();
    render(<SidebarProjectRow {...props} />);
    hoverRow();
    fireEvent.contextMenu(screen.getByRole("button", { name: "折叠Alpha" }));
    expect(props.onContextMenu).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    hoverRow();
    fireEvent.click(screen.getByRole("button", { name: "Alpha更多操作" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("关闭侧边栏或打开对话框时取消待显示卡片", () => {
    const props = rowProps();
    const { rerender, unmount } = render(<SidebarProjectRow {...props} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "折叠Alpha" }));
    rerender(<SidebarProjectRow {...props} previewEnabled={false} />);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "折叠Alpha" }));
    fireEvent.focus(screen.getByRole("button", { name: "折叠Alpha" }));
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<SidebarProjectRow {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "折叠Alpha" }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("优先放在右侧并防止越过窗口右边界和底部", () => {
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("sidebar-project-preview")
        ? new DOMRect(0, 0, 380, 180)
        : new DOMRect(12, 200, 280, 36);
    });
    const props = rowProps();
    const { rerender } = render(<SidebarProjectRow {...props} />);
    const card = hoverRow();
    expect(card).toHaveStyle({ left: "300px", top: "200px" });
    bounds.mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("sidebar-project-preview")
        ? new DOMRect(0, 0, 380, 180)
        : new DOMRect(800, 740, 200, 36);
    });
    rerender(<SidebarProjectRow {...props} sessionCount={8} runningCount={0} />);
    expect(card).toHaveStyle({ left: `${window.innerWidth - 388}px`, top: `${window.innerHeight - 188}px` });
    expect(card).toHaveTextContent("8 个会话 · 0 个运行中");
  });
});
