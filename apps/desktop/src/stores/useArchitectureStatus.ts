import { useEffect, useState } from "react";

import {
  getArchitectureStatus,
  type ArchitectureStatus,
} from "../ipc/system";

type StatusState =
  | { phase: "loading" }
  | { phase: "ready"; status: ArchitectureStatus }
  | { phase: "error"; message: string };

export function useArchitectureStatus(): StatusState {
  const [state, setState] = useState<StatusState>({ phase: "loading" });

  useEffect(() => {
    let active = true;

    getArchitectureStatus()
      .then((status) => {
        if (active) {
          setState({ phase: "ready", status });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : String(error);
          setState({ phase: "error", message });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}

