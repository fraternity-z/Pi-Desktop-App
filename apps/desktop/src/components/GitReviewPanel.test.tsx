import { confirm } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitDiff, GitDiffInput, GitStatus } from "../ipc/git";
import { formatGitError, GitReviewPanel } from "./GitReviewPanel";

vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));

const CWD = "C:\\repo";

const STATUS: GitStatus = {
  isRepository: true,
  repoRoot: "C:\\repo",
  branch: {
    head: "main",
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    detached: false,
  },
  staged: [
    { path: "README.md", originalPath: null, indexStatus: "A", worktreeStatus: " " },
  ],
  unstaged: [
    { path: "src/a.ts", originalPath: "src/old.ts", indexStatus: " ", worktreeStatus: "M" },
  ],
  untracked: [
    { path: "new.ts", originalPath: null, indexStatus: "?", worktreeStatus: "?" },
  ],
  conflicted: [
    { path: "conflict.ts", originalPath: null, indexStatus: "U", worktreeStatus: "U" },
  ],
  isClean: false,
};

function createApi(overrides: Record<string, unknown> = {}) {
  return {
    gitStatus: vi.fn().mockResolvedValue(STATUS),
    gitDiff: vi.fn().mockImplementation(async (input: GitDiffInput) => ({
      path: input.path ?? null,
      staged: input.staged ?? false,
      diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1,2 +1,2 @@\n-const oldName = true;\n+const newName = <script>safe</script>;\n context",
    })),
    gitStage: vi.fn().mockResolvedValue(undefined),
    gitUnstage: vi.fn().mockResolvedValue(undefined),
    gitDiscard: vi.fn().mockResolvedValue(undefined),
    gitInit: vi.fn().mockResolvedValue(undefined),
    gitCommit: vi.fn().mockResolvedValue(undefined),
    gitPush: vi.fn().mockResolvedValue(undefined),
    gitCreateBranch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("GitReviewPanel", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(confirm).mockReset().mockResolvedValue(true);
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("仅在激活且展开时读取差异，并缓存结果安全渲染", async () => {
    const api = createApi();
    const { container, rerender } = render(
      <GitReviewPanel cwd={CWD} active={false} api={api} />,
    );
    expect(api.gitStatus).not.toHaveBeenCalled();

    rerender(<GitReviewPanel cwd={CWD} active api={api} />);
    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("src/old.ts → src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("conflict.ts")).toBeInTheDocument();
    expect(api.gitDiff).not.toHaveBeenCalled();
    expect(screen.queryByText("更新中…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开 src/old.ts → src/a.ts" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(1));
    await screen.findByText("已读取 1/3 个文件 · +1 -1");
    expect(container).toHaveTextContent("<script>safe</script>");
    expect(container.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "折叠 src/old.ts → src/a.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 src/old.ts → src/a.ts" }));
    expect(api.gitDiff).toHaveBeenCalledTimes(1);
    expect(container).toHaveTextContent("<script>safe</script>");
  });

  it("大量未展开文件不会读取任何差异，只读取用户选择的文件", async () => {
    const entries = Array.from({ length: 250 }, (_, index) => ({
      path: `file-${index}.ts`, originalPath: null, indexStatus: " ", worktreeStatus: "M",
    }));
    const api = createApi({ gitStatus: vi.fn().mockResolvedValue({ ...STATUS, unstaged: entries, untracked: [], conflicted: [] }) });
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("file-249.ts");
    expect(api.gitDiff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "展开 file-123.ts" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(1));
    expect(api.gitDiff).toHaveBeenCalledWith(expect.objectContaining({ path: "file-123.ts" }));
  });

  it("刷新保留展开状态但使相同 Git 状态的旧差异失效", async () => {
    const api = createApi();
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    await screen.findByText("已读取 1/3 个文件 · +1 -1");
    fireEvent.click(screen.getByRole("button", { name: "折叠 new.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 conflict.ts" }));
    await screen.findByText("已读取 2/3 个文件 · +2 -2");
    const trigger = screen.getByRole("button", { name: "折叠 conflict.ts" });
    api.gitDiff.mockImplementation(async (input: GitDiffInput) => ({
      ...diffFor(input.path ?? "changed.ts"), diff: "@@ -1 +1 @@\n-before refresh\n+updated after refresh",
    }));
    fireEvent.click(screen.getByRole("button", { name: "差异操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新" }));
    expect(await screen.findByText("updated after refresh")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "折叠 conflict.ts" })).toBe(trigger);
    expect(api.gitDiff).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "展开 new.ts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(4));
    expect(api.gitDiff).toHaveBeenLastCalledWith(expect.objectContaining({ path: "new.ts" }));
  });

  it("刷新期间保留展开卡片并忽略较早请求的迟到结果", async () => {
    let resolveOld: ((value: GitDiff) => void) | undefined;
    const api = createApi();
    api.gitDiff.mockImplementationOnce(() => new Promise<GitDiff>((resolve) => { resolveOld = resolve; }));
    const { container } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "差异操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新" }));
    await screen.findByText("已读取 1/3 个文件 · +1 -1");
    await act(async () => resolveOld?.({ ...diffFor("new.ts"), diff: "@@ -1 +1 @@\n-stale revision\n+wrong revision" }));
    expect(api.gitDiff).toHaveBeenCalledTimes(2);
    expect(container).not.toHaveTextContent("wrong revision");
    expect(container).toHaveTextContent("<script>safe</script>");
    expect(screen.getByRole("button", { name: "折叠 new.ts" })).toBeInTheDocument();
  });

  it("失败只影响展开文件并允许重试", async () => {
    const api = createApi();
    api.gitDiff.mockRejectedValueOnce({ code: "GIT_DIFF_FAILED", message: "temporary failure" });
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("GIT_DIFF_FAILED: temporary failure");
    expect(api.gitDiff).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText("已读取 1/3 个文件 · +1 -1");
    expect(api.gitDiff).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("范围切换后忽略迟到差异和统计，返回原范围重新读取", async () => {
    let resolveOld: ((value: GitDiff) => void) | undefined;
    const api = createApi();
    api.gitDiff.mockImplementationOnce(() => new Promise<GitDiff>((resolve) => { resolveOld = resolve; }));
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /未暂存/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /已暂存/ }));
    await act(async () => resolveOld?.({ ...diffFor("new.ts"), diff: "@@ -1 +1 @@\n-late scope\n+wrong scope" }));
    expect(screen.queryByText("wrong scope")).toBeNull();
    expect(screen.getByText("展开文件查看差异")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 README.md" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(2));
    expect(api.gitDiff).toHaveBeenLastCalledWith(expect.objectContaining({ path: "README.md", staged: true }));
    fireEvent.click(screen.getByRole("button", { name: /已暂存/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /未暂存/ }));
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(3));
  });

  it("停用面板后丢弃在途结果且不读取差异", async () => {
    let resolveOld: ((value: GitDiff) => void) | undefined;
    const api = createApi();
    api.gitDiff.mockImplementationOnce(() => new Promise<GitDiff>((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(1));
    rerender(<GitReviewPanel cwd={CWD} active={false} api={api} />);
    await act(async () => resolveOld?.(diffFor("stale inactive.ts")));
    expect(screen.queryByText(/stale inactive/)).toBeNull();
    expect(api.gitDiff).toHaveBeenCalledTimes(1);
    rerender(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "折叠 new.ts" })).toBeInTheDocument();
  });

  it("隐藏重开保留已完成差异缓存与展开状态", async () => {
    const api = createApi();
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    await screen.findByText("已读取 1/3 个文件 · +1 -1");
    const expanded = screen.getByRole("button", { name: "折叠 new.ts" });
    rerender(<GitReviewPanel cwd={CWD} active={false} api={api} />);
    rerender(<GitReviewPanel cwd={CWD} api={api} />);
    expect(screen.getByRole("button", { name: "折叠 new.ts" })).toBe(expanded);
    expect(api.gitStatus).toHaveBeenCalledTimes(1);
    expect(api.gitDiff).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已读取 1/3 个文件 · +1 -1")).toBeInTheDocument();
  });

  it.each([false, true])("隐藏重开期间的暂存完成仍刷新缓存，失败=%s", async (fails) => {
    let finish: (() => void) | undefined;
    const api = createApi({ gitStage: vi.fn(() => new Promise<void>((resolve, reject) => {
      finish = () => fails ? reject(new Error("stage failed")) : resolve();
    })) });
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "暂存 new.ts" }));
    rerender(<GitReviewPanel cwd={CWD} active={false} api={api} />);
    rerender(<GitReviewPanel cwd={CWD} api={api} />);
    await waitFor(() => expect(api.gitStatus).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "暂存 new.ts" })).toBeDisabled();
    api.gitStatus.mockResolvedValue({ ...STATUS, untracked: [] });
    await act(async () => finish?.());
    await waitFor(() => expect(api.gitStatus).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("new.ts")).toBeNull();
    expect(screen.getByRole("button", { name: "暂存 src/a.ts" })).toBeEnabled();
    if (fails) expect(screen.getByRole("alert")).toHaveTextContent("stage failed");
  });

  it("旧工作区完成的操作不会刷新或解锁新工作区", async () => {
    let finish: (() => void) | undefined;
    const api = createApi({ gitStage: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) });
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "暂存 new.ts" }));
    rerender(<GitReviewPanel cwd="D:\other" api={api} />);
    await waitFor(() => expect(api.gitStatus).toHaveBeenCalledTimes(2));
    await act(async () => finish?.());
    expect(api.gitStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText("new.ts")).toBeInTheDocument();
  });

  it("大差异分页保持渲染行数受限并可访问最后一行及上下文", async () => {
    const diff = ["@@ -1,10 +1,610 @@", ...Array.from({ length: 10 }, (_, index) => ` context-${index}`), ...Array.from({ length: 600 }, (_, index) => `+added-${index}`)].join("\n");
    const api = createApi({ gitDiff: vi.fn().mockResolvedValue({ ...diffFor("new.ts"), diff }) });
    const { container } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    fireEvent.click(screen.getByRole("button", { name: "展开 new.ts" }));
    const visibleContent = () => [...container.querySelectorAll(".git-review-code-content")].map((node) => node.textContent);
    await waitFor(() => expect(visibleContent()).toContain("added-0"));
    expect(container.querySelectorAll(".git-review-code-row")).toHaveLength(200);
    expect(visibleContent()).not.toContain("added-599");
    for (let page = 0; page < 3; page += 1) fireEvent.click(screen.getByRole("button", { name: "下一页差异" }));
    expect(visibleContent()).toContain("added-599");
    expect(container.querySelectorAll(".git-review-code-row").length).toBeLessThanOrEqual(200);
    expect(screen.getByRole("button", { name: "下一页差异" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "显示全部上下文" }));
    expect(visibleContent()).toContain("context-4");
    fireEvent.click(screen.getByRole("button", { name: "切换到拆分布局" }));
    expect(container.querySelectorAll(".git-review-code-row").length).toBeLessThanOrEqual(400);
    expect(api.gitDiff).toHaveBeenCalledTimes(1);
  });

  it("切换范围并执行暂存、取消暂存、还原与未跟踪删除", async () => {
    const api = createApi();
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "暂存 src/a.ts" }));
    await waitFor(() => expect(api.gitStage).toHaveBeenCalledWith("C:\\repo", ["src/a.ts"]));
    fireEvent.click(screen.getByRole("button", { name: "还原 src/a.ts" }));
    await waitFor(() => expect(api.gitDiscard).toHaveBeenCalledWith("C:\\repo", ["src/a.ts"], false));
    fireEvent.click(screen.getByRole("button", { name: "删除 new.ts" }));
    await waitFor(() => expect(api.gitDiscard).toHaveBeenCalledWith("C:\\repo", ["new.ts"], true));

    fireEvent.click(screen.getByRole("button", { name: /未暂存/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /已暂存/ }));
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消暂存 README.md" }));
    await waitFor(() => expect(api.gitUnstage).toHaveBeenCalledWith("C:\\repo", ["README.md"]));
  });

  it("让显示菜单、真实 split、词级差异、空白过滤、折叠与复制命令生效", async () => {
    const api = createApi();
    const { container } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    expandAllFiles();
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "差异操作" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "启用自动换行" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "启用文字差异" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "隐藏空白字符" }));
    await waitFor(() =>
      expect(api.gitDiff).toHaveBeenCalledWith(expect.objectContaining({
        ignoreWhitespaceChanges: true,
      })),
    );
    expect(container.querySelector(".git-review-word-change")).not.toBeNull();
    expect(container.querySelector(".git-review-code-frame.is-wrapped")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "切换到拆分布局" }));
    expect(container.querySelector(".git-review-code-frame.is-split")).not.toBeNull();
    expect(container.querySelectorAll(".git-review-split-pane")).toHaveLength(6);

    fireEvent.click(screen.getByRole("menuitem", { name: "复制 git apply 命令" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]?.[0]).toContain("git apply --whitespace=nowarn");

    fireEvent.click(screen.getByRole("button", { name: "差异操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "折叠全部差异" }));
    expect(container.querySelector(".git-review-file-body")).toBeNull();
  });

  it("提交时真正包含未暂存文件，并支持提交后推送", async () => {
    const api = createApi();
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "Git 操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "提交" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "包含未暂存更改" }));
    fireEvent.change(screen.getByRole("textbox", { name: "提交说明" }), {
      target: { value: "fix: review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交并推送" }));

    await waitFor(() =>
      expect(api.gitStage).toHaveBeenCalledWith("C:\\repo", [
        "src/a.ts",
        "new.ts",
        "conflict.ts",
      ]),
    );
    expect(api.gitCommit).toHaveBeenCalledWith("C:\\repo", "fix: review");
    expect(api.gitPush).toHaveBeenCalledWith("C:\\repo");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "提交更改" })).toBeNull());
  });

  it("提交成功后即关闭对话框，后续推送失败不会重复提交", async () => {
    const api = createApi({
      gitPush: vi.fn().mockRejectedValue({
        code: "GIT_PUSH_FAILED",
        message: "远端拒绝推送",
      }),
    });
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "Git 操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "提交" }));
    fireEvent.change(screen.getByRole("textbox", { name: "提交说明" }), {
      target: { value: "fix: one commit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交并推送" }));

    await waitFor(() => expect(api.gitCommit).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "提交更改" })).toBeNull());
    expect(await screen.findByRole("alert")).toHaveTextContent("GIT_PUSH_FAILED: 远端拒绝推送");
    expect(api.gitCommit).toHaveBeenCalledTimes(1);
  });

  it("将文件差异请求限制为四个并发任务", async () => {
    const entries = Array.from({ length: 9 }, (_, index) => ({
      path: `file-${index}.ts`,
      originalPath: null,
      indexStatus: " ",
      worktreeStatus: "M",
    }));
    const pending: Array<(value: GitDiff) => void> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const gitDiff = vi.fn((input: GitDiffInput) => new Promise<GitDiff>((resolve) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      pending.push((value) => {
        activeRequests -= 1;
        resolve(value);
      });
    }));
    const api = createApi({
      gitStatus: vi.fn().mockResolvedValue({
        ...STATUS,
        staged: [],
        unstaged: entries,
        untracked: [],
        conflicted: [],
      }),
      gitDiff,
    });
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("file-0.ts");
    expect(gitDiff).not.toHaveBeenCalled();
    expandAllFiles();

    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(4));
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve(diffFor("wave-one.ts")));
    });
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(8));
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve(diffFor("wave-two.ts")));
    });
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(9));
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve(diffFor("wave-three.ts")));
    });

    expect(maxActiveRequests).toBe(4);
  });

  it("切换工作区后跳过尚未启动的旧差异任务", async () => {
    const oldEntries = Array.from({ length: 9 }, (_, index) => ({
      path: `old-${index}.ts`,
      originalPath: null,
      indexStatus: " ",
      worktreeStatus: "M",
    }));
    const pending: Array<(value: GitDiff) => void> = [];
    const gitDiff = vi.fn((input: GitDiffInput) => new Promise<GitDiff>((resolve) => {
      pending.push(resolve);
    }));
    const api = createApi({
      gitStatus: vi.fn().mockImplementation(async (cwd: string) => ({
        ...STATUS,
        staged: [],
        unstaged: cwd === CWD
          ? oldEntries
          : [{ path: "new-workspace.ts", originalPath: null, indexStatus: " ", worktreeStatus: "M" }],
        untracked: [],
        conflicted: [],
      })),
      gitDiff,
    });
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("old-0.ts");
    expandAllFiles();
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(4));

    rerender(<GitReviewPanel cwd={"D:\\another-repo"} api={api} />);
    await screen.findByText("new-workspace.ts");
    expandAllFiles();
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve(diffFor("old-running.ts")));
    });
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(5));

    expect(gitDiff.mock.calls.filter(([input]) => input.cwd === CWD)).toHaveLength(4);
    expect(gitDiff).toHaveBeenLastCalledWith(expect.objectContaining({
      cwd: "D:\\another-repo",
      path: "new-workspace.ts",
    }));
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve(diffFor("new-workspace.ts")));
    });
  });

  it("工作区 A-B-A 往返时仍按 generation 丢弃第一代队列", async () => {
    const oldEntries = Array.from({ length: 9 }, (_, index) => ({
      path: `first-a-${index}.ts`,
      originalPath: null,
      indexStatus: " ",
      worktreeStatus: "M",
    }));
    const pending: Array<(value: GitDiff) => void> = [];
    let statusCalls = 0;
    const gitDiff = vi.fn((input: GitDiffInput) => new Promise<GitDiff>((resolve) => {
      pending.push(resolve);
    }));
    const api = createApi({
      gitStatus: vi.fn().mockImplementation(async (cwd: string) => {
        statusCalls += 1;
        const unstaged = statusCalls === 1
          ? oldEntries
          : cwd === CWD
            ? [{ path: "second-a.ts", originalPath: null, indexStatus: " ", worktreeStatus: "M" }]
            : [{ path: "workspace-b.ts", originalPath: null, indexStatus: " ", worktreeStatus: "M" }];
        return { ...STATUS, staged: [], unstaged, untracked: [], conflicted: [] };
      }),
      gitDiff,
    });
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("first-a-0.ts");
    expandAllFiles();
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(4));

    rerender(<GitReviewPanel cwd={"D:\\workspace-b"} api={api} />);
    await screen.findByText("workspace-b.ts");
    expandAllFiles();
    rerender(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("second-a.ts");
    expandAllFiles();
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve(diffFor("first-a-running.ts")));
    });
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(5));

    expect(gitDiff).toHaveBeenLastCalledWith(expect.objectContaining({
      cwd: CWD,
      path: "second-a.ts",
    }));
    expect(gitDiff).not.toHaveBeenCalledWith(expect.objectContaining({ path: "workspace-b.ts" }));
    expect(gitDiff).not.toHaveBeenCalledWith(expect.objectContaining({ path: "first-a-8.ts" }));
    await act(async () => {
      pending.splice(0).forEach((resolve) => resolve(diffFor("second-a.ts")));
    });
  });

  it("工作区变化后丢弃仍在读取的旧补丁", async () => {
    const api = createApi();
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    expect(api.gitDiff).not.toHaveBeenCalled();

    let resolveOldPatch: ((value: GitDiff) => void) | undefined;
    api.gitDiff.mockImplementationOnce(() => new Promise<GitDiff>((resolve) => {
      resolveOldPatch = resolve;
    }));
    fireEvent.click(screen.getByRole("button", { name: "差异操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制 git apply 命令" }));
    await waitFor(() => expect(api.gitDiff).toHaveBeenCalledTimes(1));

    rerender(<GitReviewPanel cwd={"D:\\another-repo"} api={api} />);
    resolveOldPatch?.(diffFor("old.ts"));
    await waitFor(() => expect(api.gitStatus).toHaveBeenCalledWith("D:\\another-repo"));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("菜单支持方向键，弹窗约束焦点并在关闭后恢复触发按钮", async () => {
    const api = createApi();
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "差异操作" }));
    const displayMenu = screen.getByRole("menu", { name: "差异操作" });
    expect(screen.getByRole("menuitem", { name: "刷新" })).toHaveFocus();
    fireEvent.keyDown(displayMenu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitemcheckbox", { name: "启用自动换行" })).toHaveFocus();
    fireEvent.keyDown(displayMenu, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "差异操作" })).toHaveFocus());

    const gitTrigger = screen.getByRole("button", { name: "Git 操作" });
    fireEvent.click(gitTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "提交" }));
    const dialog = screen.getByRole("dialog", { name: "提交更改" });
    fireEvent.change(screen.getByRole("textbox", { name: "提交说明" }), {
      target: { value: "test focus" },
    });
    const lastButton = screen.getByRole("button", { name: "提交并推送" });
    lastButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(gitTrigger).toHaveFocus());
  });

  it("推送 force-with-lease、创建分支，并在忙碌时保持对话框", async () => {
    let resolvePush: (() => void) | undefined;
    const api = createApi({
      gitPush: vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolvePush = resolve;
      })),
    });
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");

    fireEvent.click(screen.getByRole("button", { name: "Git 操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "推送" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "使用 force-with-lease" }));
    fireEvent.click(screen.getByRole("button", { name: "推送" }));
    fireEvent.mouseDown(document.querySelector(".git-review-dialog-backdrop")!);
    expect(screen.getByRole("dialog", { name: "推送更改" })).toBeInTheDocument();
    resolvePush?.();
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith("C:\\repo", true));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "推送更改" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Git 操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "创建分支" }));
    fireEvent.change(screen.getByRole("textbox", { name: "分支名称" }), {
      target: { value: "feature/review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() =>
      expect(api.gitCreateBranch).toHaveBeenCalledWith("C:\\repo", "feature/review"),
    );
  });

  it("取消破坏性确认时不调用删除或刷新", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false);
    const api = createApi();
    render(<GitReviewPanel cwd={CWD} api={api} />);
    await screen.findByText("main");
    const statusCalls = api.gitStatus.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "删除 new.ts" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(api.gitDiscard).not.toHaveBeenCalled();
    expect(api.gitStatus).toHaveBeenCalledTimes(statusCalls);
  });

  it("处理非仓库、状态失败、差异失败与清洁工作区", async () => {
    const noRepoStatus: GitStatus = { ...STATUS, isRepository: false };
    const noRepo = createApi({ gitStatus: vi.fn().mockResolvedValue(noRepoStatus) });
    const { rerender } = render(<GitReviewPanel cwd={CWD} api={noRepo} />);
    fireEvent.click(await screen.findByRole("button", { name: "初始化 Git 仓库" }));
    await waitFor(() => expect(noRepo.gitInit).toHaveBeenCalledWith("C:\\repo"));

    const failed = createApi({
      gitStatus: vi.fn().mockRejectedValue({ code: "GIT_DENIED", message: "无权限" }),
    });
    rerender(<GitReviewPanel cwd={CWD} api={failed} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("GIT_DENIED: 无权限");

    const diffFailed = createApi({ gitDiff: vi.fn().mockRejectedValue(new Error("差异失败")) });
    rerender(<GitReviewPanel cwd={CWD} api={diffFailed} />);
    await screen.findByText("main");
    expandAllFiles();
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.getAllByText("差异失败")).not.toHaveLength(0);

    const clean = createApi({
      gitStatus: vi.fn().mockResolvedValue({
        ...STATUS,
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
        isClean: true,
      }),
    });
    rerender(<GitReviewPanel cwd={CWD} api={clean} />);
    expect(await screen.findByText("当前分组没有可展示的差异")).toBeInTheDocument();
  });

  it("格式化结构化、普通与未知错误", () => {
    expect(formatGitError({ code: "X", message: "y" })).toBe("X: y");
    expect(formatGitError(new Error("broken"))).toBe("broken");
    expect(formatGitError("plain")).toBe("plain");
    expect(formatGitError(null)).toContain("GIT_OPERATION_FAILED");
  });
});

function diffFor(path: string): GitDiff {
  return {
    path,
    staged: false,
    diff: `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new`,
  };
}

function expandAllFiles(): void {
  screen.getAllByRole("button", { name: /^展开 / }).forEach((button) => fireEvent.click(button));
}
