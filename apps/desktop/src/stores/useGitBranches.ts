import { useCallback, useEffect, useRef, useState } from "react";

import { gitCreateBranch, gitStatus, gitSwitchBranch } from "../ipc/git";
import { getWorktreeOptions, type GitBranchInfo } from "../ipc/workspace";

export interface GitBranchesState {
  readonly branchName: string | null;
  readonly isRepository: boolean | null;
  readonly branches: readonly GitBranchInfo[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly create: (name: string) => Promise<boolean>;
  readonly switchTo: (branch: GitBranchInfo) => Promise<boolean>;
}

interface BranchScope {
  readonly cwd: string;
  active: boolean;
  pending: boolean;
  readVersion: number;
}

export function useGitBranches(cwd: string, disabled = false): GitBranchesState {
  const [branchName, setBranchName] = useState<string | null>(null);
  const [isRepository, setIsRepository] = useState<boolean | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef<BranchScope | null>(null);

  const load = useCallback(async (scope: BranchScope): Promise<boolean> => {
    const version = ++scope.readVersion;
    const isCurrent = () => scope.active && scopeRef.current === scope && version === scope.readVersion;
    setLoading(true);
    setError(null);
    try {
      const status = await gitStatus(scope.cwd);
      if (!isCurrent()) return false;
      setIsRepository(status.isRepository);
      setBranchName(status.branch?.detached ? "分离 HEAD" : status.branch?.head ?? null);
      const options = status.isRepository ? await getWorktreeOptions(scope.cwd) : null;
      if (!isCurrent()) return false;
      setBranches(options?.branches ?? []);
      return true;
    } catch {
      if (isCurrent()) setError("无法读取 Git 分支，请检查 Git 是否可用后刷新重试。");
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope?.active || scope.cwd !== cwd || scope.pending || !cwd) return;
    await load(scope);
  }, [cwd, load]);

  useEffect(() => {
    const scope: BranchScope = { cwd, active: true, pending: false, readVersion: 0 };
    scopeRef.current = scope;
    setBranchName(null);
    setIsRepository(null);
    setBranches([]);
    setError(null);
    setBusy(false);
    setLoading(false);
    if (cwd) void load(scope);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      scope.active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [cwd, load, refresh]);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    const scope = scopeRef.current;
    if (!cwd || disabled || !scope?.active || scope.cwd !== cwd || scope.pending) return false;
    scope.pending = true;
    scope.readVersion += 1;
    setBusy(true);
    setLoading(false);
    setError(null);
    try {
      await action();
      if (!scope.active || scopeRef.current !== scope) return false;
      const loaded = await load(scope);
      if (!scope.active || scopeRef.current !== scope) return false;
      if (!loaded) setError("分支操作已完成，但状态刷新失败，请刷新确认当前分支。");
      return loaded;
    } catch (cause) {
      if (scope.active && scopeRef.current === scope) setError(branchError(cause));
      return false;
    } finally {
      scope.pending = false;
      if (scope.active && scopeRef.current === scope) setBusy(false);
    }
  }, [cwd, disabled, load]);

  return {
    branchName, isRepository, branches, loading, busy, error, refresh,
    create: (name) => run(() => gitCreateBranch(cwd, name.trim())),
    switchTo: (branch) => branch.current
      ? Promise.resolve(false)
      : run(() => gitSwitchBranch(cwd, branch.name, branch.remote)),
  };
}

function branchError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  switch (code) {
    case "GIT_BRANCH_NAME_INVALID":
      return "分支名称无效：不能包含空格、..、~、^、:、?、*、[ 或反斜杠，不能以 - 开头。";
    case "GIT_BRANCH_CREATE_FAILED":
      return "创建分支失败：请检查名称是否已存在或与已有分支路径冲突。";
    case "GIT_BRANCH_NOT_FOUND":
      return "目标分支已不存在，请刷新分支列表。";
    case "GIT_BRANCH_SWITCH_FAILED":
      return "无法切换分支：请检查未提交改动、同名本地分支或其他工作树占用。不会强制覆盖你的改动。";
    default:
      return "Git 分支操作失败，请检查仓库状态后重试。";
  }
}
