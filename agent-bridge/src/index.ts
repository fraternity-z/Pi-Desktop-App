import { createInterface } from "node:readline";

import { CliError, parseBridgeOptions } from "./cli.js";
import {
  emitPerformanceDiagnostic,
  measurePerformance,
  performanceNow,
  stderrPerformanceDiagnosticSink,
} from "./performance.js";
import { createHello, serializeFrame, type BridgeStartupError } from "./protocol.js";
import { loadPiSdk, SdkLoadError } from "./sdk-loader.js";
import { BridgeServer } from "./server.js";
import { PiSessionRuntime } from "./session-runtime.js";

function startupFailure(error: unknown): BridgeStartupError {
  if (error instanceof CliError || error instanceof SdkLoadError) {
    return {
      type: "startup.error",
      error: { code: error.code, message: error.message },
    };
  }
  return {
    type: "startup.error",
    error: { code: "STARTUP_FAILED", message: "Bridge 启动失败" },
  };
}

async function run(): Promise<void> {
  const startupStartedAt = performanceNow();
  try {
    const options = parseBridgeOptions(process.argv.slice(2));
    const loadedSdk = await measurePerformance(
      stderrPerformanceDiagnosticSink,
      "startup",
      "sdk.import",
      () => loadPiSdk(options.sdkRoot),
    );
    const runtime = new PiSessionRuntime(
      loadedSdk.sdk,
      options.agentDir,
      undefined,
      stderrPerformanceDiagnosticSink,
    );
    const server = new BridgeServer(
      runtime,
      createHello(loadedSdk.version),
      (frame) => process.stdout.write(serializeFrame(frame)),
    );
    server.start();
    runtime.warmUp();
    emitPerformanceDiagnostic(
      stderrPerformanceDiagnosticSink,
      "startup",
      "total",
      startupStartedAt,
    );

    const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
    const pending = new Set<Promise<void>>();

    await new Promise<void>((resolve) => {
      lines.on("line", (line) => {
        let task: Promise<void>;
        task = server
          .handleLine(line)
          .then((keepRunning) => {
            if (!keepRunning) {
              lines.close();
            }
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      });
      lines.once("close", resolve);
    });

    await server.close();
    await Promise.allSettled([...pending]);
  } catch (error) {
    emitPerformanceDiagnostic(
      stderrPerformanceDiagnosticSink,
      "startup",
      "total",
      startupStartedAt,
      true,
    );
    throw error;
  }
}

run().catch((error: unknown) => {
  const failure = startupFailure(error);
  process.stdout.write(serializeFrame(failure));
  process.stderr.write(`Pi Bridge 启动失败：${failure.error.code}\n`);
  process.exitCode = 1;
});
