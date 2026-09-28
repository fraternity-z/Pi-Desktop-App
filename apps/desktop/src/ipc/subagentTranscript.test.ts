import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSubagentTranscript } from "./subagentTranscript";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const scope = "0123456789abcdef";
beforeEach(() => { vi.mocked(invoke).mockReset(); });

describe("complete subagent transcript IPC", () => {
  it("reassembles more than 100 messages and full long tool input/output across chunks", async () => {
    const messages = [
      ...Array.from({ length: 130 }, (_, index) => ({ role: "assistant", content: `${index}:` + "文😀\n".repeat(3000) })),
      { role: "tool", content: "", toolInput: { text: "i".repeat(150_000), format: "json", truncated: false }, toolOutput: { text: "o".repeat(200_000), format: "text", truncated: false } },
    ];
    const serialized = JSON.stringify(messages);
    vi.mocked(invoke).mockImplementation(async (_name, args) => {
      const cursor = (args as { cursor?: string }).cursor;
      const offset = cursor ? Number(cursor.split(":")[1]) : 0;
      const text = serialized.slice(offset, offset + 4000);
      return { revision: 4, text, nextCursor: offset + text.length === serialized.length ? null : `4:${offset + text.length}:${scope}` };
    });
    expect(await readSubagentTranscript("parent", "tool:0")).toEqual({ revision: 4, messages });
    expect(invoke).toHaveBeenNthCalledWith(1, "agent_subagent_transcript", { sessionId: "parent", subagentId: "tool:0" });
  });

  it.each([null, {}, { revision: 1, text: "[]" }, { revision: 0, text: "[]", nextCursor: null },
    { revision: 1, text: "", nextCursor: null }, { revision: 1, text: "x".repeat(64_000), nextCursor: null },
    { revision: 1, text: "[", nextCursor: `1:0:${scope}` }, { revision: 1, text: "[", nextCursor: `2:1:${scope}` },
    { revision: 1, text: "{}", nextCursor: null }, { revision: 1, text: '[{"role":"bad","content":"x"}]', nextCursor: null },
    { revision: 1, text: '[{"role":"tool","content":"","toolOutput":{"text":"x","format":"html","truncated":false}}]', nextCursor: null },
  ])("rejects invalid pages and messages %#", async (page) => {
    vi.mocked(invoke).mockResolvedValue(page);
    await expect(readSubagentTranscript("parent", "tool:0")).rejects.toThrow("格式无效");
  });

  it("restarts a changed revision without joining old and new pages", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ revision: 1, text: "[", nextCursor: `1:1:${scope}` })
      .mockRejectedValueOnce({ code: "SUBAGENT_TRANSCRIPT_CHANGED" })
      .mockResolvedValueOnce({ revision: 2, text: '[{"role":"assistant","content":"complete"}]', nextCursor: null });
    expect((await readSubagentTranscript("parent", "tool:0")).messages[0]?.content).toBe("complete");
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_subagent_transcript", { sessionId: "parent", subagentId: "tool:0" });
  });

  it("bounds retries and preserves actionable errors", async () => {
    const error = { code: "SUBAGENT_TRANSCRIPT_CHANGED", message: "retry" };
    vi.mocked(invoke).mockRejectedValue(error);
    await expect(readSubagentTranscript("parent", "tool:0")).rejects.toBe(error);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("cancels page loading and validates identifiers before invoking", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readSubagentTranscript("parent", "tool:0", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(readSubagentTranscript("", "tool:0")).rejects.toThrow("格式无效");
    await expect(readSubagentTranscript("parent", "bad\nid")).rejects.toThrow("格式无效");
    expect(invoke).not.toHaveBeenCalled();
    const inFlight = new AbortController();
    vi.mocked(invoke).mockImplementation(async () => { inFlight.abort(); return { revision: 1, text: "[]", nextCursor: null }; });
    await expect(readSubagentTranscript("parent", "tool:0", inFlight.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledOnce();
  });
});
