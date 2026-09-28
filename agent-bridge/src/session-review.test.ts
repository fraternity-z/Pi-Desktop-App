import { mkdtemp, readFile, rm, writeFile, unlink, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_REVIEW_BYTES, REVIEW_ENTRY, SessionReview, readReviewSummary, reviewDiff, type ReviewContext, type ReviewExtensionApi } from "./session-review.js";
import { parseRequest } from "./protocol.js";

type Event = { toolName: string; toolCallId: string; input: Record<string, unknown>; details?: unknown; isError?: boolean };
function harness(cwd: string, entries: unknown[] = []) {
  const callbacks = new Map<string, (event: Event, context: ReviewContext) => unknown>();
  const changed = vi.fn();
  const review = new SessionReview(cwd, changed);
  const api: ReviewExtensionApi = { on: (event, callback) => { callbacks.set(event, callback); }, appendEntry: (customType, data) => { entries.push({ type: "custom", customType, data: structuredClone(data) }); } };
  review.extension(api);
  const context = { sessionManager: { getSessionId: () => "session-1", getBranch: () => entries } };
  const emit = (name: string, event: Event = { toolName: "write", toolCallId: "tool-1", input: { path: "sample.txt" } }) => callbacks.get(name)!(event, context);
  emit("session_start");
  return { review, entries, emit, changed, api };
}
const childPrefix = "12345678-1234-1234-1234-123456789abc";
function childHarness(review: SessionReview, prefix = childPrefix, id = "child-1") {
  const callbacks = new Map<string, (event: Event, context: ReviewContext) => unknown>();
  const manager = { getSessionId: () => id, getBranch: () => [] };
  const appendEntry = vi.fn();
  review.childExtension(manager, prefix)({ on: (name, handler) => { callbacks.set(name, handler); }, appendEntry });
  const emit = (name: string, event: Event = { toolName: "write", toolCallId: "tool-1", input: { path: "sample.txt" } }, sessionManager = manager) => callbacks.get(name)?.(event, { sessionManager });
  return { callbacks, manager, appendEntry, emit };
}
describe("session file review", () => {
  let cwd: string;
  beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), "pi-review-")); });
  afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });
  it("persists child edits on the parent with isolated IDs and recoverable snapshots", async () => {
    await writeFile(join(cwd, "sample.txt"), "before\n");
    const h = harness(cwd); const child = childHarness(h.review);
    await child.emit("tool_call"); await writeFile(join(cwd, "sample.txt"), "after\n");
    await child.emit("tool_result");
    const summary = h.review.list().entries[0]!;
    expect(summary).toMatchObject({ status: "ready", kind: "modified" });
    expect(summary.toolCallId).toMatch(new RegExp(`^${childPrefix}:[a-f0-9]{32}$`));
    expect(child.appendEntry).not.toHaveBeenCalled(); expect(h.entries).toHaveLength(1);
    expect(h.changed).toHaveBeenCalledWith("session-1", summary);
    const reopened = harness(cwd, h.entries);
    expect(reopened.review.detail(summary.id)).toMatchObject({ beforeText: "before\n", afterText: "after\n" });
    await reopened.review.rollback(summary.id);
    expect(await readFile(join(cwd, "sample.txt"), "utf8")).toBe("before\n");
  });
  it("does not subscribe to child lifecycle events or clear parent records and pending writes", async () => {
    const h = harness(cwd);
    await h.emit("tool_call"); await writeFile(join(cwd, "sample.txt"), "first"); await h.emit("tool_result");
    const first = h.review.list().entries[0]!;
    await h.emit("tool_call");
    const child = childHarness(h.review);
    expect([...child.callbacks.keys()]).toEqual(["tool_call", "tool_result"]);
    for (const name of ["session_start", "session_switch", "session_tree", "agent_end"]) await child.emit(name);
    expect(h.review.list().entries).toEqual([first]);
    await expect(h.review.rollback(first.id)).rejects.toMatchObject({ code: "SESSION_BUSY" });
    await writeFile(join(cwd, "sample.txt"), "second"); await h.emit("tool_result");
    expect(h.review.list().entries[0]?.status).toBe("ready");
    expect(h.changed.mock.calls.every(([sessionId]) => sessionId === "session-1")).toBe(true);
  });
  it("detects overlapping parent and child writes even with identical raw IDs", async () => {
    const h = harness(cwd); const child = childHarness(h.review);
    await h.emit("tool_call"); await child.emit("tool_call");
    await writeFile(join(cwd, "sample.txt"), "overlap");
    await child.emit("tool_result"); await h.emit("tool_result");
    const entries = h.review.list().entries;
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.status === "conflict")).toBe(true);
    expect(new Set(entries.map((entry) => entry.toolCallId)).size).toBe(2);
  });
  it("rejects mismatched child events without changing parent identity or pending state", async () => {
    const h = harness(cwd); const child = childHarness(h.review);
    const other = { getSessionId: () => "wrong-child", getBranch: () => [] };
    const event = { toolName: "write", toolCallId: "tool-1", input: { path: "sample.txt" } };
    expect(await child.emit("tool_call", event, other)).toMatchObject({ block: true });
    await child.emit("tool_result", event, other);
    expect(h.review.list().entries).toEqual([]); expect(h.entries).toEqual([]);
    await child.emit("tool_call", event);
    await writeFile(join(cwd, "sample.txt"), "child");
    await child.emit("tool_result", event, other);
    await child.emit("tool_result", event);
    expect(h.review.list().entries[0]?.status).toBe("ready");
    expect(h.changed).toHaveBeenCalledWith("session-1", expect.anything());
    child.manager.getSessionId = () => "changed-child";
    expect(await child.emit("tool_call")).toMatchObject({ block: true });
  });
  it("cleans only the disposed child's pending IDs and keeps sibling and root writes", async () => {
    const h = harness(cwd); const a = childHarness(h.review);
    const b = childHarness(h.review, "87654321-4321-4321-4321-cba987654321", "child-2");
    const rootEvent = { toolName: "write", toolCallId: "tool-1", input: { path: "root.txt" } };
    const siblingEvent = { toolName: "write", toolCallId: "tool-1", input: { path: "sibling.txt" } };
    await h.emit("tool_call", rootEvent); await a.emit("tool_call"); await b.emit("tool_call", siblingEvent);
    h.review.finishChild(childPrefix); h.review.finishChild(childPrefix);
    await writeFile(join(cwd, "root.txt"), "root"); await writeFile(join(cwd, "sibling.txt"), "sibling");
    await h.emit("tool_result", rootEvent); await b.emit("tool_result", siblingEvent);
    const entries = h.review.list().entries;
    expect(entries).toHaveLength(2); expect(entries.every((entry) => entry.status === "ready")).toBe(true);
    await expect(h.review.rollback(entries[0]!.id)).resolves.toMatchObject({ status: "rolled-back" });
  });
  it("validates child namespaces, bounded raw IDs and the captured parent identity", async () => {
    const h = harness(cwd); const child = childHarness(h.review);
    const event = { toolName: "write", toolCallId: "long".repeat(100), input: { path: "sample.txt" } };
    await child.emit("tool_call", event); await writeFile(join(cwd, "sample.txt"), "child"); await child.emit("tool_result", event);
    expect(h.review.list().entries[0]!.toolCallId.length).toBeLessThanOrEqual(128);
    for (const toolCallId of ["", "bad\0id", "x".repeat(4097)]) expect(await child.emit("tool_call", { ...event, toolCallId })).toMatchObject({ block: true });
    expect(() => childHarness(h.review, "invalid-prefix")).toThrowError(expect.objectContaining({ code: "REVIEW_UNAVAILABLE" }));
    h.review.initialize({ getSessionId: () => "new-parent", getBranch: () => [] });
    expect(await child.emit("tool_call", event)).toMatchObject({ block: true });
    await child.emit("tool_result", event); expect(h.review.list().entries).toEqual([]);
  });
  it("blocks late and in-flight child callbacks after disposal", async () => {
    const h = harness(cwd);
    const child = childHarness(h.review);
    const pending = child.emit("tool_call");
    h.review.finishChild(childPrefix);
    expect(await pending).toMatchObject({ block: true });
    expect(await child.emit("tool_call")).toMatchObject({ block: true });
    expect(await child.emit("tool_result")).toBeUndefined();
    expect(h.review.list().entries).toEqual([]);
    expect(h.entries).toEqual([]);
    expect(h.changed).not.toHaveBeenCalled();

    const next = childHarness(h.review);
    await next.emit("tool_call");
    await writeFile(join(cwd, "sample.txt"), "late result");
    const result = next.emit("tool_result");
    h.review.finishChild(childPrefix);
    expect(await result).toBeUndefined();
    expect(h.entries).toEqual([]);
    expect(h.changed).not.toHaveBeenCalled();
  });
  it("captures awaited before/after, persists outside model context, and restores rollback state", async () => {
    await writeFile(join(cwd, "sample.txt"), "before\n");
    const h = harness(cwd);
    await h.emit("tool_call");
    await writeFile(join(cwd, "sample.txt"), "after\n");
    const result = await h.emit("tool_result") as { details: { piDesktopReview: { id: string } } };
    const id = result.details.piDesktopReview.id;
    expect(h.review.detail(id)).toMatchObject({ status: "ready", kind: "modified", beforeText: "before\n", afterText: "after\n", additions: 1, deletions: 1 });
    expect(h.entries[0]).toMatchObject({ type: "custom", customType: REVIEW_ENTRY });
    const reopened = harness(cwd, h.entries);
    expect(await reopened.review.rollback(id)).toMatchObject({ status: "rolled-back" });
    expect(await readFile(join(cwd, "sample.txt"), "utf8")).toBe("before\n");
    expect(harness(cwd, h.entries).review.list().entries[0]?.status).toBe("rolled-back");
    await expect(reopened.review.rollback(id)).rejects.toMatchObject({ code: "REVIEW_NOT_REVERSIBLE" });
  });
  it("rolls back new and deleted files and rejects later edits", async () => {
    const h = harness(cwd); await h.emit("tool_call");
    await writeFile(join(cwd, "sample.txt"), "new"); await h.emit("tool_result");
    let item = h.review.list().entries[0]!; expect(item.kind).toBe("added");
    await h.review.rollback(item.id); await expect(readFile(join(cwd, "sample.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(cwd, "sample.txt"), "keep"); await h.emit("tool_call");
    await unlink(join(cwd, "sample.txt")); await h.emit("tool_result");
    item = h.review.list().entries[0]!; expect(item.kind).toBe("deleted"); await h.review.rollback(item.id);
    expect(await readFile(join(cwd, "sample.txt"), "utf8")).toBe("keep");
    await h.emit("tool_call"); await writeFile(join(cwd, "sample.txt"), "agent"); await h.emit("tool_result");
    item = h.review.list().entries[0]!; await writeFile(join(cwd, "sample.txt"), "user");
    await expect(h.review.rollback(item.id)).rejects.toMatchObject({ code: "REVIEW_CONFLICT" });
    expect(await readFile(join(cwd, "sample.txt"), "utf8")).toBe("user");
  });
  it.each([["binary", Buffer.from([0, 1])], ["too-large", "x".repeat(MAX_REVIEW_BYTES + 1)], ["sensitive", "api_key=not-a-real-credential"]] as const)("marks %s without storing file contents", async (status, content) => {
    await writeFile(join(cwd, "sample.txt"), content); const h = harness(cwd);
    await h.emit("tool_call"); await h.emit("tool_result");
    const item = h.review.list().entries[0]!; expect(item.status).toBe(status); expect(h.review.detail(item.id).beforeText).toBeNull();
    await expect(h.review.rollback(item.id)).rejects.toMatchObject({ code: "REVIEW_NOT_REVERSIBLE" });
  });
  it("rejects path escapes, metadata, symlink directories, and sensitive filenames", async () => {
    const h = harness(cwd); await mkdir(join(cwd, "real")); await symlink(join(cwd, "real"), join(cwd, "linked"), "junction");
    for (const path of ["../outside.txt", ".git/config", "linked/file.txt", ".env"]) {
      const event = { toolName: "write", toolCallId: path, input: { path } };
      await h.emit("tool_call", event); await h.emit("tool_result", event);
      expect(["unsafe-path", "sensitive"]).toContain(h.review.list().entries[0]!.status);
    }
  });
  it("marks failed, missing, mutated and overlapping tools as nonreversible", async () => {
    const h = harness(cwd);
    await h.emit("tool_result"); expect(h.review.list().entries[0]!.status).toBe("unavailable");
    await h.emit("tool_call"); await h.emit("tool_result", { toolName: "write", toolCallId: "tool-1", input: { path: "sample.txt" }, isError: true });
    expect(h.review.list().entries[0]!.status).toBe("failed");
    await h.emit("tool_call"); await h.emit("tool_result", { toolName: "write", toolCallId: "tool-1", input: { path: "other.txt" } });
    expect(h.review.list().entries[0]!.status).toBe("unavailable");
    await h.emit("tool_call"); await h.emit("tool_call", { toolName: "edit", toolCallId: "tool-2", input: { path: "sample.txt" } });
    await h.emit("tool_result"); expect(h.review.list().entries[0]!.status).toBe("conflict");
    await expect(h.review.rollback(h.review.list().entries[0]!.id)).rejects.toMatchObject({ code: "SESSION_BUSY" });
    h.emit("agent_end");
    await expect(h.review.rollback("missing")).rejects.toMatchObject({ code: "REVIEW_NOT_FOUND" });
  });
  it("limits list size, paginates, validates restored snapshots, and honors branches", async () => {
    const h = harness(cwd);
    for (let i = 0; i < 260; i++) await h.emit("tool_result", { toolName: "edit", toolCallId: `tool-${i}`, input: { path: "sample.txt" } });
    const page = h.review.list(); expect(page.entries).toHaveLength(50); expect(page.truncated).toBe(true);
    expect(h.review.list(page.nextCursor!).entries[0]!.id).not.toBe(page.entries[0]!.id);
    expect(() => h.review.list("missing")).toThrow();
    expect(harness(cwd, []).review.list().entries).toEqual([]);
    expect(readReviewSummary({ ...page.entries[0], additions: -1 })).toBeUndefined();
    const entry = { schema: 1, cwd, summary: { ...page.entries[0], path: "sample.txt", status: "ready" }, before: { exists: true, text: "tampered", hash: "wrong" } };
    expect(harness(cwd, [{ type: "custom", customType: REVIEW_ENTRY, data: entry }]).review.list().entries[0]!.status).toBe("unavailable");
  });
  it("bounds diff text and correctly marks missing final newlines", () => {
    expect(reviewDiff("a\n", "a\n", "x").diff).toBe("");
    expect(reviewDiff("a", "b", "x")).toMatchObject({ additions: 1, deletions: 1 });
    expect(reviewDiff("a", "b", "x").diff).toContain("No newline at end of file");
    expect(reviewDiff("a".repeat(MAX_REVIEW_BYTES), "b".repeat(MAX_REVIEW_BYTES), "x")).toMatchObject({ diffTruncated: true });
  });
  it("matches unchanged lines between separated edits and emits correct hunk offsets", () => {
    const middle = Array.from({ length: 12 }, (_, index) => `same-${index}\n`).join("");
    const result = reviewDiff(`old-first\n${middle}old-last\n`, `new-first\n${middle}new-last\n`, "sample.txt");
    expect(result).toMatchObject({ additions: 2, deletions: 2, diffTruncated: false });
    expect(result.diff).toContain("@@ -1,4 +1,4 @@");
    expect(result.diff).toContain("@@ -11,4 +11,4 @@");
    expect(result.diff).not.toMatch(/^[+-]same-/m);
    expect(result.diff).not.toContain("same-6");
    expect(reviewDiff("first\nsame\nold\n", "first\nadded\nsame\nnew\n", "x")).toMatchObject({ additions: 2, deletions: 1, diffTruncated: false });
    expect(reviewDiff("", "added\n", "x").diff).toContain("@@ -0,0 +1,1 @@");
    expect(reviewDiff("gone\n", "", "x").diff).toContain("@@ -1,1 +0,0 @@");
    const shifted = reviewDiff(`${middle}gone\n`, `added\n${middle}`, "x");
    expect(shifted).toMatchObject({ additions: 1, deletions: 1, diffTruncated: false });
    expect(shifted.diff).toContain("@@ -1,3 +1,4 @@");
    expect(shifted.diff).toContain("@@ -10,4 +11,3 @@");
  });
  it("marks coarse comparisons above the fixed work budget and bounds output", () => {
    const middle = "same\n".repeat(2000);
    const result = reviewDiff(`old\n${middle}end-old\n`, `new\n${middle}end-new\n`, "x");
    expect(result).toMatchObject({ diffTruncated: true, additions: 2002, deletions: 2002 });
    expect(result.diff.length).toBeLessThanOrEqual(MAX_REVIEW_BYTES);
  });
  it("accepts only canonical UUIDs and UTC millisecond timestamps in restored summaries", async () => {
    const h = harness(cwd);
    await h.emit("tool_result");
    const summary = h.review.list().entries[0]!;
    expect(readReviewSummary(summary)).toEqual(summary);
    expect(readReviewSummary({ ...summary, createdAt: "2024-02-29T23:59:59.999Z" })).toBeDefined();
    for (const id of ["-".repeat(36), "12345678-1234-1234-1234-123456789abz", "12345678-1234-1234-1234-123456789ABC"]) {
      expect(readReviewSummary({ ...summary, id })).toBeUndefined();
    }
    for (const createdAt of ["2026-02-29T00:00:00.000Z", "2026-04-31T00:00:00.000Z", "2026-09-27", "2026-09-27T00:00:00Z", "2026-09-27T00:00:00.000+00:00", "2026-09-27T24:00:00.000Z", "invalid"]) {
      expect(readReviewSummary({ ...summary, createdAt })).toBeUndefined();
    }
  });
  it("validates review wire identifiers and absolute workspace paths", () => {
    const reviewId = "12345678-1234-1234-1234-123456789abc";
    for (const op of ["session.review.list", "session.review.detail", "session.review.rollback"]) {
      const request = { v: 1, id: "request", op, sessionId: "session-1", cwd, ...(op.endsWith("list") ? { cursor: reviewId } : { reviewId }) };
      expect(parseRequest(JSON.stringify(request))).toEqual(request);
      expect(() => parseRequest(JSON.stringify({ ...request, cwd: "relative" }))).toThrow();
      expect(() => parseRequest(JSON.stringify({ ...request, reviewId: "invalid", cursor: "invalid" }))).toThrow();
    }
  });
});
