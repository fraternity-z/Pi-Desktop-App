# Sidebar Design QA

## Visual Sources

- Reference implementation: `E:\code\pix\apps\desktop\src\renderer`
- Reference screenshot: user-provided sidebar screenshot attached to this task
- Target implementation: `apps/desktop/src/components/AppSidebar.tsx` and `apps/desktop/src/styles.css`

## Static Comparison

| Area | Reference | Target | Status |
| --- | --- | --- | --- |
| Rail sizing | 300 px default; 232-360 px resizable | 300 px default; 232-360 px pointer/keyboard resize | Matched |
| Rail hierarchy | Brand, primary actions, project/session scroll area, footer | Same four-row hierarchy | Matched |
| Row geometry | 36 px project rows, 32 px session/menu rows | 36 px project rows, 32 px session/menu rows | Matched |
| Controls | 28 px icon controls, 6 px control radius | 28 px icon controls, 6 px control radius | Matched |
| Light palette | White rail, subtle gray labels, gray hover/selection | `#fff`, `#a9a9a9`, `#f5f5f5`, `#f1f1f1` | Matched |
| Menus | Fixed portal, viewport clamping, 8 px radius, outside/Escape close | Same behavior and geometry | Matched |
| Mobile overlay | Fixed rail, dimmed scrim, outside click close | Fixed rail at <=900 px, 34% scrim, outside click close | Matched |
| Layering | Rail above content; menu/dialog above rail | Rail 30, scrim 20, menu 10000, dialog 10020 | Matched |
| Reduced motion | Global reduced-motion handling | Existing project handling retained | Matched |

## Interaction Coverage

- New conversation and per-project session creation.
- Project add, rename, archive, recent-list removal, pin, collapse and manual sorting.
- Project reveal in the native file manager and permanent Git worktree creation/opening with branch selection, automatic naming and collision handling.
- Session select, rename, archive, restore, delete-from-index, pin, unread state, manual sorting and project reassignment.
- Project/list grouping, recent/priority/manual ordering, search and incremental expansion.
- Plugin list/install/enable/update/remove/update-check and resource refresh/filter/copy-path flows.
- Loading, empty, duplicate-name, confirmation, failure and retry states.
- Fixed and hover-close modes, pointer and keyboard resizing, mobile scrim close.
- Menu and dialog Escape/outside-click behavior.
- Workspace authorization gates and stale async-result suppression across project switches.

## Automated Evidence

- Renderer: 112 tests passed. Coverage: 85.29% statements, 80.72% branches, 84.79% functions, 88.43% lines.
- Agent Bridge: 82 tests passed. Coverage: 92.73% statements, 82.20% branches, 97.36% functions, 94.77% lines.
- Rust Core: 58 tests passed.
- TypeScript/Rust checks and production build passed.

## Screenshot Review

The reference screenshot has been inspected. A same-viewport target screenshot and combined side-by-side image comparison are still pending because browser automation has not been authorized in this task. No visual pass is claimed for that final comparison.

Open verification item:

- P2: capture the populated target sidebar at the reference viewport, compare both images together, and correct any remaining pixel-level spacing or font-rendering differences.

No P0 or P1 issues were found by source comparison, static layout review, automated interaction tests, type checks, or production build.

# Dialog And Composer Design QA

## Result

Passed. The composer, project header, permission menu, model and thinking selectors,
context meter, and resource menu were compared against the three user-provided Pix
screenshots in the same image inputs after native runtime capture.

## Visual Evidence

- Base composer comparison: `C:\Users\Administrator\AppData\Local\Temp\pi-desktop-qa-base-final.png`
- Permission comparison: `C:\Users\Administrator\AppData\Local\Temp\pi-desktop-qa-permission-final.png`
- Resource comparison: `C:\Users\Administrator\AppData\Local\Temp\pi-desktop-qa-resources-final.png`
- Reference implementation: `E:\code\pix`
- Target runtime: native Tauri window at 1700 x 1000 on Windows with 150% DPI scaling.

