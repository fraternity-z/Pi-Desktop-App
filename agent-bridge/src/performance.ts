import { performance } from "node:perf_hooks";

export const PERFORMANCE_DIAGNOSTIC_PREFIX = "PI_BRIDGE_DIAGNOSTIC ";

export type PerformanceOperation =
  | "startup"
  | "model.runtime"
  | "session.create"
  | "session.open"
  | "resource.list"
  | "command.list";

export type PerformancePhase =
  | "sdk.import"
  | "model.initialize"
  | "session.manager"
  | "resource.reload"
  | "session.create"
  | "history.project"
  | "total";

export interface PerformanceDiagnostic {
  event: "performance";
  operation: PerformanceOperation;
  phase: PerformancePhase;
  durationMs: number;
  outcome: "ok" | "slow" | "error";
}

export type PerformanceDiagnosticSink = (diagnostic: PerformanceDiagnostic) => void;

const SLOW_OPERATION_MS = 3_000;

export const stderrPerformanceDiagnosticSink: PerformanceDiagnosticSink = (diagnostic) => {
  process.stderr.write(`${PERFORMANCE_DIAGNOSTIC_PREFIX}${JSON.stringify(diagnostic)}\n`);
};

export function performanceNow(): number {
  return performance.now();
}

export function emitPerformanceDiagnostic(
  sink: PerformanceDiagnosticSink,
  operation: PerformanceOperation,
  phase: PerformancePhase,
  startedAt: number,
  failed = false,
): void {
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  sink({
    event: "performance",
    operation,
    phase,
    durationMs,
    outcome: failed ? "error" : durationMs >= SLOW_OPERATION_MS ? "slow" : "ok",
  });
}

export async function measurePerformance<T>(
  sink: PerformanceDiagnosticSink,
  operation: PerformanceOperation,
  phase: PerformancePhase,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await task();
    emitPerformanceDiagnostic(sink, operation, phase, startedAt);
    return result;
  } catch (error) {
    emitPerformanceDiagnostic(sink, operation, phase, startedAt, true);
    throw error;
  }
}

export function measurePerformanceSync<T>(
  sink: PerformanceDiagnosticSink,
  operation: PerformanceOperation,
  phase: PerformancePhase,
  task: () => T,
): T {
  const startedAt = performance.now();
  try {
    const result = task();
    emitPerformanceDiagnostic(sink, operation, phase, startedAt);
    return result;
  } catch (error) {
    emitPerformanceDiagnostic(sink, operation, phase, startedAt, true);
    throw error;
  }
}
