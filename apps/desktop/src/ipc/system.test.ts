import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getArchitectureStatus } from "./system";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("getArchitectureStatus", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("调用白名单命令并返回类型化状态", async () => {
    const status = {
      renderer: "ready",
      core: "ready",
      bridge: "not-started",
      protocolVersion: 1,
    };
    vi.mocked(invoke).mockResolvedValue(status);

    await expect(getArchitectureStatus()).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith("get_architecture_status");
  });

  it("保留 Rust command 的结构化错误", async () => {
    const error = { code: "CORE_UNAVAILABLE", message: "Rust Core 不可用" };
    vi.mocked(invoke).mockRejectedValue(error);

    await expect(getArchitectureStatus()).rejects.toEqual(error);
  });
});

