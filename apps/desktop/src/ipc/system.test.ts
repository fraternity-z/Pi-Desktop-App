import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getArchitectureStatus,
  getRuntimeStatus,
  listenToRuntimeStatus,
  restartRuntime,
} from "./system";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("getArchitectureStatus", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("调用白名单命令并返回类型化状态", async () => {
    const status = {
      renderer: "ready",
      core: "ready",
      bridge: "ready",
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

describe("getRuntimeStatus", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("调用运行时状态命令", async () => {
    const status = {
      status: "ready" as const,
      runtimeSource: "path-pi-command",
      piVersion: "0.84.2",
      nodeVersion: "22.23.2",
      error: null,
    };
    vi.mocked(invoke).mockResolvedValue(status);

    await expect(getRuntimeStatus()).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith("get_runtime_status");
  });

  it("仅通过显式命令重新启动运行时", async () => {
    const status = {
      status: "starting" as const,
      runtimeSource: null,
      piVersion: null,
      nodeVersion: null,
      error: null,
    };
    vi.mocked(invoke).mockResolvedValue(status);

    await expect(restartRuntime()).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith("restart_runtime");
  });

  it("只转发结构完整的运行时状态事件", async () => {
    const handler = vi.fn();
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    await expect(listenToRuntimeStatus(handler)).resolves.toBe(unlisten);
    expect(listen).toHaveBeenCalledWith("runtime://status", expect.any(Function));
    const eventHandler = vi.mocked(listen).mock.calls[0]?.[1] as unknown as (event: {
      payload: unknown;
    }) => void;

    eventHandler({
      payload: {
        status: "starting",
        runtimeSource: null,
        piVersion: null,
        nodeVersion: null,
        error: null,
      },
    });
    eventHandler({ payload: { status: "ready", runtimeSource: 42 } });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ status: "starting" }));
  });
});