The final pass checked hierarchy, width, vertical density, spacing, border radius,
translucent surfaces, selected states, warning color, icon alignment, text fit,
menu overlap, and scrollbar treatment. The surrounding conversation canvas remains
the target product's existing dark workspace and was not treated as part of the
composer clone.

## Runtime Interaction Evidence

- Project selector displayed the active project, local runtime, and current Git branch.
- The model menu loaded the real `codex` catalog and displayed `gpt-5.6-sol`,
  `gpt-5.6-luna`, and `gpt-5.6-terra`; no false empty state appeared.
- Permission selection exposed the Pix-compatible default, automatic review, and full
  access presets with immediate selected-state feedback.
- Thinking selection displayed and retained the active `high` level.
- Context usage displayed the real initial 0% state and is wired to runtime usage events.
- The resource menu loaded real authorized workspace paths, used native file/folder
  actions, scrolled correctly, and closed through the normal trigger behavior.

## Automated Evidence

- Renderer: 138 tests passed; 84.78% statements, 80.02% branches, 85.03% functions,
  and 87.85% lines.
- Agent Bridge: 92 tests passed; 92.78% statements, 83.60% branches, 97.69% functions,
  and 94.80% lines.
- Rust Core: 64 tests passed.
- `pnpm check` passed for TypeScript and Rust.
- `pnpm build` passed for the Bridge bundle, Renderer production bundle, and Rust app.

No P0, P1, or P2 visual or interaction issues remain in the requested surface.

# Composer Size And Context Ring QA

## Visual Sources

- Width and height reference: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-92972096-5715-4c21-8bf2-43321049dd62.png`
- Context ring reference: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-5540c808-1d3d-43b7-95fc-dda4c205412d.png`
- Reference implementation: `E:\code\pix\apps\desktop\src\renderer\components\Composer.tsx`
- Native implementation screenshot: `C:\Users\Administrator\AppData\Local\Temp\codex-shot-2026-08-25_15-34-36.png`
- Combined full and focused comparison: `C:\Users\Administrator\AppData\Local\Temp\pi-composer-comparison.png`
- Target implementation: `apps/desktop/src/components/ChatComposer.tsx` and `apps/desktop/src/styles.css`

## Viewport And State

- Native Tauri window on Windows at a 1080 x 720 CSS viewport with 150% DPI scaling.
- Ready conversation state for `MathStudyPlatform`, local runtime, `main` branch,
  `gpt-5.6-sol`, high thinking level, default permissions, and 9% context usage.
- The desktop main region measured 808 px after excluding the 272 px sidebar.

## Comparison Findings

| Area | Expected | Measured result | Status |
| --- | --- | --- | --- |
| Composer width | 50% of the main region | 404 / 808 px | Matched |
| Horizontal position | Centered in the main region | Composer and main-region centers both at x = 676 px | Matched |
| Input height | 50% above the former 60 px minimum | 90 px minimum; complete composer about 180 px | Matched |
| Context track | Pix two-circle ring, radius 7, stroke 2.25, 20% track opacity | Same geometry and opacity | Matched |
| Context occupancy | Clockwise arc starting at 12 o'clock | `strokeDashoffset = 100 - percent`, verified at 9% | Matched |
| Layout integrity | No clipping or control overlap | Project row, textarea, controls, and percentage remain legible | Matched |
| Narrow viewport | Preserve usable mobile layout | Existing <=760 px full-width fallback retained | Matched |

The large width reduction and height increase are intentional requested differences from
the first reference screenshot. The focused ring comparison matches the Pix occupancy
model, including the empty track, rounded progress arc, and adjacent numeric percentage.
No P0, P1, or P2 visual issue remains in the requested surface.

## Automated Evidence

- Renderer: 140 tests passed; 84.87% statements, 80.23% branches, 85.15% functions,
  and 87.89% lines.
- `ChatComposer.tsx`: 86.38% statements and 88.17% lines.
- Agent Bridge: 92 tests passed.
- Rust Core: 64 tests passed.
- `pnpm check` and `pnpm build` passed.

final result: passed

# Conversation Process Disclosure Design QA

## Visual Sources

