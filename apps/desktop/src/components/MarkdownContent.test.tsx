import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("展示 GFM 内容并阻止不安全链接与内联 HTML", () => {
    render(
      <MarkdownContent>{[
        "## 结果",
        "",
        "- [x] 已完成",
        "- ~~旧项~~",
        "",
        "| 名称 | 状态 |",
        "| --- | --- |",
        "| 构建 | 通过 |",
        "",
        "[安全链接](https://example.com)",
        "[危险链接](javascript:alert(1))",
        "<script>alert(1)</script>",
      ].join("\n")}</MarkdownContent>,
    );

    expect(screen.getByRole("heading", { name: "结果" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText("旧项").tagName).toBe("DEL");
    expect(screen.getByRole("table")).toHaveTextContent("构建通过");
    expect(screen.getByRole("link", { name: /安全链接/ })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.getByRole("link", { name: /安全链接/ })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByText("危险链接").closest("a")).not.toHaveAttribute("href");
    expect(screen.queryByText("alert(1)")).not.toBeInTheDocument();
  });

  it("复制代码块并将图片降级为文本占位", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MarkdownContent>{"```ts\nconst value = 1;\n```\n\n![预览](file:///secret.png)"}</MarkdownContent>,
    );

    expect(screen.getByText("[图片：预览]")).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const value = 1;"));
  });

  it("增量补全 Markdown 时复用代码块容器并保持最终内容一致", () => {
    const { container, rerender } = render(<MarkdownContent>{"```ts\nconst value ="}</MarkdownContent>);
    const codeBlock = container.querySelector(".markdown-code-block");
    expect(codeBlock).toHaveTextContent("const value =");

    rerender(<MarkdownContent>{"```ts\nconst value = 1;\n```"}</MarkdownContent>);

    expect(container.querySelector(".markdown-code-block")).toBe(codeBlock);
    expect(codeBlock).toHaveTextContent("const value = 1;");
    expect(screen.getByText("ts")).toBeInTheDocument();
  });
});
