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
const startupStyles = stylesheet.slice(
  stylesheet.indexOf(".startup-overlay {"),
  stylesheet.indexOf(".empty-workspace h2", stylesheet.indexOf(".startup-overlay {")),
);

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

describe("启动遮罩动画", () => {
  it("使用独立于应用缩放的全窗口固定遮罩", () => {
    expect(startupStyles).toMatch(
      /\.startup-overlay\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*width:\s*100vw;[^}]*min-height:\s*100dvh;/s,
    );
    expect(startupStyles).toMatch(/\.startup-overlay\s*\{[^}]*contain:\s*paint;/s);
  });

  it("使用短淡出和局部动效，避免全屏模糊与持续图层提升", () => {
    expect(startupStyles).toMatch(
      /\.startup-overlay\s*\{[^}]*transition:\s*opacity var\(--startup-exit-duration, 180ms\)/s,
    );
    expect(startupStyles).toMatch(
      /@keyframes loading-indicator-pulse\s*\{[^}]*opacity:/s,
    );
    expect(startupStyles).not.toContain("backdrop-filter");
    expect(startupStyles).not.toContain("will-change");
  });

  it("尊重系统和应用的减少动态效果设置", () => {
    expect(startupStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(startupStyles).toContain(':root[data-reduce-motion="true"] .startup-overlay');
  });

  it("关闭书写动效或启动结束时仍保留完整笔迹", () => {
    expect(startupStyles).toMatch(
      /\.startup-handwriting-stroke\s*\{[^}]*stroke-dashoffset:\s*0;/s,
    );
    expect(startupStyles).toMatch(
      /\.startup-overlay\[data-ready="true"\] \.startup-handwriting-stroke\s*\{\s*animation:\s*none;/s,
    );
    expect(startupStyles).toContain('.startup-overlay[data-state="error"] .startup-handwriting-stroke');
    expect(startupStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.startup-overlay \*::after,[^}]*animation:\s*none !important;/s,
    );
  });
});
