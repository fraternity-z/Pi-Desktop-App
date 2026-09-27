import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const REVIEW_ENTRY = "pi-desktop-file-review-v1";
export const MAX_REVIEW_BYTES = 32 * 1024;
const MAX_RECORDS = 256;
const PAGE_SIZE = 50;
export type ReviewStatus = "ready" | "unchanged" | "binary" | "too-large" | "unsafe-path" | "sensitive" | "unavailable" | "failed" | "conflict" | "rolled-back";
export interface SessionReviewSummary {
  id: string;
  toolCallId: string;
  path: string;
  kind: "added" | "modified" | "deleted" | "unknown";
  status: ReviewStatus;
  additions: number;
  deletions: number;
  createdAt: string;
}
export interface SessionReviewDetail extends SessionReviewSummary {
  beforeText: string | null;
  afterText: string | null;
  diff: string;
  diffTruncated: boolean;
}
export interface SessionReviewPage { entries: SessionReviewSummary[]; nextCursor: string | null; truncated: boolean }
interface Snapshot { exists: boolean; text: string; hash: string }
interface ReviewRecord { schema: 1; cwd: string; summary: SessionReviewSummary; before?: Snapshot; after?: Snapshot }
interface Pending { path: string; before?: Snapshot; status?: ReviewStatus; overlap: boolean }
export interface ReviewContext {
  sessionManager: { getSessionId(): string; getBranch(): unknown[] };
}
interface ToolEvent { toolName: string; toolCallId: string; input: Record<string, unknown>; details?: unknown; isError?: boolean }
export interface ReviewExtensionApi {
  on(event: "tool_call" | "tool_result" | "session_start" | "session_switch" | "session_tree" | "agent_end", handler: (event: ToolEvent, context: ReviewContext) => unknown): void;
  appendEntry(customType: string, data: unknown): void;
}
export type ReviewExtensionFactory = (pi: ReviewExtensionApi) => void;

