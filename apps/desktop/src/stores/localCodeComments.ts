export const LOCAL_CODE_COMMENTS_STORAGE_KEY = "pi-desktop.local-code-comments.v1";

export interface LocalCodeComment {
  readonly id: string;
  readonly rootPath: string;
  readonly filePath: string;
  readonly line: number;
  readonly lineText: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface CreateLocalCodeCommentInput {
  readonly rootPath: string;
  readonly filePath: string;
  readonly line: number;
  readonly lineText: string;
  readonly text: string;
}

export function normalizeLocalCodeCommentPath(path: string): string {
  return path.trim().replace(/\\/g, "/").toLowerCase();
}

export function createLocalCodeComment(input: CreateLocalCodeCommentInput): LocalCodeComment {
  return {
    ...input,
    id: `local-comment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    text: input.text.trim(),
    createdAt: new Date().toISOString(),
  };
}

export function readLocalCodeComments(): ReadonlyArray<LocalCodeComment> {
  if (typeof window === "undefined") return [];
  try {
    return sanitizeLocalCodeComments(JSON.parse(window.localStorage.getItem(LOCAL_CODE_COMMENTS_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function writeLocalCodeComments(comments: ReadonlyArray<LocalCodeComment>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_CODE_COMMENTS_STORAGE_KEY, JSON.stringify(comments));
  } catch {
    // Local comments remain available in memory when persistence is unavailable.
  }
}

export function commentsForFile(
  comments: ReadonlyArray<LocalCodeComment>,
  filePath: string,
): ReadonlyArray<LocalCodeComment> {
  const normalizedPath = normalizeLocalCodeCommentPath(filePath);
  return comments
    .filter((comment) => normalizeLocalCodeCommentPath(comment.filePath) === normalizedPath)
    .sort((left, right) => left.line - right.line || left.createdAt.localeCompare(right.createdAt));
}

function sanitizeLocalCodeComments(value: unknown): ReadonlyArray<LocalCodeComment> {
  if (!Array.isArray(value)) return [];
  const comments: LocalCodeComment[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const comment = sanitizeLocalCodeComment(item);
    if (comment === null || ids.has(comment.id)) continue;
    ids.add(comment.id);
    comments.push(comment);
  }
  return comments;
}

function sanitizeLocalCodeComment(value: unknown): LocalCodeComment | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Partial<Record<keyof LocalCodeComment, unknown>>;
  if (
    typeof record.id !== "string" || !record.id ||
    typeof record.rootPath !== "string" || !record.rootPath ||
    typeof record.filePath !== "string" || !record.filePath ||
    typeof record.line !== "number" || !Number.isInteger(record.line) || record.line < 1 ||
    typeof record.lineText !== "string" ||
    typeof record.text !== "string" || !record.text.trim() ||
    typeof record.createdAt !== "string"
  ) return null;
  return {
    id: record.id,
    rootPath: record.rootPath,
    filePath: record.filePath,
    line: record.line,
    lineText: record.lineText,
    text: record.text.trim(),
    createdAt: record.createdAt,
  };
}
