import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listenToAgentEvents } from "../ipc/agent";
import {
  getNotificationPermission,
  listenToRuntimeFaults,
  openSystemNotificationSettings,
  requestNotificationPermission,
  sendDesktopNotification,
} from "../ipc/notifications";
import { DEFAULT_APP_PREFERENCES } from "./useAppPreferences";
import { useDesktopNotifications } from "./useDesktopNotifications";

vi.mock("../ipc/agent", () => ({ listenToAgentEvents: vi.fn() }));
vi.mock("../ipc/notifications", () => ({
  getNotificationPermission: vi.fn(),
  listenToRuntimeFaults: vi.fn(),
  openSystemNotificationSettings: vi.fn(),
  requestNotificationPermission: vi.fn(),
  sendDesktopNotification: vi.fn(),
}));

type AgentHandler = Parameters<typeof listenToAgentEvents>[0];
type FaultHandler = Parameters<typeof listenToRuntimeFaults>[0];

describe("useDesktopNotifications", () => {
  let agentHandler: AgentHandler | undefined;
  let faultHandler: FaultHandler | undefined;
  let preferences = { ...DEFAULT_APP_PREFERENCES };
  let updatePreferences: ReturnType<typeof vi.fn<(patch: Partial<typeof preferences>) => void>>;

  beforeEach(() => {
    agentHandler = undefined;
    faultHandler = undefined;
    preferences = { ...DEFAULT_APP_PREFERENCES, notifyOnlyWhenUnfocused: false };
    updatePreferences = vi.fn<(patch: Partial<typeof preferences>) => void>((patch) => {
      preferences = { ...preferences, ...patch };
    });
    vi.mocked(getNotificationPermission).mockReset().mockResolvedValue("granted");
    vi.mocked(requestNotificationPermission).mockReset().mockResolvedValue("granted");
    vi.mocked(sendDesktopNotification).mockReset();
    vi.mocked(openSystemNotificationSettings).mockReset();
    vi.mocked(listenToAgentEvents).mockReset().mockImplementation(async (handler) => {
      agentHandler = handler;
      return vi.fn<() => void>();
    });
    vi.mocked(listenToRuntimeFaults).mockReset().mockImplementation(async (handler) => {
      faultHandler = handler;
      return vi.fn<() => void>();
    });
  });

  function renderNotifications() {
    return renderHook(() => useDesktopNotifications(preferences, updatePreferences));
  }

  async function waitForListeners() {
    await waitFor(() => expect(agentHandler).toBeTypeOf("function"));
    await waitFor(() => expect(faultHandler).toBeTypeOf("function"));
  }

  function event(name: "agent.started" | "message.failed" | "agent.settled", data?: unknown) {
    agentHandler?.({ v: 1, kind: "event", seq: 1, sessionId: "s-1", name, data });
  }

  it("任务成功完成后发送一次通知，重复 settled 会被忽略", async () => {
    renderNotifications();
    await waitForListeners();
    event("agent.started");
    event("agent.settled");
    event("agent.settled");

    await waitFor(() => expect(sendDesktopNotification).toHaveBeenCalledTimes(1));
    expect(sendDesktopNotification).toHaveBeenCalledWith({
      title: "Pi Desktop",
      body: "任务已成功完成",
      sound: true,
    });
  });

  it("失败仅在 settled 后发送，取消任务不发送任何通知", async () => {
    renderNotifications();
    await waitForListeners();
    event("agent.started");
    event("message.failed", { reason: "error", message: "bad" });
    expect(sendDesktopNotification).not.toHaveBeenCalled();
    event("agent.settled");
    await waitFor(() => expect(sendDesktopNotification).toHaveBeenCalledWith(expect.objectContaining({ body: "任务执行失败" })));

    vi.mocked(sendDesktopNotification).mockClear();
    event("agent.started");
    event("message.failed", { reason: "aborted", message: "cancelled" });
    event("agent.settled");
    await Promise.resolve();
    expect(sendDesktopNotification).not.toHaveBeenCalled();
  });

  it("窗口聚焦且仅在失焦时通知会过滤后台事件", async () => {
    preferences = { ...preferences, notifyOnlyWhenUnfocused: true };
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    renderNotifications();
    await waitForListeners();
    event("agent.started");
    event("agent.settled");
    await Promise.resolve();
    expect(sendDesktopNotification).not.toHaveBeenCalled();
  });

  it("权限检查期间窗口重新聚焦时不会发送通知", async () => {
    preferences = { ...preferences, notifyOnlyWhenUnfocused: true };
    const rendered = renderNotifications();
    await waitForListeners();
    await waitFor(() => expect(rendered.result.current.permission).toBe("granted"));

    let resolvePermission!: (permission: "granted") => void;
    const permission = new Promise<"granted">((resolve) => {
      resolvePermission = resolve;
    });
    vi.mocked(getNotificationPermission).mockReturnValueOnce(permission);
    const hasFocus = vi
      .spyOn(document, "hasFocus")
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    hasFocus.mockClear();

    event("agent.started");
    event("agent.settled");
    await waitFor(() => expect(getNotificationPermission).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolvePermission("granted");
      await permission;
    });

    expect(hasFocus).toHaveBeenCalledTimes(2);
    expect(sendDesktopNotification).not.toHaveBeenCalled();
  });

  it("自动通知在分类关闭或系统拒绝权限时不发送", async () => {
    preferences = {
      ...preferences,
      taskCompletedNotifications: false,
      taskFailedNotifications: false,
      hostExceptionNotifications: false,
    };
    const { result, rerender } = renderNotifications();
    await waitForListeners();

    event("agent.started");
    event("agent.settled");
    faultHandler?.({ code: "BRIDGE_CLOSED", message: "closed" });
    await Promise.resolve();
    expect(sendDesktopNotification).not.toHaveBeenCalled();
    expect(getNotificationPermission).toHaveBeenCalledTimes(1);

    preferences = { ...preferences, taskCompletedNotifications: true };
    rerender();
    vi.mocked(getNotificationPermission).mockResolvedValueOnce("denied");
    event("agent.started");
    event("agent.settled");
    await waitFor(() => expect(result.current.permission).toBe("denied"));
    expect(sendDesktopNotification).not.toHaveBeenCalled();
  });

  it("主开关关闭时会过滤事件，失焦时仍可发送通知", async () => {
    preferences = { ...preferences, desktopNotifications: false };
    const first = renderNotifications();
    await waitForListeners();
    event("agent.started");
    event("agent.settled");
    await Promise.resolve();
    expect(sendDesktopNotification).not.toHaveBeenCalled();
    first.unmount();

    preferences = { ...preferences, desktopNotifications: true, notifyOnlyWhenUnfocused: true };
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    renderNotifications();
    await waitForListeners();
    event("agent.started");
    event("agent.settled");
    await waitFor(() => expect(sendDesktopNotification).toHaveBeenCalledTimes(1));
  });

  it("自动发送失败时保留错误，但不会中断运行事件处理", async () => {
    vi.mocked(sendDesktopNotification).mockImplementationOnce(() => {
      throw new Error("notification unavailable");
    });
    const { result } = renderNotifications();
    await waitForListeners();
    event("agent.started");
    event("agent.settled");

    await waitFor(() => expect(result.current.error).toBe("notification unavailable"));
  });

  it("运行时故障遵守开关并发送 Host 通知", async () => {
    renderNotifications();
    await waitForListeners();
    faultHandler?.({ code: "BRIDGE_CLOSED", message: "closed" });
    await waitFor(() => expect(sendDesktopNotification).toHaveBeenCalledWith({
      title: "Pi Desktop",
      body: "Agent Host 异常或意外退出",
      sound: true,
    }));
  });

  it("启用和测试通知才会请求权限，并处理拒绝", async () => {
    const { result } = renderNotifications();
    await waitForListeners();
    vi.mocked(requestNotificationPermission).mockResolvedValueOnce("denied");
    await act(async () => expect(await result.current.setEnabled(true)).toBe(false));
    expect(updatePreferences).not.toHaveBeenCalledWith({ desktopNotifications: true });
    expect(result.current.error).toContain("系统未授予通知权限");

    await act(async () => expect(await result.current.sendTestNotification()).toBe(true));
    expect(sendDesktopNotification).toHaveBeenCalledWith({
      title: "Pi Desktop",
      body: "这是一条测试通知",
      sound: true,
    });
  });

  it("显式关闭不会请求权限，测试通知发送异常会保留错误", async () => {
    const { result } = renderNotifications();
    await waitForListeners();

    await act(async () => expect(await result.current.setEnabled(false)).toBe(true));
    expect(updatePreferences).toHaveBeenCalledWith({ desktopNotifications: false });
    expect(requestNotificationPermission).not.toHaveBeenCalled();
    expect(result.current.status).toBe("桌面通知已关闭");

    vi.mocked(sendDesktopNotification).mockImplementationOnce(() => {
      throw new Error("notification unavailable");
    });
    await act(async () => expect(await result.current.sendTestNotification()).toBe(false));
    expect(result.current.error).toBe("notification unavailable");
  });

  it("显式请求权限失败与测试通知被拒绝均返回失败", async () => {
    const { result } = renderNotifications();
    await waitForListeners();
    vi.mocked(requestNotificationPermission).mockRejectedValueOnce(new Error("unsupported"));
    await act(async () => expect(await result.current.setEnabled(true)).toBe(false));
    expect(result.current.error).toBe("unsupported");

    vi.mocked(requestNotificationPermission).mockResolvedValueOnce("denied");
    await act(async () => expect(await result.current.sendTestNotification()).toBe(false));
    expect(sendDesktopNotification).not.toHaveBeenCalled();
    expect(result.current.error).toContain("系统未授予通知权限");
  });

  it("监听失败、已注册监听的卸载和系统设置失败都会保留可定位反馈", async () => {
    const agentUnlisten = vi.fn<() => void>();
    vi.mocked(listenToAgentEvents).mockResolvedValueOnce(agentUnlisten);
    vi.mocked(listenToRuntimeFaults).mockRejectedValueOnce(new Error("channel unavailable"));
    const { result, unmount } = renderNotifications();
    await waitFor(() => expect(result.current.error).toContain("无法订阅通知事件：channel unavailable"));
    unmount();
    expect(agentUnlisten).toHaveBeenCalledTimes(1);

    const second = renderNotifications();
    await waitForListeners();
    vi.mocked(openSystemNotificationSettings).mockRejectedValueOnce(new Error("unsupported"));
    await act(async () => expect(await second.result.current.openSystemSettings()).toBe(false));
    expect(second.result.current.error).toBe("unsupported");
  });

  it("系统设置打开成功时反馈成功状态", async () => {
    const { result } = renderNotifications();
    await waitForListeners();

    await act(async () => expect(await result.current.openSystemSettings()).toBe(true));
    expect(openSystemNotificationSettings).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("已打开系统通知设置");
    expect(result.current.error).toBeNull();
  });
});