export class ReviewError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "ReviewError"; }
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const absent = (): Snapshot => ({ exists: false, text: "", hash: digest("") });
const errorCode = (error: unknown): unknown => record(error) ? error.code : undefined;
const sensitive = (text: string): boolean => /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]+|\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|authorization|password|passwd|secret|credentials?|cookie|token)["']?\s*[:=]\s*\S/i.test(text);

function localPath(cwd: string, input: unknown): string {
  if (typeof input !== "string" || !input || input.length > 4096 || /[\0-\x1f]/.test(input)) throw new ReviewError("REVIEW_UNSAFE_PATH", "审查文件路径无效");
  const path = relative(cwd, resolve(cwd, input));
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`) || path.split(/[\\/]/).some((part) => part.toLowerCase() === ".git" || part.includes(":"))) {
    throw new ReviewError("REVIEW_UNSAFE_PATH", "审查仅支持当前工作区内的普通文件");
  }
  return path.replace(/\\/g, "/");
}

async function authorizePath(cwd: string, path: string): Promise<string> {
  const root = await realpath(cwd);
  const rel = localPath(root, path);
  let current = root;
  for (const segment of rel.split("/")) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new ReviewError("REVIEW_UNSAFE_PATH", "审查不支持符号链接或目录联接");
      const canonical = await realpath(current);
      const canonicalRelative = relative(root, canonical);
      if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) throw new ReviewError("REVIEW_UNSAFE_PATH", "文件不在授权工作区内");
    } catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
  }
  return resolve(root, rel);
}

async function snapshot(cwd: string, path: string): Promise<Snapshot> {
  if (/(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials(?:\..*)?|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx)$/i.test(path)) throw new ReviewError("REVIEW_SENSITIVE", "敏感文件不保存审查快照");
  const absolute = await authorizePath(cwd, path);
  let handle;
  try { handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { if (errorCode(error) === "ENOENT") return absent(); throw error; }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new ReviewError("REVIEW_UNSAFE_PATH", "审查仅支持非硬链接的普通文件");
    if (info.size > MAX_REVIEW_BYTES) throw new ReviewError("REVIEW_TOO_LARGE", "审查快照超过 32 KiB 上限");
    const bytes = Buffer.alloc(MAX_REVIEW_BYTES + 1);
    const read = await handle.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > MAX_REVIEW_BYTES) throw new ReviewError("REVIEW_TOO_LARGE", "审查快照超过 32 KiB 上限");
    const data = bytes.subarray(0, read.bytesRead);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
    catch { throw new ReviewError("REVIEW_BINARY", "二进制文件不提供文本审查快照"); }
    if (text.includes("\0")) throw new ReviewError("REVIEW_BINARY", "二进制文件不提供文本审查快照");
    if (sensitive(text)) throw new ReviewError("REVIEW_SENSITIVE", "文件包含疑似凭据，不保存审查快照");
    return { exists: true, text, hash: digest(text) };
  } finally { await handle.close(); }
}

function snapshotStatus(error: unknown): ReviewStatus {
  switch (errorCode(error)) {
    case "REVIEW_UNSAFE_PATH": return "unsafe-path";
    case "REVIEW_BINARY": return "binary";
    case "REVIEW_TOO_LARGE": return "too-large";
    case "REVIEW_SENSITIVE": return "sensitive";
    default: return "unavailable";
  }
}

// At most one million LCS cells (4 MiB). Larger changed regions use a
// coarse replacement hunk and report diffTruncated; their counts are coarse too.
const MAX_DIFF_CELLS = 1_000_000;
/** Bounded line diff with exact matching inside the work budget. */
export function reviewDiff(before: string, after: string, path: string): { diff: string; additions: number; deletions: number; diffTruncated: boolean } {
  if (before === after) return { diff: "", additions: 0, deletions: 0, diffTruncated: false };
  const lines = (text: string) => text === "" ? [] : text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = lines(before); const b = lines(after);
  let head = 0; let tail = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const oldCount = a.length - head - tail; const newCount = b.length - head - tail;
  const coarse = oldCount > 0 && newCount > 0 && (oldCount + 1) * (newCount + 1) > MAX_DIFF_CELLS;
  const operations: Array<{ line: string; sign: string }> = [];
  const add = (line: string, sign: string) => operations.push({ line, sign });
  for (let i = 0; i < head; i++) add(a[i]!, " ");
  let additions = 0; let deletions = 0;
  if (coarse || oldCount === 0 || newCount === 0) {
    for (let i = head; i < a.length - tail; i++) add(a[i]!, "-");
    for (let i = head; i < b.length - tail; i++) add(b[i]!, "+");
    deletions = oldCount; additions = newCount;
  } else {
    const width = newCount + 1;
    const lcs = new Uint32Array((oldCount + 1) * width);
    for (let i = oldCount - 1; i >= 0; i--) {
      for (let j = newCount - 1; j >= 0; j--) {
        lcs[i * width + j] = a[head + i] === b[head + j]
          ? 1 + lcs[(i + 1) * width + j + 1]!
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
      }
    }
    let i = 0; let j = 0;
    while (i < oldCount || j < newCount) {
      if (i < oldCount && j < newCount && a[head + i] === b[head + j]) {
        add(a[head + i++]!, " "); j++;
      } else if (i < oldCount && (j === newCount || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
        add(a[head + i++]!, "-"); deletions++;
      } else { add(b[head + j++]!, "+"); additions++; }
    }
  }
  for (let i = a.length - tail; i < a.length; i++) add(a[i]!, " ");
  const format = (line: string, sign: string) => `${sign}${line.endsWith("\n") ? line : `${line}\n\\ No newline at end of file\n`}`;
  const ranges: Array<{ start: number; end: number }> = [];
  operations.forEach((operation, index) => {
    if (operation.sign === " ") return;
    const start = Math.max(0, index - 3); const end = Math.min(operations.length, index + 4);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end) previous.end = end;
    else ranges.push({ start, end });
  });
  let diff = `--- a/${path}\n+++ b/${path}\n`;
  let oldLine = 0; let newLine = 0; let position = 0;
  for (const range of ranges) {
    while (position < range.start) {
      const operation = operations[position++]!;
      if (operation.sign !== "+") oldLine++;
      if (operation.sign !== "-") newLine++;
    }
    const hunk = operations.slice(range.start, range.end);
    const oldLength = hunk.filter((operation) => operation.sign !== "+").length;
    const newLength = hunk.filter((operation) => operation.sign !== "-").length;
    diff += `@@ -${oldLine + (oldLength ? 1 : 0)},${oldLength} +${newLine + (newLength ? 1 : 0)},${newLength} @@\n`;
    diff += hunk.map((operation) => format(operation.line, operation.sign)).join("");
  }
  return { diff: diff.slice(0, MAX_REVIEW_BYTES), additions, deletions, diffTruncated: coarse || diff.length > MAX_REVIEW_BYTES };
}

export function readReviewSummary(value: unknown): SessionReviewSummary | undefined {
  if (!record(value) || typeof value.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id) || typeof value.toolCallId !== "string" || !value.toolCallId || value.toolCallId.length > 256 ||
      typeof value.path !== "string" || value.path.length > 4096 || /[\0-\x1f]/.test(value.path) || typeof value.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt ||
      !["added", "modified", "deleted", "unknown"].includes(String(value.kind)) ||
      !["ready", "unchanged", "binary", "too-large", "unsafe-path", "sensitive", "unavailable", "failed", "conflict", "rolled-back"].includes(String(value.status)) ||
      !Number.isSafeInteger(value.additions) || Number(value.additions) < 0 || Number(value.additions) > MAX_REVIEW_BYTES || !Number.isSafeInteger(value.deletions) || Number(value.deletions) < 0 || Number(value.deletions) > MAX_REVIEW_BYTES) return undefined;
  return { id: value.id, toolCallId: value.toolCallId, path: value.path, kind: value.kind as SessionReviewSummary["kind"], status: value.status as ReviewStatus, additions: Number(value.additions), deletions: Number(value.deletions), createdAt: value.createdAt };
}
function validSnapshot(value: unknown): value is Snapshot {
  return record(value) && typeof value.exists === "boolean" && typeof value.text === "string" && Buffer.byteLength(value.text) <= MAX_REVIEW_BYTES && !value.text.includes("\0") && !sensitive(value.text) && value.hash === digest(value.text) && (value.exists || value.text === "");
}

export class SessionReview {
  private readonly records = new Map<string, ReviewRecord>();
  private readonly pending = new Map<string, Pending>();
  private pi?: ReviewExtensionApi;
  private sessionId = "";
  private truncated = false;
  private busy = false;
  constructor(readonly cwd: string, private readonly changed: (sessionId: string, summary: SessionReviewSummary) => void) {}

  readonly extension: ReviewExtensionFactory = (pi) => {
    this.pi = pi;
    for (const event of ["session_start", "session_switch", "session_tree"] as const) pi.on(event, (_event, context) => this.initialize(context.sessionManager));
    pi.on("agent_end", () => this.pending.clear());
    pi.on("tool_call", async (event, context) => {
      if (!["write", "edit"].includes(event.toolName)) return;
      this.sessionId = context.sessionManager.getSessionId();
      if (this.busy) return { block: true, reason: "文件正在回滚，请稍后重试" };
      if (this.pending.size >= 64) return { block: true, reason: "文件审查并发数量超出上限" };
      const pending: Pending = { path: "", overlap: false };
      this.pending.set(event.toolCallId, pending);
      try {
        pending.path = localPath(this.cwd, event.input.path);
        for (const other of this.pending.values()) if (other !== pending && other.path.toLowerCase() === pending.path.toLowerCase()) other.overlap = pending.overlap = true;
        pending.before = await snapshot(this.cwd, pending.path);
      } catch (error) { pending.status = snapshotStatus(error); }
    });
    pi.on("tool_result", async (event) => {
      if (!["write", "edit"].includes(event.toolName)) return;
      const pending = this.pending.get(event.toolCallId);
      this.pending.delete(event.toolCallId);
      let after: Snapshot | undefined;
      let status: ReviewStatus = event.isError ? "failed" : pending?.status ?? "ready";
      if (!pending) status = "unavailable";
      if (pending?.overlap) status = "conflict";
      if (status === "ready") {
        try {
          // A later extension may legally mutate the tool input. Never associate
          // that tool result with a snapshot of the originally requested path.
          if (localPath(this.cwd, event.input.path) !== pending?.path) status = "unavailable";
          else after = await snapshot(this.cwd, pending.path);
        } catch (error) { status = snapshotStatus(error); }
      }
      const before = pending?.before;
      const snapshots = before && after && status === "ready" ? { before, after } : undefined;
      if (snapshots && snapshots.before.exists === snapshots.after.exists && snapshots.before.hash === snapshots.after.hash) status = "unchanged";
      const counts = snapshots ? reviewDiff(snapshots.before.text, snapshots.after.text, pending!.path) : { additions: 0, deletions: 0 };
      const summary: SessionReviewSummary = { id: randomUUID(), toolCallId: event.toolCallId, path: pending?.path ?? "",
        kind: snapshots ? !snapshots.before.exists ? "added" : !snapshots.after.exists ? "deleted" : "modified" : "unknown", status,
        additions: counts.additions, deletions: counts.deletions, createdAt: new Date().toISOString() };
      const entry: ReviewRecord = { schema: 1, cwd: this.cwd, summary, ...snapshots };
      try { this.persist(entry); } catch { summary.status = "unavailable"; this.remember({ schema: 1, cwd: this.cwd, summary }); }
      this.changed(this.sessionId, summary);
      return { details: { ...(record(event.details) ? event.details : {}), piDesktopReview: summary } };
    });
  };

  private remember(entry: ReviewRecord): void {
    this.records.set(entry.summary.id, entry);
    if (this.records.size > MAX_RECORDS) { this.records.delete(this.records.keys().next().value!); this.truncated = true; }
  }
  private persist(entry: ReviewRecord): void {
    if (!this.pi) throw new ReviewError("REVIEW_UNAVAILABLE", "SDK 审查扩展尚未就绪");
    this.pi.appendEntry(REVIEW_ENTRY, entry);
    this.remember(entry);
  }
  /** Restore native custom entries even when the SDK caller has no UI bindings. */
  initialize(sessionManager: ReviewContext["sessionManager"]): void {
    this.sessionId = sessionManager.getSessionId();
    this.records.clear(); this.pending.clear(); this.truncated = false;
    for (const entry of sessionManager.getBranch()) {
      if (!record(entry) || entry.type !== "custom" || entry.customType !== REVIEW_ENTRY || !record(entry.data)) continue;
      const data = entry.data; const summary = readReviewSummary(data.summary);
      if (!summary || data.schema !== 1 || data.cwd !== this.cwd) continue;
      try { if (summary.path) localPath(this.cwd, summary.path); else if (summary.status === "ready") continue; } catch { continue; }
      const snapshots = validSnapshot(data.before) && validSnapshot(data.after) ? { before: data.before, after: data.after } : {};
      if (summary.status === "ready" && !("before" in snapshots)) summary.status = "unavailable";
      this.remember({ schema: 1, cwd: this.cwd, summary, ...snapshots });
    }
  }
  list(cursor?: string): SessionReviewPage {
    const all = [...this.records.values()].reverse();
    const offset = cursor ? all.findIndex((entry) => entry.summary.id === cursor) : 0;
    if (offset < 0) throw new ReviewError("REVIEW_CURSOR_INVALID", "审查列表已变化，请刷新");
    const selected = all.slice(offset, offset + PAGE_SIZE);
    return { entries: selected.map((entry) => ({ ...entry.summary })), nextCursor: all[offset + PAGE_SIZE]?.summary.id ?? null, truncated: this.truncated };
  }
  summary(id: string): SessionReviewSummary | undefined { return this.records.get(id)?.summary; }
  detail(id: string): SessionReviewDetail {
    const entry = this.require(id);
    return { ...entry.summary, beforeText: entry.before?.exists ? entry.before.text : null, afterText: entry.after?.exists ? entry.after.text : null,
      ...(entry.before && entry.after ? reviewDiff(entry.before.text, entry.after.text, entry.summary.path) : { diff: "", diffTruncated: false }) };
  }
  private require(id: string): ReviewRecord {
    const entry = this.records.get(id);
    if (!entry) throw new ReviewError("REVIEW_NOT_FOUND", "审查记录不可用，请重新打开会话");
    return entry;
  }
  async rollback(id: string): Promise<SessionReviewSummary> {
    if (this.busy || this.pending.size) throw new ReviewError("SESSION_BUSY", "会话正在修改文件，请等待任务结束");
    const entry = this.require(id);
    if (entry.summary.status !== "ready" || !entry.before || !entry.after) throw new ReviewError("REVIEW_NOT_REVERSIBLE", "该记录没有可安全回滚的完整快照");
    this.busy = true;
    try {
      const current = await snapshot(this.cwd, entry.summary.path);
      if (current.exists !== entry.after.exists || current.hash !== entry.after.hash) {
        const conflict = { ...entry, summary: { ...entry.summary, status: "conflict" as const } };
        this.persist(conflict); this.changed(this.sessionId, conflict.summary);
        throw new ReviewError("REVIEW_CONFLICT", "文件已被后续修改，已拒绝覆盖；请手动合并");
      }
      const absolute = await authorizePath(this.cwd, entry.summary.path);
      if (!entry.after.exists) {
        const handle = await open(absolute, "wx", 0o600);
        try { await handle.writeFile(entry.before.text, "utf8"); await handle.sync(); } finally { await handle.close(); }
      } else {
        const handle = await open(absolute, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
        try {
          const info = await handle.stat();
          const now = await lstat(absolute);
          if (!info.isFile() || info.nlink !== 1 || now.isSymbolicLink() || info.ino !== now.ino || info.dev !== now.dev || info.size > MAX_REVIEW_BYTES) throw new ReviewError("REVIEW_CONFLICT", "文件身份发生变化，已取消回滚");
          const bytes = Buffer.alloc(MAX_REVIEW_BYTES + 1); const read = await handle.read(bytes, 0, bytes.length, 0);
          if (createHash("sha256").update(bytes.subarray(0, read.bytesRead)).digest("hex") !== entry.after.hash) throw new ReviewError("REVIEW_CONFLICT", "文件已被后续修改，已取消回滚");
          if (entry.before.exists) { await handle.write(Buffer.from(entry.before.text), 0, Buffer.byteLength(entry.before.text), 0); await handle.truncate(Buffer.byteLength(entry.before.text)); await handle.sync(); }
          else { await unlink(absolute); }
        } finally { await handle.close(); }
      }
      const restored = { ...entry, summary: { ...entry.summary, status: "rolled-back" as const } };
      this.persist(restored); this.changed(this.sessionId, restored.summary); return restored.summary;
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      throw new ReviewError("REVIEW_ROLLBACK_FAILED", "回滚失败，请检查文件权限和当前内容后刷新");
    } finally { this.busy = false; }
  }
}
