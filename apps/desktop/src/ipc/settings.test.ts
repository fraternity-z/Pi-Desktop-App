import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestHeaderSettings, updateRequestHeaderSettings, getPromptDocument, savePromptDocument } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("request header settings IPC", () => {
  it("uses fixed prompt kinds and preserves null for file removal and conflict checks", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: "fixture/SYSTEM.md", content: null });
    await getPromptDocument("system");
    expect(invoke).toHaveBeenCalledWith("get_prompt_document", { kind: "system" });
    await savePromptDocument("append", null, "previous");
    expect(invoke).toHaveBeenCalledWith("save_prompt_document", { kind: "append", content: null, expectedContent: "previous" });
    vi.mocked(invoke).mockRejectedValueOnce({ code: "PROMPT_CONFLICT", message: "reload" });
    await expect(savePromptDocument("system", "new", null)).rejects.toMatchObject({ code: "PROMPT_CONFLICT" });
  });
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