- Collapsed reference: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-8c0e0b26-f1a1-422f-a882-7be69215f3b4.png`
- Expanded reference: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-ac386d71-1dec-4997-8d7f-de01e5f03e36.png`
- Collapsed implementation: `C:\Users\Administrator\AppData\Local\Temp\pi-timeline-collapsed-final.png`
- Expanded implementation: `C:\Users\Administrator\AppData\Local\Temp\pi-timeline-expanded-large.png`
- Collapsed comparison: `C:\Users\Administrator\AppData\Local\Temp\pi-timeline-comparison-collapsed.png`
- Expanded comparison: `C:\Users\Administrator\AppData\Local\Temp\pi-timeline-comparison-expanded.png`
- Narrow collapsed state: `C:\Users\Administrator\AppData\Local\Temp\pi-timeline-collapsed-narrow.png`
- Narrow expanded state: `C:\Users\Administrator\AppData\Local\Temp\pi-timeline-expanded-narrow.png`

## Viewport And State

- Desktop state: completed conversation at 2200 x 1400 logical pixels, captured through the native
  Tauri window in both collapsed and expanded states.
- Narrow state: the same conversation at 900 x 1000 logical pixels in both states.
- The fixture used a 9m 48s completed timer, intermediate assistant updates, grouped tools, a system
  status, and a separate final conclusion.

## Comparison Evidence

The Pix references and matching Pi Desktop states were placed together in the two comparison images.
The completed turn defaults to collapsed, retains the user prompt above the process header, and keeps
only the final assistant conclusion below it. Expanding restores the intermediate assistant updates,
tool group, and system status without moving the final conclusion into the disclosure region.

| Surface | Evidence | Result |
| --- | --- | --- |
| Typography | The timer remains secondary, process headings retain existing assistant typography, and the final conclusion keeps the strongest response hierarchy. | Passed |
| Spacing and layout | The timer occupies the full message column, the divider aligns with response content, and neither desktop nor narrow states overlap or clip. | Passed |
| Colors and tokens | Existing canvas, text, border, hover, and focus tokens are reused; no new palette or decorative surface was introduced. | Passed |
| Icons and affordances | The existing Lucide chevron rotates between collapsed and expanded states and stays aligned at the trailing edge. | Passed |
| Copy and structure | The label is `已处理 9m 48s`; collapsed content contains only the final conclusion while expanded content restores the full process. | Passed |
| Accessibility and interaction | Native disclosure semantics expose Collapsed/Expanded states, accessible labels describe the next action, and each completed turn toggles independently. | Passed |
| Responsive behavior | At 900 x 1000, long response text wraps naturally and the timer, chevron, process rows, and copy action remain inside the viewport. | Passed |

## Findings

No actionable visual or interaction findings remain. The Pi Desktop fixture intentionally uses the
application's existing neutral theme rather than copying the reference application's illustrated
background; the requested disclosure hierarchy and behavior match the reference.

## Automated Evidence

- Renderer: 359 tests passed; 86.46% statements, 80.49% branches, 87.63% functions, and 89.56% lines.
- `ConversationTimeline.tsx`: 90.46% statements, 81.46% branches, 95.83% functions, and 92.33% lines.
- Agent Bridge: 123 tests passed; 89.41% statements, 81.00% branches, 96.98% functions, and 92.28% lines.
- Rust Core: 139 tests passed.
- `pnpm check`, `pnpm build`, `git diff --check`, and the changed-file sensitive-value scan passed.

final result: passed

# Streaming Conversation Timeline QA

## Visual Sources

- Source visual truth:
  - `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-20f5989b-f358-449c-b5a1-e6ee04756d2a.png`
  - `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-56fe36d5-6495-4650-801e-0e25762781e8.png`
  - `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-b21baf02-317f-4a76-a0f4-3e88bc05577f.png`
