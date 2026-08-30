import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as agentIpc from "../ipc/agent";
import { useAgentEcosystem } from "./useAgentEcosystem";

vi.mock("../ipc/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/agent")>()),
  checkAgentPackageUpdates: vi.fn(),
  installAgentPackage: vi.fn(),
  listAgentPackages: vi.fn(),
  listAgentResources: vi.fn(),
  removeAgentPackage: vi.fn(),
  setAgentPackageEnabled: vi.fn(),
  updateAgentPackage: vi.fn(),
}));

describe("useAgentEcosystem", () => {
  beforeEach(() => vi.clearAllMocks());

  it("按进入的页面独立加载插件与资源目录", async () => {
    vi.mocked(agentIpc.listAgentPackages).mockResolvedValue([
      {
        source: "npm:pi-test",
        scope: "global",
        kind: "npm",
        filtered: false,
        enabled: true,
      },
    ]);
    vi.mocked(agentIpc.listAgentResources).mockResolvedValue([
      { kind: "skill", name: "review", path: "C:\\agent\\skills\\review\\SKILL.md" },
    ]);
    const { result } = renderHook(() => useAgentEcosystem());

    await act(() => result.current.refresh("C:\\work", "packages"));

    expect(result.current.phase).toBe("ready");
    expect(result.current.packages).toHaveLength(1);
    expect(agentIpc.listAgentResources).not.toHaveBeenCalled();

    await act(() => result.current.refresh("C:\\work", "resources"));

    expect(result.current.resources[0]?.kind).toBe("skill");
    expect(agentIpc.listAgentPackages).toHaveBeenCalledOnce();
  });

  it("插件变更不重复刷新资源并公开稳定错误", async () => {
    vi.mocked(agentIpc.installAgentPackage).mockResolvedValue([]);
    vi.mocked(agentIpc.listAgentResources).mockResolvedValue([]);
    const { result } = renderHook(() => useAgentEcosystem());

    await act(() => result.current.installPackage("C:\\work", "npm:pi-test", "project"));
    expect(agentIpc.installAgentPackage).toHaveBeenCalledWith(
      "C:\\work",
      "npm:pi-test",
      "project",
    );
    expect(agentIpc.listAgentResources).not.toHaveBeenCalled();

    vi.mocked(agentIpc.removeAgentPackage).mockRejectedValueOnce({
      code: "PACKAGE_REMOVE_FAILED",
      message: "插件正在使用",
    });
    await act(() =>
      result.current.removePackage("C:\\work", {
        source: "npm:pi-test",
        scope: "global",
        kind: "npm",
        filtered: false,
        enabled: true,
      }),
    );
    expect(result.current.error).toBe("PACKAGE_REMOVE_FAILED: 插件正在使用");
  });

  it("覆盖启停、更新与检查更新的成功和降级路径", async () => {
    const item = {
      source: "npm:pi-test",
      scope: "global" as const,
      kind: "npm" as const,
      filtered: false,
      enabled: true,
    };
    vi.mocked(agentIpc.setAgentPackageEnabled).mockResolvedValue([{ ...item, enabled: false }]);
    vi.mocked(agentIpc.updateAgentPackage).mockResolvedValue([item]);
    vi.mocked(agentIpc.checkAgentPackageUpdates).mockResolvedValue([
      { source: item.source, displayName: "Pi Test", type: "npm", scope: "global" },
    ]);
    vi.mocked(agentIpc.listAgentResources).mockResolvedValue([]);
    const { result } = renderHook(() => useAgentEcosystem());

    await act(() => result.current.setPackageEnabled("C:\\work", item, false));
    expect(agentIpc.setAgentPackageEnabled).toHaveBeenCalledWith(
      "C:\\work",
      item.source,
      "global",
      false,
    );
    expect(result.current.packages[0]?.enabled).toBe(false);

    await act(() => result.current.updatePackage("C:\\work"));
    expect(agentIpc.updateAgentPackage).toHaveBeenCalledWith("C:\\work", undefined);
    await act(() => result.current.checkUpdates("C:\\work"));
    expect(result.current.updates[0]?.displayName).toBe("Pi Test");

    vi.mocked(agentIpc.checkAgentPackageUpdates).mockRejectedValueOnce(new Error("offline"));
    await act(() => result.current.checkUpdates("C:\\work"));
    expect(result.current.error).toBe("PACKAGE_UPDATE_CHECK_FAILED: 无法检查插件更新");
    expect(result.current.operation).toBeNull();
  });

  it("忽略过期刷新结果并映射未知加载异常", async () => {
    let releasePackages: (value: Awaited<ReturnType<typeof agentIpc.listAgentPackages>>) => void =
      () => undefined;
    vi.mocked(agentIpc.listAgentPackages)
      .mockReturnValueOnce(new Promise((resolve) => (releasePackages = resolve)))
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() => useAgentEcosystem());
    let staleTask: Promise<boolean> = Promise.resolve(false);

    act(() => {
      staleTask = result.current.refresh("C:\\old", "packages");
    });
    await act(() => result.current.refresh("C:\\new", "packages"));
    await act(async () => {
      releasePackages([]);
      await staleTask;
    });
    expect(result.current.phase).toBe("ready");

    vi.mocked(agentIpc.listAgentPackages).mockRejectedValueOnce(new Error("offline"));
    await act(() => result.current.refresh("C:\\failed", "packages"));
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("PACKAGE_LIST_FAILED: 无法读取插件");
  });

  it("切换工作区后忽略旧插件操作和更新检查结果", async () => {
    const oldPackage = {
      source: "npm:old",
      scope: "global" as const,
      kind: "npm" as const,
      filtered: false,
      enabled: true,
    };
    const newPackage = { ...oldPackage, source: "npm:new" };
    let releaseUpdate: (value: typeof oldPackage[]) => void = () => undefined;
    let releaseCheck: (
      value: Awaited<ReturnType<typeof agentIpc.checkAgentPackageUpdates>>,
    ) => void = () => undefined;
    vi.mocked(agentIpc.updateAgentPackage).mockReturnValueOnce(
      new Promise((resolve) => (releaseUpdate = resolve)),
    );
    vi.mocked(agentIpc.checkAgentPackageUpdates).mockReturnValueOnce(
      new Promise((resolve) => (releaseCheck = resolve)),
    );
    vi.mocked(agentIpc.listAgentPackages).mockResolvedValue([newPackage]);
    vi.mocked(agentIpc.listAgentResources).mockResolvedValue([]);
    const { result } = renderHook(() => useAgentEcosystem());
    let staleUpdate: Promise<boolean> = Promise.resolve(false);
    let staleCheck: Promise<boolean> = Promise.resolve(false);

    act(() => {
      staleUpdate = result.current.updatePackage("C:\\old");
    });
    await act(() => result.current.refresh("C:\\new", "packages"));
    await act(async () => {
      releaseUpdate([oldPackage]);
      await staleUpdate;
    });
    expect(result.current.packages[0]?.source).toBe("npm:new");
    expect(result.current.operation).toBeNull();

    act(() => {
      staleCheck = result.current.checkUpdates("C:\\old");
    });
    await act(() => result.current.refresh("C:\\new", "packages"));
    await act(async () => {
      releaseCheck([
        { source: "npm:old", displayName: "Old", type: "npm", scope: "global" },
      ]);
      await staleCheck;
    });
    expect(result.current.updates).toEqual([]);
    expect(result.current.operation).toBeNull();
  });
});
