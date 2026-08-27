import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export type NotificationPermissionStatus = "granted" | "denied" | "unknown";

export interface DesktopNotification {
  title: string;
  body: string;
  sound: boolean;
}

export interface RuntimeFault {
  code: string;
  message: string;
}

const MAX_ERROR_CODE_CHARS = 128;
const MAX_ERROR_MESSAGE_CHARS = 1_024;

export async function getNotificationPermission(): Promise<NotificationPermissionStatus> {
  try {
    return (await isPermissionGranted()) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

/** 只能由用户明确启用通知或发送测试通知时调用。 */
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  try {
    if (await isPermissionGranted()) return "granted";
    return (await requestPermission()) === "granted" ? "granted" : "denied";
  } catch (error) {
    throw new Error(`无法请求系统通知权限：${formatError(error)}`);
  }
}

export function sendDesktopNotification(notification: DesktopNotification): void {
  try {
    sendNotification({
      title: notification.title,
      body: notification.body,
      // 不传 sound，交由系统选择默认提示音；关闭时用官方 silent 选项抑制声音。
      silent: !notification.sound,
    });
  } catch (error) {
    throw new Error(`无法发送系统通知：${formatError(error)}`);
  }
}

export async function openSystemNotificationSettings(): Promise<void> {
  try {
    await invoke("open_system_notification_settings");
  } catch (error) {
    throw new Error(`无法打开系统通知设置：${formatError(error)}`);
  }
}

export async function listenToRuntimeFaults(
  handler: (fault: RuntimeFault) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("runtime://fault", (event) => {
    const fault = parseRuntimeFault(event.payload);
    if (fault) handler(fault);
  });
}

export function parseRuntimeFault(payload: unknown): RuntimeFault | null {
  if (
    !isRecord(payload) ||
    Object.keys(payload).length !== 2 ||
    !isBoundedText(payload.code, MAX_ERROR_CODE_CHARS) ||
    !isBoundedText(payload.message, MAX_ERROR_MESSAGE_CHARS)
  ) {
    return null;
  }
  return { code: payload.code, message: payload.message };
}

function formatError(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return error instanceof Error ? error.message : String(error);
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
