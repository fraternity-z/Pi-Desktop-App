import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceState {
  recentWorkspaces: string[];
  lastWorkspace: string | null;
  conversationHome: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface WorktreeOptions {
  branches: GitBranchInfo[];
  suggestedName: string;
}

export interface CreateWorktreeInput {
  cwd: string;
  base: string;
  name?: string | null;
}

export interface CreatedWorktree {
  path: string;
}

export interface WorkspacePathMatch {
  path: string;
  relativePath: string;
  kind: "file" | "folder";
}

export interface WorkspaceFileContent {
  dataBase64: string;
  size: number;
}

export async function getWorkspaceState(): Promise<WorkspaceState> {
  return invoke<WorkspaceState>("workspace_get_state");
}

export async function rememberWorkspace(cwd: string): Promise<WorkspaceState> {
  return invoke<WorkspaceState>("workspace_remember", { cwd });
}

export async function removeRecentWorkspace(cwd: string): Promise<WorkspaceState> {
  return invoke<WorkspaceState>("workspace_remove_recent", { cwd });
}

export async function ensureConversationWorkspace(): Promise<string> {
  return invoke<string>("workspace_ensure_conversation");
}

export async function revealWorkspace(cwd: string): Promise<void> {
  return invoke<void>("workspace_reveal", { cwd });
}

export async function readWorkspaceFile(cwd: string, path: string): Promise<WorkspaceFileContent> {
  return invoke<WorkspaceFileContent>("workspace_read_file", { cwd, path });
}

export async function openWorkspaceFile(cwd: string, path: string): Promise<void> {
  return invoke<void>("workspace_open_file", { cwd, path });
}

export async function revealWorkspaceFile(cwd: string, path: string): Promise<void> {
  return invoke<void>("workspace_reveal_file", { cwd, path });
}

export async function searchWorkspacePaths(
  cwd: string,
  query: string,
  limit = 24,
): Promise<WorkspacePathMatch[]> {
  return invoke<WorkspacePathMatch[]>("workspace_search_paths", { cwd, query, limit });
}

export async function getWorktreeOptions(cwd: string): Promise<WorktreeOptions> {
  return invoke<WorktreeOptions>("workspace_get_worktree_options", { cwd });
}

export async function createWorkspaceWorktree(
  input: CreateWorktreeInput,
): Promise<CreatedWorktree> {
  return invoke<CreatedWorktree>("workspace_create_worktree", { input });
}
