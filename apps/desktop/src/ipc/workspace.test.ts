import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CLIPBOARD_IMAGE_BYTES,
  createWorkspaceWorktree,
  ensureConversationWorkspace,
  getWorkspaceState,
  getWorktreeOptions,
  openWorkspaceFile,
  readWorkspaceFile,
  rememberWorkspace,
  removeRecentWorkspace,
  revealWorkspace,
  revealWorkspaceFile,
  saveClipboardImage,
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
      .mockResolvedValueOnce({ dataBase64: "aGVsbG8=", size: 5 })
      .mockResolvedValueOnce(undefined)
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
    await expect(readWorkspaceFile("C:\\work", "src/main.ts")).resolves.toEqual({
      dataBase64: "aGVsbG8=",
      size: 5,
    });
    await expect(openWorkspaceFile("C:\\work", "src/main.ts")).resolves.toBeUndefined();
    await expect(revealWorkspaceFile("C:\\work", "src/main.ts")).resolves.toBeUndefined();
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
    expect(invoke).toHaveBeenNthCalledWith(6, "workspace_read_file", {
      cwd: "C:\\work",
      path: "src/main.ts",
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "workspace_open_file", {
      cwd: "C:\\work",
      path: "src/main.ts",
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "workspace_reveal_file", {
      cwd: "C:\\work",
      path: "src/main.ts",
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "workspace_search_paths", {
      cwd: "C:\\work",
      query: "main",
      limit: 12,
    });
    expect(invoke).toHaveBeenNthCalledWith(10, "workspace_get_worktree_options", {
      cwd: "C:\\work",
    });
    expect(invoke).toHaveBeenNthCalledWith(11, "workspace_create_worktree", {
      input: { cwd: "C:\\work", base: "main", name: "work-1" },
    });
  });

  it("将受支持的剪贴板图片作为字节写入应用缓存", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const image = {
      type: "image/png",
      size: bytes.byteLength,
      arrayBuffer: vi.fn(async () => bytes.buffer),
    } as unknown as File;
    vi.mocked(invoke).mockResolvedValueOnce("C:\\cache\\composer-attachments\\paste.png");

    await expect(saveClipboardImage(image)).resolves.toBe(
      "C:\\cache\\composer-attachments\\paste.png",
    );
    expect(invoke).toHaveBeenCalledWith("workspace_save_clipboard_image", {
      mimeType: "image/png",
      bytes: [0x89, 0x50, 0x4e, 0x47],
    });
  });

  it("在调用 Rust 前拒绝不支持的剪贴板图片类型", async () => {
    const image = {
      type: "image/svg+xml",
      size: 8,
      arrayBuffer: vi.fn(),
    } as unknown as File;

    await expect(saveClipboardImage(image)).rejects.toEqual({
      code: "PROMPT_IMAGE_TYPE_UNSUPPORTED",
      message: "仅支持 GIF、JPEG、PNG 或 WebP 图片",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("在调用 Rust 前拒绝空图片和超大图片", async () => {
    const empty = {
      type: "image/png",
      size: 0,
      arrayBuffer: vi.fn(),
    } as unknown as File;
    const oversized = {
      type: "image/webp",
      size: MAX_CLIPBOARD_IMAGE_BYTES + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File;

    await expect(saveClipboardImage(empty)).rejects.toEqual({
      code: "PROMPT_IMAGE_EMPTY",
      message: "剪贴板图片内容为空",
    });
    await expect(saveClipboardImage(oversized)).rejects.toEqual({
      code: "PROMPT_IMAGE_TOO_LARGE",
      message: "单张图片不能超过 10 MiB",
    });
    expect(empty.arrayBuffer).not.toHaveBeenCalled();
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
