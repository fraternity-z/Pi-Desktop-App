import { CircleAlert, CircleCheck, LoaderCircle, RefreshCw } from "lucide-react";

import type { AgentEventConnection } from "../stores/useChatSession";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";

interface RuntimeStatusControlProps {
  runtime: RuntimeStatusController;
  eventConnection: AgentEventConnection;
}

export function RuntimeStatusControl({ runtime, eventConnection }: RuntimeStatusControlProps) {
  if (runtime.phase === "loading") {
    return (
      <div className="runtime-control runtime-control-loading" aria-live="polite">
        <LoaderCircle className="spin" size={16} />
        <span>正在检测运行时</span>
      </div>
    );
  }

  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const connectionReady = eventConnection === "ready";

  return (
    <div className={`runtime-control${runtimeReady && connectionReady ? " runtime-control-ready" : ""}`}>
      {runtimeReady && connectionReady ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
      <span>
        {runtimeReady
          ? `Pi ${runtime.status.piVersion ?? "ready"} · Node ${runtime.status.nodeVersion ?? "ready"}`
          : "运行时不可用"}
      </span>
      <button
        className="icon-button runtime-refresh-button"
        type="button"
        onClick={() => void runtime.refresh()}
        aria-label="重新检测运行时"
        title="重新检测运行时"
      >
        <RefreshCw size={15} />
      </button>
    </div>
  );
}
