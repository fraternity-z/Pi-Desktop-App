import { invoke } from "@tauri-apps/api/core";

export const REVIEW_STATUSES = ["ready", "unchanged", "binary", "too-large", "unsafe-path", "sensitive", "unavailable", "failed", "conflict", "rolled-back"] as const;
export interface SessionReviewSummary {
  id: string; toolCallId: string; path: string; kind: "added" | "modified" | "deleted" | "unknown";
  status: typeof REVIEW_STATUSES[number]; additions: number; deletions: number; createdAt: string;
}
export interface SessionReviewDetail extends SessionReviewSummary { beforeText: string | null; afterText: string | null; diff: string; diffTruncated: boolean }
export interface SessionReviewPage { entries: SessionReviewSummary[]; nextCursor: string | null; truncated: boolean }
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export function isSessionReviewSummary(value: unknown): value is SessionReviewSummary {
  return record(value) && Object.keys(value).length === 8 && validId(value.id) &&
    typeof value.toolCallId === "string" && value.toolCallId.length > 0 && value.toolCallId.length <= 256 && !/[\x00-\x1f]/.test(value.toolCallId) &&
    typeof value.path === "string" && value.path.length <= 4096 && !/[\x00-\x1f]/.test(value.path) && !/^[\\/]/.test(value.path) &&
    !value.path.split(/[\\/]/).some((part) => part === ".." || part.includes(":") || part.toLowerCase() === ".git") &&
    ["added", "modified", "deleted", "unknown"].includes(String(value.kind)) && REVIEW_STATUSES.includes(value.status as SessionReviewSummary["status"]) &&
    (value.status !== "ready" || value.path.length > 0) &&
    [value.additions, value.deletions].every((count) => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 32768) &&
    typeof value.createdAt === "string" && value.createdAt.length <= 40 && Number.isFinite(Date.parse(value.createdAt));
}
function invalid(): never { throw new Error("REVIEW_RESPONSE_INVALID: 会话审查响应无效，请刷新重试"); }
export async function listSessionReviews(sessionId: string, cwd: string, cursor?: string): Promise<SessionReviewPage> {
  const value = await invoke<unknown>("agent_review_list", { sessionId, cwd, ...(cursor ? { cursor } : {}) });
  if (!record(value) || !Array.isArray(value.entries) || value.entries.length > 50 || !value.entries.every(isSessionReviewSummary) ||
    new Set(value.entries.map((entry) => entry.id)).size !== value.entries.length ||
    (value.nextCursor !== null && !validId(value.nextCursor)) || typeof value.truncated !== "boolean") return invalid();
  return value as unknown as SessionReviewPage;
}
export async function getSessionReview(sessionId: string, cwd: string, reviewId: string): Promise<SessionReviewDetail> {
  const value = await invoke<unknown>("agent_review_detail", { sessionId, cwd, reviewId });
  if (!record(value)) return invalid();
  const { beforeText, afterText, diff, diffTruncated, ...summary } = value;
  if (!isSessionReviewSummary(summary) || summary.id !== reviewId ||
    ![beforeText, afterText].every((text) => text === null || (typeof text === "string" && new TextEncoder().encode(text).length <= 32768 && !text.includes("\0"))) ||
    typeof diff !== "string" || diff.length > 32768 || typeof diffTruncated !== "boolean") return invalid();
  return value as unknown as SessionReviewDetail;
}
export async function rollbackSessionReview(sessionId: string, cwd: string, reviewId: string): Promise<SessionReviewSummary> {
  const value = await invoke<unknown>("agent_review_rollback", { sessionId, cwd, reviewId });
  if (!isSessionReviewSummary(value) || value.id !== reviewId || value.status !== "rolled-back") return invalid();
  return value;
}
