import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HighlightedCodeLine, highlightCodeLine } from "./CodeHighlight";

describe("CodeHighlight", () => {
  it("高亮已注册语言并转义未知语言 HTML", () => {
    expect(highlightCodeLine("const value = true;", "main.ts")).toContain("hljs-keyword");
    expect(highlightCodeLine("<script>alert('x')</script>", "notes.unknown"))
      .toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
  });

  it("渲染高亮内容且保留空行", () => {
    render(<HighlightedCodeLine content="let count = 1;" path="main.js" />);
    expect(screen.getByText("let")).toHaveClass("hljs-keyword");
    expect(highlightCodeLine("   ", "main.ts")).toBe("   ");
  });

  it("接受 Markdown 语言名并限制大型流式代码块的高亮", () => {
    expect(highlightCodeLine("const ready = true;", "typescript")).toContain("hljs-keyword");
    expect(highlightCodeLine("def main(): pass", "python")).toContain("hljs-keyword");
    expect(highlightCodeLine("fn main() {}", "rust")).toContain("hljs-keyword");
    const large = '<script>' + 'x'.repeat(64_000);
    expect(highlightCodeLine(large, "typescript")).toBe('&lt;script&gt;' + 'x'.repeat(64_000));
    const expected = highlightCodeLine("const first = true;", "ts");
    for (let index = 0; index < 260; index += 1) highlightCodeLine(`const value = ${index};`, "ts");
    expect(highlightCodeLine("const first = true;", "ts")).toBe(expected);
  });
});
