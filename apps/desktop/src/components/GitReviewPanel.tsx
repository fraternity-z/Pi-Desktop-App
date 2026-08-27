import { confirm } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Eye,
  FileDiff,
  FolderGit2,
  GitBranch,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  SplitSquareHorizontal,
  Trash2,
  Upload,
  WrapText,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import * as defaultApi from "../ipc/git";
import type { GitDiff, GitDiffInput, GitStatus, GitStatusEntry } from "../ipc/git";
import {
  DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS,
  type RightPanelDiffStyle,
  type RightPanelDisplayOptionKey,
  type RightPanelDisplayOptions,
} from "../stores/useRightPanelLayout";
import { HighlightedCodeLine } from "./CodeHighlight";
import {
  buildGitApplyCommand,
  buildSplitDiffRows,
  buildUnifiedWordSegments,
  calculateDiffStats,
  collapseUnchangedLines,
  parseUnifiedDiff,
  type DiffLine,
  type DiffStats,
  type WordSegment,
} from "./gitReviewModel";
import "./git-review.css";

export { parseUnifiedDiff } from "./gitReviewModel";
export type { DiffLine } from "./gitReviewModel";

type Scope = "unstaged" | "staged";
type ViewStyle = RightPanelDiffStyle;
type OpenMenu = "scope" | "display" | "git" | null;
type DialogKind = "commit" | "push" | "branch" | null;

type DisplayOptions = RightPanelDisplayOptions;

type GitApi = Pick<
  typeof defaultApi,
  | "gitStatus"
  | "gitDiff"
  | "gitStage"
  | "gitUnstage"
  | "gitDiscard"
  | "gitInit"
  | "gitCommit"
  | "gitPush"
  | "gitCreateBranch"
>;

export interface GitReviewPanelProps {
  readonly cwd: string;
  readonly active?: boolean;
  readonly api?: GitApi;
  readonly diffStyle?: ViewStyle;
  readonly displayOptions?: DisplayOptions;
  readonly onDiffStyleChange?: (style: ViewStyle) => void;
  readonly onDisplayOptionToggle?: (option: RightPanelDisplayOptionKey) => void;
}

const MAX_APPLY_PATCH_BYTES = 1024 * 1024;
const NON_PATCH_DIFF_MESSAGES = new Set([
  "未跟踪文件为空，暂无可展示的文本差异",
  "未跟踪文件不是 UTF-8 文本，无法展示差异",
  "未跟踪路径是目录，无法展示单文件差异",
  "当前文件没有可展示的文本差异",
]);
const MAX_CONCURRENT_DIFF_REQUESTS = 4;
const STALE_DIFF_REQUEST = new Error("Git diff request belongs to a stale workspace");

interface AsyncLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

function createAsyncLimiter(maxConcurrent: number): AsyncLimiter {
  type QueueItem = {
    readonly task: () => Promise<unknown>;
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason?: unknown) => void;
  };
  const queue: QueueItem[] = [];
  let running = 0;

  const drain = () => {
    while (running < maxConcurrent) {
      const item = queue.shift();
      if (!item) return;
      running += 1;
      void Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          running -= 1;
          drain();
        });
    }
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          task,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        drain();
      });
    },
  };
}

export function formatGitError(
  cause: unknown,
  fallback = "GIT_OPERATION_FAILED: Git 操作失败，请重试",
): string {
  if (cause && typeof cause === "object") {
    const value = cause as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string") {
      return `${value.code}: ${value.message}`;
    }
    if (typeof value.message === "string" && value.message) return value.message;
  }
  return typeof cause === "string" && cause ? cause : fallback;
}