- Reported pre-fix state: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-69914bae-1ccd-4cea-9f46-dff748bead8c.png`
- Full and focused comparison: `E:\code\Pi Desktop App\output\playwright\timeline-reference-comparison.png`
- Desktop implementation: `E:\code\Pi Desktop App\output\playwright\timeline-desktop-completed.png`
- Narrow implementation: `E:\code\Pi Desktop App\output\playwright\timeline-mobile-completed.png`
- Expanded details: `E:\code\Pi Desktop App\output\playwright\timeline-mobile-expanded.png`
- Streaming state without a copy action: `E:\code\Pi Desktop App\output\playwright\timeline-mobile.png`

## Viewport And State

- Desktop: 1200 x 760 CSS pixels, light theme, completed turn with seven tool rows,
  completed/running/failed statuses, a final assistant segment, a system status, and one
  turn-level copy action.
- Narrow: 390 x 844 CSS pixels, the same dense content and responsive wrapping.
- Details: failed tool expanded with long result text and an intentionally long call ID.
- Streaming: active processing state verified separately; no copy action is rendered until
  the current assistant turn settles.

## Full-View Comparison Evidence

The combined comparison normalizes the focused conversation region to the same width. The
implementation now follows the reference hierarchy: unframed assistant text, compact inline
tool activity, muted secondary status text, restrained semantic icons, and a light bordered
details surface. The reported pre-fix empty action row and roughly 45 px tool rows are no
longer present.

Measured implementation geometry:

- Assistant text to first tool row: 8 px on desktop and narrow viewports.
- Collapsed tool row height: 24 px for every tested status.
- Narrow document width: 390 px at a 390 px viewport; no horizontal page overflow.
- Expanded narrow details: 344 px outer width, 327 px content/scroll width, and no horizontal
  overflow or clipped long identifier.

## Focused Fidelity Review

| Surface | Evidence | Result |
| --- | --- | --- |
| Fonts and typography | 14 px assistant body, 1.65 line height, 12.5 px tool labels, 11.5 px statuses, zero negative letter spacing, and platform fallbacks retain the reference hierarchy. | Passed |
| Spacing and layout rhythm | 8 px text-to-tool gap, zero inter-tool gap, stable 24 px rows, 6 px detail radius, and aligned 16 px icon track match the reference density. | Passed |
| Colors and tokens | Existing semantic text, muted, subtle, success, focus, warning, danger, surface, line, and code tokens are reused; no page-wide palette changes were introduced. | Passed |
| Image and asset fidelity | The surface has no raster imagery. All visible action and status icons use the existing Lucide icon family; no CSS or inline-SVG substitutes were added. | Passed |
| Copy and content | One copy control appears only after a completed assistant turn. It concatenates assistant text segments and excludes thinking, tool results, call IDs, and system statuses. | Passed |
| Responsive behavior | Desktop and 390 px captures have no overlap, clipping, page overflow, or broken wrapping; detail content remains internally scrollable. | Passed |
| Streaming stability | Stable message/activity keys preserve tool nodes and open details while new deltas append; the copy action is not inserted during active output. | Passed |

## Findings

No actionable P0, P1, or P2 findings remain. Reference screenshots contain different dynamic
copy and tool content, so literal line wrapping is not compared; geometry, density, state
styling, icon alignment, and interaction placement are compared in the focused image instead.

## Patches Made Since The Previous QA Pass

- Removed the hidden per-message action row that reserved vertical space.
- Grouped consecutive thinking, tool, and system activity under stable keyed containers.
- Reduced collapsed activity rows to 24 px and normalized icon, label, status, and chevron tracks.
- Added bounded, wrapping details surfaces for long results, errors, code, and call IDs.
- Removed the narrow-screen copy-action spacer and retained an 8 px text-to-tool gap.
- Replaced per-fragment copy controls with one completed-turn action that copies assistant text only.
- Added tests for stable streamed nodes, detail state retention, copy aggregation, exclusions,
  clipboard failure, and hidden copy actions during streaming.

## Automated Evidence

- Agent Bridge: 93 tests passed; 92.91% statements, 83.60% branches, 97.69% functions,
  and 94.93% lines.
- Renderer: 147 tests passed; 85.59% statements, 80.82% branches, 85.51% functions,
  and 88.59% lines.
- `ConversationTimeline.tsx`: 97.02% statements, 95.09% branches, 91.66% functions,
  and 97.64% lines.
- Rust Core: 67 tests passed.
- `pnpm check`, `pnpm build`, and `pnpm tauri build` passed.

## Implementation Checklist

- [x] Match reference density and visual hierarchy.
- [x] Verify desktop, narrow, expanded, loading, success, running, and failure states.
- [x] Verify one completed-turn copy action and assistant-only clipboard content.
- [x] Run full tests, checks, production build, and installer packaging.

final result: passed

# Appearance Settings Design QA

## Visual Sources

- Source visual truth: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-8205850b-5ba5-4530-b1c0-99cc8bbef71e.png`
- Implementation screenshot: `E:\code\Pi Desktop App\output\playwright\appearance-desktop-final.png`
- Full-view comparison: `E:\code\Pi Desktop App\output\playwright\appearance-reference-comparison-current.png`
- Theme-browser comparison: `E:\code\Pi Desktop App\output\playwright\appearance-theme-comparison-current.png`
- Controls comparison: `E:\code\Pi Desktop App\output\playwright\appearance-controls-comparison-current.png`
- Narrow top and bottom states:
  - `E:\code\Pi Desktop App\output\playwright\appearance-mobile-final-top-current.png`
  - `E:\code\Pi Desktop App\output\playwright\appearance-mobile-final-bottom-current.png`
