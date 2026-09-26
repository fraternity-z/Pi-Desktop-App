/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const generalSettingsStyles = readFileSync(
  resolve(process.cwd(), "src/components/GeneralSettings.css"), "utf8",
);
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
    ["关于页面操作", ".about-settings-option"],
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

describe("对话输入区项目栏", () => {
  it("在项目选择行和输入框之间保留单条分割线", () => {
    expect(stylesheet).toMatch(
      /\.composer-project-bar\s*\{[^}]*border-bottom:\s*1px solid[^}]*\}/s,
    );
    expect(stylesheet).toMatch(/\.composer-frame\s*\{[^}]*border-top:\s*0;/s);
  });
});

describe("外观设置排版", () => {
  it("沿用共享设置尺度并保留桌面设置顶栏", () => {
    expect(stylesheet).not.toContain(".settings-main-appearance .settings-topbar");
    expect(appearanceStyles).not.toMatch(/font-size:\s*(?:18|20|28|32)px/);
    expect(appearanceStyles).not.toMatch(/min-height:\s*114px/);
    expect(appearanceStyles).toMatch(
      /\.appearance-theme-card strong\s*\{[^}]*font-size:\s*var\(--settings-label-size\);/s,
    );
    expect(appearanceStyles).toMatch(
      /\.appearance-theme-actions button\s*\{[^}]*font-size:\s*var\(--settings-label-size\);/s,
    );
  });
});

describe("设置页统一排版", () => {
  it("说明浮层使用视口定位，不再负向偏移至滚动容器外", () => {
    const tooltip = generalSettingsStyles.split(".general-setting-tooltip {")[1].split("}")[0];
    expect(tooltip).toContain("position: fixed;");
    expect(tooltip).toContain("z-index: 10000;");
    expect(tooltip).toContain("max-height: calc(100dvh - 16px);");
    expect(tooltip).toContain("box-sizing: border-box;");
    expect(tooltip).toContain("var(--settings-caption-size,");
    expect(generalSettingsStyles).not.toMatch(/left:\s*-\d+px/);
  });

  it("标题与辅助文字使用共享字号，并跟随用户字体偏好", () => {
    expect(stylesheet).toContain("--settings-label-size: max(12px, calc(var(--app-ui-font-size) - 1px));");
    expect(stylesheet).toContain("--settings-caption-size: max(11px, calc(var(--app-ui-font-size) - 2px));");
    expect(stylesheet).toMatch(/\.settings-row-title\s*\{[^}]*font-size:\s*var\(--settings-label-size\);/s);
    expect(stylesheet).toMatch(/\.settings-row-description\s*\{[^}]*font-size:\s*var\(--settings-caption-size\);/s);
    expect(generalSettingsStyles).toMatch(/\.general-setting-label\s*\{[^}]*font-size:\s*var\(--settings-label-size\);/s);
    expect(generalSettingsStyles).toMatch(/\.general-system-section > h2\s*\{[^}]*font-size:\s*var\(--settings-label-size\);/s);
  });

  it("常规项与共享设置行使用同一密度尺度", () => {
    for (const [source, selector] of [
      [stylesheet, ".settings-row"],
      [generalSettingsStyles, ".general-setting-row"],
    ]) {
      const body = source.slice(source.indexOf(`\n${selector} {`)).split("}")[0];
      expect(body).toContain("min-height: var(--settings-row-height);");
      expect(body).toContain("padding: var(--settings-row-padding);");
    }
    expect(stylesheet).toContain("--settings-row-height: 56px;");
    expect(stylesheet).toMatch(/:root\[data-interface-density="compact"\] \.settings-main\s*\{[^}]*--settings-row-height:\s*48px;/s);
    expect(generalSettingsStyles).not.toContain(".general-system-settings .settings-toggle");
  });

  it("设置与提示词卡片保留统一边框圆角，不再被重置为无边框列表", () => {
    expect(stylesheet).toMatch(/\.settings-card,\s*\.prompt-editor\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*border-radius:\s*var\(--radius-ui\);[^}]*background:\s*var\(--surface\);/s);
    expect(generalSettingsStyles).toMatch(/\.general-setting-row\s*\{[^}]*border:\s*1px solid var\(--line\);[^}]*border-radius:\s*var\(--radius-ui\);[^}]*background:\s*var\(--surface\);/s);
    expect(stylesheet).not.toContain(".settings-card,\n.ecosystem-list");
    expect(stylesheet).not.toContain(".settings-main-shortcuts .settings-card");
  });

  it("长路径省略显示，保存状态不被挤压，编辑器保留焦点提示", () => {
    expect(stylesheet).toMatch(/\.settings-path\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(stylesheet).toMatch(/\.prompt-editor-status\s*\{[^}]*flex-shrink:\s*0;/s);
    expect(stylesheet).toMatch(/\.prompt-editor textarea:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\);/s);
  });
});

