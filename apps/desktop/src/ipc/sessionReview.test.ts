import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionReview, isSessionReviewSummary, listSessionReviews, rollbackSessionReview } from "./sessionReview";
import { parseAgentEvent } from "./agent";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const summary = { id: "12345678-1234-1234-1234-123456789abc", toolCallId: "tool-1", path: "src/main.ts", kind: "modified", status: "ready", additions: 1, deletions: 1, createdAt: "2026-09-27T01:00:00.000Z" };
describe("session review IPC", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  it("uses fixed commands and validates every response", async () => {
    const detail = { ...summary, beforeText: "a", afterText: "b", diff: "-a\n+b", diffTruncated: false };
    vi.mocked(invoke).mockResolvedValueOnce({ entries: [summary], nextCursor: null, truncated: false }).mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...summary, status: "rolled-back" });
    expect((await listSessionReviews("s-1", "C:/work")).entries).toEqual([summary]);
    await expect(getSessionReview("s-1", "C:/work", summary.id)).resolves.toEqual(detail);
    expect((await rollbackSessionReview("s-1", "C:/work", summary.id)).status).toBe("rolled-back");
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_review_rollback", { sessionId: "s-1", cwd: "C:/work", reviewId: summary.id });
  });
  it("rejects malformed, oversized, escaping and mismatched responses", async () => {
    for (const change of [{ path: "../escape" }, { path: "C:/secret" }, { path: ".git/config" }, { status: "invalid" }, { additions: -1 }, { createdAt: "yesterday" }, { extra: true }]) expect(isSessionReviewSummary({ ...summary, ...change })).toBe(false);
    vi.mocked(invoke).mockResolvedValueOnce({ entries: [summary, summary], nextCursor: null, truncated: false }).mockResolvedValueOnce({ ...summary, beforeText: "界".repeat(32768), afterText: null, diff: "", diffTruncated: false }).mockResolvedValueOnce(summary);
    await expect(listSessionReviews("s", "C:/work")).rejects.toThrow("REVIEW_RESPONSE_INVALID");
    await expect(getSessionReview("s", "C:/work", summary.id)).rejects.toThrow("REVIEW_RESPONSE_INVALID");
    await expect(rollbackSessionReview("s", "C:/work", summary.id)).rejects.toThrow("REVIEW_RESPONSE_INVALID");
  });
  it("accepts bounded review events and tool metadata but rejects malformed review data", () => {
    const event = { v: 1, kind: "event", seq: 1, sessionId: "s", name: "session.reviewChanged", data: summary };
    expect(parseAgentEvent(event)).not.toBeNull();
    expect(parseAgentEvent({ ...event, data: { ...summary, path: "/etc/secret" } })).toBeNull();
    expect(parseAgentEvent({ ...event, name: "tool.completed", data: { toolCallId: "tool-1", toolName: "edit", review: summary } })).not.toBeNull();
    expect(parseAgentEvent({ ...event, name: "tool.started", data: { toolCallId: "tool-1", toolName: "edit", review: summary } })).toBeNull();
  });
});
