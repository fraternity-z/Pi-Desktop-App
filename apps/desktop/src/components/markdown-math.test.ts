import { describe, expect, it } from "vitest";

import {
  normalizeLatexMathDelimiters,
  prepareMarkdownMath,
  remarkLatexBracketDisplay,
  remarkRestoreMathPipes,
} from "./markdown-math";

describe("prepareMarkdownMath", () => {
  it.each([
    String.raw`$e^{-a|t|}$`,
    String.raw`$$e^{-a|t|}$$`,
    String.raw`$\|x\|$`,
    String.raw`$\left|t\right|$`,
    String.raw`$\text{a|b}$`,
    String.raw`\(e^{-a|t|}\)`,
    String.raw`\[e^{-a|t|}\]`,
    String.raw`$a|b$ 与 $c|d$`,
    String.raw`$x$$y|z$`,
  ])("只保护完整公式内的竖线且保留源码偏移：%s", (formula) => {
    const source = `| ${formula} | 条件 |`;
    const prepared = prepareMarkdownMath(source);
    expect(prepared.source.length).toBe(source.length);
    expect(prepared.source).toBe(`| ${normalizeLatexMathDelimiters(formula).replaceAll("|", prepared.pipeMarker!)} | 条件 |`);
  });

  it.each([
    String.raw`前文 | 后文`,
    String.raw`\$price | text`,
    String.raw`$e^{-a|t|}`,
    String.raw`$$e^{-a|t|}$`,
    String.raw`\(e^{-a|t|}`,
    String.raw`\\(a|b\\)`,
    "`$a|b$`",
    "```tex\n$a|b$\n```",
    "~~~tex\n\\[a|b\\]\n~~~",
    "    $a|b$",
    "\t$a|b$",
    "| $incomplete | a > 0 |\n| $x$ | b > 0 |",
    "Price $5\n\n| Column | Value |\n| --- | --- |\n| $x$ | 1 |",
  ])("保留代码、转义与未闭合公式且不跨行吞掉分列符：%s", (source) => {
    expect(prepareMarkdownMath(source).source).toBe(source);
  });

  it("选择不与用户字符冲突的占位符", () => {
    const source = "\ue000 $|x|$";
    const prepared = prepareMarkdownMath(source);
    expect(prepared.pipeMarker).toBe("\ue001");
    expect(prepared.source).toBe("\ue000 $\ue001x\ue001$");
  });

  it("没有可用占位符时保留竖线而不篡改原始字符", () => {
    const characters = Array.from({ length: 0x1900 }, (_, index) => String.fromCharCode(0xe000 + index)).join("");
    const source = `${characters} $|x|$`;
    expect(prepareMarkdownMath(source)).toEqual({ source, pipeMarker: undefined });
  });
});

describe("remarkRestoreMathPipes", () => {
  it("同时恢复公式、普通文本降级和公式生成的 HTML 文本", () => {
    const math = {
      value: "a\ue000b",
      data: { hChildren: [{ type: "text", value: "a\ue000b" }] },
    };
    const text = { type: "text", value: "\ue000literal\ue000" };
    const tree = { type: "root", children: [math, text] };
    remarkRestoreMathPipes("\ue000")()(tree);
    expect(math.value).toBe("a|b");
    expect(math.data.hChildren[0].value).toBe("a|b");
    expect(text.value).toBe("|literal|");
  });

  it("未启用占位符时不修改节点", () => {
    const tree = { value: "\ue000" };
    remarkRestoreMathPipes()()(tree);
    expect(tree.value).toBe("\ue000");
  });
});

describe("normalizeLatexMathDelimiters", () => {
  it.each([
    [String.raw`前文 \(a+b\) 后文`, "前文 $$a+b$$ 后文"],
    ["\\[\na+b\n\\]", "$$ a+b $$"],
    ["\\[\r\na+b\r\n\\]", "$$  a+b  $$"],
    [String.raw`\(x\) 和 \[y\]`, "$$x$$ 和 $$y$$"],
    [String.raw`\[a\\b\]`, String.raw`$$a\\b$$`],
    ["`code` \\(x\\)", "`code` $$x$$"],
    ["```tex\n\\(literal\\)\n```\n\\[x\\]", "```tex\n\\(literal\\)\n```\n$$x$$"],
  ])("归一化时保留 UTF-16 源码偏移：%s", (source, expected) => {
    const normalized = normalizeLatexMathDelimiters(source);
    expect(normalized).toBe(expected);
    expect(normalized.length).toBe(source.length);
  });

  it.each([
    "",
    "普通文字，不含公式。",
    String.raw`\\(escaped\\)`,
    String.raw`\\[escaped\\]`,
    String.raw`\(unmatched`,
    String.raw`closing\]`,
    String.raw`\(mismatched\]`,
    "`\\(inline\\)`",
    "`` ` \\[inline\\] ``",
    "```tex\n\\(fenced\\)\n```",
    "~~~tex\n\\[fenced\\]\n~~~",
    "````tex\n```\n\\[fenced\\]\n````",
    "~~~tex\n```\n\\[fenced\\]\n~~~",
    "~~~tex\n~~~ not a closing fence\n\\[fenced\\]\n~~~",
    "~~~tex\r\n\\[fenced\\]\r\n~~~",
    "```tex\n\\[streaming code\\]",
    "    \\[indented code\\]",
    "\t\\(indented code\\)",
    "$x$\n\n$$\nx^2\n$$",
  ])("不改写转义、代码、未闭合公式或美元语法：%s", (source) => {
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
  });
});

describe("remarkLatexBracketDisplay", () => {
  it("只提升拥有完整 TeX 方括号源码位置的公式节点", () => {
    const display = {
      type: "inlineMath",
      position: { start: { offset: 0 }, end: { offset: 5 } },
      data: { existing: true },
    };
    const inline = { type: "inlineMath", position: { start: { offset: 6 }, end: { offset: 11 } } };
    const missingPosition = { type: "inlineMath" };
    const tree = { type: "root", children: [display, inline, missingPosition] };

    remarkLatexBracketDisplay(String.raw`\[x\] \(y\)`)()(tree);

    expect(display.data).toEqual({
      existing: true,
      hProperties: { className: ["language-math", "math-display"] },
    });
    expect(inline).not.toHaveProperty("data");
    expect(missingPosition).not.toHaveProperty("data");
  });
});
