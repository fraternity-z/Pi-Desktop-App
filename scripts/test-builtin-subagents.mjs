import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

// Uses the installed SDK, never user configuration
// or a live provider: only the model transport and authentication are fixtures.
for (const longContent of [false, true]) test(`official SDK preserves ${longContent ? "long paginated" : "short"} child transcripts and restores history`, async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sdkPath = process.env.PI_SUBAGENT_TEST_SDK ?? join(root, "src-tauri/resources/pi-bridge/pi-runtime/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  const sdk = await import(pathToFileURL(sdkPath).href);
  const temporary = await mkdtemp(join(tmpdir(), "pi-builtin-subagents-"));
  const cwd = join(temporary, "workspace");
  const agentDir = join(temporary, "agent");
  await mkdir(cwd); await mkdir(agentDir);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network is forbidden in SDK smoke test"); };
  let runtime;
  try {
    const require = createRequire(join(root, "agent-bridge/package.json"));
    const { build } = require("esbuild");
    const bundle = join(temporary, "session-runtime.mjs");
    await build({ entryPoints: [join(root, "agent-bridge/src/session-runtime.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", mainFields: ["module", "main"], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
    const { PiSessionRuntime } = await import(pathToFileURL(bundle).href);
    const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), refreshOnCreate: false });
    const model = { id: "offline-fixture", name: "Offline fixture", provider: "fixture", api: "openai-completions", baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
    modelRuntime.getModel = () => model;
    modelRuntime.hasConfiguredAuth = () => true;
    modelRuntime.checkAuth = async () => ({ apiKey: "offline-fixture" });
    modelRuntime.getAuth = async () => ({ auth: { apiKey: "offline-fixture" }, env: {} });
    const childTask = "child inspection task";
    const fileContent = longContent ? "完整工具文本 😀\n".repeat(1_200) : "verified child edit\n";
    const childReply = longContent ? "完整回复😀\n".repeat(16_000) : "child verified result";
    let requests = 0;
    modelRuntime.streamSimple = (_model, context) => {
      requests++;
      const user = context.messages.find((message) => message.role === "user");
      const text = typeof user?.content === "string" ? user.content : user?.content?.map((block) => block.text ?? "").join("");
      const child = text === childTask;
      const toolReturned = context.messages.some((message) => message.role === "toolResult");
      const needsRead = child && longContent && toolReturned && !context.messages.some((message) => message.role === "toolResult" && message.toolCallId === "fixture-read");
      const content = needsRead
        ? [{ type: "toolCall", id: "fixture-read", name: "read", arguments: { path: "child-note.txt" } }]
        : toolReturned
        ? [{ type: "text", text: child ? childReply : "parent verified result" }]
        : child
          ? [{ type: "thinking", thinking: "inspect the child workspace" }, { type: "toolCall", id: "fixture-write", name: "write", arguments: { path: "child-note.txt", content: fileContent } }]
          : [{ type: "toolCall", id: "fixture-delegation", name: "subagent", arguments: { agent: "inspector", task: childTask } }];
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content, stopReason: toolReturned && !needsRead ? "stop" : "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      return {
        async *[Symbol.asyncIterator]() { yield { type: "done", reason: message.stopReason, message }; },
        result: async () => message,
      };
    };
    const sessions = [];
    const adapter = {
      ...sdk, ModelRuntime: { create: async () => modelRuntime },
      createAgentSession: async (options) => {
        const result = await sdk.createAgentSession({ ...options, model: options.model ?? model, thinkingLevel: options.thinkingLevel ?? "low" });
        sessions.push({ options, session: result.session });
        return result;
      },
    };
    runtime = new PiSessionRuntime(adapter, agentDir);
    const events = []; runtime.subscribe((event) => events.push(event));
    const parent = await runtime.createSession(cwd);
    assert.ok(parent.configuration.activeToolNames.includes("subagent"));
    await runtime.configureSession(parent.sessionId, { permissionMode: "auto" });
    await runtime.prompt(parent.sessionId, "delegate the inspection");
    assert.equal(requests, longContent ? 5 : 4, JSON.stringify(events.filter((event) => event.name.includes("failed"))));
    assert.equal(sessions.length, 2);
    assert.equal(sessions[1].session.sessionFile, undefined);
    assert.ok(!sessions[1].session.getAllTools().some((tool) => tool.name === "subagent"));
    assert.equal(await readFile(join(cwd, "child-note.txt"), "utf8"), fileContent);
    const review = await runtime.listReviews(parent.sessionId, cwd);
    assert.equal(review.entries.length, 1);
    assert.equal(review.entries[0].path, "child-note.txt");
    assert.equal(review.entries[0].status, "ready");
    const transcript = events.flatMap((event) => event.data?.subagents ?? []).at(-1);
    const fullTranscript = (owner, childId) => {
      let text = ""; let cursor;
      do { const page = runtime.readSubagentTranscript(owner, childId, cursor); text += page.text; cursor = page.nextCursor ?? undefined; } while (cursor);
      return JSON.parse(text);
    };
    assert.equal(transcript.transcriptAvailable, true);
    const full = fullTranscript(parent.sessionId, transcript.id);
    assert.equal(full.filter((message) => message.role === "user").length, 1);
    assert.equal(full.filter((message) => message.role === "tool").length, longContent ? 2 : 1);
    assert.equal(full.at(-1).content, childReply);
    const fullWrite = full.find((message) => message.role === "tool" && message.toolName === "write");
    assert.equal(JSON.parse(fullWrite.toolInput.text).content, fileContent);
    assert.equal(fullWrite.toolInput.truncated, false);
    if (longContent) {
      assert.ok(runtime.readSubagentTranscript(parent.sessionId, transcript.id).nextCursor);
      const fullRead = full.find((message) => message.role === "tool" && message.toolName === "read");
      assert.equal(fullRead.toolOutput.text, fileContent);
      assert.equal(fullRead.toolOutput.truncated, false);
    }
    assert.equal(transcript.status, "completed");
    assert.equal(transcript.task, "child inspection task");
    assert.ok(transcript.messages.some((message) => message.role === "user" && message.content === "child inspection task"));
    assert.ok(full.some((message) => message.role === "thinking"));
    const childTool = fullWrite;
    assert.equal(childTool.toolInput.format, "json");
    assert.equal(JSON.parse(childTool.toolInput.text).path, "child-note.txt");
    assert.equal(transcript.truncated, longContent);
    const sessionFile = sessions[0].session.sessionFile;
    await runtime.shutdown();
    runtime = new PiSessionRuntime(adapter, agentDir);
    const restored = await runtime.openSession(sessionFile);
    const persisted = restored.messages.find((message) => message.subagents)?.subagents[0];
    assert.equal(persisted?.status, "completed");
    assert.equal(persisted.transcriptAvailable, true);
    assert.deepEqual(fullTranscript(restored.sessionId, persisted.id), full);
    assert.equal((await runtime.listReviews(restored.sessionId, cwd)).entries[0].status, "ready");
  } finally {
    await runtime?.shutdown();
    globalThis.fetch = originalFetch;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(temporary, { recursive: true, force: true });
  }
});
