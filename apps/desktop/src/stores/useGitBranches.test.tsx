import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { gitCreateBranch, gitStatus, gitSwitchBranch, type GitStatus } from "../ipc/git";
import { getWorktreeOptions } from "../ipc/workspace";
import { useGitBranches } from "./useGitBranches";

vi.mock("../ipc/git", () => ({ gitCreateBranch: vi.fn(), gitStatus: vi.fn(), gitSwitchBranch: vi.fn() }));
vi.mock("../ipc/workspace", () => ({ getWorktreeOptions: vi.fn() }));

function status(head = "main"): GitStatus {
  return {
    isRepository: true, repoRoot: "C:\\work",
    branch: { head, upstream: null, ahead: 0, behind: 0, detached: false },
    staged: [], unstaged: [], untracked: [], conflicted: [], isClean: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const local = { name: "feature/local", current: false, remote: false };
const remote = { name: "origin/feature/remote", current: false, remote: true };

describe("useGitBranches", () => {
  beforeEach(() => {
    vi.mocked(gitStatus).mockReset().mockResolvedValue(status());
    vi.mocked(getWorktreeOptions).mockReset().mockResolvedValue({
      branches: [{ name: "main", current: true, remote: false }, local, remote], suggestedName: "unused",
    });
    vi.mocked(gitCreateBranch).mockReset().mockResolvedValue(undefined);
    vi.mocked(gitSwitchBranch).mockReset().mockResolvedValue(undefined);
  });

  it("loads current branch in StrictMode and refreshes on window focus", async () => {
    const { result } = renderHook(() => useGitBranches("C:\\work"), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.branchName).toBe("main");
    expect(result.current.branches).toHaveLength(3);
    vi.mocked(gitStatus).mockResolvedValue(status("external-change"));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.branchName).toBe("external-change"));
  });

  it("does not call Git for an empty workspace or mutate while disabled", async () => {
    const { result, rerender } = renderHook(({ cwd, disabled }) => useGitBranches(cwd, disabled), {
      initialProps: { cwd: "", disabled: false },
    });
    await act(() => result.current.refresh());
    await act(async () => { expect(await result.current.create("test")).toBe(false); });
    expect(gitStatus).not.toHaveBeenCalled();
    rerender({ cwd: "C:\\work", disabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { expect(await result.current.switchTo(local)).toBe(false); });
    expect(gitCreateBranch).not.toHaveBeenCalled();
    expect(gitSwitchBranch).not.toHaveBeenCalled();
  });

  it("distinguishes non-repositories, unborn branches and detached HEAD", async () => {
    vi.mocked(gitStatus).mockResolvedValue({ ...status(), isRepository: false, branch: null });
    const { result } = renderHook(() => useGitBranches("C:\\work"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isRepository).toBe(false);
    expect(result.current.branchName).toBeNull();
    expect(getWorktreeOptions).not.toHaveBeenCalled();
    vi.mocked(gitStatus).mockResolvedValue(status("unborn"));
    vi.mocked(getWorktreeOptions).mockResolvedValue({ branches: [], suggestedName: "unused" });
    await act(() => result.current.refresh());
    expect(result.current.branchName).toBe("unborn");
    vi.mocked(gitStatus).mockResolvedValue({ ...status(), branch: { ...status().branch!, detached: true, head: null } });
    await act(() => result.current.refresh());
    expect(result.current.branchName).toBe("分离 HEAD");
  });

  it("creates a trimmed branch and refreshes the actual current branch", async () => {
    const { result } = renderHook(() => useGitBranches("C:\\work"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(gitStatus).mockResolvedValue(status("feature/new"));
    await act(async () => { expect(await result.current.create("  feature/new  ")).toBe(true); });
    expect(gitCreateBranch).toHaveBeenCalledWith("C:\\work", "feature/new");
    expect(result.current.branchName).toBe("feature/new");
    expect(result.current.busy).toBe(false);
  });

  it("switches local and remote branches but ignores the current branch", async () => {
    const { result } = renderHook(() => useGitBranches("C:\\work"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.switchTo({ ...local, current: true }));
    expect(gitSwitchBranch).not.toHaveBeenCalled();
    await act(() => result.current.switchTo(local));
    await act(() => result.current.switchTo(remote));
    expect(gitSwitchBranch).toHaveBeenNthCalledWith(1, "C:\\work", local.name, false);
    expect(gitSwitchBranch).toHaveBeenNthCalledWith(2, "C:\\work", remote.name, true);
  });

  it("blocks duplicate same-tick mutations and refreshes during a mutation", async () => {
    const pending = deferred<void>();
    vi.mocked(gitSwitchBranch).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useGitBranches("C:\\work"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let operation!: Promise<boolean>;
    await act(async () => {
      operation = result.current.switchTo(local);
      expect(await result.current.create("duplicate")).toBe(false);
      await result.current.refresh();
    });
    expect(result.current.busy).toBe(true);
    expect(gitStatus).toHaveBeenCalledTimes(1);
    expect(gitCreateBranch).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); await operation; });
    expect(result.current.busy).toBe(false);
  });

  it.each([
    ["GIT_BRANCH_NAME_INVALID", "分支名称无效"],
    ["GIT_BRANCH_CREATE_FAILED", "创建分支失败"],
    ["GIT_BRANCH_NOT_FOUND", "目标分支已不存在"],
    ["GIT_BRANCH_SWITCH_FAILED", "不会强制覆盖"],
    ["UNKNOWN", "Git 分支操作失败"],
  ])("sanitizes %s errors and keeps the current branch", async (code, message) => {
    const { result } = renderHook(() => useGitBranches("C:\\work"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(gitSwitchBranch).mockRejectedValue({ code, message: "private diagnostics" });
    await act(async () => { expect(await result.current.switchTo(local)).toBe(false); });
    expect(result.current.error).toContain(message);
    expect(result.current.error).not.toContain("private diagnostics");
    expect(result.current.branchName).toBe("main");
    expect(result.current.busy).toBe(false);
  });

  it("retries list errors and distinguishes completed mutations from reload failures", async () => {
    vi.mocked(getWorktreeOptions).mockRejectedValueOnce(Error("private"));
    const { result } = renderHook(() => useGitBranches("C:\\work"));
    await waitFor(() => expect(result.current.error).toContain("无法读取"));
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
    vi.mocked(gitStatus).mockRejectedValueOnce(Error("private"));
    await act(async () => { expect(await result.current.create("new")).toBe(false); });
    expect(result.current.error).toContain("操作已完成");
  });

  it("ignores older reads after changing workspaces", async () => {
    const pending = deferred<GitStatus>();
    vi.mocked(gitStatus).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ cwd }) => useGitBranches(cwd), { initialProps: { cwd: "C:\\old" } });
    rerender({ cwd: "C:\\new" });
    await waitFor(() => expect(result.current.branchName).toBe("main"));
    await act(async () => { pending.resolve(status("old-branch")); });
    expect(result.current.branchName).toBe("main");
    expect(getWorktreeOptions).toHaveBeenCalledWith("C:\\new");
    expect(getWorktreeOptions).not.toHaveBeenCalledWith("C:\\old");
  });

  it("ignores stale mutations and allows the next workspace to operate", async () => {
    const pending = deferred<void>();
    vi.mocked(gitSwitchBranch).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ cwd }) => useGitBranches(cwd), { initialProps: { cwd: "C:\\old" } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let operation!: Promise<boolean>;
    act(() => { operation = result.current.switchTo(local); });
    rerender({ cwd: "C:\\new" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { pending.resolve(); expect(await operation).toBe(false); });
    expect(result.current.busy).toBe(false);
    await act(() => result.current.create("new-workspace"));
    expect(gitCreateBranch).toHaveBeenCalledWith("C:\\new", "new-workspace");
  });
});