export function GitReviewPanel({
  cwd,
  active = true,
  api = defaultApi,
  diffStyle,
  displayOptions: controlledDisplayOptions,
  onDiffStyleChange,
  onDisplayOptionToggle,
}: GitReviewPanelProps): ReactElement {
  const [statusState, setStatusState] = useState<{
    readonly cwd: string;
    readonly generation: number;
    readonly value: GitStatus;
  } | null>(null);
  const [statusRevision, setStatusRevision] = useState(0);
  const [scope, setScope] = useState<Scope>("unstaged");
  const [loading, setLoading] = useState(active);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const [localViewStyle, setLocalViewStyle] = useState<ViewStyle>("unified");
  const [localDisplayOptions, setLocalDisplayOptions] = useState<DisplayOptions>(() => ({
    ...DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS,
  }));
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [statsByPath, setStatsByPath] = useState<Record<string, DiffStats>>({});
  const toolbarRef = useRef<HTMLDivElement>(null);
  const gitMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusRequest = useRef(0);
  const copyRequest = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const operationKey = `${active}\0${cwd}`;
  const operationContextRef = useRef({ key: operationKey, generation: 0 });
  if (operationContextRef.current.key !== operationKey) {
    operationContextRef.current = {
      key: operationKey,
      generation: operationContextRef.current.generation + 1,
    };
  }
  const operationGeneration = operationContextRef.current.generation;
  const viewStyle = diffStyle ?? localViewStyle;
  const displayOptions = controlledDisplayOptions ?? localDisplayOptions;
  const status = statusState?.cwd === cwd && statusState.generation === operationGeneration
    ? statusState.value
    : null;
  const diffContextRef = useRef({ api, cwd });
  diffContextRef.current = { api, cwd };
  const copyContext = `${operationGeneration}\0${cwd}\0${scope}\0${displayOptions.hideWhitespace}\0${statusRevision}`;
  const copyContextRef = useRef(copyContext);
  copyContextRef.current = copyContext;
  const diffLimiter = useMemo(
    () => createAsyncLimiter(MAX_CONCURRENT_DIFF_REQUESTS),
    [api],
  );
  const loadDiff = useCallback(
    (input: GitDiffInput) => {
      const generation = operationContextRef.current.generation;
      return diffLimiter.run(() => {
        const current = diffContextRef.current;
        if (
          current.api !== api ||
          current.cwd !== input.cwd ||
          operationContextRef.current.generation !== generation
        ) {
          return Promise.reject(STALE_DIFF_REQUEST);
        }
        return api.gitDiff(input);
      });
    },
    [api, diffLimiter],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!activeRef.current) return;
    const generation = operationContextRef.current.generation;
    const request = ++statusRequest.current;
    setLoading(true);
    setStatusError(null);
    try {
      const nextStatus = await api.gitStatus(cwd);
      if (
        request !== statusRequest.current ||
        generation !== operationContextRef.current.generation
      ) return;
      setStatusState({ cwd, generation, value: nextStatus });
      setStatsByPath({});
      setStatusRevision((current) => current + 1);
    } catch (cause) {
      if (
        request !== statusRequest.current ||
        generation !== operationContextRef.current.generation
      ) return;
      setStatusState(null);
      setStatusError(formatGitError(cause, "GIT_STATUS_FAILED: 无法读取 Git 状态"));
    } finally {
      if (
        request === statusRequest.current &&
        generation === operationContextRef.current.generation
      ) setLoading(false);
    }
  }, [api, cwd]);

  useEffect(() => {
    setStatusState(null);
    setStatsByPath({});
    setActionError(null);
    setScope("unstaged");
    setOpenMenu(null);
    setDialog(null);
    setBusy(false);
    if (!active) {
      statusRequest.current += 1;
      setLoading(false);
      return;
    }
    void refresh();
  }, [active, cwd, refresh]);

  useEffect(() => {
    setStatsByPath({});
  }, [displayOptions.hideWhitespace, scope]);

  useEffect(() => {
    copyRequest.current += 1;
    setCopyPending(false);
  }, [active, cwd, displayOptions.hideWhitespace, scope, statusRevision]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpenMenu(null);
    if (restoreFocus) {
      window.setTimeout(() => menuTriggerRef.current?.focus(), 0);
    }
  }, []);

  const toggleMenu = useCallback((menu: Exclude<OpenMenu, null>, trigger: HTMLButtonElement) => {
    if (openMenu === menu) {
      closeMenu(true);
      return;
    }
    menuTriggerRef.current = trigger;
    setOpenMenu(menu);
  }, [closeMenu, openMenu]);

  const openDialog = useCallback((kind: Exclude<DialogKind, null>) => {
    dialogTriggerRef.current = gitMenuTriggerRef.current;
    closeMenu();
    setDialog(kind);
  }, [closeMenu]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    window.setTimeout(() => dialogTriggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) closeMenu();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [closeMenu, openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const menu = toolbarRef.current?.querySelector<HTMLElement>(`[data-review-menu="${openMenu}"]`);
    menu?.querySelector<HTMLElement>('button[role^="menuitem"]:not(:disabled)')?.focus();
  }, [openMenu]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      if (busy) return false;
      const generation = operationContextRef.current.generation;
      const isCurrent = () =>
        activeRef.current && operationContextRef.current.generation === generation;
      setBusy(true);
      setActionError(null);
      try {
        await action();
        if (!isCurrent()) return false;
        await refresh();
        return isCurrent();
      } catch (cause) {
        if (isCurrent()) {
          setActionError(formatGitError(cause));
          await refresh();
        }
        return false;
      } finally {
        if (isCurrent()) setBusy(false);
      }
    },
    [busy, refresh],
  );

  const unstagedEntries = useMemo(
    () => [
      ...(status?.unstaged ?? []),
      ...(status?.untracked ?? []),
      ...(status?.conflicted ?? []),
    ],
    [status],
  );
  const entries = scope === "staged" ? status?.staged ?? [] : unstagedEntries;
  const totals = sumStats(entries, statsByPath);
  const statsReady = entries.length > 0 && entries.every((entry) => statsByPath[entry.path]);

  const reportStats = useCallback((path: string, stats: DiffStats) => {
    setStatsByPath((current) => {
      const previous = current[path];
      if (
        previous?.additions === stats.additions &&
        previous.deletions === stats.deletions
      ) return current;
      return { ...current, [path]: stats };
    });
  }, []);

  const updateDisplayOption = useCallback(
    (option: RightPanelDisplayOptionKey) => {
      if (onDisplayOptionToggle) {
        onDisplayOptionToggle(option);
        return;
      }
      setLocalDisplayOptions((current) => ({ ...current, [option]: !current[option] }));
    },
    [onDisplayOptionToggle],
  );

  const toggleViewStyle = useCallback(() => {
    const next = viewStyle === "unified" ? "split" : "unified";
    if (onDiffStyleChange) onDiffStyleChange(next);
    else setLocalViewStyle(next);
  }, [onDiffStyleChange, viewStyle]);

  async function handleDiscard(entry: GitStatusEntry): Promise<void> {
    const deleteUntracked = entry.indexStatus === "?" && entry.worktreeStatus === "?";
    const allowed = await confirm(
      `确定要${deleteUntracked ? "删除" : "还原"} ${entry.path} 吗？此操作不可撤销。`,
    );
    if (!allowed) return;
    await runAction(() => api.gitDiscard(cwd, [entry.path], deleteUntracked));
  }

  async function handleCopyGitApply(): Promise<void> {
    if (copyPending) return;
    const request = ++copyRequest.current;
    const context = copyContextRef.current;
    closeMenu(true);
    setCopyPending(true);
    setActionError(null);
    try {
      const patches: string[] = [];
      let totalBytes = 0;
      for (const entry of entries) {
        const output = await loadDiff({
          cwd,
          path: entry.path,
          staged: scope === "staged",
          ignoreWhitespaceChanges: displayOptions.hideWhitespace,
        });
        if (
          request !== copyRequest.current ||
          context !== copyContextRef.current ||
          !activeRef.current
        ) return;
        const patch = output.diff.trimEnd();
        if (!isPatchContent(patch)) continue;
        totalBytes += new TextEncoder().encode(patch).byteLength;
        if (totalBytes > MAX_APPLY_PATCH_BYTES) {
          throw new Error("当前分组补丁超过 1 MiB，无法安全写入剪贴板。");
        }
        patches.push(patch);
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前环境不支持写入剪贴板。");
      }
      if (
        request !== copyRequest.current ||
        context !== copyContextRef.current ||
        !activeRef.current
      ) return;
      await navigator.clipboard.writeText(buildGitApplyCommand(patches.join("\n")));
    } catch (cause) {
      if (
        request === copyRequest.current &&
        context === copyContextRef.current &&
        activeRef.current
      ) {
        setActionError(formatGitError(cause, "GIT_PATCH_COPY_FAILED: 无法复制 git apply 命令"));
      }
    } finally {
      if (request === copyRequest.current && context === copyContextRef.current) {
        setCopyPending(false);
      }
    }
  }

  async function handleCommit(
    message: string,
    pushAfterCommit: boolean,
    includeUnstaged: boolean,
  ): Promise<void> {
    if (busy) return;
    const generation = operationContextRef.current.generation;
    const isCurrent = () =>
      activeRef.current && operationContextRef.current.generation === generation;
    setBusy(true);
    setActionError(null);
    try {
      if (includeUnstaged) {
        await stagePathsInChunks(api, cwd, uniquePaths(unstagedEntries));
      }
      await api.gitCommit(cwd, message);
    } catch (cause) {
      if (isCurrent()) {
        setActionError(formatGitError(cause));
        await refresh();
        setBusy(false);
      }
      return;
    }

    if (isCurrent()) {
      closeDialog();
      await refresh();
    }
    if (pushAfterCommit) {
      try {
        await api.gitPush(cwd);
        if (isCurrent()) await refresh();
      } catch (cause) {
        if (isCurrent()) {
          setActionError(formatGitError(cause, "GIT_PUSH_FAILED: 提交已创建，但推送失败"));
        }
      }
    }
    if (isCurrent()) setBusy(false);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button[role^="menuitem"]:not(:disabled)',
    )];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = current < items.length - 1 ? current + 1 : 0;
    if (event.key === "ArrowUp") next = current > 0 ? current - 1 : items.length - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  if (!active && status === null) {
    return <section className="git-review-panel" aria-label="Git 审阅" />;
  }
  if (loading && !status) {
    return (
      <PanelState
        icon={<LoaderCircle className="spin" />}
        title="正在读取 Git 状态"
      />
    );
  }
  if (statusError && !status) {
    return (
      <PanelState
        icon={<AlertTriangle />}
        title="无法读取 Git 状态"
        detail={statusError}
        error
        action="重试"
        onAction={() => void refresh()}
      />
    );
  }
  if (status && !status.isRepository) {
    return (
      <PanelState
        icon={<FolderGit2 />}
        title="当前工作区还不是 Git 仓库"
        detail="初始化后即可在右侧面板审阅、暂存和提交更改。"
        action="初始化 Git 仓库"
        actionDisabled={busy}
        onAction={() => void runAction(() => api.gitInit(cwd))}
      />
    );
  }

  const branch = status?.branch;
  const branchLabel = branch?.detached ? "分离 HEAD" : branch?.head ?? "未命名分支";
  return (
    <section className="git-review-panel" aria-label="Git 审阅">
      <div className="git-review-controls" ref={toolbarRef}>
        <div className="git-review-title-wrap">
          <div className="git-review-menu-wrap git-review-scope-wrap">
            <button
              type="button"
              className="git-review-scope-trigger"
              aria-haspopup="menu"
              aria-expanded={openMenu === "scope"}
              onClick={(event) => toggleMenu("scope", event.currentTarget)}
            >
              <span>{scope === "unstaged" ? "未暂存" : "已暂存"}</span>
              <small>{entries.length}</small>
              <ChevronDown aria-hidden="true" />
            </button>
            {openMenu === "scope" ? (
              <div
                className="git-review-scope-menu"
                role="menu"
                aria-label="差异范围"
                data-review-menu="scope"
                onKeyDown={handleMenuKeyDown}
              >
                <ScopeMenuItem
                  selected={scope === "unstaged"}
                  label="未暂存"
                  count={unstagedEntries.length}
                  onSelect={() => {
                    setScope("unstaged");
                    closeMenu(true);
                  }}
                />
                <ScopeMenuItem
                  selected={scope === "staged"}
                  label="已暂存"
                  count={status?.staged.length ?? 0}
                  onSelect={() => {
                    setScope("staged");
                    closeMenu(true);
                  }}
                />
              </div>
            ) : null}
          </div>
          {entries.length === 0 ? null : statsReady ? (
            <span
              className="git-review-change-summary"
              aria-label={`当前分组新增 ${totals.additions} 行，删除 ${totals.deletions} 行`}
            >
              <b>+{totals.additions}</b>
              <b>-{totals.deletions}</b>
            </span>
          ) : (
            <span className="git-review-summary-pending">更新中…</span>
          )}
        </div>

        <div className="git-review-toolbar-actions">
          <div className="git-review-menu-wrap">
            <ToolbarButton
              label="差异操作"
              expanded={openMenu === "display"}
              onClick={(event) => toggleMenu("display", event.currentTarget)}
            >
              <MoreHorizontal />
            </ToolbarButton>
            {openMenu === "display" ? (
              <div
                className="git-review-actions-menu"
                role="menu"
                aria-label="差异操作"
                data-review-menu="display"
                onKeyDown={handleMenuKeyDown}
              >
                <MenuCommand icon={<RefreshCw />} label="刷新" onClick={() => {
                  closeMenu(true);
                  void refresh();
                }} />
                <MenuToggle
                  icon={<WrapText />}
                  label={displayOptions.wordWrap ? "禁用自动换行" : "启用自动换行"}
                  checked={displayOptions.wordWrap}
                  onClick={() => updateDisplayOption("wordWrap")}
                />
                <MenuCommand
                  icon={<ChevronDown />}
                  label="折叠全部差异"
                  onClick={() => {
                    setCollapseSignal((current) => current + 1);
                    closeMenu(true);
                  }}
                />
                <div className="git-review-menu-separator" role="separator" />
                <MenuToggle
                  icon={<Eye />}
                  label={displayOptions.richPreview ? "禁用富文本预览" : "启用富文本预览"}
                  checked={displayOptions.richPreview}
                  onClick={() => updateDisplayOption("richPreview")}
                />
                <MenuToggle
                  icon={<FileDiff />}
                  label={displayOptions.wordDiff ? "禁用文字差异" : "启用文字差异"}
                  checked={displayOptions.wordDiff}
                  onClick={() => updateDisplayOption("wordDiff")}
                />
                <MenuToggle
                  icon={<SplitSquareHorizontal />}
                  label={displayOptions.hideWhitespace ? "显示空白字符" : "隐藏空白字符"}
                  checked={displayOptions.hideWhitespace}
                  onClick={() => updateDisplayOption("hideWhitespace")}
                />
                <MenuCommand
                  icon={copyPending ? <LoaderCircle className="spin" /> : <Clipboard />}
                  label="复制 git apply 命令"
                  disabled={copyPending || entries.length === 0}
                  onClick={() => void handleCopyGitApply()}
                />
              </div>
            ) : null}
          </div>

          <ToolbarButton
            label={viewStyle === "unified" ? "切换到拆分布局" : "切换到统一布局"}
            pressed={viewStyle === "split"}
            onClick={toggleViewStyle}
          >
            <SplitSquareHorizontal />
          </ToolbarButton>

          <div className="git-review-menu-wrap">
            <ToolbarButton
              label="Git 操作"
              title={`Git 操作 · ${branchLabel}`}
              expanded={openMenu === "git"}
              buttonRef={gitMenuTriggerRef}
              onClick={(event) => toggleMenu("git", event.currentTarget)}
            >
              <GitBranch />
            </ToolbarButton>
            {openMenu === "git" ? (
              <div
                className="git-review-actions-menu git-review-git-menu"
                role="menu"
                aria-label="Git 操作"
                data-review-menu="git"
                onKeyDown={handleMenuKeyDown}
              >
                <MenuCommand
                  icon={<Check />}
                  label="提交"
                  disabled={busy || (status?.isClean ?? true)}
                  onClick={() => {
                    openDialog("commit");
                  }}
                />
                <MenuCommand
                  icon={<Upload />}
                  label="推送"
                  disabled={busy}
                  onClick={() => {
                    openDialog("push");
                  }}
                />
                <MenuCommand
                  icon={<GitBranch />}
                  label="创建分支"
                  disabled={busy}
                  onClick={() => {
                    openDialog("branch");
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {branch ? (
        <div className="git-review-branch" title={branch.upstream ?? undefined}>
          <GitBranch aria-hidden="true" />
          <span>{branchLabel}</span>
          {branch.ahead > 0 ? <small>↑{branch.ahead}</small> : null}
          {branch.behind > 0 ? <small>↓{branch.behind}</small> : null}
        </div>
      ) : null}
      {actionError ? <InlineError message={actionError} /> : null}

      <main className="git-review-stream">
        {loading ? <p className="git-review-refreshing" role="status">正在刷新差异…</p> : null}
        {!loading && status?.isClean ? (
          <PanelState
            icon={<Check />}
            title="当前分组没有可展示的差异"
            detail="修改文件后会在这里显示连续 diff 视图。"
            embedded
          />
        ) : !loading && entries.length === 0 ? (
          <PanelState
            icon={<FileDiff />}
            title="当前分组没有可展示的差异"
            detail="切换分组或修改文件后，差异会显示在这里。"
            embedded
          />
        ) : (
          entries.map((entry) => (
            <DiffCard
              key={`${statusRevision}:${scope}:${entry.path}`}
              cwd={cwd}
              loadDiff={loadDiff}
              entry={entry}
              staged={scope === "staged"}
              busy={busy}
              collapseSignal={collapseSignal}
              displayOptions={displayOptions}
              viewStyle={viewStyle}
              onStats={reportStats}
              onStage={() => void runAction(() =>
                scope === "staged"
                  ? api.gitUnstage(cwd, [entry.path])
                  : api.gitStage(cwd, [entry.path]),
              )}
              onDiscard={() => void handleDiscard(entry)}
            />
          ))
        )}
      </main>

      {dialog === "commit" ? (
        <CommitDialog
          stagedCount={status?.staged.length ?? 0}
          unstagedCount={unstagedEntries.length}
          busy={busy}
          onClose={closeDialog}
          onCommit={(message, pushAfterCommit, includeUnstaged) =>
            void handleCommit(message, pushAfterCommit, includeUnstaged)}
        />
      ) : null}
      {dialog === "push" ? (
        <PushDialog
          busy={busy}
          onClose={closeDialog}
          onPush={(forceWithLease) => void runAction(() => api.gitPush(cwd, forceWithLease)).then(
            (succeeded) => {
              if (succeeded) closeDialog();
            },
          )}
        />
      ) : null}
      {dialog === "branch" ? (
        <BranchDialog
          busy={busy}
          onClose={closeDialog}
          onCreate={(name) => void runAction(() => api.gitCreateBranch(cwd, name)).then(
            (succeeded) => {
              if (succeeded) closeDialog();
            },
          )}
        />
      ) : null}
    </section>
  );
}

interface DiffCardProps {
  readonly cwd: string;
  readonly loadDiff: (input: GitDiffInput) => Promise<GitDiff>;
  readonly entry: GitStatusEntry;
  readonly staged: boolean;
  readonly busy: boolean;
  readonly collapseSignal: number;
  readonly displayOptions: DisplayOptions;
  readonly viewStyle: ViewStyle;
  readonly onStats: (path: string, stats: DiffStats) => void;
  readonly onStage: () => void;
  readonly onDiscard: () => void;
}

function DiffCard(props: DiffCardProps): ReactElement {
  const [open, setOpen] = useState(true);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = `${props.cwd}:${props.entry.path}:${props.staged}:${props.displayOptions.hideWhitespace}`;

  useEffect(() => {
    if (props.collapseSignal > 0) setOpen(false);
  }, [props.collapseSignal]);

  useEffect(() => {
    setDiff(null);
    setError(null);
  }, [requestKey]);

  useEffect(() => {
    if (!open || diff || error) return;
    let current = true;
    setLoading(true);
    void props.loadDiff({
      cwd: props.cwd,
      path: props.entry.path,
      staged: props.staged,
      ignoreWhitespaceChanges: props.displayOptions.hideWhitespace,
    }).then((output) => {
      if (!current) return;
      setDiff(output);
      props.onStats(props.entry.path, calculateDiffStats(parseUnifiedDiff(output.diff)));
    }).catch((cause) => {
      if (current && cause !== STALE_DIFF_REQUEST) {
        setError(formatGitError(cause, "GIT_DIFF_FAILED: 无法读取差异"));
      }
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [
    diff,
    error,
    open,
    props.cwd,
    props.displayOptions.hideWhitespace,
    props.entry.path,
    props.loadDiff,
    props.onStats,
    props.staged,
    requestKey,
  ]);

  const parsedLines = useMemo(() => diff ? parseUnifiedDiff(diff.diff) : [], [diff]);
  const stats = diff ? calculateDiffStats(parsedLines) : null;
  const title = props.entry.originalPath
    ? `${props.entry.originalPath} → ${props.entry.path}`
    : props.entry.path;
  const untracked = props.entry.indexStatus === "?" && props.entry.worktreeStatus === "?";
  const conflict = isConflicted(props.entry);
  const stateLabel = props.staged
    ? "已暂存"
    : conflict
      ? "冲突"
      : untracked
        ? "未跟踪"
        : "未暂存";

  return (
    <article className="git-review-file-card">
      <header className="git-review-file-header">
        <button
          type="button"
          className="git-review-file-trigger"
          aria-expanded={open}
          aria-label={`${open ? "折叠" : "展开"} ${title}`}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <span className="git-review-file-copy">
            <strong title={title}>{title}</strong>
            <small>{stateLabel}</small>
          </span>
        </button>
        <span className="git-review-file-summary" aria-label={stats ? `新增 ${stats.additions} 行，删除 ${stats.deletions} 行` : undefined}>
          {stats ? <><b>+{stats.additions}</b><b>-{stats.deletions}</b></> : loading ? "…" : error ? "!" : ""}
        </span>
        <div className="git-review-file-actions">
          <button
            type="button"
            aria-label={`${props.staged ? "取消暂存" : "暂存"} ${props.entry.path}`}
            title={props.staged ? "取消暂存" : "暂存"}
            disabled={props.busy}
            onClick={props.onStage}
          >
            {props.staged ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </button>
          {!props.staged ? (
            <button
              type="button"
              aria-label={`${untracked ? "删除" : "还原"} ${props.entry.path}`}
              title={untracked ? "删除未跟踪文件" : "还原文件"}
              disabled={props.busy}
              onClick={props.onDiscard}
            >
              {untracked ? <Trash2 aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </header>
      {open ? (
        <div className="git-review-file-body">
          {loading ? (
            <p className="git-review-card-state" role="status">
              <LoaderCircle className="spin" />正在加载差异…
            </p>
          ) : error ? (
            <div className="git-review-card-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}>重试</button>
            </div>
          ) : diff && parsedLines.length > 0 ? (
            <DiffView
              lines={parsedLines}
              path={props.entry.path}
              displayOptions={props.displayOptions}
              viewStyle={props.viewStyle}
            />
          ) : (
            <p className="git-review-card-state">该文件没有可展示的文本差异。</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function DiffView(props: {
  readonly lines: ReadonlyArray<DiffLine>;
  readonly path: string;
  readonly displayOptions: DisplayOptions;
  readonly viewStyle: ViewStyle;
}): ReactElement {
  const lines = useMemo(() => collapseUnchangedLines(props.lines), [props.lines]);
  if (props.viewStyle === "split") {
    return (
      <SplitDiffView
        lines={lines}
        path={props.path}
        displayOptions={props.displayOptions}
      />
    );
  }
  const wordSegments = props.displayOptions.wordDiff
    ? buildUnifiedWordSegments(lines)
    : new Map<DiffLine, ReadonlyArray<WordSegment>>();
  return (
    <DiffScrollFrame wordWrap={props.displayOptions.wordWrap}>
      <section className="git-review-hunk">
        {lines.map((line, index) => (
          <UnifiedDiffRow
            key={`${index}:${line.kind}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
            line={line}
            path={props.path}
            richPreview={props.displayOptions.richPreview}
            segments={wordSegments.get(line) ?? null}
          />
        ))}
      </section>
    </DiffScrollFrame>
  );
}

function UnifiedDiffRow(props: {
  readonly line: DiffLine;
  readonly path: string;
  readonly richPreview: boolean;
  readonly segments: ReadonlyArray<WordSegment> | null;
}): ReactElement {
  const lineNumber = props.line.kind === "delete" ? props.line.oldLine : props.line.newLine;
  return (
    <div className={`git-review-code-row ${props.line.kind}`}>
      <span className="git-review-line-number">{lineNumber ?? ""}</span>
      <span className="git-review-line-sign">{lineSign(props.line)}</span>
      <DiffLineContent
        line={props.line}
        path={props.path}
        richPreview={props.richPreview}
        segments={props.segments}
      />
    </div>
  );
}

function SplitDiffView(props: {
  readonly lines: ReadonlyArray<DiffLine>;
  readonly path: string;
  readonly displayOptions: DisplayOptions;
}): ReactElement {
  const rows = useMemo(
    () => buildSplitDiffRows(props.lines, props.displayOptions.wordDiff),
    [props.displayOptions.wordDiff, props.lines],
  );
  return (
    <DiffScrollFrame wordWrap={props.displayOptions.wordWrap} split>
      <div className="git-review-split-frame">
        <div className="git-review-split-pane" aria-label="原始版本">
          {rows.map((row, index) => (
            <SplitDiffRow
              key={`left:${index}`}
              line={row.kind === "meta" ? row.meta : row.left}
              segments={row.leftSegments}
              path={props.path}
              richPreview={props.displayOptions.richPreview}
              side="left"
            />
          ))}
        </div>
        <div className="git-review-split-pane" aria-label="修改版本">
          {rows.map((row, index) => (
            <SplitDiffRow
              key={`right:${index}`}
              line={row.kind === "meta" ? row.meta : row.right}
              segments={row.rightSegments}
              path={props.path}
              richPreview={props.displayOptions.richPreview}
              side="right"
            />
          ))}
        </div>
      </div>
    </DiffScrollFrame>
  );
}

function SplitDiffRow(props: {
  readonly line: DiffLine | null;
  readonly segments: ReadonlyArray<WordSegment> | null;
  readonly path: string;
  readonly richPreview: boolean;
  readonly side: "left" | "right";
}): ReactElement {
  const line = props.line;
  if (!line) {
    return <div className="git-review-code-row empty" aria-hidden="true" />;
  }
  const lineNumber = props.side === "left" ? line.oldLine : line.newLine;
  return (
    <div className={`git-review-code-row ${line.kind}`}>
      <span className="git-review-line-number">{lineNumber ?? ""}</span>
      <span className="git-review-line-sign">{lineSign(line)}</span>
      <DiffLineContent
        line={line}
        path={props.path}
        richPreview={props.richPreview}
        segments={props.segments}
      />
    </div>
  );
}

function DiffLineContent(props: {
  readonly line: DiffLine;
  readonly path: string;
  readonly richPreview: boolean;
  readonly segments: ReadonlyArray<WordSegment> | null;
}): ReactElement {
  if (props.line.kind === "meta" || props.line.kind === "collapsed") {
    return <span className="git-review-code-content">{props.line.content}</span>;
  }
  if (props.segments) {
    return (
      <code className="git-review-code-content">
        {props.segments.map((segment, index) => (
          <span
            className={segment.changed ? "git-review-word-change" : undefined}
            key={`${index}:${segment.changed}`}
          >
            {segment.text}
          </span>
        ))}
      </code>
    );
  }
  return props.richPreview ? (
    <code className="git-review-code-content">
      <HighlightedCodeLine content={props.line.content} path={props.path} />
    </code>
  ) : (
    <code className="git-review-code-content">{props.line.content}</code>
  );
}

function DiffScrollFrame(props: {
  readonly wordWrap: boolean;
  readonly split?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const synchronizing = useRef(false);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const surface = surfaceRef.current;
    if (!viewport || !surface) return;
    const width = Math.max(surface.scrollWidth, viewport.clientWidth);
    setSurfaceWidth((current) => current === width ? current : width);
    setOverflowing(width > viewport.clientWidth + 1);
  }, []);

  useLayoutEffect(measure, [measure, props.children, props.wordWrap]);
  useEffect(() => {
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      if (viewportRef.current) observer.observe(viewportRef.current);
      if (surfaceRef.current) observer.observe(surfaceRef.current);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  function syncScroll(source: HTMLDivElement, target: HTMLDivElement | null) {
    if (!target || synchronizing.current) return;
    synchronizing.current = true;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame?.(() => {
      synchronizing.current = false;
    });
    if (typeof window.requestAnimationFrame !== "function") synchronizing.current = false;
  }

  const frameClassName = [
    "git-review-code-frame",
    props.split ? "is-split" : "",
    props.wordWrap ? "is-wrapped" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={frameClassName}>
      <div
        className="git-review-code-viewport"
        ref={viewportRef}
        onScroll={(event) => syncScroll(event.currentTarget, railRef.current)}
      >
        <div className="git-review-code-surface" ref={surfaceRef}>{props.children}</div>
      </div>
      {!props.wordWrap ? (
        <div
          className={`git-review-horizontal-scroll ${overflowing ? "is-active" : "is-inactive"}`}
          ref={railRef}
          onScroll={(event) => syncScroll(event.currentTarget, viewportRef.current)}
          aria-hidden="true"
        >
          <div style={{ width: `${surfaceWidth}px` } as CSSProperties} />
        </div>
      ) : null}
    </div>
  );
}

function ScopeMenuItem(props: {
  readonly selected: boolean;
  readonly label: string;
  readonly count: number;
  readonly onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.selected}
      onClick={props.onSelect}
    >
      <span>{props.label}</span>
      <small>{props.count}</small>
      {props.selected ? <Check aria-hidden="true" /> : <span />}
    </button>
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly title?: string;
  readonly expanded?: boolean;
  readonly pressed?: boolean;
  readonly buttonRef?: Ref<HTMLButtonElement>;
  readonly onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <button
      ref={props.buttonRef}
      type="button"
      className="git-review-toolbar-button"
      aria-label={props.label}
      title={props.title ?? props.label}
      aria-haspopup={props.expanded === undefined ? undefined : "menu"}
      aria-expanded={props.expanded}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function MenuCommand(props: {
  readonly icon: ReactElement;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button type="button" role="menuitem" disabled={props.disabled} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      <span />
    </button>
  );
}

function MenuToggle(props: {
  readonly icon: ReactElement;
  readonly label: string;
  readonly checked: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={props.checked}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
      <small>{props.checked ? "开" : ""}</small>
    </button>
  );
}

function DialogFrame(props: {
  readonly title: string;
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly onClose: () => void;
}): ReactElement {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !props.busy) props.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props.busy, props.onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.contains(document.activeElement)) return;
    dialog.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )?.focus();
  }, []);

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="git-review-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!props.busy) props.onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="git-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        aria-busy={props.busy}
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{props.title}</h2>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            disabled={props.busy}
            onClick={props.onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        {props.children}
      </section>
    </div>
  );
}

function CommitDialog(props: {
  readonly stagedCount: number;
  readonly unstagedCount: number;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCommit: (message: string, push: boolean, includeUnstaged: boolean) => void;
}): ReactElement {
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(
    props.stagedCount === 0 && props.unstagedCount > 0,
  );
  const canCommit = message.trim().length > 0 &&
    (props.stagedCount > 0 || (includeUnstaged && props.unstagedCount > 0));

  function submit(push: boolean) {
    if (canCommit && !props.busy) props.onCommit(message.trim(), push, includeUnstaged);
  }

  return (
    <DialogFrame title="提交更改" busy={props.busy} onClose={props.onClose}>
      <form className="git-review-dialog-body" onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}>
        <label>
          <span>提交说明</span>
          <textarea
            aria-label="提交说明"
            value={message}
            autoFocus
            maxLength={4096}
            disabled={props.busy}
            onChange={(event) => setMessage(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                submit(false);
              }
            }}
          />
        </label>
        <label className="git-review-checkbox-row">
          <input
            type="checkbox"
            checked={includeUnstaged}
            disabled={props.busy || props.unstagedCount === 0}
            onChange={(event) => setIncludeUnstaged(event.currentTarget.checked)}
          />
          <span>包含未暂存更改</span>
        </label>
        <p>
          将提交 {props.stagedCount} 个已暂存文件
          {includeUnstaged ? `及 ${props.unstagedCount} 个未暂存文件` : ""}。
        </p>
        <footer>
          <button className="secondary-button" type="button" disabled={props.busy} onClick={props.onClose}>取消</button>
          <button className="secondary-button" type="submit" disabled={props.busy || !canCommit}>提交</button>
          <button className="primary-button" type="button" disabled={props.busy || !canCommit} onClick={() => submit(true)}>提交并推送</button>
        </footer>
      </form>
    </DialogFrame>
  );
}

function PushDialog(props: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onPush: (forceWithLease: boolean) => void;
}): ReactElement {
  const [forceWithLease, setForceWithLease] = useState(false);
  return (
    <DialogFrame title="推送更改" busy={props.busy} onClose={props.onClose}>
      <div className="git-review-dialog-body">
        <label className="git-review-checkbox-row">
          <input
            type="checkbox"
            checked={forceWithLease}
            disabled={props.busy}
            onChange={(event) => setForceWithLease(event.currentTarget.checked)}
          />
          <span>使用 force-with-lease</span>
        </label>
        <footer>
          <button className="secondary-button" type="button" disabled={props.busy} onClick={props.onClose}>取消</button>
          <button className="primary-button" type="button" disabled={props.busy} onClick={() => props.onPush(forceWithLease)}>
            <Upload aria-hidden="true" />推送
          </button>
        </footer>
      </div>
    </DialogFrame>
  );
}

function BranchDialog(props: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreate: (name: string) => void;
}): ReactElement {
  const [name, setName] = useState("");
  return (
    <DialogFrame title="创建分支" busy={props.busy} onClose={props.onClose}>
      <form className="git-review-dialog-body" onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !props.busy) props.onCreate(name.trim());
      }}>
        <label>
          <span>分支名称</span>
          <input
            aria-label="分支名称"
            value={name}
            autoFocus
            maxLength={255}
            disabled={props.busy}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <footer>
          <button className="secondary-button" type="button" disabled={props.busy} onClick={props.onClose}>取消</button>
          <button className="primary-button" type="submit" disabled={props.busy || !name.trim()}>创建</button>
        </footer>
      </form>
    </DialogFrame>
  );
}

function InlineError({ message }: { readonly message: string }): ReactElement {
  return (
    <p className="git-review-error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

function PanelState(props: {
  readonly icon: ReactElement;
  readonly title: string;
  readonly detail?: string;
  readonly error?: boolean;
  readonly embedded?: boolean;
  readonly action?: string;
  readonly actionDisabled?: boolean;
  readonly onAction?: () => void;
}): ReactElement {
  return (
    <section
      className={`git-review-state${props.embedded ? " is-embedded" : ""}`}
      role={props.error ? "alert" : "status"}
    >
      {props.icon}
      <h2>{props.title}</h2>
      {props.detail ? <p>{props.detail}</p> : null}
      {props.action && props.onAction ? (
        <button
          className={props.error ? "secondary-button" : "primary-button"}
          type="button"
          disabled={props.actionDisabled}
          onClick={props.onAction}
        >
          {props.action}
        </button>
      ) : null}
    </section>
  );
}

function lineSign(line: DiffLine): string {
  if (line.kind === "add") return "+";
  if (line.kind === "delete") return "-";
  return "";
}

function isConflicted(entry: GitStatusEntry): boolean {
  return entry.indexStatus === "U" ||
    entry.worktreeStatus === "U" ||
    (entry.indexStatus === "A" && entry.worktreeStatus === "A") ||
    (entry.indexStatus === "D" && entry.worktreeStatus === "D");
}

function sumStats(
  entries: ReadonlyArray<GitStatusEntry>,
  statsByPath: Readonly<Record<string, DiffStats>>,
): DiffStats {
  return entries.reduce<DiffStats>(
    (total, entry) => ({
      additions: total.additions + (statsByPath[entry.path]?.additions ?? 0),
      deletions: total.deletions + (statsByPath[entry.path]?.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

function uniquePaths(entries: ReadonlyArray<GitStatusEntry>): string[] {
  return [...new Set(entries.map((entry) => entry.path))];
}

async function stagePathsInChunks(api: GitApi, cwd: string, paths: ReadonlyArray<string>) {
  for (let offset = 0; offset < paths.length; offset += 64) {
    await api.gitStage(cwd, paths.slice(offset, offset + 64));
  }
}

function isPatchContent(value: string): boolean {
  return value.length > 0 &&
    !NON_PATCH_DIFF_MESSAGES.has(value) &&
    /^(diff --git|@@ )/m.test(value);
}
