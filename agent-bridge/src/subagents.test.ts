import { describe, expect, it } from "vitest";
import { fitSubagents, projectSubagents } from "./subagents.js";
const projection = {
  redact: (text: string) => text.replace(/token=\S+/g, "token=[REDACTED]"),
  input: (value: unknown) => value === undefined ? undefined : ({ text: JSON.stringify(value), format: "json" as const, truncated: false }),
  output: (value: unknown) => value === undefined ? undefined : ({ text: JSON.stringify(value), format: "text" as const, truncated: false }),
};
describe("subagent projection", () => {
  const chain = { chain: [{ agent: "a", task: "one" }, { agent: "a", task: "two" }, { agent: "a", task: "three" }] };
  it("preserves explicit built-in peer status and truncation across progress and history", () => {
    const states = ["completed", "running", "pending", "failed", "cancelled"];
    const details = { mode: "parallel", results: states.map((status, index) => ({ agent: `peer-${index}`, task: "inspect", status, truncated: true, exitCode: -1, messages: [] })) };
    const update = projectSubagents("t", undefined, details, "update", projection)!;
    expect(update.map((item) => item.status)).toEqual(states);
    expect(update.every((item) => item.truncated)).toBe(true);
    const history = projectSubagents("t", undefined, JSON.parse(JSON.stringify(details)), "complete", projection)!;
    expect(history.map((item) => item.status)).toEqual(["completed", "cancelled", "cancelled", "failed", "cancelled"]);
    expect(history.every((item) => item.truncated)).toBe(true);
  });
  it("keeps future chain steps pending and cancels skipped steps on failure", () => {
    const seed = projectSubagents("t", chain, undefined, "start", projection)!;
    expect(seed.map((item) => item.status)).toEqual(["running", "pending", "pending"]);
    const details = { mode: "chain", results: [{ agent: "a", task: "one", exitCode: 0, messages: [] }, { agent: "a", task: "two", exitCode: 0, messages: [] }] };
    const update = projectSubagents("t", undefined, details, "update", projection, seed)!;
    expect(update.map((item) => item.status)).toEqual(["completed", "running", "pending"]);
    details.results[1]!.exitCode = 1;
    expect(projectSubagents("t", undefined, details, "failed", projection, update)!.map((item) => item.status)).toEqual(["completed", "failed", "cancelled"]);
  });
  it("recognizes cancellation and rejects unrecognizable raw structures", () => {
    expect(projectSubagents("t", undefined, { results: ["bad"] }, "update", projection)).toBeUndefined();
    expect(projectSubagents("t", undefined, { mode: "single", results: [{ agent: "a", task: "t", exitCode: 0, stopReason: "aborted", messages: [] }] }, "complete", projection)?.[0]?.status).toBe("cancelled");
  });
  it("keeps the original delegated task when pi-subagents redacts progress and final results", () => {
    const input = { agent: "delegate", task: "Calculate 17 × 23 token=private" };
    const started = projectSubagents("t", input, undefined, "start", projection)!;
    const details = { mode: "single", results: [{ agent: "delegate", task: "[prompt redacted]", exitCode: 0, finalOutput: "SUBAGENT_OK: 391" }] };
    const live = projectSubagents("t", undefined, details, "complete", projection, started)!;
    expect(live[0]).toMatchObject({ task: "Calculate 17 × 23 token=[REDACTED]", status: "completed", messages: [
      { role: "system", content: expect.stringContaining("扩展未提供完整会话") },
      { role: "assistant", content: "SUBAGENT_OK: 391" },
    ] });
    expect(projectSubagents("t", input, details, "complete", projection)).toEqual(live);
    expect(projectSubagents("t", undefined, details, "complete", projection)?.[0]?.task).toBe("[prompt redacted]");
  });
  it("updates compact progress without inventing roles or duplicating snapshots", () => {
    const result = { agent: "delegate", task: "[prompt redacted]", exitCode: 0, progress: { recentOutput: ["Working token=private", "read output"] } };
    const details = { mode: "single", results: [result] };
    const update = projectSubagents("t", { agent: "delegate", task: "inspect" }, details, "update", projection)!;
    expect(update[0]!.messages).toEqual([{ role: "system", content: "子代理进度摘要（扩展未提供完整会话）\n\nWorking token=[REDACTED]\nread output" }]);
    expect(projectSubagents("t", undefined, details, "update", projection, update)).toEqual(update);
    const complete = projectSubagents("t", undefined, { mode: "single", results: [{ ...result, messages: [], finalOutput: "done token=private" }] }, "complete", projection, update)!;
    expect(complete[0]!.messages.at(-1)).toEqual({ role: "assistant", content: "done token=[REDACTED]" });
    expect(JSON.stringify(complete)).not.toContain("Working");
  });
  it("prefers full transcripts and resolved tasks to compact fallbacks", () => {
    const details = { mode: "single", results: [{ agent: "delegate", task: "resolved task", exitCode: 0, finalOutput: "done", progress: { recentOutput: ["old preview"] }, messages: [{ role: "assistant", content: "done" }] }] };
    expect(projectSubagents("t", { agent: "delegate", task: "template" }, details, "complete", projection)?.[0]).toMatchObject({ task: "resolved task", messages: [{ role: "assistant", content: "done" }] });
  });
  it("keeps every agent visible when earlier transcripts exhaust the text budget", () => {
    const results = Array.from({ length: 16 }, (_, index) => ({ agent: `agent-${index}`, task: "inspect", exitCode: 0, messages: Array.from({ length: 10 }, () => ({ role: "assistant", content: "x".repeat(8192) })) }));
    const snapshots = projectSubagents("t", undefined, { mode: "parallel", results }, "complete", projection)!;
    expect(snapshots.map((snapshot) => snapshot.id)).toEqual(results.map((_, index) => `t:${index}`));
    expect(snapshots.at(-1)).toMatchObject({ agent: "agent-15", status: "completed", truncated: true });
    expect(Buffer.byteLength(JSON.stringify(snapshots))).toBeLessThanOrEqual(100_000);
  });
  it("merges tool calls with results and preserves payloads across metadata-free updates", () => {
    const details = { mode: "single", results: [{ agent: "a", task: "inspect", exitCode: 0, messages: [
      { role: "assistant", content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } }] },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", content: "result", isError: false },
    ] }] };
    const snapshots = projectSubagents("t", undefined, details, "complete", projection)!;
    expect(snapshots[0]!.messages).toHaveLength(1);
    expect(snapshots[0]!.messages[0]).toMatchObject({ toolCallId: "read-1", isError: false, toolInput: { format: "json" }, toolOutput: { text: '"result"' } });
    expect(projectSubagents("t", undefined, undefined, "failed", projection, snapshots)).toEqual(snapshots);
  });
  it("restores legacy JSON input strings and keeps tool-only truncation local", () => {
    const details = { mode: "single", results: [{ agent: "a", task: "inspect", exitCode: 0, messages: [
      { role: "assistant", content: [{ type: "toolCall", id: "b", name: "bash", arguments: JSON.stringify({ command: "git status" }, null, 2) }] },
      { role: "toolResult", toolCallId: "b", toolName: "bash", content: "x".repeat(5000) },
      { role: "assistant", content: "final" },
    ] }] };
    const snapshot = projectSubagents("p", undefined, details, "complete", projection)![0]!;
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.messages[0]).toMatchObject({ toolInput: { text: '{"command":"git status"}', format: "json" }, toolOutput: { truncated: true } });
    expect(snapshot.messages.at(-1)?.content).toBe("final");
  });
  it("keeps late answers and tool order when old messages exhaust the budget", () => {
    const results = Array.from({ length: 4 }, (_, index) => ({ agent: `peer-${index}`, task: "inspect", exitCode: 0, messages: [
      ...Array.from({ length: 105 }, () => ({ role: "assistant", content: "old".repeat(3000) })),
      { role: "assistant", content: [{ type: "toolCall", id: "b", name: "bash", arguments: { command: "pwd" } }, { type: "text", text: "commentary" }] },
      { role: "toolResult", toolCallId: "b", toolName: "bash", content: "workspace" },
      { role: "assistant", content: `FINAL-${index}` },
    ] }));
    const snapshots = projectSubagents("p", undefined, { mode: "parallel", results }, "complete", projection)!;
    snapshots.forEach((snapshot, index) => {
      expect(snapshot.messages.at(-1)?.content).toBe(`FINAL-${index}`);
      expect(snapshot.messages.slice(-3).map((message) => message.role)).toEqual(["tool", "assistant", "assistant"]);
      expect(snapshot.truncated).toBe(true);
    });
  });
  it("byte fitting evicts older activity instead of final replies", () => {
    const snapshots = projectSubagents("t", undefined, { mode: "single", results: [{ agent: "a", task: "inspect", exitCode: 0, messages: [
      { role: "user", content: "inspect" }, { role: "assistant", content: "old".repeat(2000) }, { role: "assistant", content: "FINAL" },
    ] }] }, "complete", projection)!;
    expect(fitSubagents(snapshots, 500)?.[0]?.messages.at(-1)?.content).toBe("FINAL");
    expect(snapshots[0]?.truncated).toBe(true);
  });
  it("keeps parallel progress running and reports final process failures with safe errors", () => {
    const details = { mode: "parallel", results: [{ agent: "a", task: "inspect", exitCode: 0, messages: [], stderr: "token=private failed" }] };
    expect(projectSubagents("t", undefined, details, "update", projection)?.[0]?.status).toBe("running");
    details.results[0]!.exitCode = -1;
    expect(projectSubagents("t", undefined, details, "complete", projection)?.[0]).toMatchObject({ status: "failed", messages: [{ role: "system", content: "token=[REDACTED] failed", isError: true }] });
  });
  it("fits within the remaining parent history byte budget", () => {
    const snapshots = projectSubagents("t", chain, undefined, "start", projection)!;
    const fitted = fitSubagents(snapshots, 150);
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(150);
    expect(fitted?.[0]?.truncated).toBe(true);
    expect(fitSubagents(snapshots, 0)).toBeUndefined();
  });
  it("bounds agents messages text and escaped UTF-8 bytes and omits images", () => {
    const results = Array.from({ length: 20 }, (_, i) => ({ agent: `a${i}`, task: "task", exitCode: 0, messages: Array.from({ length: 110 }, () => ({
      role: "assistant", content: [{ type: "text", text: "\u0000汉token=private ".repeat(4000) }, { type: "image", data: "private-image" }],
    })) }));
    const projected = projectSubagents("t", undefined, { mode: "parallel", results }, "complete", projection)!;
    expect(projected.length).toBeLessThanOrEqual(16);
    expect(projected.every((item) => item.truncated && item.messages.length <= 100)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThanOrEqual(100_000);
    expect(JSON.stringify(projected)).not.toMatch(/private|private-image/);
    expect(projected.flatMap((item) => item.messages).every((item) => item.content.length <= 8192)).toBe(true);
  });
});
