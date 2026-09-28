import { describe, expect, it, vi } from "vitest";
import { SubagentTranscripts } from "./subagent-transcripts.js";
import type { SubagentMessage } from "./subagents.js";

function fixture(sessionId = "parent") {
  const entries: unknown[] = [];
  const manager = { getSessionId: () => sessionId, getBranch: () => entries, appendCustomEntry: vi.fn((customType: string, data: unknown) => entries.push({ type: "custom", customType, data: structuredClone(data) })) };
  const archive = new SubagentTranscripts(); archive.initialize(sessionId, manager);
  return { archive, entries, manager };
}
function read(archive: SubagentTranscripts, id: string): SubagentMessage[] {
  let cursor: string | undefined; let text = ""; let revision: number | undefined;
  do {
    const page = archive.read(id, cursor);
    expect(Buffer.byteLength(JSON.stringify(page.text))).toBeLessThanOrEqual(64_000);
    if (revision !== undefined) expect(page.revision).toBe(revision);
    revision = page.revision; text += page.text; cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return JSON.parse(text);
}

describe("complete subagent transcript archive", () => {
  it("round-trips all messages, long unicode, escaped text and typed tool payloads through SDK entries", () => {
    const { archive, manager } = fixture();
    const messages: SubagentMessage[] = Array.from({ length: 130 }, (_, index) => ({ role: "assistant", content: `${index}:${"完整😀\u0001\n".repeat(2_000)}` }));
    messages.push({ role: "tool", content: "", toolCallId: "tool", toolName: "bash", toolInput: { text: JSON.stringify({ command: "x".repeat(150_000) }), format: "json", truncated: false }, toolOutput: { text: "result".repeat(30_000), format: "text", truncated: false } });
    expect(archive.set("call:0", messages)).toBe(1);
    expect(archive.set("call:0", messages)).toBe(1);
    expect(read(archive, "call:0")).toEqual(messages);
    archive.persist("call:0");
    const writes = manager.appendCustomEntry.mock.calls.length; archive.persist("call:0");
    expect(manager.appendCustomEntry).toHaveBeenCalledTimes(writes);
    const restored = new SubagentTranscripts(); restored.initialize("parent", manager);
    expect(read(restored, "call:0")).toEqual(messages);
  });

  it("binds cursors to revision and child identity without accepting paths or foreign parents", () => {
    const { archive, manager } = fixture(); const message: SubagentMessage = { role: "assistant", content: "a".repeat(150_000) };
    archive.set("call:0", [message]); archive.set("call:1", [message]); archive.persist("call:0");
    const cursor = archive.read("call:0").nextCursor!;
    expect(() => archive.read("call:1", cursor)).toThrow("不属于");
    for (const invalid of ["", "1:-1:x", "../archive", cursor.replace(/:\d+:/, ":9999999999999999:")]) expect(() => archive.read("call:0", invalid)).toThrow();
    archive.set("call:0", [{ ...message, content: "changed" }]);
    expect(() => archive.read("call:0", cursor)).toThrow("已更新");
    expect(() => archive.read("../other-session.jsonl")).toThrow("没有此子代理");
    const other = fixture("other"); other.entries.push(...manager.getBranch()); other.archive.initialize("other", other.manager);
    expect(() => other.archive.read("call:0")).toThrow("没有此子代理");
    expect(() => other.archive.initialize("wrong", other.manager)).toThrow("身份不匹配");
  });

  it("does not restore partial writes, corrupted commits, invalid records or legacy previews", () => {
    const { archive, manager, entries } = fixture(); archive.set("call:0", [{ role: "assistant", content: "answer" }]); archive.persist("call:0");
    const valid = structuredClone(entries);
    entries.pop();
    const restored = new SubagentTranscripts(); restored.initialize("parent", manager);
    expect(() => restored.read("call:0")).toThrow("没有此子代理");
    entries.splice(0, entries.length, ...valid);
    (entries[0] as { data: { text: string } }).data.text = "tampered";
    entries.push(null, { type: "custom", customType: "other", data: {} }, { type: "toolResult", details: { messages: [] } });
    restored.initialize("parent", manager);
    expect(() => restored.read("call:0")).toThrow("没有此子代理");
  });

  it("restores a successful retry despite an earlier interrupted multipart write", () => {
    const { archive, manager } = fixture();
    const messages: SubagentMessage[] = [{ role: "assistant", content: "完整😀\n".repeat(30_000) }];
    archive.set("call:0", messages);
    const append = manager.appendCustomEntry.getMockImplementation()!;
    manager.appendCustomEntry.mockImplementationOnce(append).mockImplementationOnce(() => { throw new Error("disk"); });
    expect(() => archive.persist("call:0")).toThrow("保存失败");
    const incomplete = new SubagentTranscripts(); incomplete.initialize("parent", manager);
    expect(() => incomplete.read("call:0")).toThrow("没有此子代理");
    expect(read(archive, "call:0")).toEqual(messages);
    archive.persist("call:0");
    const restored = new SubagentTranscripts(); restored.initialize("parent", manager);
    expect(read(restored, "call:0")).toEqual(messages);
  });

  it("keeps live data and reports persistence failures without a false committed archive", () => {
    const { archive, manager } = fixture(); archive.set("call:0", [{ role: "assistant", content: "recoverable" }]);
    manager.appendCustomEntry.mockImplementation(() => { throw new Error("disk"); });
    expect(() => archive.persist("call:0")).toThrow("保存失败");
    expect(read(archive, "call:0")[0]?.content).toBe("recoverable");
    const unavailable = new SubagentTranscripts(); unavailable.initialize("parent", {}); unavailable.set("call:0", []);
    expect(() => unavailable.persist("call:0")).toThrow("无法保存");
    const inMemory = new SubagentTranscripts(); inMemory.set("call:0", []); inMemory.persist("call:0"); expect(read(inMemory, "call:0")).toEqual([]);
  });
});
