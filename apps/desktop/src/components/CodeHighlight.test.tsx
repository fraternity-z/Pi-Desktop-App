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
});
