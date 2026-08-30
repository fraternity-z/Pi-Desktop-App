import { useCallback, useEffect, useRef, useState } from "react";

import {
  getRuntimeStatus,
  listenToRuntimeStatus,
  restartRuntime,
  type RuntimeStatus,
} from "../ipc/system";

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
      const status = await restartRuntime();
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

    void (async () => {
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

      if (!active) return;
      const revision = eventRevision;
      const currentRequest = ++requestId.current;
      try {
        const status = await getRuntimeStatus();
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

    return () => {
      active = false;
      requestId.current += 1;
      unlisten?.();
    };
  }, []);

  return { ...state, refresh };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
