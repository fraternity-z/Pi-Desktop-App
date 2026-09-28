import { createHash, randomUUID } from "node:crypto";
import type { SubagentMessage } from "./subagents.js";

const ENTRY = "pi-desktop-subagent-transcript-v1";
const PAGE_BYTES = 64_000;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export interface TranscriptPage { revision: number; text: string; nextCursor: string | null }
interface Manager { getSessionId?(): string; getBranch?(): unknown[]; appendCustomEntry?(type: string, data: unknown): unknown }
interface Snapshot { revision: number; text: string; persisted?: boolean }
export class SubagentTranscriptError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "SubagentTranscriptError"; }
}

/** Complete, sanitized records; only transport chunks have size limits. */
export class SubagentTranscripts {
  private readonly records = new Map<string, Snapshot>();
  private manager?: Manager;
  private sessionId = "";

  initialize(sessionId: string, manager: Manager): void {
    if (manager.getSessionId && manager.getSessionId() !== sessionId) throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_UNAVAILABLE", "子代理记录会话身份不匹配");
    this.manager = manager; this.sessionId = sessionId; this.records.clear();
    const pending = new Map<string, { id: string; revision: number; parts: string[] }>();
    for (const entry of manager.getBranch?.() ?? []) {
      if (!record(entry) || entry.type !== "custom" || entry.customType !== ENTRY || !record(entry.data)) continue;
      const data = entry.data;
      if (data.schema !== 1 || data.sessionId !== sessionId || typeof data.id !== "string" || typeof data.writeId !== "string" || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1) continue;
      if (data.kind === "part" && typeof data.text === "string" && Number.isSafeInteger(data.index) && Number(data.index) >= 0) {
        let item = pending.get(data.writeId);
        if (!item && data.index === 0) { item = { id: data.id, revision: Number(data.revision), parts: [] }; pending.set(data.writeId, item); }
        if (item?.id === data.id && item.revision === data.revision && data.index === item.parts.length) item.parts.push(data.text);
        else pending.delete(data.writeId);
      } else if (data.kind === "commit") {
        const item = pending.get(data.writeId); pending.delete(data.writeId);
        if (!item || item.id !== data.id || item.revision !== data.revision || data.parts !== item.parts.length) continue;
        const text = item.parts.join("");
        if (data.digest !== digest(text)) continue;
        try { if (!validMessages(JSON.parse(text))) continue; } catch { continue; }
        this.records.set(data.id, { revision: item.revision, text, persisted: true });
      }
    }
  }

  set(id: string, messages: SubagentMessage[]): number {
    const text = JSON.stringify(messages);
    const prior = this.records.get(id);
    if (prior?.text === text) return prior.revision;
    const revision = (prior?.revision ?? 0) + 1;
    this.records.set(id, { revision, text });
    return revision;
  }

  persist(id: string): void {
    const snapshot = this.require(id);
    if (snapshot.persisted) return;
    // Direct executor fixtures have no parent manager; runtime instances always bind one.
    if (!this.manager) return;
    if (!this.manager.appendCustomEntry) throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_SAVE_FAILED", "当前 SDK 无法保存完整子代理记录");
    const writeId = randomUUID();
    const base = { schema: 1, sessionId: this.sessionId, id, revision: snapshot.revision, writeId };
    let offset = 0; let index = 0;
    try {
      while (offset < snapshot.text.length) {
        const text = chunk(snapshot.text, offset);
        this.manager.appendCustomEntry(ENTRY, { ...base, kind: "part", index, text });
        offset += text.length; index++;
      }
      this.manager.appendCustomEntry(ENTRY, { ...base, kind: "commit", parts: index, digest: digest(snapshot.text) });
      snapshot.persisted = true;
    } catch { throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_SAVE_FAILED", "完整子代理记录保存失败，当前窗口仍可查看；请勿关闭会话"); }
  }

  read(id: string, cursor?: string): TranscriptPage {
    const snapshot = this.require(id);
    let offset = 0;
    if (cursor !== undefined) {
      if (!/^\d{1,16}:\d{1,16}:[a-f0-9]{16}$/.test(cursor)) throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_CURSOR_INVALID", "子代理会话分页游标无效");
      const [revision, position, scope] = cursor.split(":");
      offset = Number(position);
      if (scope !== digest(id).slice(0, 16)) throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_CURSOR_INVALID", "分页游标不属于当前子代理");
      if (Number(revision) !== snapshot.revision) throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_CHANGED", "子代理会话已更新，请重新加载");
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= snapshot.text.length) throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_CURSOR_INVALID", "子代理会话分页游标无效");
    }
    const text = chunk(snapshot.text, offset);
    const next = offset + text.length;
    return { revision: snapshot.revision, text, nextCursor: next < snapshot.text.length ? `${snapshot.revision}:${next}:${digest(id).slice(0, 16)}` : null };
  }

  private require(id: string): Snapshot {
    const value = this.records.get(id);
    if (!value) throw new SubagentTranscriptError("SUBAGENT_TRANSCRIPT_NOT_FOUND", "当前主会话中没有此子代理的完整记录");
    return value;
  }
}

function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }

/** Count encoded bytes including JSON escaping; never split a UTF-16 pair. */
function chunk(text: string, offset: number): string {
  let low = 1; let high = Math.min(text.length - offset, PAGE_BYTES); let length = 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(text.slice(offset, offset + middle)), "utf8") <= PAGE_BYTES) { length = middle; low = middle + 1; }
    else high = middle - 1;
  }
  const last = text.charCodeAt(offset + length - 1);
  if (last >= 0xd800 && last <= 0xdbff && offset + length < text.length) length--;
  return text.slice(offset, offset + length);
}

function validMessages(value: unknown): value is SubagentMessage[] {
  const payload = (item: unknown) => item === undefined || (record(item) && typeof item.text === "string" && ["text", "json"].includes(String(item.format)) && typeof item.truncated === "boolean");
  return Array.isArray(value) && value.every((item) => record(item) && ["user", "assistant", "thinking", "tool", "system"].includes(String(item.role)) && typeof item.content === "string" &&
    (item.toolCallId === undefined || typeof item.toolCallId === "string") && (item.toolName === undefined || typeof item.toolName === "string") &&
    (item.isError === undefined || typeof item.isError === "boolean") && payload(item.toolInput) && payload(item.toolOutput));
}
