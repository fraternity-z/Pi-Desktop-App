import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitInit,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
} from "./git";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("git IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  });

  it("仅调用稳定命令并逐项传递受限参数", async () => {
    await gitStatus("C:\\repo");
    await gitDiff({
      cwd: "C:\\repo",
      path: "src/a.ts",
      staged: true,
      ignoreWhitespaceChanges: true,
    });
    await gitStage("C:\\repo", ["src/a.ts"]);
    await gitUnstage("C:\\repo", ["src/a.ts"]);
    await gitDiscard("C:\\repo", ["src/a.ts"], true);
    await gitInit("C:\\repo");
    await gitCommit("C:\\repo", "fix: a");
    await gitPush("C:\\repo", true);
    await gitCreateBranch("C:\\repo", "feature/a");

    expect(invoke).toHaveBeenNthCalledWith(1, "git_get_status", { cwd: "C:\\repo" });
    expect(invoke).toHaveBeenNthCalledWith(2, "git_get_diff", {
      cwd: "C:\\repo",
      path: "src/a.ts",
      staged: true,
      ignoreWhitespaceChanges: true,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "git_stage", {
      cwd: "C:\\repo",
      paths: ["src/a.ts"],
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "git_unstage", {
      cwd: "C:\\repo",
      paths: ["src/a.ts"],
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "git_discard", {
      cwd: "C:\\repo",
      paths: ["src/a.ts"],
      deleteUntracked: true,
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "git_init", { cwd: "C:\\repo" });
    expect(invoke).toHaveBeenNthCalledWith(7, "git_commit", {
      cwd: "C:\\repo",
      message: "fix: a",
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "git_push", {
      cwd: "C:\\repo",
      forceWithLease: true,
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "git_create_branch", {
      cwd: "C:\\repo",
      name: "feature/a",
    });
  });

  it("省略可选参数时不制造未定义字段", async () => {
    await gitDiff({ cwd: "C:\\repo" });
    await gitPush("C:\\repo");
    await gitDiscard("C:\\repo", ["README.md"]);

    expect(invoke).toHaveBeenNthCalledWith(1, "git_get_diff", { cwd: "C:\\repo" });
    expect(invoke).toHaveBeenNthCalledWith(2, "git_push", { cwd: "C:\\repo" });
    expect(invoke).toHaveBeenNthCalledWith(3, "git_discard", {
      cwd: "C:\\repo",
      paths: ["README.md"],
      deleteUntracked: false,
    });
  });
});
