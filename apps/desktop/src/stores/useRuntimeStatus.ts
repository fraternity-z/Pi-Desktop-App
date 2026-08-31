import { useCallback, useEffect, useRef, useState } from "react";

import {
  getRuntimeStatus,
  getRuntimeSettings,
  listenToRuntimeStatus,
  restartRuntime,
  setRuntimeMode,
  type RuntimeMode,
  type RuntimeStatus,
} from "../ipc/system";

const RUNTIME_STATUS_TIMEOUT_MS = 2_000;
const RUNTIME_PROBE_INTERVAL_MS = 3_000;
const MAX_RUNTIME_PROBE_ATTEMPTS = 5;

export type RuntimeStatusState =
  | { phase: "loading" }
  | { phase: "ready"; status: RuntimeStatus }
  | { phase: "error"; message: string };

export type RuntimeStatusController = RuntimeStatusState & {
  refresh: () => Promise<void>;
  runtimeMode?: RuntimeMode;
  runtimeSettingsPhase?: "loading" | "ready" | "error";
  runtimeSettingsError?: string | null;
  setRuntimeMode?: (mode: RuntimeMode) => Promise<void>;
};

export function useRuntimeStatus(): RuntimeStatusController {
  const [state, setState] = useState<RuntimeStatusState>({ phase: "loading" });
  const [runtimeMode, setRuntimeModeState] = useState<RuntimeMode>("builtin");
  const [runtimeSettingsPhase, setRuntimeSettingsPhase] = useState<
    "loading" | "ready" | "error"
  >(typeof getRuntimeSettings === "function" ? "loading" : "ready");
  const [runtimeSettingsError, setRuntimeSettingsError] = useState<string | null>(null);
  const requestId = useRef(0);
  const statusProbeAttempts = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    statusProbeAttempts.current = 0;
    setState({ phase: "loading" });
    try {
      const status = await withTimeout(
        restartRuntime(),
        RUNTIME_STATUS_TIMEOUT_MS,
        "RUNTIME_RESTART_TIMEOUT: Pi Bridge 正在后台启动，请稍后重试",
      );
      if (requestId.current === currentRequest) {
        setState({ phase: "ready", status });
      }
    } catch (error) {
      if (requestId.current === currentRequest) {
        setState({ phase: "error", message: formatError(error) });
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    let eventRevision = 0;

    const listenerTask = (async () => {
      try {
        const stopListening = await listenToRuntimeStatus((status) => {
          if (!active) return;
          eventRevision += 1;
          requestId.current += 1;
          setState({ phase: "ready", status });
        });
        if (!active) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      } catch {
        // Cached status remains usable when event subscription is unavailable.
      }
    })();

    const statusTask = (async () => {
      if (!active) return;
      const revision = eventRevision;
      const currentRequest = ++requestId.current;
      try {
        const status = await withTimeout(
          getRuntimeStatus(),
          RUNTIME_STATUS_TIMEOUT_MS,
          "RUNTIME_STATUS_TIMEOUT: Pi 运行时检测超时，后台仍会继续连接",
        );
        if (
          active &&
          requestId.current === currentRequest &&
          eventRevision === revision
        ) {
          setState({ phase: "ready", status });
        }
      } catch (error) {
        if (
          active &&
          requestId.current === currentRequest &&
          eventRevision === revision
        ) {
          setState({ phase: "error", message: formatError(error) });
        }
      }
    })();

    const settingsTask = (async () => {
      if (!active || typeof getRuntimeSettings !== "function") return;
      try {
        const settings = await withTimeout(
          getRuntimeSettings(),
          RUNTIME_STATUS_TIMEOUT_MS,
          "RUNTIME_SETTINGS_TIMEOUT: 运行时设置读取超时",
        );
        if (active) {
          setRuntimeModeState(settings.runtimeMode);
          setRuntimeSettingsPhase("ready");
          setRuntimeSettingsError(null);
        }
      } catch (error) {
        if (active) {
          setRuntimeSettingsPhase("error");
          setRuntimeSettingsError(formatError(error));
        }
      }
    })();

    void Promise.allSettled([listenerTask, statusTask, settingsTask]);

    return () => {
      active = false;
      requestId.current += 1;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const shouldProbe =
      state.phase === "error" ||
      (state.phase === "ready" &&
        (state.status.status === "unavailable" || state.status.status === "starting"));
    if (
      !shouldProbe ||
      typeof getRuntimeStatus !== "function" ||
      typeof restartRuntime !== "function" ||
      statusProbeAttempts.current >= MAX_RUNTIME_PROBE_ATTEMPTS
    ) {
      if (state.phase === "ready" && state.status.status === "ready") {
        statusProbeAttempts.current = 0;
      }
      return undefined;
    }
    const timer = window.setTimeout(() => {
      statusProbeAttempts.current += 1;
      const currentRequest = ++requestId.current;
      const shouldRestart =
        state.phase === "error" ||
        (state.phase === "ready" && state.status.status === "unavailable");
      // Normalize synchronous mock/IPC failures into the same promise path so
      // one bad probe cannot terminate the retry effect without updating UI.
      const probe = Promise.resolve().then(() =>
        shouldRestart ? restartRuntime() : getRuntimeStatus(),
      );
      void withTimeout(
        probe,
        RUNTIME_STATUS_TIMEOUT_MS,
        shouldRestart
          ? "RUNTIME_RESTART_TIMEOUT: Pi Bridge 正在后台启动，请稍后重试"
          : "RUNTIME_STATUS_TIMEOUT: Pi 运行时检测超时，后台仍会继续连接",
      )
        .then((status) => {
          if (requestId.current === currentRequest) setState({ phase: "ready", status });
        })
        .catch((error: unknown) => {
          if (requestId.current === currentRequest) {
            setState({ phase: "error", message: formatError(error) });
          }
        });
    }, RUNTIME_PROBE_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const updateRuntimeMode = useCallback(async (mode: RuntimeMode) => {
    if (typeof setRuntimeMode !== "function") return;
    statusProbeAttempts.current = 0;
    setRuntimeSettingsPhase("loading");
    setRuntimeSettingsError(null);
    try {
      const settings = await setRuntimeMode(mode);
      setRuntimeModeState(settings.runtimeMode);
      setRuntimeSettingsPhase("ready");
    } catch (error) {
      setRuntimeSettingsPhase("error");
      setRuntimeSettingsError(formatError(error));
      throw error;
    }
  }, []);

  return {
    ...state,
    refresh,
    runtimeMode,
    runtimeSettingsPhase,
    runtimeSettingsError,
    setRuntimeMode: updateRuntimeMode,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
