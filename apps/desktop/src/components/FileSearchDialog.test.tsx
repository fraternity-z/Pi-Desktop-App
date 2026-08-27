import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileSearchDialog, getFileSearchResultName } from "./FileSearchDialog";

describe("FileSearchDialog", () => {
  afterEach(() => vi.useRealTimers());

  it("搜索、键盘选择并打开结果", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue([{ path: "src/main.ts" }, { path: "README.md" }]);
    const onOpenFile = vi.fn();
    render(<FileSearchDialog open search={search} onClose={vi.fn()} onOpenFile={onOpenFile} debounceMs={10} />);
    const input = screen.getByRole("searchbox", { name: "输入内容搜索文件" });
    fireEvent.change(input, { target: { value: "main" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(search).toHaveBeenCalledWith("main");
    expect(screen.getByRole("button", { name: /main.ts/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenFile).toHaveBeenCalledWith({ path: "README.md" });
  });

  it("支持错误、空查询、关闭和结果名回退", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<FileSearchDialog open search={vi.fn().mockRejectedValue(new Error("连接失败"))} onClose={onClose} onOpenFile={vi.fn()} debounceMs={1} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "x" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("alert")).toHaveTextContent("连接失败");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { value: " " } });
    expect(screen.queryByText("没有匹配文件")).not.toBeInTheDocument();
    expect(getFileSearchResultName({ path: "C:\\repo\\src\\a.ts" })).toBe("a.ts");
    expect(getFileSearchResultName({ path: "x", name: "  名称  " })).toBe("名称");
  });

  it("关闭时不渲染", () => {
    render(<FileSearchDialog open={false} search={vi.fn()} onClose={vi.fn()} onOpenFile={vi.fn()} />);
    expect(screen.queryByRole("dialog", { name: "搜索文件" })).not.toBeInTheDocument();
  });
});
