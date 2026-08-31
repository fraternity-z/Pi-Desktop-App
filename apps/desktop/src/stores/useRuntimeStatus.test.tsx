import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRuntimeSettings,
  getRuntimeStatus,
  listenToRuntimeStatus,
  restartRuntime,
  setRuntimeMode,
} from "../ipc/system";
import { useRuntimeStatus } from "./useRuntimeStatus";

vi.mock("../ipc/system", () => ({
  getRuntimeSettings: vi.fn(),
  getRuntimeStatus: vi.fn(),
  listenToRuntimeStatus: vi.fn(),
  restartRuntime: vi.fn(),
  setRuntimeMode: vi.fn(),
}));

const defaultRuntimeSettings = {
  schemaVersion: 1,
  runtimeMode: "builtin" as const,
  nodePath: null,
  sdkPath: null,
  piCommand: null,
  agentDir: "~/.pi/agent",
  supportedSdkRange: ">=0.83 <0.86",
  telemetry: false,
};

describe("useRuntimeStatus", () => {
  let emitStatus: Parameters<typeof listenToRuntimeStatus>[0] | undefined;
  const unlisten = vi.fn();

  beforeEach(() => {
    emitStatus = undefined;
    unlisten.mockReset();
    vi.mocked(getRuntimeStatus).mockReset();
    vi.mocked(restartRuntime).mockReset();
    vi.mocked(getRuntimeSettings).mockReset().mockResolvedValue(defaultRuntimeSettings);
    vi.mocked(setRuntimeMode).mockReset().mockResolvedValue(defaultRuntimeSettings);
    vi.mocked(listenToRuntimeStatus)
      .mockReset()
      .mockImplementation(async (handler) => {
        emitStatus = handler;
        return unlisten;
      });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("格式化 Error 和非 Error 失败", async () => {
    vi.mocked(getRuntimeStatus).mockRejectedValueOnce(new Error("offline"));
    const first = renderHook(() => useRuntimeStatus());
    await waitFor(() =>
      expect(first.result.current).toMatchObject({ phase: "error", message: "offline" }),
    );
    first.unmount();

    vi.mocked(getRuntimeStatus).mockRejectedValueOnce("unavailable");
    const second = renderHook(() => useRuntimeStatus());
    await waitFor(() =>
      expect(second.result.current).toMatchObject({ phase: "error", message: "unavailable" }),
    );
  });

  it("格式化 Rust 结构化错误并保留错误码", async () => {
    vi.mocked(getRuntimeStatus).mockRejectedValueOnce({
      code: "BRIDGE_TIMEOUT",
      message: "后台仍在连接",
    });

    const { result } = renderHook(() => useRuntimeStatus());
    await waitFor(() =>
      expect(result.current).toMatchObject({
        phase: "error",
        message: "BRIDGE_TIMEOUT: 后台仍在连接",
      }),
    );
  });

  it("支持用户重新检测运行时", async () => {
    vi.mocked(getRuntimeStatus).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(restartRuntime).mockResolvedValueOnce({
        status: "ready",
        runtimeSource: "path-pi-command",
        piVersion: "0.84.2",
        nodeVersion: "22.23.2",
        error: null,
      });
    const { result } = renderHook(() => useRuntimeStatus());
    await waitFor(() => expect(result.current.phase).toBe("error"));

    await act(() => result.current.refresh());

    await waitFor(() =>
      expect(result.current).toMatchObject({
        phase: "ready",
        status: { status: "ready", piVersion: "0.84.2" },
      }),
    );
    expect(getRuntimeStatus).toHaveBeenCalledOnce();
    expect(restartRuntime).toHaveBeenCalledOnce();
  });

  it("接收后台 starting 与 ready 状态而不触发额外查询", async () => {
    vi.mocked(getRuntimeStatus).mockResolvedValue({
      status: "starting",
      runtimeSource: null,
      piVersion: null,
      nodeVersion: null,
      error: null,
    });
    const { result } = renderHook(() => useRuntimeStatus());
    await waitFor(() =>
      expect(result.current).toMatchObject({ phase: "ready", status: { status: "starting" } }),
    );

    act(() =>
      emitStatus?.({
        status: "ready",
        runtimeSource: "path-pi-command",
        piVersion: "0.84.2",
        nodeVersion: "22.23.2",
        error: null,
      }),
    );

    expect(result.current).toMatchObject({ phase: "ready", status: { status: "ready" } });
    expect(getRuntimeStatus).toHaveBeenCalledOnce();
    expect(restartRuntime).not.toHaveBeenCalled();
  });

  it("监听注册变慢时仍先完成状态查询", async () => {
    let resolveListener: ((value: typeof unlisten) => void) | undefined;
    const listenerPromise = new Promise<typeof unlisten>((resolve) => {
      resolveListener = resolve;
    });
    vi.mocked(listenToRuntimeStatus).mockReturnValueOnce(listenerPromise);
    vi.mocked(getRuntimeStatus).mockResolvedValueOnce({
      status: "ready",
      runtimeSource: "builtin",
      piVersion: "0.84.2",
      nodeVersion: "22.23.2",
      error: null,
    });

    const { result, unmount } = renderHook(() => useRuntimeStatus());
    await waitFor(() => expect(getRuntimeStatus).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current).toMatchObject({ phase: "ready" }));

    await act(async () => {
      resolveListener?.(unlisten);
      await listenerPromise;
    });
    unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("卸载后忽略延迟返回的状态", async () => {
    let resolveStatus: ((value: Awaited<ReturnType<typeof getRuntimeStatus>>) => void) | undefined;
    vi.mocked(getRuntimeStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useRuntimeStatus());
    await waitFor(() => expect(getRuntimeStatus).toHaveBeenCalledOnce());
    unmount();
    resolveStatus?.({
      status: "ready",
      runtimeSource: "path-pi-command",
      piVersion: "0.84.2",
      nodeVersion: "22.23.2",
      error: null,
    });

    await Promise.resolve();
    expect(result.current.phase).toBe("loading");
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("运行时暂不可用时自动触发后台重连，无需刷新页面", async () => {
    vi.useFakeTimers();
    vi.mocked(getRuntimeStatus).mockResolvedValueOnce({
      status: "unavailable",
      runtimeSource: null,
      piVersion: null,
      nodeVersion: null,
      error: { code: "RUNTIME_NOT_FOUND", message: "Pi 尚未启动" },
    });
    vi.mocked(restartRuntime).mockResolvedValueOnce({
      status: "ready",
      runtimeSource: "builtin",
      piVersion: "0.84.2",
      nodeVersion: "22.23.2",
      error: null,
    });

    const { result } = renderHook(() => useRuntimeStatus());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ phase: "ready", status: { status: "unavailable" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(restartRuntime).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({ phase: "ready", status: { status: "ready" } });
  });
});
