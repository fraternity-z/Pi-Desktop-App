import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";

import type { AgentEventConnection } from "../stores/useChatSession";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";

interface RuntimeStatusControlProps {
  runtime: RuntimeStatusController;
  eventConnection: AgentEventConnection;
}

export function RuntimeStatusControl({ runtime, eventConnection }: RuntimeStatusControlProps) {
  if (
    runtime.phase === "loading" ||
    (runtime.phase === "ready" && runtime.status.status === "starting") ||
    eventConnection === "connecting"
  ) {
    return (
      <span
        className="runtime-status-icon runtime-status-icon-loading"
        role="status"
        aria-label="正在检测运行状态"
        title="正在检测运行状态"
      >
        <LoaderCircle className="spin" size={18} aria-hidden="true" />
      </span>
    );
  }

  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const connectionReady = eventConnection === "ready";
  const ready = runtimeReady && connectionReady;
  const detail = ready
    ? `状态正常：Pi ${runtime.status.piVersion ?? "ready"} · Node ${runtime.status.nodeVersion ?? "ready"}`
    : "状态异常";

  return (
    <span
      className={`runtime-status-icon runtime-status-icon-${ready ? "ready" : "error"}`}
      role="status"
      aria-label={ready ? "状态正常" : "状态异常"}
      title={detail}
    >
      {ready ? (
        <CircleCheck size={18} aria-hidden="true" />
      ) : (
        <CircleX size={18} aria-hidden="true" />
      )}
    </span>
  );
}
