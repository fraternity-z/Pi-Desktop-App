import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRuntimeStatus } from "../ipc/system";
import { useRuntimeStatus } from "./useRuntimeStatus";

vi.mock("../ipc/system", () => ({ getRuntimeStatus: vi.fn() }));

describe("useRuntimeStatus", () => {
  beforeEach(() => {
    vi.mocked(getRuntimeStatus).mockReset();
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

  it("支持用户重新检测运行时", async () => {
    vi.mocked(getRuntimeStatus)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
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
  });
});
