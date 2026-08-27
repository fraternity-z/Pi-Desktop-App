import { useCallback, useEffect, useRef, useState } from "react";

import { listenToAgentEvents, type AgentEvent } from "../ipc/agent";
import {
  getNotificationPermission,
  listenToRuntimeFaults,
  openSystemNotificationSettings,
  requestNotificationPermission,
  sendDesktopNotification,
  type NotificationPermissionStatus,
} from "../ipc/notifications";
import type { AppPreferences } from "./useAppPreferences";

export type DesktopNotificationPhase =
  | "idle"
  | "checking-permission"
  | "requesting-permission"
  | "sending-test"
  | "opening-settings";

export interface DesktopNotificationController {
  permission: NotificationPermissionStatus;
  phase: DesktopNotificationPhase;
  error: string | null;
  status: string | null;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  sendTestNotification: () => Promise<boolean>;
  openSystemSettings: () => Promise<boolean>;
  clearFeedback: () => void;
}

interface AgentRunState {
  failed: boolean;
  cancelled: boolean;
  settled: boolean;
}

export function useDesktopNotifications(
  preferences: AppPreferences,
  updatePreferences: (patch: Partial<AppPreferences>) => void,
): DesktopNotificationController {
  const [permission, setPermission] = useState<NotificationPermissionStatus>("unknown");
  const [phase, setPhase] = useState<DesktopNotificationPhase>("checking-permission");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const preferencesRef = useRef(preferences);
  const runsRef = useRef(new Map<string, AgentRunState>());
  const aliveRef = useRef(true);

  preferencesRef.current = preferences;

  const clearFeedback = useCallback(() => {
    setError(null);
    setStatus(null);
  }, []);

  const refreshPermission = useCallback(async () => {
    const nextPermission = await getNotificationPermission();
    if (aliveRef.current) setPermission(nextPermission);
    return nextPermission;
  }, []);

  const deliverAutomatic = useCallback(async (kind: "completed" | "failed" | "host") => {
    if (!canDeliverAutomatic(kind, preferencesRef.current)) return;

    const nextPermission = await getNotificationPermission();
    if (aliveRef.current) setPermission(nextPermission);
    const current = preferencesRef.current;
    if (nextPermission !== "granted" || !canDeliverAutomatic(kind, current)) return;

    const content = notificationContent(kind);
    try {
      sendDesktopNotification({ ...content, sound: current.notificationSound });
    } catch (sendError) {
      if (aliveRef.current) setError(formatError(sendError));
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refreshPermission().finally(() => {
      if (aliveRef.current) setPhase("idle");
    });
    return () => {
      aliveRef.current = false;
    };
  }, [refreshPermission]);

  useEffect(() => {
    let active = true;
    let stopAgentEvents: (() => void) | undefined;
    let stopRuntimeFaults: (() => void) | undefined;

    const onAgentEvent = (event: AgentEvent) => {
      if (!active) return;
      if (event.name === "agent.started") {
        runsRef.current.set(event.sessionId, { failed: false, cancelled: false, settled: false });
        return;
      }
      const run = runsRef.current.get(event.sessionId);
      if (!run) return;
      if (event.name === "message.failed") {
        const reason = readFailureReason(event.data);
        if (reason === "aborted") run.cancelled = true;
        else if (reason) run.failed = true;
        return;
      }
      if (event.name === "agent.settled" && !run.settled) {
        run.settled = true;
        runsRef.current.delete(event.sessionId);
        if (!run.cancelled) void deliverAutomatic(run.failed ? "failed" : "completed");
      }
    };

    void (async () => {
      const failures: string[] = [];
      try {
        const unlisten = await listenToAgentEvents(onAgentEvent);
        if (active) stopAgentEvents = unlisten;
        else unlisten();
      } catch (listenError) {
        failures.push(formatError(listenError));
      }
      try {
        const unlisten = await listenToRuntimeFaults(() => void deliverAutomatic("host"));
        if (active) stopRuntimeFaults = unlisten;
        else unlisten();
      } catch (listenError) {
        failures.push(formatError(listenError));
      }
      if (active && failures.length > 0) {
        setError(`无法订阅通知事件：${failures.join("；")}`);
      }
    })();

    return () => {
      active = false;
      stopAgentEvents?.();
      stopRuntimeFaults?.();
    };
  }, [deliverAutomatic]);

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      clearFeedback();
      if (!enabled) {
        updatePreferences({ desktopNotifications: false });
        setStatus("桌面通知已关闭");
        return true;
      }
      setPhase("requesting-permission");
      try {
        const nextPermission = await requestNotificationPermission();
        setPermission(nextPermission);
        if (nextPermission !== "granted") {
          setError("系统未授予通知权限，请在系统通知设置中允许 Pi Desktop 发送通知");
          return false;
        }
        updatePreferences({ desktopNotifications: true });
        setStatus("桌面通知已启用");
        return true;
      } catch (requestError) {
        setError(formatError(requestError));
        return false;
      } finally {
        if (aliveRef.current) setPhase("idle");
      }
    },
    [clearFeedback, updatePreferences],
  );

  const sendTestNotification = useCallback(async (): Promise<boolean> => {
    clearFeedback();
    setPhase("sending-test");
    try {
      const nextPermission = await requestNotificationPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setError("系统未授予通知权限，请在系统通知设置中允许 Pi Desktop 发送通知");
        return false;
      }
      sendDesktopNotification({
        title: "Pi Desktop",
        body: "这是一条测试通知",
        sound: preferencesRef.current.notificationSound,
      });
      setStatus("测试通知已发送");
      return true;
    } catch (sendError) {
      setError(formatError(sendError));
      return false;
    } finally {
      if (aliveRef.current) setPhase("idle");
    }
  }, [clearFeedback]);

  const openSystemSettings = useCallback(async (): Promise<boolean> => {
    clearFeedback();
    setPhase("opening-settings");
    try {
      await openSystemNotificationSettings();
      setStatus("已打开系统通知设置");
      return true;
    } catch (settingsError) {
      setError(formatError(settingsError));
      return false;
    } finally {
      if (aliveRef.current) setPhase("idle");
    }
  }, [clearFeedback]);

  return {
    permission,
    phase,
    error,
    status,
    setEnabled,
    sendTestNotification,
    openSystemSettings,
    clearFeedback,
  };
}

function notificationContent(kind: "completed" | "failed" | "host") {
  if (kind === "completed") return { title: "Pi Desktop", body: "任务已成功完成" };
  if (kind === "failed") return { title: "Pi Desktop", body: "任务执行失败" };
  return { title: "Pi Desktop", body: "Agent Host 异常或意外退出" };
}

function canDeliverAutomatic(
  kind: "completed" | "failed" | "host",
  preferences: AppPreferences,
): boolean {
  return !(
    !preferences.desktopNotifications ||
    (kind === "completed" && !preferences.taskCompletedNotifications) ||
    (kind === "failed" && !preferences.taskFailedNotifications) ||
    (kind === "host" && !preferences.hostExceptionNotifications) ||
    (preferences.notifyOnlyWhenUnfocused &&
      typeof document !== "undefined" &&
      document.hasFocus())
  );
}

function readFailureReason(data: unknown): string | null {
  return isRecord(data) && typeof data.reason === "string" ? data.reason : null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