- Narrow navigation state: `E:\code\Pi Desktop App\output\playwright\appearance-mobile-sidebar-current.png`
- Cross-page background evidence: `E:\code\Pi Desktop App\output\playwright\appearance-desktop-cross-page-final2.png`
- Local implementation: `http://127.0.0.1:1420/`

## Viewport And State

- Desktop comparison: 1308 x 1920 CSS pixels, matching the source image exactly.
- Responsive comparison: 390 x 844 CSS pixels at the top, bottom, and open-navigation states.
- State: light/system appearance, moonlit Elaina theme applied, sidebar translucency enabled,
  300 px sidebar width, 100% scale, and system-default UI/code fonts.

## Full-View Comparison Evidence

The source and implementation were captured at the same 1308 x 1920 viewport and placed together
in one comparison image. The 1230 px outer frame, 24 px viewport margin, title hierarchy, section
spacing, card geometry, control widths, theme-card track, and bottom slider align with the source.
The three dark strips in the source cross the UI at unrelated positions and were treated as external
screenshot redactions rather than product chrome.

## Focused Region Comparison Evidence

Focused theme-browser and controls comparisons were opened after the full-view comparison. The final
pass explicitly checked the required fidelity surfaces:

| Surface | Evidence | Result |
| --- | --- | --- |
| Fonts and typography | System/Segoe UI fallbacks, zero negative letter spacing, 32 px page title, 20 px desktop labels, 18 px supporting copy, and responsive 14/12 px UI preserve the source hierarchy without clipping. | Passed |
| Spacing and layout rhythm | 1230 px frame, 48 px desktop inset, 50 px section rhythm, 114 px setting rows, 24 px inset dividers, 8 px radii, and fixed control tracks match the normalized source capture. | Passed |
| Colors and visual tokens | White settings cards, restrained gray copy and borders, `#3298ff` selected/toggle/range states, and translucent canvas treatment reproduce the source state while retaining readable contrast over images. | Passed |
| Image quality and asset fidelity | Built-in previews are full-resolution WebP assets featuring Elaina's moonlit journey and spring meadow; they are reused as real application backgrounds with correct cover crops. No placeholder, CSS-drawn, emoji, or handcrafted SVG asset is present. | Passed |
| Copy and content | Appearance, theme, scaling, font, translucency, width, and theme-action labels match the source hierarchy. Theme names are `魔女伊雷娜 · 月夜旅途` and `魔女伊雷娜 · 花海日记`. | Passed |
| Icons and affordances | Existing Lucide icons are used for commands; selected, disabled, preview-only, and applied states remain distinct. Native select arrows vary slightly by platform but remain clear. | Passed |
| Responsive behavior | At 390 x 844 the selected theme stays fully visible, controls stack without overlap, document width remains 390 px, and the fixed navigation scrim/close button work correctly. | Passed |

