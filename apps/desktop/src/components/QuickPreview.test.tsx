import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickPreview } from "./QuickPreview";

const { renderDocx } = vi.hoisted(() => ({ renderDocx: vi.fn() }));

vi.mock("docx-preview", () => ({ renderAsync: renderDocx }));

describe("QuickPreview", () => {
  beforeEach(() => {
    renderDocx.mockReset().mockImplementation(async (_data, body: HTMLElement) => {
      const wrapper = document.createElement("div");
      wrapper.className = "pi-right-panel-docx-wrapper";
      const page = document.createElement("section");
      page.className = "pi-right-panel-docx";
      wrapper.appendChild(page);
      body.appendChild(wrapper);
    });
  });

  it("展示图片、Markdown 与文本预览", () => {
    const { rerender } = render(<QuickPreview target={{ kind: "image", name: "图.png", src: "https://example.com/image.png" }} />);
    expect(screen.getByRole("img", { name: "图.png" })).toHaveAttribute("src", "https://example.com/image.png");
    rerender(<QuickPreview target={{ kind: "markdown", name: "说明.md", content: "# 标题" }} />);
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    rerender(<QuickPreview target={{ kind: "text", name: "日志.txt", content: "内容" }} />);
    expect(screen.getByText("内容")).toBeInTheDocument();
  });

  it("处理文档降级、加载和错误重试", () => {
    const onOpenExternal = vi.fn();
    const { rerender } = render(<QuickPreview target={{ kind: "document", name: "报告.docx", extension: "DOCX" }} onOpenExternal={onOpenExternal} />);
    fireEvent.click(screen.getAllByRole("button", { name: "在外部打开预览" })[0]);
    expect(onOpenExternal).toHaveBeenCalledOnce();
    rerender(<QuickPreview target={{ kind: "text", name: "a.txt" }} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载预览");
    const onRetry = vi.fn();
    rerender(<QuickPreview target={{ kind: "text", name: "a.txt" }} error="预览失败" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("按 CSV、PDF、Office 扩展名分流，并处理外部动作失败", async () => {
    const brokenOpen = vi.fn().mockRejectedValue(new Error("打开失败"));
    const { rerender } = render(<QuickPreview target={{ kind: "text", name: "data.csv", path: "src/data.csv" }} content="a,b" onOpenExternal={brokenOpen} onReveal={vi.fn()} />);
    expect(screen.getByText("a,b")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "预览文件路径" })).toHaveTextContent("src › data.csv");
    fireEvent.click(screen.getByRole("button", { name: "在外部打开预览" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("打开失败");
    rerender(<QuickPreview target={{ kind: "document", name: "file.pdf", extension: "pdf", src: "https://example.com/a.pdf" }} />);
    expect(document.querySelector("object")).toHaveAttribute("type", "application/pdf");
    rerender(<QuickPreview target={{ kind: "document", name: "book.xlsx", extension: "xlsx" }} />);
    expect(screen.getByText(/当前格式可能无法直接内嵌渲染/)).toBeInTheDocument();
  });

  it("支持完整图片 MIME、定位动作与 DOCX 渲染和失败状态", async () => {
    const onReveal = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<QuickPreview target={{ kind: "image", name: "a.webp" }} dataBase64="aGVsbG8=" onReveal={onReveal} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("data:image/webp;base64,"));
    fireEvent.click(screen.getByRole("button", { name: "显示预览所在文件夹" }));
    expect(onReveal).toHaveBeenCalledOnce();
    rerender(<QuickPreview target={{ kind: "document", name: "a.docx", extension: "docx" }} dataBase64="aGVsbG8=" />);
    await waitFor(() => expect(renderDocx).toHaveBeenCalledOnce());
    expect(screen.getByTestId("docx-preview-panel")).toBeInTheDocument();

    renderDocx.mockRejectedValueOnce(new Error("DOCX 渲染失败"));
    rerender(<QuickPreview target={{ kind: "document", name: "a.docx", extension: "docx" }} dataBase64="d29ybGQ=" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("DOCX 渲染失败");
  });
});
