import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it.each([
    String.raw`$$e^{-a|t|}$$`,
    String.raw`$e^{-a|t|}$`,
    String.raw`\(e^{-a|t|}\)`,
    String.raw`\[e^{-a|t|}\]`,
  ])("表格中的绝对值竖线不能截断公式或吞掉后面的单元格：%s", (formula) => {
    const { container } = render(
      <MarkdownContent>{`| 信号 | 条件 |\n| --- | --- |\n| ${formula} | a > 0 |`}</MarkdownContent>,
    );

    expect(screen.getAllByRole("cell")).toHaveLength(2);
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent("a > 0");
    expect(container.querySelector("td .katex annotation")).toHaveTextContent(String.raw`e^{-a|t|}`);
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it.each([
    String.raw`\(\sinc(x)=\frac{\sin x}{x}\)`,
    String.raw`| 频谱 |
| --- |
| $T\sinc(\frac{\omega T}{2})$ |
| $T\sinc^2(\frac{\omega T}{2})$ |`,
  ])("兼容 sinc 算子且不将命令显示为红色源码：%s", (source) => {
    const { container } = render(<MarkdownContent>{source}</MarkdownContent>);

    for (const formula of container.querySelectorAll(".katex-html")) {
      expect(formula).toHaveTextContent("sinc");
      expect(formula).not.toHaveTextContent(String.raw`\sinc`);
    }
    expect(container.querySelector(".katex-html .mop")).toHaveTextContent("sinc");
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("渲染美元与 TeX 括号包裹的行内公式", () => {
    const { container } = render(
      <MarkdownContent>{String.raw`卷积：\(y(n)=x(n)*h(n)\)，能量：$E=mc^2$。`}</MarkdownContent>,
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-display")).toBeNull();
    expect(container.querySelector("annotation")).toHaveTextContent("y(n)=x(n)*h(n)");
    expect(container.querySelector(".markdown-code-block")).toBeNull();
  });

  it("保留范数、文本竖线及括号公式的显示模式", () => {
    const { container } = render(
      <MarkdownContent>{String.raw`| 范数 | 绝对值 | 文本 | 条件 |
| --- | --- | --- | --- |
| $\|x\|$ | \[\left|t\right|\] | $\text{a|b}$ | a > 0 |`}</MarkdownContent>,
    );
    expect(screen.getAllByRole("cell")).toHaveLength(4);
    expect(screen.getAllByRole("cell")[3]).toHaveTextContent("a > 0");
    expect(Array.from(container.querySelectorAll("annotation"), (node) => node.textContent)).toEqual([
      String.raw`\|x\|`, String.raw`\left|t\right|`, String.raw`\text{a|b}`,
    ]);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.textContent).not.toMatch(/[\ue000-\uf8ff]/);
  });

  it("流式表格中的未闭合美元公式不会吞掉下一行", () => {
    const { container, rerender } = render(
      <MarkdownContent>{"| 信号 | 条件 |\n| --- | --- |\n| $incomplete | a > 0 |\n| $x$ | b > 0 |"}</MarkdownContent>,
    );
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getAllByRole("cell")).toHaveLength(4);
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent("a > 0");
    expect(screen.getAllByRole("cell")[3]).toHaveTextContent("b > 0");
    expect(container.querySelector("annotation")).toHaveTextContent("x");

    rerender(<MarkdownContent>{"| 信号 | 条件 |\n| --- | --- |\n| $e^{-a|t|}$ | a > 0 |\n| $x$ | b > 0 |"}</MarkdownContent>);
    expect(screen.getAllByRole("cell")).toHaveLength(4);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/[\ue000-\uf8ff]/);
  });

  it("一条消息中的宏定义不会污染其他消息或下一次流式解析", () => {
    const first = render(<MarkdownContent>{String.raw`$\gdef\sinc{OVERRIDE}\sinc(x)$`}</MarkdownContent>);
    expect(first.container.querySelector(".katex-html")).toHaveTextContent("OVERRIDE");
    const second = render(<MarkdownContent>{String.raw`$\sinc(x)$`}</MarkdownContent>);
    expect(second.container.querySelector(".katex-html .mop")).toHaveTextContent("sinc");
    expect(second.container).not.toHaveTextContent("OVERRIDE");
    first.rerender(<MarkdownContent>{String.raw`$\sinc(y)$`}</MarkdownContent>);
    expect(first.container.querySelector(".katex-html .mop")).toHaveTextContent("sinc");
    expect(first.container).not.toHaveTextContent("OVERRIDE");
  });

  it.each([
    String.raw`\[X(\omega)=\int_{-\infty}^{\infty}x(t)e^{-j\omega t}\,dt\]`,
    String.raw`前文 \[x^2+y^2=z^2\] 后文`,
    "$$\nx^2+y^2=z^2\n$$",
    String.raw`\[
R_N(n)=\begin{cases}1,&0\le n\le N-1,\\0,&\text{其他}.\end{cases}
\]`,
  ])("将块公式渲染为 KaTeX 而不是代码块：%s", (source) => {
    const { container } = render(<MarkdownContent>{source}</MarkdownContent>);

    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".markdown-code-block")).toBeNull();
    expect(screen.queryByRole("button", { name: "复制代码" })).not.toBeInTheDocument();
  });

  it("表格保留语义、强调与单元格公式，并提供独立横向滚动容器", () => {
    const { container } = render(
      <MarkdownContent>{String.raw`| 题号 | 因果性 | 稳定性 | 理由 |
| --- | --- | --- | --- |
| (1) | **因果** | **稳定** | 只依赖当前输入 \(x(n)\) |
| (2) | **非因果** | **稳定** | 用到未来输入 $x(n+1)$ |`}</MarkdownContent>,
    );

    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("markdown-table-scroll");
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(container.querySelectorAll("td .katex")).toHaveLength(2);
    expect(screen.getByText("非因果").tagName).toBe("STRONG");
  });

  it("不改写代码示例中的公式分隔符", () => {
    const { container } = render(
      <MarkdownContent>{"`\\(inline\\)`\n\n```tex\n\\[x^2\\]\n```"}</MarkdownContent>,
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("p code")).toHaveTextContent(String.raw`\(inline\)`);
    expect(container.querySelector("pre code")).toHaveTextContent(String.raw`\[x^2\]`);
  });

  it("流式公式未闭合时保留文本，闭合后正常渲染", () => {
    const { container, rerender } = render(<MarkdownContent>{String.raw`\[\frac{1}{2}`}</MarkdownContent>);
    expect(container.querySelector(".katex")).toBeNull();

    rerender(<MarkdownContent>{String.raw`\[\frac{1}{2}\]`}</MarkdownContent>);
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(container.querySelector("annotation")).toHaveTextContent(String.raw`\frac{1}{2}`);
  });

  it("非法公式安全降级且禁用公式中的 HTML、外链与远程资源", () => {
    const { container } = render(
      <MarkdownContent>{String.raw`$\notARealCommand{x}$

$\frac{1}{$

$\href{javascript:alert(1)}{click}$

$\includegraphics{https://example.com/tracker.png}$

$\htmlClass{unsafe}{x}$`}</MarkdownContent>,
    );

    expect(container).toHaveTextContent(String.raw`\notARealCommand`);
    expect(container.querySelector(".katex-error")).toHaveTextContent(String.raw`\frac{1}{`);
    expect(container.querySelector("a, img, script, .unsafe")).toBeNull();
  });

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

  it("高亮多行代码且未知语言安全降级", () => {
    const { container, rerender } = render(<MarkdownContent>{"```typescript\nconst value = '<script>danger</script>';\n```"}</MarkdownContent>);
    expect(container.querySelector(".hljs-keyword")).toHaveTextContent("const");
    expect(container.querySelector("pre code")).toHaveTextContent("<script>danger</script>");
    expect(container.querySelector("script")).toBeNull();
    rerender(<MarkdownContent>{"```unknown\n<img src=x onerror=alert(1)>\n```"}</MarkdownContent>);
    expect(container.querySelector("pre code")).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("复制失败可重试并提供成功反馈", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownContent>{"```json\n{\"ready\": true}\n```"}</MarkdownContent>);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    fireEvent.click(await screen.findByRole("button", { name: "复制失败，点击重试" }));
    expect(await screen.findByRole("button", { name: "代码已复制" })).toBeInTheDocument();
    expect(writeText).toHaveBeenLastCalledWith('{"ready": true}');
  });
});