## Findings

No actionable P0, P1, or P2 findings remain. The exact source artwork is not available as a
standalone file, so the built-in theme images intentionally use matching high-quality artwork rather
than raster crops from the screenshot. Custom backgrounds remain user-replaceable by design.

P3 platform variation: native select chevrons render slightly darker in the browser capture than in
the source image. This does not affect hierarchy, control size, focus behavior, or usability.

## Interaction And Persistence Evidence

- Light, dark, and system theme modes update the application root immediately.
- Built-in and custom themes support preview, apply, replace, create, edit, import, and export states.
- Only an unapplied preview exposes the Apply command; the active card exposes a stable selected state.
- Valid PNG, JPEG, and WebP images are installed through Rust into application data after absolute-path,
  size, extension, and file-signature validation; invalid and spoofed files fail with stable errors.
- The applied background remains visible on the conversation workbench and settings pages without
  stacking duplicate translucent layers.
- Versioned preferences migrate from v1 to v2 and retain theme, background, scale, fonts, translucency,
  and sidebar width after reload.
- Browser console verification returned zero errors and zero warnings. Web preview runtime failures are
  surfaced as handled in-app Tauri-unavailable alerts and do not produce uncaught React errors.

## Patches Made Since The Previous QA Pass

- Implemented the full Appearance screen and separated reusable controls from page composition.
- Added application-wide background rendering, live preview/apply behavior, and versioned persistence.
- Added validated native background installation and portable custom-theme import/export commands.
- Matched desktop dimensions, responsive stacking, mobile navigation layering, thumbnail swatches,
  selected-state feedback, inset dividers, toggle geometry, and the outlined inset range track.
- Fixed background-root selection and removed duplicate translucent layers on the conversation page.
- Added `ResizeObserver` track positioning so the selected theme remains visible after viewport changes.

## Automated Evidence

- Renderer: 42 files and 260 tests passed; 86.97% statements, 81.32% branches,
  87.01% functions, and 90.25% lines.
- Agent Bridge: 6 files and 93 tests passed; 92.91% statements, 83.60% branches,
  97.69% functions, and 94.93% lines.
- Rust Core: 97 tests passed, including valid install, traversal, oversize, spoofed image,
  and custom-theme portability cases.
- `pnpm check`, `pnpm build`, `git diff --check`, and the changed-file sensitive-value scan passed.
- Production build reports only the existing non-blocking large-chunk advisory.

## Implementation Checklist

- [x] Capture and compare the same desktop viewport and state as the source visual.
- [x] Compare full-view and focused typography, spacing, colors, imagery, copy, icons, and controls.
- [x] Verify theme preview/apply, custom background replacement, cross-page application, and persistence.
- [x] Verify 390 x 844 responsive top, bottom, open-navigation, close, and overflow states.
- [x] Run full tests, TypeScript/Rust checks, production build, diff check, and sensitive-value scan.

final result: passed

# 主界面流式对话与工具悬浮复刻（2026-09-11）

本节仅评价本次对话流改动，不替代上方其他任务的记录。

## 素材与证据

- 视频：`C:/Users/Administrator/Downloads/QQ20260911-002036.mp4`，1920×1062，48.77秒；解码核对0、10、20、44秒及增量出现时段。
- 对话图片：`C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-70509508-cad3-4130-9b73-cf5bfa1421ac.png`。
- 悬浮前后图片：`C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-d16fcc98-2e2e-42de-b7dc-21e9bad952af.png`、`C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-2bdae3e7-7ea4-4faf-b374-3f324a93024c.png`。
- 实现截图：`output/playwright/streaming-desktop.png`、`streaming-mobile.png`、`streaming-empty.png`、`streaming-tool-expanded.png`、`streaming-failed.png`、`streaming-completed.png`（均在同一目录）。
- 全图并排比较：`output/playwright/streaming-comparison.png`。左右为参考10秒帧及相同正文、生成中状态；均为1920×1062后等比例缩小。
- 正文及悬浮局部并排比较：`output/playwright/streaming-focused-comparison.png`，使用实际截图裁切，已亲自打开检查。
- 窄屏：390×844，真实主页面、真实React组件和store，以浏览器内Mock替代Tauri和Pi外部依赖，不执行用户项目命令。

