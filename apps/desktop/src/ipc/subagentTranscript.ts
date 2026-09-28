import { invoke } from "@tauri-apps/api/core";
import type { SubagentMessage, ToolDisplayPayload } from "./agent";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = () => new Error("完整子代理会话格式无效，请重试");

function payload(value: unknown): value is ToolDisplayPayload {
  return record(value) && Object.keys(value).length === 3 && typeof value.text === "string" &&
    (value.format === "text" || value.format === "json") && typeof value.truncated === "boolean";
}

function messages(value: unknown): value is SubagentMessage[] {
  return Array.isArray(value) && value.every((message) => record(message) &&
    Object.keys(message).every((key) => ["role", "content", "toolCallId", "toolName", "toolInput", "toolOutput", "isError"].includes(key)) &&
    ["user", "assistant", "thinking", "tool", "system"].includes(String(message.role)) &&
    typeof message.content === "string" &&
    ["toolCallId", "toolName"].every((key) => !(key in message) || typeof message[key] === "string") &&
    (!("isError" in message) || typeof message.isError === "boolean") &&
    ["toolInput", "toolOutput"].every((key) => !(key in message) || payload(message[key])));
}

/** Page limits protect IPC frames, never the number or length of saved messages. */
export async function readSubagentTranscript(sessionId: string, subagentId: string, signal?: AbortSignal): Promise<{ revision: number; messages: SubagentMessage[] }> {
  if (!sessionId.trim() || sessionId.length > 128 || /[\x00-\x1f\x7f]/.test(sessionId) ||
    !subagentId.trim() || subagentId.length > 260 || /[\x00-\x1f\x7f]/.test(subagentId)) throw invalid();
  // Live records may change between requests; restart rather than mixing revisions.
  for (let attempt = 0; ; attempt++) {
    let cursor: string | undefined;
    let revision: number | undefined;
    let scope: string | undefined;
    let offset = 0;
    const chunks: string[] = [];
    try {
      do {
        signal?.throwIfAborted();
        const page = await invoke<unknown>("agent_subagent_transcript", { sessionId, subagentId, ...(cursor === undefined ? {} : { cursor }) });
        signal?.throwIfAborted();
        if (!record(page) || Object.keys(page).length !== 3 || !Number.isSafeInteger(page.revision) || Number(page.revision) < 1 ||
          typeof page.text !== "string" || !page.text.length || new TextEncoder().encode(JSON.stringify(page.text)).length > 64_000 ||
          !(page.nextCursor === null || typeof page.nextCursor === "string") || (revision !== undefined && revision !== page.revision)) throw invalid();
        revision = Number(page.revision);
        chunks.push(page.text); offset += page.text.length;
        if (page.nextCursor === null) break;
        const match = /^(\d{1,16}):(\d{1,16}):([a-f0-9]{16})$/.exec(page.nextCursor);
        if (!match || Number(match[1]) !== revision || Number(match[2]) !== offset || (scope !== undefined && scope !== match[3])) throw invalid();
        scope = match[3]; cursor = page.nextCursor;
      } while (cursor !== undefined);
      let decoded: unknown;
      try { decoded = JSON.parse(chunks.join("")); } catch { throw invalid(); }
      if (!messages(decoded)) throw invalid();
      return { revision: revision!, messages: decoded };
    } catch (error) {
      signal?.throwIfAborted();
      if (record(error) && error.code === "SUBAGENT_TRANSCRIPT_CHANGED" && attempt < 2) continue;
      throw error;
    }
  }
}
