import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkForUpdates } from "../ipc/update";
import { useAppUpdate } from "./useAppUpdate";

vi.mock("../ipc/update", () => ({
  checkForUpdates: vi.fn(),
}));

const availableUpdate = {
  currentVersion: "0.1.2",
  latestVersion: "0.1.3",
  updateAvailable: true,
  releaseUrl: "https://github.com/fraternity-z/Pi-Desktop-App/releases/tag/v0.1.3",
  downloadUrl: null,
};

describe("useAppUpdate", () => {
  beforeEach(() => {
    vi.mocked(checkForUpdates).mockReset();
  });

  it("报告检查中、成功和重置状态", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    const { result } = renderHook(() => useAppUpdate());

    let request: Promise<void> | undefined;
    act(() => {
      request = result.current.check();
    });
    expect(result.current.phase).toBe("checking");
    await act(async () => {
      await request;
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.result).toEqual(availableUpdate);
    expect(result.current.error).toBeNull();

    act(() => result.current.reset());
    expect(result.current).toMatchObject({ phase: "idle", result: null, error: null });
  });

  it("复用进行中的请求，避免重复访问更新服务", async () => {
    let resolve: ((value: typeof availableUpdate) => void) | undefined;
    vi.mocked(checkForUpdates).mockImplementation(
      () => new Promise((nextResolve) => {
        resolve = nextResolve;
      }),
    );
    const { result } = renderHook(() => useAppUpdate());

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.check();
      second = result.current.check();
    });
    expect(first).toBe(second);
    expect(checkForUpdates).toHaveBeenCalledOnce();

    await act(async () => {
      resolve?.(availableUpdate);
      await first;
    });
    expect(result.current.result).toEqual(availableUpdate);
  });

  it("将网络错误转换为可展示的稳定消息", async () => {
    vi.mocked(checkForUpdates).mockRejectedValue({
      code: "UPDATE_CHECK_FAILED",
      message: "无法连接 GitHub",
    });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.check();
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toBe("UPDATE_CHECK_FAILED: 无法连接 GitHub");
  });

  it("兼容没有结构化字段的错误值", async () => {
    vi.mocked(checkForUpdates).mockRejectedValue("网络不可用");
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.check();
    });
    expect(result.current.error).toBe("网络不可用");
  });

  it("卸载后忽略迟到的响应", async () => {
    let resolve: ((value: typeof availableUpdate) => void) | undefined;
    vi.mocked(checkForUpdates).mockImplementation(
      () => new Promise((nextResolve) => {
        resolve = nextResolve;
      }),
    );
    const { result, unmount } = renderHook(() => useAppUpdate());
    act(() => {
      void result.current.check();
    });
    unmount();
    resolve?.(availableUpdate);
  });
});
