import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { MarkdownContent } from "./MarkdownContent";

function clipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clipboard();
});

describe("MarkdownCodeBlock", () => {
  it.each([["py", "Python"], ["tsx", "TypeScript"], ["JS", "JavaScript"], ["c++", "C++"], ["unknown-x", "unknown-x"], ["constructor", "constructor"]])("规范化语言名称 %s", (language, expected) => {
    render(<MarkdownCodeBlock><code className={`language-${language}`}>value</code></MarkdownCodeBlock>);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "启用自动换行" })).toHaveAttribute("aria-pressed", "false");
  });

  it("未标语言、空块和未知语言 HTML 安全降级", () => {
    const { container, rerender } = render(<MarkdownCodeBlock>{null}</MarkdownCodeBlock>);
    expect(screen.getByText("代码")).toBeInTheDocument();
    expect(container.querySelector("pre code")?.textContent).toBe("");
    rerender(<MarkdownCodeBlock><code className="language-unknown">{"<img src=x onerror=alert(1)>"}</code></MarkdownCodeBlock>);
    expect(container.querySelector("pre code")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("每个代码块换行状态独立，流式补全不会重置", () => {
    const { container, rerender } = render(<MarkdownContent>{"```py\nprint('one')\n```\n\n```ts\nconst second ="}</MarkdownContent>);
    const blocks = container.querySelectorAll(".markdown-code-block");
    fireEvent.click(within(blocks[1] as HTMLElement).getByRole("button", { name: "启用自动换行" }));
    expect(blocks[0]).toHaveAttribute("data-wrap", "false");
    expect(blocks[1]).toHaveAttribute("data-wrap", "true");
    rerender(<MarkdownContent>{"```py\nprint('one')\n```\n\n```ts\nconst second = 2;\n```"}</MarkdownContent>);
    expect(container.querySelectorAll(".markdown-code-block")[1]).toBe(blocks[1]);
    expect(within(blocks[1] as HTMLElement).getByRole("button", { name: "禁用自动换行" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "禁用自动换行" }));
    expect(blocks[1]).toHaveAttribute("data-wrap", "false");
  });

  it("复制原始缩进空行而非高亮 HTML，换行模式不改变文本", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    render(<MarkdownContent>{"```python\n\tprint('中文')  \n\n  # comment\n\n```"}</MarkdownContent>);
    fireEvent.click(screen.getByRole("button", { name: "启用自动换行" }));
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    expect(await screen.findByRole("button", { name: "代码已复制" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("\tprint('中文')  \n\n  # comment\n");
    expect(screen.getByRole("status")).toHaveTextContent("代码已复制");
  });

  it("缺失剪贴板可重试，错误不泄露异常内容", async () => {
    clipboard();
    render(<MarkdownCodeBlock><code>text</code></MarkdownCodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    const retry = await screen.findByRole("button", { name: "复制失败，点击重试" });
    clipboard(vi.fn().mockRejectedValue(new Error("private-detail")));
    await act(async () => fireEvent.click(retry));
    expect(document.body).not.toHaveTextContent("private-detail");
    clipboard(vi.fn().mockResolvedValue(undefined));
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "代码已复制" })).toBeInTheDocument();
  });

  it("旧复制请求晚返回不能覆盖新请求状态", async () => {
    let rejectOld!: (error: Error) => void;
    const writeText = vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject; })).mockResolvedValue(undefined);
    clipboard(writeText);
    render(<MarkdownCodeBlock><code>value</code></MarkdownCodeBlock>);
    const button = screen.getByRole("button", { name: "复制代码" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "代码已复制" })).toBeInTheDocument();
    await act(async () => rejectOld(new Error("stale failure")));
    expect(screen.getByRole("button", { name: "代码已复制" })).toBeInTheDocument();
  });

  it("流式内容变化使旧复制反馈失效", async () => {
    let resolve!: () => void;
    clipboard(() => new Promise<void>((done) => { resolve = done; }));
    const { rerender } = render(<MarkdownCodeBlock><code>first</code></MarkdownCodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    rerender(<MarkdownCodeBlock><code>first second</code></MarkdownCodeBlock>);
    await act(async () => resolve());
    expect(screen.getByRole("button", { name: "复制代码" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("成功反馈按时重置，卸载清除计时器", async () => {
    vi.useFakeTimers();
    clipboard(vi.fn().mockResolvedValue(undefined));
    const { unmount } = render(<MarkdownCodeBlock><code>value</code></MarkdownCodeBlock>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "复制代码" })));
    expect(screen.getByRole("button", { name: "代码已复制" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_200));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "复制代码" })));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("卸载后的未完成复制不会创建新计时器", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    clipboard(() => new Promise<void>((done) => { resolve = done; }));
    const { unmount } = render(<MarkdownCodeBlock><code>value</code></MarkdownCodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    unmount();
    await act(async () => resolve());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("鼠标与键盘显示独立 portal 提示，Escape、失焦及滚动关闭", () => {
    const { container } = render(<MarkdownCodeBlock><code>value</code></MarkdownCodeBlock>);
    const button = screen.getByRole("button", { name: "启用自动换行" });
    fireEvent.mouseEnter(button);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("启用自动换行");
    expect(container).not.toContainElement(tooltip);
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(button);
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(button);
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("工具提示在视口边缘收敛并在顶部空间不足时下放", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "BUTTON"
        ? { left: window.innerWidth - 30, top: 2, right: window.innerWidth + 14, bottom: 46, width: 44, height: 44, x: 0, y: 0, toJSON: () => ({}) }
        : { left: 0, top: 0, right: 150, bottom: 36, width: 150, height: 36, x: 0, y: 0, toJSON: () => ({}) };
    });
    render(<MarkdownCodeBlock><code>value</code></MarkdownCodeBlock>);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "复制代码" }));
    expect(screen.getByRole("tooltip")).toHaveStyle({ left: `${window.innerWidth - 158}px`, top: "52px" });
    fireEvent.resize(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
