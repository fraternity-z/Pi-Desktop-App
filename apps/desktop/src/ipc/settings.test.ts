import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestHeaderSettings, updateRequestHeaderSettings } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("request header settings IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("通过白名单命令读取类型化设置", async () => {
    const settings = { enabled: false, client: "claude-code" as const };
    vi.mocked(invoke).mockResolvedValue(settings);

    await expect(getRequestHeaderSettings()).resolves.toEqual(settings);
    expect(invoke).toHaveBeenCalledWith("get_request_header_settings");
  });

  it("只向固定命令提交完整设置对象", async () => {
    const settings = { enabled: true, client: "codex" as const };
    vi.mocked(invoke).mockResolvedValue(settings);

    await expect(updateRequestHeaderSettings(settings)).resolves.toEqual(settings);
    expect(invoke).toHaveBeenCalledWith("update_request_header_settings", { settings });
  });
});
