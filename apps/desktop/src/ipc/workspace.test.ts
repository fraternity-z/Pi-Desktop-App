import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureConversationWorkspace,
  getWorkspaceState,
  rememberWorkspace,
  removeRecentWorkspace,
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
      .mockResolvedValueOnce("C:\\conversations");

    await expect(getWorkspaceState()).resolves.toEqual(state);
    await expect(rememberWorkspace("C:\\work")).resolves.toEqual(state);
    await expect(removeRecentWorkspace("C:\\work")).resolves.toEqual({
      ...state,
      recentWorkspaces: [],
    });
    await expect(ensureConversationWorkspace()).resolves.toBe("C:\\conversations");

    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_get_state");
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_remember", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(3, "workspace_remove_recent", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(4, "workspace_ensure_conversation");
  });
});
