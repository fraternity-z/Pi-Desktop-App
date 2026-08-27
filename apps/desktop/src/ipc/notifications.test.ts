import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getNotificationPermission,
  listenToRuntimeFaults,
  openSystemNotificationSettings,
  parseRuntimeFault,
  requestNotificationPermission,
  sendDesktopNotification,
} from "./notifications";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

describe("notification IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
    vi.mocked(isPermissionGranted).mockReset();
    vi.mocked(requestPermission).mockReset();
    vi.mocked(sendNotification).mockReset();
  });

  it("读取和请求系统权限，并将拒绝映射为稳定状态", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(requestPermission).mockResolvedValueOnce("denied");

    await expect(getNotificationPermission()).resolves.toBe("granted");
    await expect(requestNotificationPermission()).resolves.toBe("denied");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("权限检查失败时降级为未知，请求失败提供中文错误", async () => {
    vi.mocked(isPermissionGranted).mockRejectedValueOnce(new Error("unsupported"));
    await expect(getNotificationPermission()).resolves.toBe("unknown");

    vi.mocked(isPermissionGranted).mockRejectedValueOnce(new Error("unsupported"));
    await expect(requestNotificationPermission()).rejects.toThrow("无法请求系统通知权限：unsupported");
  });

  it("发送通知时精确映射声音开关", () => {
    sendDesktopNotification({ title: "Pi Desktop", body: "完成", sound: true });
    sendDesktopNotification({ title: "Pi Desktop", body: "失败", sound: false });

    expect(sendNotification).toHaveBeenNthCalledWith(1, {
      title: "Pi Desktop",
      body: "完成",
      silent: false,
    });
    expect(sendNotification).toHaveBeenNthCalledWith(2, {
      title: "Pi Desktop",
      body: "失败",
      silent: true,
    });
  });

  it("通知插件同步失败时保留可定位的错误信息", () => {
    vi.mocked(sendNotification).mockImplementationOnce(() => {
      throw "notification unavailable";
    });

    expect(() => sendDesktopNotification({ title: "Pi Desktop", body: "完成", sound: true })).toThrow(
      "无法发送系统通知：notification unavailable",
    );
  });

  it("已经授权时不重复请求权限", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValueOnce(true);

    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("订阅严格校验后的运行时故障事件", async () => {
    let callback: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementation(async (_channel, handler) => {
      callback = handler as (event: { payload: unknown }) => void;
      return unlisten;
    });
    const handler = vi.fn();

    await expect(listenToRuntimeFaults(handler)).resolves.toBe(unlisten);
    callback?.({ payload: { code: "BRIDGE_CLOSED", message: "Pi Bridge 已关闭" } });
    callback?.({ payload: { code: "BAD", message: "x", extra: true } });

    expect(listen).toHaveBeenCalledWith("runtime://fault", expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ code: "BRIDGE_CLOSED", message: "Pi Bridge 已关闭" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(parseRuntimeFault({ code: "", message: "bad" })).toBeNull();
    expect(parseRuntimeFault(["BRIDGE_CLOSED", "bad"])).toBeNull();
    expect(parseRuntimeFault({ code: "x".repeat(129), message: "bad" })).toBeNull();
    expect(parseRuntimeFault({ code: "BAD", message: {} })).toBeNull();
  });

  it("调用固定命令打开系统设置，并包装错误", async () => {
    await openSystemNotificationSettings();
    expect(invoke).toHaveBeenCalledWith("open_system_notification_settings");

    vi.mocked(invoke).mockRejectedValueOnce({ message: "unsupported" });
    await expect(openSystemNotificationSettings()).rejects.toThrow(
      "无法打开系统通知设置：unsupported",
    );
  });
});
