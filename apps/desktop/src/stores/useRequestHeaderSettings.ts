import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_REQUEST_HEADER_SETTINGS,
  getRequestHeaderSettings,
  updateRequestHeaderSettings,
  type RequestHeaderSettings,
} from "../ipc/settings";

export interface RequestHeaderSettingsController {
  phase: "loading" | "ready" | "error";
  settings: RequestHeaderSettings;
  saving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (patch: Partial<RequestHeaderSettings>) => Promise<boolean>;
}

interface RequestHeaderSettingsState {
  phase: RequestHeaderSettingsController["phase"];
  settings: RequestHeaderSettings;
  saving: boolean;
  error: string | null;
}

export function useRequestHeaderSettings(): RequestHeaderSettingsController {
  const [state, setState] = useState<RequestHeaderSettingsState>({
    phase: "loading",
    settings: DEFAULT_REQUEST_HEADER_SETTINGS,
    saving: false,
    error: null,
  });
  const settingsRef = useRef(DEFAULT_REQUEST_HEADER_SETTINGS);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, phase: "loading", saving: false, error: null }));
    try {
      const settings = await getRequestHeaderSettings();
      if (requestId.current === currentRequest) {
        settingsRef.current = settings;
        setState({ phase: "ready", settings, saving: false, error: null });
      }
    } catch (error) {
      if (requestId.current === currentRequest) {
        setState((current) => ({
          ...current,
          phase: "error",
          saving: false,
          error: formatError(error),
        }));
      }
    }
  }, []);

  const update = useCallback(async (patch: Partial<RequestHeaderSettings>) => {
    const previous = settingsRef.current;
    const settings = { ...previous, ...patch };
    const currentRequest = ++requestId.current;
    settingsRef.current = settings;
    setState({ phase: "ready", settings, saving: true, error: null });
    try {
      const saved = await updateRequestHeaderSettings(settings);
      if (requestId.current === currentRequest) {
        settingsRef.current = saved;
        setState({ phase: "ready", settings: saved, saving: false, error: null });
      }
      return true;
    } catch (error) {
      if (requestId.current === currentRequest) {
        settingsRef.current = previous;
        setState({
          phase: "ready",
          settings: previous,
          saving: false,
          error: formatError(error),
        });
      }
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh, update };
}

function formatError(error: unknown): string {
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
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
