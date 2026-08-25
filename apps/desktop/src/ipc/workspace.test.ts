import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkspaceWorktree,
  ensureConversationWorkspace,
  getWorkspaceState,
  getWorktreeOptions,
  rememberWorkspace,
  removeRecentWorkspace,
  revealWorkspace,
  searchWorkspacePaths,
} from "./workspace";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("workspace IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("只调用固定的工作区命令并传递规范化参数", async () => {
    const state = {
      recentWorkspaces: ["C:\\work"],
      lastWorkspace: "C:\\work",
      conversationHome: "C:\\conversations",
    };
    vi.mocked(invoke)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce({ ...state, recentWorkspaces: [] })
      .mockResolvedValueOnce("C:\\conversations")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { path: "C:\\work\\src\\main.ts", relativePath: "src/main.ts", kind: "file" },
      ])
      .mockResolvedValueOnce({
        branches: [{ name: "main", current: true, remote: false }],
        suggestedName: "work-1",
      })
      .mockResolvedValueOnce({ path: "C:\\worktrees\\work-1" });

    await expect(getWorkspaceState()).resolves.toEqual(state);
    await expect(rememberWorkspace("C:\\work")).resolves.toEqual(state);
    await expect(removeRecentWorkspace("C:\\work")).resolves.toEqual({
      ...state,
      recentWorkspaces: [],
    });
    await expect(ensureConversationWorkspace()).resolves.toBe("C:\\conversations");
    await expect(revealWorkspace("C:\\work")).resolves.toBeUndefined();
    await expect(searchWorkspacePaths("C:\\work", "main", 12)).resolves.toEqual([
      { path: "C:\\work\\src\\main.ts", relativePath: "src/main.ts", kind: "file" },
    ]);
    await expect(getWorktreeOptions("C:\\work")).resolves.toEqual({
      branches: [{ name: "main", current: true, remote: false }],
      suggestedName: "work-1",
    });
    await expect(
      createWorkspaceWorktree({ cwd: "C:\\work", base: "main", name: "work-1" }),
    ).resolves.toEqual({ path: "C:\\worktrees\\work-1" });

    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_get_state");
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_remember", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(3, "workspace_remove_recent", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(4, "workspace_ensure_conversation");
    expect(invoke).toHaveBeenNthCalledWith(5, "workspace_reveal", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(6, "workspace_search_paths", {
      cwd: "C:\\work",
      query: "main",
      limit: 12,
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "workspace_get_worktree_options", {
      cwd: "C:\\work",
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "workspace_create_worktree", {
      input: { cwd: "C:\\work", base: "main", name: "work-1" },
    });
  });
});
