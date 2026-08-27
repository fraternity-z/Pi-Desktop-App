import { invoke } from "@tauri-apps/api/core";

export interface GitStatusEntry {
  readonly path: string;
  readonly originalPath: string | null;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

export interface GitBranchSummary {
  readonly head: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly detached: boolean;
}

export interface GitStatus {
  readonly isRepository: boolean;
  readonly repoRoot: string | null;
  readonly branch: GitBranchSummary | null;
  readonly staged: ReadonlyArray<GitStatusEntry>;
  readonly unstaged: ReadonlyArray<GitStatusEntry>;
  readonly untracked: ReadonlyArray<GitStatusEntry>;
  readonly conflicted: ReadonlyArray<GitStatusEntry>;
  readonly isClean: boolean;
}

export interface GitDiffInput {
  readonly cwd: string;
  readonly path?: string;
  readonly staged?: boolean;
  readonly ignoreWhitespaceChanges?: boolean;
}

export interface GitDiff {
  readonly path: string | null;
  readonly staged: boolean;
  readonly diff: string;
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_get_status", { cwd });
}

export async function gitDiff(input: GitDiffInput): Promise<GitDiff> {
  return invoke<GitDiff>("git_get_diff", { ...input });
}

export async function gitStage(cwd: string, paths: ReadonlyArray<string>): Promise<void> {
  return invoke<void>("git_stage", { cwd, paths });
}

export async function gitUnstage(cwd: string, paths: ReadonlyArray<string>): Promise<void> {
  return invoke<void>("git_unstage", { cwd, paths });
}

export async function gitDiscard(
  cwd: string,
  paths: ReadonlyArray<string>,
  deleteUntracked = false,
): Promise<void> {
  return invoke<void>("git_discard", { cwd, paths, deleteUntracked });
}

export async function gitInit(cwd: string): Promise<void> {
  return invoke<void>("git_init", { cwd });
}

export async function gitCommit(cwd: string, message: string): Promise<void> {
  return invoke<void>("git_commit", { cwd, message });
}

export async function gitPush(cwd: string, forceWithLease?: boolean): Promise<void> {
  return invoke<void>("git_push", {
    cwd,
    ...(forceWithLease === undefined ? {} : { forceWithLease }),
  });
}

export async function gitCreateBranch(cwd: string, name: string): Promise<void> {
  return invoke<void>("git_create_branch", { cwd, name });
}
