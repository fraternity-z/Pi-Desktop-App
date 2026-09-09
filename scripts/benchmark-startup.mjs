import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "..");
const runtime = join(root, "src-tauri", "resources", "pi-bridge", "pi-runtime");
const node = process.argv[2] ?? join(runtime, process.platform === "win32" ? "node.exe" : "node");
const sdk = process.argv[3] ?? join(runtime, "node_modules", "@earendil-works", "pi-coding-agent");
const bridge = join(root, "src-tauri", "resources", "pi-bridge", "pi-bridge.mjs");
const temporary = await mkdtemp(join(tmpdir(), "pi-desktop-startup-benchmark-"));
const samples = [];

async function sample(index) {
  const agentDir = join(temporary, `agent-${index}`);
  await mkdir(agentDir);
  const workspace = join(temporary, `workspace-${index}`);
  await mkdir(workspace);
  const home = join(temporary, "home");
  await mkdir(home, { recursive: true });
  const started = performance.now();
  const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, HOME: home, USERPROFILE: home };
  // Control runs use the same Node/SDK and isolate cache from user sessions.
  if (process.env.PI_BENCH_DISABLE_CACHE === "1") env.NODE_DISABLE_COMPILE_CACHE = "1";
  else delete env.NODE_DISABLE_COMPILE_CACHE;
  // Enabling via env would also optimize the baseline; use the app's activation path instead.
  delete env.NODE_COMPILE_CACHE;
  env.PI_DESKTOP_COMPILE_CACHE_DIR = join(temporary, "compile-cache");
  const child = spawn(node, [bridge, "--protocol", "v1", "--stdio", "--sdk-root", sdk, "--agent-dir", agentDir], {
    cwd: temporary, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const diagnostics = [];
  let helloMs;
  let healthMs;
  let catalogMs;
  let sessionReadyMs;
  let sessionRequestedAt;
  let firstSessionMs;
  let nextSessionRequestedAt;
  let subsequentSessionMs;
  let nodeVersion;
  const catalogs = new Set();
  const ecosystem = new Set();
  const lines = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  let failure;
  stderr.on("line", (line) => {
    if (!line.startsWith("PI_BRIDGE_DIAGNOSTIC ")) return;
    try { diagnostics.push(JSON.parse(line.slice("PI_BRIDGE_DIAGNOSTIC ".length))); } catch { /* non-diagnostic output is never logged */ }
  });
  lines.on("line", (line) => {
    try {
      const frame = JSON.parse(line);
      if (frame.kind === "response" && frame.ok !== true) {
        failure = new Error(`Bridge operation failed: ${frame.error?.code}`);
        child.kill();
        return;
      }
      if (frame.type === "hello") {
        nodeVersion = frame.nodeVersion;
        helloMs = performance.now() - started;
        child.stdin.write(`${JSON.stringify({ v: 1, id: "benchmark-health", op: "health" })}\n`);
      } else if (frame.id === "benchmark-health") {
        healthMs = performance.now() - started;
        child.stdin.write(`${JSON.stringify({ v: 1, id: "benchmark-models", op: "model.list" })}\n`);
        child.stdin.write(`${JSON.stringify({ v: 1, id: "benchmark-sessions", op: "session.list" })}\n`);
      } else if (["benchmark-models", "benchmark-sessions"].includes(frame.id)) {
        catalogs.add(frame.id);
        if (catalogs.size === 2) {
          catalogMs = performance.now() - started;
          sessionRequestedAt = performance.now();
          child.stdin.write(`${JSON.stringify({ v: 1, id: "benchmark-create", op: "session.create", cwd: workspace })}\n`);
        }
      } else if (frame.id === "benchmark-create") {
        sessionReadyMs = performance.now() - started;
        firstSessionMs = performance.now() - sessionRequestedAt;
        nextSessionRequestedAt = performance.now();
        child.stdin.write(`${JSON.stringify({ v: 1, id: "benchmark-next-create", op: "session.create", cwd: workspace })}\n`);
      } else if (frame.id === "benchmark-next-create") {
        subsequentSessionMs = performance.now() - nextSessionRequestedAt;
        if (process.env.PI_BENCH_VERIFY_ECOSYSTEM === "1") {
          if (typeof frame.data?.sessionId !== "string") throw new Error("Missing session ID");
          for (const request of [
            { id: "benchmark-packages", op: "package.list", cwd: workspace },
            { id: "benchmark-resources", op: "resource.list", cwd: workspace },
            { id: "benchmark-commands", op: "command.list", sessionId: frame.data.sessionId },
          ]) child.stdin.write(`${JSON.stringify({ v: 1, ...request })}\n`);
        } else child.stdin.write(`${JSON.stringify({ v: 1, id: "benchmark-shutdown", op: "shutdown" })}\n`);
      } else if (["benchmark-packages", "benchmark-resources", "benchmark-commands"].includes(frame.id)) {
        ecosystem.add(frame.id);
        if (ecosystem.size === 3) child.stdin.write(`${JSON.stringify({ v: 1, id: "benchmark-shutdown", op: "shutdown" })}\n`);
      } else if (frame.type === "startup.error") {
        failure = new Error(`Bridge startup failed: ${frame.error?.code}`);
      }
    } catch { failure = new Error("Bridge returned invalid JSONL"); child.kill(); }
  });
  await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => { failure = new Error("Bridge benchmark timed out"); child.kill(); }, 60_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      lines.close(); stderr.close();
      if (failure) reject(failure);
      else if (code !== 0 || helloMs === undefined || healthMs === undefined || catalogMs === undefined || sessionReadyMs === undefined || subsequentSessionMs === undefined) reject(new Error(`Incomplete benchmark (exit=${code})`));
      else resolveExit();
    });
  });
  return { run: index, nodeVersion, helloMs: +helloMs.toFixed(2), healthMs: +healthMs.toFixed(2), catalogMs: +catalogMs.toFixed(2), sessionReadyMs: +sessionReadyMs.toFixed(2), firstSessionMs: +firstSessionMs.toFixed(2), subsequentSessionMs: +subsequentSessionMs.toFixed(2), ecosystemChecks: ecosystem.size, diagnostics };
}

try {
  for (let index = 0; index < 6; index += 1) samples.push(await sample(index));
  const warm = samples.slice(1).map((sample) => sample.helloMs).sort((a, b) => a - b);
  const median = (key) => samples.slice(1).map((sample) => sample[key]).sort((a, b) => a - b)[2];
  console.log(JSON.stringify({ platform: process.platform, startupContract: "full-sdk-ready", nodeVersion: samples[0].nodeVersion, cacheDisabled: process.env.PI_BENCH_DISABLE_CACHE === "1",
    coldHelloMs: samples[0].helloMs, warmHelloMedianMs: warm[2], warmHelloMaxMs: warm.at(-1), firstSessionMedianMs: median("firstSessionMs"), subsequentSessionMedianMs: median("subsequentSessionMs"), samples }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
