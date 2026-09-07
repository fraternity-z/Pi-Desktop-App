import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useKeyboardShortcuts } from "../stores/useKeyboardShortcuts";
import { KeyboardShortcutSettings } from "./KeyboardShortcutSettings";

function Settings() {
  return <KeyboardShortcutSettings controller={useKeyboardShortcuts()} />;
}
describe("KeyboardShortcutSettings", () => {
  beforeEach(() => localStorage.clear());
  it("records, detects conflicts, cancels, clears and restores bindings", () => {
    render(<Settings />);
    const binding = screen.getByRole("button", { name: "修改命令面板快捷键" });
    fireEvent.click(binding);
    fireEvent.keyDown(binding, { key: "n", ctrlKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent("新建会话");
    fireEvent.keyDown(binding, { key: "u", ctrlKey: true });
    expect(binding).toHaveTextContent("U");
    fireEvent.click(binding);
    fireEvent.keyDown(binding, { key: "Escape" });
    expect(binding).toHaveTextContent("U");
    fireEvent.click(screen.getByRole("button", { name: "清除命令面板快捷键" }));
    expect(binding).toHaveTextContent("未设置");
    fireEvent.click(screen.getByRole("button", { name: "重置命令面板快捷键" }));
    expect(binding).toHaveTextContent("K");
    fireEvent.click(screen.getByRole("button", { name: "全部重置" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("未找到快捷键")).toBeInTheDocument();
  });
});
