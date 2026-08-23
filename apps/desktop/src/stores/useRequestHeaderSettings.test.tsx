import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestHeaderSettings, updateRequestHeaderSettings } from "../ipc/settings";
import { useRequestHeaderSettings } from "./useRequestHeaderSettings";

vi.mock("../ipc/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/settings")>()),
  getRequestHeaderSettings: vi.fn(),
  updateRequestHeaderSettings: vi.fn(),
}));

describe("useRequestHeaderSettings", () => {
  beforeEach(() => {
    vi.mocked(getRequestHeaderSettings)
      .mockReset()
      .mockResolvedValue({ enabled: false, client: "claude-code" });
    vi.mocked(updateRequestHeaderSettings).mockReset();
  });

  it("加载持久化设置并提交完整的新状态", async () => {
    vi.mocked(updateRequestHeaderSettings).mockResolvedValue({ enabled: true, client: "codex" });
    const { result } = renderHook(() => useRequestHeaderSettings());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(() => result.current.update({ enabled: true, client: "codex" }));

    expect(updateRequestHeaderSettings).toHaveBeenCalledWith({ enabled: true, client: "codex" });
    expect(result.current).toMatchObject({
      phase: "ready",
      settings: { enabled: true, client: "codex" },
      saving: false,
      error: null,
    });
  });

  it("保存失败时回滚并保留稳定错误", async () => {
    vi.mocked(updateRequestHeaderSettings).mockRejectedValue({
      code: "REQUEST_HEADERS_UNSUPPORTED",
      message: "当前 Pi SDK 不支持请求头扩展",
    });
    const { result } = renderHook(() => useRequestHeaderSettings());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(() => result.current.update({ enabled: true }));

    expect(result.current.settings.enabled).toBe(false);
    expect(result.current.error).toBe(
      "REQUEST_HEADERS_UNSUPPORTED: 当前 Pi SDK 不支持请求头扩展",
    );
  });

  it("读取失败后允许重新加载", async () => {
    vi.mocked(getRequestHeaderSettings)
      .mockReset()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ enabled: true, client: "claude-code" });
    const { result } = renderHook(() => useRequestHeaderSettings());
    await waitFor(() => expect(result.current).toMatchObject({ phase: "error", error: "offline" }));

    await act(() => result.current.refresh());

    expect(result.current).toMatchObject({
      phase: "ready",
      settings: { enabled: true, client: "claude-code" },
      error: null,
    });
  });
});
