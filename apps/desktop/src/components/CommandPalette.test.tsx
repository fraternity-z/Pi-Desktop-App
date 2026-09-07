import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "../stores/useKeyboardShortcuts";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("keeps Tab focus inside the dialog and activates buttons", () => {
    const onAction = vi.fn();
    render(<CommandPalette bindings={DEFAULT_SHORTCUTS} disabled={{}} onAction={onAction} onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "关闭" });
    const last = screen.getByRole("button", { name: /打开浏览器/ });
    last.focus(); fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.click(last);
    expect(onAction).toHaveBeenCalledWith("browser");
    const search = screen.getByRole("searchbox");
    search.focus(); fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(last).toHaveFocus();
  });
  it("searches commands, supports keyboard selection, disabled actions and Escape", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        bindings={DEFAULT_SHORTCUTS}
        disabled={{ newSession: true }}
        onAction={onAction}
        onClose={onClose}
      />,
    );
    const search = screen.getByRole("searchbox");
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: /新建会话/ })).toBeDisabled();
    fireEvent.change(search, { target: { value: "资源" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith("resources");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /打开资源/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.change(search, { target: { value: "无匹配" } });
    expect(screen.getByText("未找到命令")).toBeInTheDocument();
  });
});
