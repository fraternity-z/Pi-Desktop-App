import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeAppWindow,
  getArchitectureStatus,
  getRuntimeSettings,
  getRuntimeStatus,
  listenToRuntimeStatus,
  restartRuntime,
  setRuntimeMode,
} from "./system";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

describe("closeAppWindow", () => {
  it("只关闭当前 Tauri 窗口", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({ close } as never);

    await expect(closeAppWindow()).resolves.toBeUndefined();
    expect(getCurrentWindow).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

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

describe("runtime settings", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  const settings = {
    schemaVersion: 1,
    runtimeMode: "builtin" as const,
    nodePath: null,
    sdkPath: null,
    piCommand: null,
    agentDir: "~/.pi/agent",
    supportedSdkRange: ">=0.83 <0.86",
    telemetry: false,
  };

  it("读取并校验持久化的运行时来源", async () => {
    vi.mocked(invoke).mockResolvedValue(settings);

    await expect(getRuntimeSettings()).resolves.toEqual(settings);
    expect(invoke).toHaveBeenCalledWith("get_runtime_settings");
  });

  it("切换运行时来源时只发送允许的模式并校验响应", async () => {
    const localSettings = { ...settings, runtimeMode: "local" as const };
    vi.mocked(invoke).mockResolvedValue(localSettings);

    await expect(setRuntimeMode("local")).resolves.toEqual(localSettings);
    expect(invoke).toHaveBeenCalledWith("set_runtime_mode", { mode: "local" });
  });

  it("拒绝结构不完整的运行时设置", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...settings, runtimeMode: "unknown" });

    await expect(getRuntimeSettings()).rejects.toThrow("RUNTIME_SETTINGS_INVALID");
  });

  it("拒绝不兼容的运行时设置 schema", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...settings, schemaVersion: 2 });

    await expect(getRuntimeSettings()).rejects.toThrow("RUNTIME_SETTINGS_INVALID");
  });
});
