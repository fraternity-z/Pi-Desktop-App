import { useCallback, useEffect, useRef, useState } from "react";

import { checkForUpdates, type UpdateCheckResult } from "../ipc/update";

export type AppUpdatePhase = "idle" | "checking" | "ready" | "error";

export interface AppUpdateState {
  phase: AppUpdatePhase;
  result: UpdateCheckResult | null;
  error: string | null;
}

export interface AppUpdateController extends AppUpdateState {
  check: () => Promise<void>;
  reset: () => void;
}

const IDLE_STATE: AppUpdateState = {
  phase: "idle",
  result: null,
  error: null,
};

export function useAppUpdate(): AppUpdateController {
  const [state, setState] = useState<AppUpdateState>(IDLE_STATE);
  const aliveRef = useRef(true);
  const requestIdRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    inFlightRef.current = null;
    setState(IDLE_STATE);
  }, []);

  const check = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const requestId = ++requestIdRef.current;
    setState({ phase: "checking", result: null, error: null });
    const request = (async () => {
      try {
        const result = await checkForUpdates();
        if (aliveRef.current && requestIdRef.current === requestId) {
          setState({ phase: "ready", result, error: null });
        }
      } catch (error) {
        if (aliveRef.current && requestIdRef.current === requestId) {
          setState({ phase: "error", result: null, error: formatError(error) });
        }
      }
    })();
    inFlightRef.current = request;
    void request.then(() => {
      if (inFlightRef.current === request) inFlightRef.current = null;
    });
    return request;
  }, []);

  return { ...state, check, reset };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") {
    const code = typeof error.code === "string" ? `${error.code}: ` : "";
    return `${code}${error.message}`;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
