/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("卡片轻量阴影", () => {
  it.each([
    "--shadow: 0 2px 4px rgb(0 0 0 / 3%), 0 6px 16px rgb(0 0 0 / 4%);",
    "--shadow-strong: 0 3px 8px rgb(0 0 0 / 4%), 0 12px 28px rgb(0 0 0 / 7%);",
    "--shadow: 0 2px 4px rgb(0 0 0 / 8%), 0 6px 16px rgb(0 0 0 / 10%);",
    "--shadow-strong: 0 3px 8px rgb(0 0 0 / 12%), 0 12px 28px rgb(0 0 0 / 16%);",
  ])("保留低强度的明暗主题阴影：%s", (declaration) => {
    expect(stylesheet).toContain(declaration);
  });

  it("紧凑浮层覆盖局部阴影且不依赖组件加载顺序", () => {
    const rules = stylesheet.split(":root .composer-menu.composer-model-popover,")[1];
    expect(rules).toBeDefined();
    expect(rules.split("}")[0]).toContain(":root .markdown-code-tooltip");
    expect(rules.split("}")[0]).toContain("box-shadow: var(--shadow);");
  });

  it.each([
    "--composer-shadow: 0 2px 8px rgb(0 0 0 / 4%), 0 8px 24px rgb(0 0 0 / 2%);",
    "--composer-shadow: 0 2px 8px rgb(0 0 0 / 12%), 0 8px 24px rgb(0 0 0 / 8%);",
  ])("输入卡片在明暗主题下使用柔和扩散阴影：%s", (declaration) => {
    expect(stylesheet).toContain(declaration);
  });

  it("输入卡片四边都有浅色细描边，并使用饱满圆角", () => {
    const rule = stylesheet.split(".composer-frame {").at(-1)!.split("}")[0];
    expect(rule).toContain("border: 1px solid color-mix(in srgb, var(--line) 65%, var(--composer));");
    expect(rule).toContain("border-radius: 22px;");
    expect(rule).toContain("box-shadow: var(--composer-shadow);");
    expect(rule).not.toContain("border-top: 0");
  });

  it("输入卡片聚焦时只略微加深边框，阴影不加重", () => {
    const rule = stylesheet.split(".composer-frame:focus-within {").at(-1)!.split("}")[0];
    expect(rule).toContain("box-shadow: var(--composer-shadow);");
    expect(rule).toContain("border-color: color-mix(in srgb, var(--line) 85%, var(--composer));");
  });
});
