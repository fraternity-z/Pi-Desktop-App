import { afterEach, describe, expect, it, vi } from "vitest";
import { BuiltinSubagents } from "./builtin-subagents.js";
import { projectSubagents } from "./subagents.js";
import { SubagentTranscripts } from "./subagent-transcripts.js";
import type { PiSessionLike } from "./session-runtime.js";

const projection = {
  redact: (text: string) => text.replace(/token=\S+/g, "token=[REDACTED]"),
  input: (value: unknown) => value === undefined ? undefined : ({ text: typeof value === "string" ? value : JSON.stringify(value, (key, entry) => key === "password" ? "[REDACTED]" : entry), format: "text" as const, truncated: false }),
  output: (value: unknown) => value === undefined ? undefined : ({ text: typeof value === "string" ? value : Array.isArray(value) ? value.filter((block) => block.type === "text").map((block) => block.text).join("") : JSON.stringify(value), format: "text" as const, truncated: false }),
};
const assistant = (text: string, extra: Record<string, unknown> = {}) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", ...extra });
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function child(run: (task: string, emit: (event: unknown) => void, session: PiSessionLike) => Promise<void> = async (_task, emit, session) => { const message = assistant("done"); session.messages.push(message); emit({ type: "message_end", message }); }) {
  let listener: (event: unknown) => void = () => undefined;
  const unsubscribe = vi.fn();
  const session: PiSessionLike = {
    sessionId: "child", isStreaming: false, thinkingLevel: "off", messages: [],
    model: { id: "selected", provider: "mock", name: "Mock", reasoning: false },
    prompt: vi.fn(async (task) => run(task, (event) => listener(event), session)),
    subscribe: vi.fn((callback) => { listener = callback; return unsubscribe; }),
    abort: vi.fn(async () => undefined), dispose: vi.fn(), clearQueue: vi.fn(),
    getSteeringMessages: () => [], getFollowUpMessages: () => [], setModel: vi.fn(async () => undefined),
  };
  const dispose = vi.fn(() => session.dispose());
  return { session, dispose, unsubscribe };
}
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("built-in subagent execution", () => {
  it("keeps every message and complete tool payload in the independently persisted archive", async () => {
    const long = "文😀\n".repeat(30_000);
    const fixture = child(async (task, emit, session) => {
      const messages = [
        { role: "user", content: task },
        ...Array.from({ length: 130 }, (_, index) => assistant(`message ${index}: ${"a".repeat(9000)}`)),
        assistant("", { content: [{ type: "toolCall", id: "long-tool", name: "write", arguments: { content: long } }] }),
        { role: "toolResult", toolCallId: "long-tool", toolName: "write", content: [{ type: "text", text: long }], isError: false },
        assistant(`FINAL ${long}`),
      ];
      for (const message of messages) { session.messages.push(message); emit({ type: "message_start", message }); emit({ type: "message_end", message }); }
    });
    const manager = new BuiltinSubagents(async () => fixture, projection);
    const entries: unknown[] = [];
    const sessionManager = { getSessionId: () => "parent", getBranch: () => entries, appendCustomEntry: (customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); } };
    manager.transcripts.initialize("parent", sessionManager);
    const result = await manager.tool.execute("call", { agent: "worker", task: "full task" });
    expect(result.details.results[0]).toMatchObject({ transcriptAvailable: true, status: "completed" });
    const restored = new SubagentTranscripts(); restored.initialize("parent", sessionManager);
    for (const archive of [manager.transcripts, restored]) {
      let text = ""; let cursor: string | undefined;
      do { const page = archive.read("call:0", cursor); text += page.text; cursor = page.nextCursor ?? undefined; } while (cursor);
      const messages = JSON.parse(text);
      expect(messages).toHaveLength(133);
      expect(messages[0]).toEqual({ role: "user", content: "full task" });
      expect(messages[1].content).toBe(`message 0: ${"a".repeat(9000)}`);
      expect(messages.at(-1).content).toBe(`FINAL ${long}`);
      const tool = messages.find((message: { role: string }) => message.role === "tool");
      expect(JSON.parse(tool.toolInput.text).content).toBe(long);
      expect(tool.toolOutput).toEqual({ text: long, format: "text", truncated: false });
    }
  });

  it("reconciles final SDK state while retaining events removed by compaction", async () => {
    const fixture = child(async (_task, emit, session) => {
      emit({ type: "message_end", message: assistant("before compaction", { timestamp: 1 }) });
      emit({ type: "message_start", message: assistant("partial", { timestamp: 2 }) });
      session.messages.push(assistant("complete final reply", { timestamp: 2 }));
    });
    const manager = new BuiltinSubagents(async () => fixture, projection);
    await manager.tool.execute("call", { agent: "worker", task: "task" });
    const messages = JSON.parse(manager.transcripts.read("call:0").text);
    expect(messages.map((message: { content: string }) => message.content)).toEqual(["task", "before compaction", "complete final reply"]);
  });

  it.each([null, {}, { agent: "a" }, { agent: "", task: "x" }, { agent: "a".repeat(129), task: "x" }, { agent: "a", task: "x".repeat(4097) }, { tasks: [] }, { tasks: Array.from({ length: 5 }, () => ({ agent: "a", task: "x" })) }, { agent: "a", task: "x", cwd: "outside" }, { tasks: [{ agent: "a", task: "x", model: "other" }] }, { tasks: [{ agent: "a", task: "x" }], chain: [] }, { agent: "a", task: "x", tools: [] }])("rejects invalid or override input %#", async (params) => {
    const create = vi.fn();
    await expect(new BuiltinSubagents(create, projection).tool.execute("id", params)).rejects.toThrow("SUBAGENT_INPUT_INVALID");
    expect(create).not.toHaveBeenCalled();
  });

  it("streams real task, thinking, tools and reply with actual model and immutable snapshots", async () => {
    vi.useFakeTimers();
    const updates: unknown[] = [];
    const fixture = child(async (task, emit, session) => {
      const user = { role: "user", content: [{ type: "text", text: task }] };
      emit({ type: "message_start", message: user }); emit({ type: "message_end", message: user });
      emit({ type: "message_start", message: assistant("") });
      const message = assistant("reply", { model: "actual", provider: "live", content: [{ type: "thinking", thinking: "consider", thinkingSignature: "hidden" }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "file", password: "hidden" } }, { type: "text", text: "reply" }] });
      emit({ type: "message_update", message });
      await vi.advanceTimersByTimeAsync(50);
      emit({ type: "message_end", message });
      emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "file" } });
      emit({ type: "tool_execution_update", toolCallId: "t1", toolName: "read", partialResult: { content: [{ type: "text", text: "part" }] } });
      emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "read", result: { content: [{ type: "text", text: "full" }], details: { signature: "hidden" } } });
      session.messages.push(user, message, { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "full" }] });
    });
    const manager = new BuiltinSubagents(async () => fixture, projection);
    const result = await manager.tool.execute("parent", { agent: "worker", task: "real instruction token=secret" }, undefined, (update) => updates.push(update));
    expect(result.details.results[0]).toMatchObject({ task: "real instruction token=[REDACTED]", status: "completed", model: "live/actual", usage: { turns: 1 } });
    expect(JSON.stringify(result)).toContain("consider");
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(JSON.stringify(result)).not.toContain("token=secret");
    expect(result.content[0]!.text).toBe("worker: reply");
    expect(JSON.stringify(updates[0])).not.toContain("reply");
    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(fixture.session.prompt).toHaveBeenCalledWith("real instruction token=secret", { expandPromptTemplates: false });
    expect(fixture.unsubscribe).toHaveBeenCalledOnce(); expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it("limits four children across independent calls and isolates child tool prefixes", async () => {
    const gate = deferred(); const fixtures = Array.from({ length: 4 }, () => child(async () => gate.promise));
    let next = 0; const create = vi.fn(async () => fixtures[next++]!);
    const manager = new BuiltinSubagents(create, projection);
    const tasks = [{ agent: "same", task: "one" }, { agent: "same", task: "two" }];
    const left = manager.tool.execute("duplicate", { tasks }); const right = manager.tool.execute("duplicate", { tasks });
    await tick();
    await expect(manager.tool.execute("fifth", tasks[0])).rejects.toThrow("SUBAGENT_BUSY");
    expect(create).toHaveBeenCalledTimes(4);
    const prefixes = create.mock.calls as unknown as Array<[AbortSignal, string]>;
    expect(new Set(prefixes.map((call) => call[1])).size).toBe(4);
    gate.resolve(); await Promise.all([left, right]);
    expect(fixtures.every((fixture) => fixture.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("marks completed peers while other parallel children remain running", async () => {
    const gate = deferred(); let count = 0; const updates: string[][] = [];
    const manager = new BuiltinSubagents(async () => count++ ? child(async () => gate.promise) : child(), projection);
    const running = manager.tool.execute("p", { tasks: [{ agent: "a", task: "one" }, { agent: "b", task: "two" }] }, undefined, (update) => updates.push(update.details.results.map((result) => result.status)));
    await tick(); expect(updates).toContainEqual(["completed", "running"]); gate.resolve(); await running;
  });

  it("substitutes previous final text in chains without including thinking", async () => {
    const fixtures = [child(async (_task, _emit, session) => { session.messages.push(assistant("first", { content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "first" }] })); }), child()];
    let index = 0; const manager = new BuiltinSubagents(async () => fixtures[index++]!, projection);
    const result = await manager.tool.execute("c", { chain: [{ agent: "a", task: "do first" }, { agent: "b", task: "Review {previous}" }] });
    expect(fixtures[1]!.session.prompt).toHaveBeenCalledWith("Review first", { expandPromptTemplates: false });
    expect(result.details.results[1]!.task).toBe("Review first");
    expect(result.content[0]!.text).not.toContain("private reasoning");
  });

  it.each(["error", "aborted", "pending", "deferred"])("recognizes resolved model %s and skips subsequent chain tasks", async (stopReason) => {
    const fixture = child(async (_task, _emit, session) => { session.messages.push(assistant("", { stopReason, errorMessage: "bad token=hidden" })); });
    const create = vi.fn(async () => fixture);
    const result = await new BuiltinSubagents(create, projection).tool.execute("c", { chain: [{ agent: "a", task: "one" }, { agent: "b", task: "two" }] });
    expect(result.details.results[0]!.status).toBe(stopReason === "aborted" ? "cancelled" : "failed");
    expect(result.details.results[1]!.status).toBe("cancelled"); expect(create).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("token=hidden");
  });

  it("reports expanded-chain overflow without silently cutting instructions", async () => {
    const create = vi.fn(async () => child(async (_task, _emit, session) => { session.messages.push(assistant("x".repeat(5000))); }));
    const result = await new BuiltinSubagents(create, projection).tool.execute("c", { chain: [{ agent: "a", task: "one" }, { agent: "b", task: "{previous}" }] });
    expect(result.details.results[1]!.errorMessage).toContain("4096"); expect(create).toHaveBeenCalledOnce();
  });

  it("does not create a child when the caller signal is already aborted", async () => {
    const controller = new AbortController(); controller.abort(); const create = vi.fn();
    const result = await new BuiltinSubagents(create, projection).tool.execute("p", { agent: "a", task: "task" }, controller.signal);
    expect(result.details.results[0]!.status).toBe("cancelled"); expect(create).not.toHaveBeenCalled();
  });

  it("waits for cancelled creation and disposes the eventual child without prompting", async () => {
    const gate = deferred<ReturnType<typeof child>>(); const fixture = child(); const controller = new AbortController();
    const manager = new BuiltinSubagents(async () => gate.promise, projection);
    const running = manager.tool.execute("p", { agent: "a", task: "task" }, controller.signal); await tick();
    controller.abort(); let settled = false; const cancelling = manager.cancel().then(() => { settled = true; });
    await tick(); expect(settled).toBe(false); gate.resolve(fixture); await cancelling;
    expect((await running).details.results[0]!.status).toBe("cancelled");
    expect(fixture.session.prompt).not.toHaveBeenCalled(); expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it("aborts a running prompt, retains output, and supports a later execution after cancel", async () => {
    const gate = deferred(); const fixture = child(async (_task, emit) => { emit({ type: "message_end", message: assistant("partial") }); await gate.promise; });
    vi.mocked(fixture.session.abort).mockImplementation(async () => { gate.resolve(); });
    const manager = new BuiltinSubagents(async () => fixture, projection); const controller = new AbortController();
    const running = manager.tool.execute("p", { agent: "a", task: "task" }, controller.signal); await tick(); controller.abort(); await manager.cancel();
    const result = await running; expect(result.details.results[0]!.status).toBe("cancelled"); expect(JSON.stringify(result)).toContain("partial");
    expect(fixture.session.abort).toHaveBeenCalledOnce(); expect(fixture.dispose).toHaveBeenCalledOnce();
    expect((await manager.tool.execute("next", { agent: "a", task: "next" })).details.results[0]!.status).toBe("completed");
  });

  it("close cancels all calls and permanently rejects new work", async () => {
    const gate = deferred(); const fixture = child(async () => gate.promise); vi.mocked(fixture.session.abort).mockImplementation(async () => { gate.resolve(); });
    const manager = new BuiltinSubagents(async () => fixture, projection); const running = manager.tool.execute("p", { agent: "a", task: "task" }); await tick();
    await manager.close(); expect((await running).isError).toBe(true);
    await expect(manager.tool.execute("next", { agent: "a", task: "task" })).rejects.toThrow("SUBAGENT_CLOSED");
  });

  it("sanitizes and bounds persisted details with large unicode transcripts", async () => {
    const manager = new BuiltinSubagents(async () => child(async (_task, emit, session) => {
      for (let index = 0; index < 110; index++) {
        const message = assistant("text", { content: [{ type: "text", text: "界".repeat(10000) }, { type: "image", data: "hidden-image" }, { type: "thinking", thinking: "token=hidden", signature: "hidden-signature" }], providerMetadata: { credential: "hidden-provider" } });
        session.messages.push(message); emit({ type: "message_end", message });
      }
    }), projection);
    const result = await manager.tool.execute("p", { tasks: Array.from({ length: 4 }, () => ({ agent: "a", task: "task" })) });
    expect(Buffer.byteLength(JSON.stringify(result.details), "utf8")).toBeLessThanOrEqual(200000);
    expect(result.details.results.every((item) => item.truncated && item.messages.length <= 100)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/hidden-image|hidden-signature|hidden-provider|token=hidden/);
    expect(result.details.results[0]!.usage.turns).toBe(110);
  });

  it("handles creation, subscription, prompt and cleanup errors without losing settlement", async () => {
    const createFailed = new BuiltinSubagents(async () => { throw new Error("create token=hidden"); }, projection);
    expect((await createFailed.tool.execute("p", { agent: "a", task: "t" })).details.results[0]!.errorMessage).toBe("create token=[REDACTED]");
    const fixture = child(async () => { throw new Error("prompt failed"); });
    const manager = new BuiltinSubagents(async () => fixture, projection);
    const result = await manager.tool.execute("p", { agent: "a", task: "t" }, undefined, () => { throw new Error("observer"); });
    expect(result.details.results[0]!.status).toBe("failed"); expect(fixture.unsubscribe).toHaveBeenCalledOnce(); expect(fixture.dispose).toHaveBeenCalledOnce();
    vi.mocked(fixture.session.subscribe).mockImplementation(() => { throw new Error("subscribe failed"); });
    expect((await manager.tool.execute("p2", { agent: "a", task: "t" })).isError).toBe(true);
    expect(fixture.dispose).toHaveBeenCalledTimes(2);
    vi.mocked(fixture.session.subscribe).mockImplementation(() => fixture.unsubscribe); fixture.unsubscribe.mockImplementation(() => { throw new Error("unsubscribe failed"); });
    expect((await manager.tool.execute("p3", { agent: "a", task: "t" })).details.results[0]!.errorMessage).toContain("解除");
    fixture.dispose.mockImplementation(() => { throw new Error("dispose failed"); });
    expect((await manager.tool.execute("p4", { agent: "a", task: "t" })).details.results[0]!.errorMessage).toContain("释放");
  });

  it("throttles token updates and flushes complete snapshots without retaining timers", async () => {
    vi.useFakeTimers(); const updates = vi.fn();
    const fixture = child(async (_task, emit) => {
      emit({ type: "message_start", message: assistant("") });
      for (let index = 0; index < 100; index++) emit({ type: "message_update", assistantMessageEvent: { partial: assistant(`part ${index}`) } });
      expect(updates).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(50); expect(updates).toHaveBeenCalledTimes(2);
      emit({ type: "message_end", message: assistant("final") });
    });
    const result = await new BuiltinSubagents(async () => fixture, projection).tool.execute("p", { agent: "a", task: "t" }, undefined, updates);
    expect(result.content[0]!.text).toBe("a: final"); expect(vi.getTimerCount()).toBe(0);
    expect(updates).toHaveBeenCalledTimes(4);
  });

  it("bounds whole details even with escaped tasks, errors and text", async () => {
    const fixture = () => child(async (_task, emit) => {
      for (let index = 0; index < 12; index++) emit({ type: "message_end", message: assistant("\u0001".repeat(4096)) });
      throw new Error("\u0001".repeat(4096));
    });
    const result = await new BuiltinSubagents(async () => fixture(), projection).tool.execute("p", { tasks: Array.from({ length: 4 }, () => ({ agent: "a", task: `task${"\u0001".repeat(4092)}` })) });
    expect(Buffer.byteLength(JSON.stringify(result.details))).toBeLessThanOrEqual(200000);
    expect(result.details.results.every((entry) => entry.truncated)).toBe(true);
  });

  it("retains standalone tool events and ignores unsupported event payloads", async () => {
    const fixture = child(async (_task, emit) => {
      emit(null); emit({ type: "other" }); emit({ type: "message_update" });
      emit({ type: "message_end", message: { role: "extension", content: "hidden" } });
      emit({ type: "tool_execution_start", toolCallId: "", toolName: "" });
      emit({ type: "tool_execution_start", toolCallId: "x", toolName: "read", args: { path: "file" } });
      emit({ type: "tool_execution_update", toolCallId: "x", toolName: "read", partialResult: "partial" });
      emit({ type: "tool_execution_end", toolCallId: "x", toolName: "read", result: { content: [{ type: "image", data: "hidden" }, { type: "text", text: "result" }] } });
      emit({ type: "message_end", message: { role: "assistant", content: "done", stopReason: "stop" } });
    });
    const result = await new BuiltinSubagents(async () => fixture, projection).tool.execute("p", { agent: "a", task: "t" });
    const entry = result.details.results[0]!;
    expect(entry.messages[0]!.content[0]).toMatchObject({ type: "toolCall", name: "read" });
    expect(entry.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
    expect(entry.truncated).toBe(false);
    expect(entry.messages.find((message) => message.role === "toolResult")?.toolOutput?.truncated).toBe(true);
    expect(result.content[0]!.text).toBe("a: done");
  });

  it("persists typed tool previews and reports only local truncation for long output", async () => {
    const typed = { ...projection, input: (value: unknown) => ({ text: JSON.stringify(value, null, 2), format: "json" as const, truncated: false }) };
    const fixture = child(async (task, emit, session) => {
      const messages = [
        { role: "user", content: task },
        assistant("", { content: [{ type: "toolCall", id: "cmd", name: "bash", arguments: { command: "git status" } }] }),
        { role: "toolResult", toolCallId: "cmd", toolName: "bash", content: [{ type: "text", text: "output\n".repeat(1000) }] },
        assistant("final answer"),
      ];
      for (const message of messages) { session.messages.push(message); emit({ type: "message_end", message }); }
    });
    const updates: unknown[] = [];
    const result = await new BuiltinSubagents(async () => fixture, typed).tool.execute("p", { agent: "a", task: "inspect" }, undefined, (update) => updates.push(update.details));
    for (const details of [result.details, JSON.parse(JSON.stringify(result.details)), updates.at(-1)]) {
      const snapshot = projectSubagents("p", undefined, details, "complete", typed)![0]!;
      expect(snapshot.truncated).toBe(false);
      expect(snapshot.messages.at(-1)?.content).toBe("final answer");
      expect(snapshot.messages.find((message) => message.role === "tool")).toMatchObject({
        toolInput: { text: JSON.stringify({ command: "git status" }, null, 2), format: "json", truncated: false },
        toolOutput: { format: "text", truncated: true },
      });
    }
  });

  it("preserves each final reply after transcript eviction and escaped byte limits", async () => {
    const manager = new BuiltinSubagents(async () => child(async (task, _emit, session) => {
      session.messages.push({ role: "user", content: task });
      for (let index = 0; index < 110; index++) session.messages.push(assistant("older ".repeat(1500)));
      session.messages.push(assistant(`FINAL ${"\u0001".repeat(8000)}`));
    }), projection);
    const result = await manager.tool.execute("p", { tasks: Array.from({ length: 4 }, (_, index) => ({ agent: `peer-${index}`, task: "inspect" })) });
    expect(Buffer.byteLength(JSON.stringify(result.details))).toBeLessThanOrEqual(200000);
    for (const item of result.details.results) {
      expect(item.truncated).toBe(true);
      expect(item.messages.at(-1)?.content.at(-1)?.text).toEqual(expect.stringContaining("FINAL"));
    }
    const projected = projectSubagents("p", undefined, result.details, "complete", projection)!;
    expect(projected).toHaveLength(4);
    expect(projected.every((item) => item.messages.at(-1)?.content.startsWith("FINAL"))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(100000);
  });

  it("cleans up even if SDK abort rejects", async () => {
    const gate = deferred(); const fixture = child(async () => gate.promise);
    vi.mocked(fixture.session.abort).mockImplementation(async () => { gate.resolve(); throw new Error("abort rejected"); });
    const manager = new BuiltinSubagents(async () => fixture, projection);
    const execution = manager.tool.execute("p", { agent: "a", task: "t" }); await tick(); await manager.cancel();
    expect((await execution).details.results[0]!.status).toBe("cancelled"); expect(fixture.dispose).toHaveBeenCalledOnce();
  });
});