## 五项视觉核对

| 范围 | 本次实现及核对结果 |
| --- | --- |
| 字体与排版 | 沿用用户字体偏好；默认正文16px、行高25.6px，工具行同字号并降为灰色。参考视频经过缩放，附图字号约18px，因此不声称两种素材在同一缩放比例下像素完全一致。 |
| 布局与节奏 | 正文与输入框共用700px上限，窄屏14px侧留白；连续正文/活动约22px间隔。输入区最小高度54px，外框18px圆角，底部固定；长内容不横向撑开。 |
| 颜色与状态 | 默认白底、深色正文、灰色活动行。真实测得工具文字从rgb(112,112,112)变为rgb(31,31,31)，箭头透明度从0变为1；140ms过渡，无悬浮背景卡片。键盘聚焦也变深并显示箭头。停止按钮使用中性主按钮色。 |
| 图标与素材 | 复用现有Lucide语义图标及Pi标识。参考里的其他代理任务徽标没有对应业务数据，未伪造为真实任务。工具图标和状态文案因Pi工具语义保留现有表达。 |
| 文案与内容 | 活动显示“已处理”，结束显示“用时”，中文分钟/秒。生成期助手正文按原序显示在思考提示之前，工具运行时隐藏重复思考提示；结束后的过程仍可独立展开。 |

## 交互验证与修复

- 初次截图对照发现工具名在空间充足时仍被45%限制截断，已改为有界28ch并允许收缩。
- 实测发现真实助手增量没有工具的running字段，已修正动画启用条件并新增真实DTO形状回归测试。
- 同一真实事件链路80ms时显示16字，随后显示完整65字，证实不是仅有状态动画；28ms一批呈现，积压上限240字素。
- 完成、停止、替换内容、后台、减少动态效果会补齐完整内容；Unicode字素与卸载清理有测试。
- ResizeObserver观察正文变化，执行滚动前再次检查是否跟随，避免用户上滑与已排队滚动竞争。
- 390px窄屏实测页面/滚动容器均为390px；长路径、连续消息及长文本没有横向溢出。
- 长流跟随到底部间隙0px；上滑后继续输出时scrollTop保持0；点击“跳到最新消息”后间隙恢复0px。
- 鼠标和Enter均能展开/收起工具详情；失败信息通过alert显示且不会折叠隐藏。

## 验证结果与限制

- Renderer：60个文件、450项测试全部通过。覆盖率语句87.78%、分支82.09%、函数88.90%、行90.59%。
- 新增流式hook：语句/函数/行100%，分支92.30%；时间线行92.16%、分支85.27%。
- ChatWorkbenchView整体行81.63%、分支79.81%、函数73.80%；该大页面的其他操作未全部覆盖，本次新增滚动路径已有Mock回归和实际浏览器验证，未扩展修改无关功能以提高覆盖数字。
- Bridge：167项通过、1项既有跳过；运行时准备脚本8项通过；Rust：156项通过、1项既有忽略。
- 首次全量测试有2项并发超时，降低到2个worker后全量通过。首次Rust检查遇到运行中程序占用资源，使用独立CARGO_TARGET_DIR完成测试、检查和完整pnpm build。
- pnpm check与最终pnpm build成功；生产包仍有既有的大chunk体积提示。
- 素材未展示失败、移动端、长流自动滚动；这些状态按既有产品语义补齐并验证。浏览器Mock验证不等同于重新运行外部Pi模型请求。
- 保留Pi侧边栏、项目选择与输入框工具控件；参考应用的侧栏内容、系统标题栏、第三方任务徽标及字体抗锯齿存在产品/平台差异。其余P3为素材缩放造成的字号视觉差别，可随应用字号偏好调整。

本次对话流范围无未解决的P0/P1/P2交互或布局问题；不将素材未提供的状态称为一比一复刻。

final result: passed
