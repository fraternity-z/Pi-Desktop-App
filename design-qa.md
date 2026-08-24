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
