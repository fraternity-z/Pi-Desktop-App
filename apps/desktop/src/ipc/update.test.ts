import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkForUpdates } from "./update";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("checkForUpdates", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("调用 Rust 更新检查命令并返回版本信息", async () => {
    const result = {
      currentVersion: "0.1.2",
      latestVersion: "0.1.3",
      updateAvailable: true,
      releaseUrl: "https://github.com/fraternity-z/Pi-Desktop-App/releases/tag/v0.1.3",
      downloadUrl: "https://github.com/fraternity-z/Pi-Desktop-App/releases/download/v0.1.3/Pi.exe",
    };
    vi.mocked(invoke).mockResolvedValue(result);

    await expect(checkForUpdates()).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("check_for_updates");
  });

  it("保留更新服务的结构化错误", async () => {
    const error = { code: "UPDATE_CHECK_FAILED", message: "网络不可用" };
    vi.mocked(invoke).mockRejectedValue(error);

    await expect(checkForUpdates()).rejects.toEqual(error);
  });
});
