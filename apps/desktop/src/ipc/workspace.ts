import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceState {
  recentWorkspaces: string[];
  lastWorkspace: string | null;
  conversationHome: string;
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
