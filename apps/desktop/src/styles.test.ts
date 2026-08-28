/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const radiusSectionMarker = "/* Unified rectangular UI corners */";
const radiusSection = stylesheet.slice(
  stylesheet.indexOf(radiusSectionMarker) + radiusSectionMarker.length,
);
const appearanceStylesMarker = "/* Keep the range row in one column";
const appearanceStyles = stylesheet.slice(stylesheet.indexOf(appearanceStylesMarker));

function selectorsUsing(declaration: string): Set<string> {
  const selectors = new Set<string>();
  for (const rule of radiusSection.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    if (!rule[2].includes(declaration)) continue;
    for (const selector of rule[1].split(",")) selectors.add(selector.trim());
  }
  return selectors;
}

describe("统一矩形圆角", () => {
  it("以对话框的 12px 圆角作为全局矩形 UI token", () => {
    expect(stylesheet).toMatch(/--radius-ui:\s*12px;/);
    expect(stylesheet).toContain(radiusSectionMarker);
  });

  it.each([
    ["对话框", ".sidebar-dialog"],
    ["项目选择对话框", ".project-dialog"],
    ["侧边栏文件夹", ".app-sidebar:not(.settings-sidebar) .project-row"],
    ["侧边栏对话", ".app-sidebar:not(.settings-sidebar) .session-row"],
    ["设置导航", ".settings-nav-item"],
    ["设置卡片", ".settings-card"],
    ["聊天消息", ".user-message-bubble"],
    ["聊天输入框", ".composer-frame"],
    ["浮层菜单", ".floating-menu"],
    ["帮助面板", ".help-panel"],
    ["包列表", ".ecosystem-list"],
  ])("%s 使用统一圆角 token", (_label, selector) => {
    expect(selectorsUsing("border-radius: var(--radius-ui);")).toContain(selector);
  });

  it("组合输入区只在外侧顶部保留统一圆角", () => {
    const connectedSelectors = selectorsUsing(
      "border-radius: var(--radius-ui) var(--radius-ui) 0 0;",
    );
    expect(connectedSelectors).toContain(".composer-project-bar");
    expect(connectedSelectors).toContain(".composer-protrusion");
  });

  it("圆形与胶囊控件保持其形状语义", () => {
    expect(stylesheet).toMatch(/\.composer-submit\s*\{[^}]*border-radius:\s*50%;/s);
    expect(stylesheet).toMatch(/\.settings-toggle\s*\{[^}]*border-radius:\s*999px;/s);
  });
});

describe("外观设置排版", () => {
  it("沿用共享设置尺度并保留桌面设置顶栏", () => {
    expect(stylesheet).not.toContain(".settings-main-appearance .settings-topbar");
    expect(appearanceStyles).not.toMatch(/font-size:\s*(?:18|20|28|32)px/);
    expect(appearanceStyles).not.toMatch(/min-height:\s*114px/);
    expect(appearanceStyles).toMatch(
      /\.appearance-theme-card strong\s*\{[^}]*font-size:\s*var\(--app-ui-font-size\);/s,
    );
    expect(appearanceStyles).toMatch(
      /\.appearance-theme-actions button\s*\{[^}]*font-size:\s*var\(--app-ui-font-size\);/s,
    );
  });
});
