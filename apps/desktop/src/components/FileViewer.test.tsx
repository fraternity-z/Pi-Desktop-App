import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileViewer, relativeFilePath, splitFileContent } from "./FileViewer";

describe("FileViewer", () => {
  it("显示路径、行号、评论和外部操作", async () => {
    const onCopy = vi.fn();
    const onReveal = vi.fn();
    render(<FileViewer path="C:\\repo\\src\\main.ts" rootPath="C:\\repo" content={"one\r\ntwo"} comments={[{ id: "c1", line: 2, text: "需要补充测试" }]} onCopy={onCopy} onReveal={onReveal} />);
    expect(screen.getByRole("navigation", { name: "文件路径" })).toHaveTextContent("src›main.ts");
    expect(screen.getByText("需要补充测试")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制文件内容" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "显示文件所在文件夹" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "显示文件所在文件夹" }));
    expect(onCopy).toHaveBeenCalledWith("one\r\ntwo");
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("处理加载和错误重试状态", () => {
    const { rerender } = render(<FileViewer path="a.ts" content="" loading />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取文件");
    const onRetry = vi.fn();
    rerender(<FileViewer path="a.ts" content="" error="读取失败" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("导出的文本辅助函数覆盖路径边界", () => {
    expect(relativeFilePath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativeFilePath("/other/a.ts", "/repo")).toBe("/other/a.ts");
    expect(splitFileContent("")).toEqual([""]);
    expect(splitFileContent("a\rb")).toEqual(["a", "b"]);
  });

  it("创建、取消、删除本地行评论并显示动作错误", async () => {
    const onCreateComment = vi.fn().mockResolvedValue(undefined);
    const onDeleteComment = vi.fn().mockRejectedValue(new Error("删除失败"));
    render(<FileViewer path="a.ts" content={["第一行", "第二行"].join("\n")} comments={[{ id: "c1", line: 1, text: "旧评论" }]} onCreateComment={onCreateComment} onDeleteComment={onDeleteComment} />);
    fireEvent.click(screen.getByRole("button", { name: "评论第 2 行" }));
    const submit = screen.getByRole("button", { name: "注释" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "第 2 行评论" }), { target: { value: " 新评论 " } });
    fireEvent.click(submit);
    await screen.findByText("第一行");
    expect(onCreateComment).toHaveBeenCalledWith({ line: 2, lineText: "第二行", text: "新评论" });
    fireEvent.click(screen.getByRole("button", { name: "评论第 1 行" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("textbox", { name: "第 1 行评论" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除本地评论" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("删除失败");
  });

  it("捕获工具栏结构化错误并在执行期间禁用其他动作", async () => {
    let rejectOpen: ((reason: unknown) => void) | undefined;
    const onOpenExternal = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectOpen = reject;
    }));
    render(
      <FileViewer
        path="a.ts"
        content="line"
        onOpenExternal={onOpenExternal}
        onReveal={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "在外部打开文件" }));
    expect(screen.getByRole("button", { name: "显示文件所在文件夹" })).toBeDisabled();
    rejectOpen?.({ code: "WORKSPACE_FILE_OPEN_FAILED", message: "无法打开" });
    expect(await screen.findByRole("alert")).toHaveTextContent("WORKSPACE_FILE_OPEN_FAILED: 无法打开");
  });
});
