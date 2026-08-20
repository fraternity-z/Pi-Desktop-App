import { useCallback, useEffect, useRef, useState } from "react";

import { getRuntimeStatus, type RuntimeStatus } from "../ipc/system";

export type RuntimeStatusState =
  | { phase: "loading" }
  | { phase: "ready"; status: RuntimeStatus }
  | { phase: "error"; message: string };

export type RuntimeStatusController = RuntimeStatusState & {
  refresh: () => Promise<void>;
};

export function useRuntimeStatus(): RuntimeStatusController {
  const [state, setState] = useState<RuntimeStatusState>({ phase: "loading" });
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState({ phase: "loading" });
    try {
      const status = await getRuntimeStatus();
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
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  return { ...state, refresh };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