describe("启动遮罩动画", () => {
  it("HTML 入口只保留空挂载点，不再展示预加载屏", () => {
    const entry = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(entry).toMatch(/<div id="root"><\/div>/);
    expect(entry).not.toMatch(/boot-splash|boot-ring|boot-enter|Preparing workspace/);
  });

  it("移除粒子、轨道、呼吸圆环和图标脉冲", () => {
    expect(startupStyles).not.toMatch(/startup-orbit|startup-breathe|startup-emblem-pulse/);
    expect(startupStyles).not.toContain(".startup-overlay::before");
    expect(startupStyles).not.toContain("startup-step-track");
  });

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
    expect(startupStyles).toMatch(
      /\.startup-progress-meter::after\s*\{[^}]*transform:\s*scaleX\(var\(--startup-progress-scale, 0\)\);[^}]*transition:\s*transform 360ms/s,
    );
    expect(startupStyles).toMatch(
      /\.startup-progress-meter\s*\{[^}]*height:\s*6px;[^}]*border-radius:\s*999px;/s,
    );
    expect(startupStyles).toMatch(
      /\.startup-progress-scan\s*\{[^}]*left:\s*calc\(var\(--startup-progress-scale, 0\) \* 100%\);[^}]*width:\s*calc\(var\(--startup-progress-step\) \* 100%\);/s,
    );
    expect(startupStyles).toMatch(/@keyframes startup-progress-slide\s*\{[^}]*transform:/s);
    expect(startupStyles).not.toContain("startup-step-scan");
    expect(startupStyles).not.toContain("backdrop-filter");
    expect(startupStyles).not.toContain("will-change");
  });

  it("尊重系统和应用的减少动态效果设置", () => {
    expect(startupStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(startupStyles).toContain(':root[data-reduce-motion="true"] .startup-overlay');
    const systemMotionStyles = startupStyles.slice(startupStyles.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(systemMotionStyles).toMatch(/\.startup-progress-scan\s*\{\s*display:\s*none;/s);
    expect(startupStyles).toMatch(/:root\[data-reduce-motion="true"\] \.startup-progress-scan\s*\{\s*display:\s*none;/s);
  });

  it("关闭书写动效或启动结束时仍保留完整笔迹", () => {
    expect(startupStyles).toMatch(
      /\.startup-handwriting-stroke\s*\{[^}]*stroke-dashoffset:\s*0;/s,
    );
    expect(startupStyles).toMatch(
      /\.startup-handwriting\[data-complete="true"\] \.startup-handwriting-mask-finish\s*\{\s*animation:\s*none;/s,
    );
    expect(startupStyles).toMatch(/\.startup-handwriting\[data-complete="true"\] \.startup-handwriting-letter\s*\{\s*mask:\s*none;/s);
    expect(startupStyles).not.toContain('.startup-overlay[data-ready="true"] .startup-handwriting');
    expect(startupStyles).toMatch(/\.startup-handwriting-stroke\s*\{[^}]*animation-play-state:\s*paused;/s);
    expect(startupStyles).toMatch(/\.startup-handwriting\[data-playing="true"\] \.startup-handwriting-mask-finish\s*\{\s*animation-play-state:\s*running;/s);
    expect(startupStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.startup-overlay \*::after,[^}]*animation:\s*none !important;/s,
    );
  });
});
