import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROXY_SETTINGS,
  getProxySettings,
  updateProxySettings,
  type ProxySettings,
} from "../ipc/proxy";
import { useProxySettings } from "./useProxySettings";

vi.mock("../ipc/proxy", async (original) => ({
  ...(await original<typeof import("../ipc/proxy")>()),
  getProxySettings: vi.fn(),
  updateProxySettings: vi.fn(),
}));
describe("useProxySettings", () => {
  beforeEach(() => {
    vi.mocked(getProxySettings)
      .mockReset()
      .mockResolvedValue(DEFAULT_PROXY_SETTINGS);
    vi.mocked(updateProxySettings).mockReset();
  });
  it("handles StrictMode and preserves drafts on sanitized failure", async () => {
    const { result } = renderHook(useProxySettings, { wrapper: StrictMode });
    await waitFor(() => expect(result.current.busy).toBe(false));
    act(() =>
      result.current.setDraft({
        ...DEFAULT_PROXY_SETTINGS,
        ai: { mode: "direct", url: "", noProxy: "" },
      }),
    );
    vi.mocked(updateProxySettings).mockRejectedValueOnce(Error("private"));
    await act(() => result.current.save());
    expect(result.current.error).toContain("保存失败");
    expect(result.current.error).not.toContain("private");
    expect(result.current.draft.ai.mode).toBe("direct");
    act(() =>
      result.current.setDraft({
        ...DEFAULT_PROXY_SETTINGS,
        ai: { mode: "custom", url: "", noProxy: "" },
      }),
    );
    await act(() => result.current.save());
    expect(updateProxySettings).toHaveBeenCalledOnce();
  });
  it("prevents duplicate mutations and ignores completion after unmount", async () => {
    const { result, unmount } = renderHook(useProxySettings);
    await waitFor(() => expect(result.current.busy).toBe(false));
    let resolve!: (settings: ProxySettings) => void;
    vi.mocked(updateProxySettings).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.save();
    });
    await act(async () => {
      await result.current.save();
      await result.current.refresh();
    });
    expect(updateProxySettings).toHaveBeenCalledOnce();
    unmount();
    await act(async () => {
      resolve(DEFAULT_PROXY_SETTINGS);
      await saving;
    });
  });
});
