import type { ChatMessage, TimelineStatus } from "../stores/useChatSession";
import { calculateDiffStats, type DiffLine, type DiffStats } from "./gitReviewModel";

export type ToolKind = "command" | "read" | "edit" | "write" | "search" | "fetch" | "integration";

export interface ToolDiffPreview {
  path: string;
  lines: DiffLine[];
  stats: DiffStats | null;
  note: string;
  text: string;
  truncated: boolean;
}

const MAX_PREVIEW_CHARACTERS = 48_000;
const MAX_PREVIEW_LINES = 400;
const MAX_DIFF_CELLS = 160_000;

export function toolKind(name = ""): ToolKind {
  const leaf = name.toLowerCase().split(/[.:/]|__/).pop() ?? "";
  if (/^(bash|shell|exec|exec_command|run_command|terminal)$/.test(leaf)) return "command";
  if (/^(edit|apply_patch|patch|replace|str_replace|edit_file|replace_in_file)$/.test(leaf)) return "edit";
  if (/^(write|write_file|create_file)$/.test(leaf)) return "write";
  if (/^(read|read_file|read_text_file|cat|list|ls|list_directory)$/.test(leaf)) return "read";
  if (/^(search|web_search|search_query|grep|rg|glob|find|find_files)$/.test(leaf)) return "search";
  if (/^(fetch|web_fetch|http_request)$/.test(leaf)) return "fetch";
  return "integration";
}

export function toolActionLabel(kind: ToolKind, status: TimelineStatus): string {
  const verb = { command: "运行", read: "读取", edit: "编辑", write: "写入", search: "搜索", fetch: "获取", integration: "调用" }[kind];
  if (status === "running") return "正在" + verb;
  if (status === "pending") return "等待" + verb;
  if (status === "failed") return verb + "失败";
  if (status === "cancelled") return "已停止" + verb;
  return verb + "了";
}

export function toolGroupSummary(messages: ChatMessage[], status: TimelineStatus): string {
  const actions = new Map<string, string>();
  for (const message of messages) {
    const kind = toolKind(message.toolName);
    const target = { command: "命令", read: "文件", edit: "文件", write: "文件", search: "内容", fetch: "网页", integration: message.toolName || "工具" }[kind];
    const key = kind === "integration" ? target : kind;
    actions.set(key, toolActionLabel(kind, status) + target);
  }
  return [...actions.values()].join("、");
}

/** This is a preview of a tool's supplied fragment, not a working-tree diff. */
export function buildToolDiffPreview(message: ChatMessage): ToolDiffPreview | null {
  const kind = toolKind(message.toolName);
  if (kind !== "edit" && kind !== "write") return null;
  const payload = message.toolInput;
  if (!payload || payload.format !== "json") return null;
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(payload.text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    input = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const path = readString(input, ["path", "filePath", "file_path", "file"]);
  if (!path?.trim()) return null;
  const before = kind === "write" ? "" : readString(input, ["oldText", "old_string", "old_text", "old"]);
  const after = readString(input, kind === "write" ? ["content", "text"] : ["newText", "new_string", "new_text", "new"]);
  if (before === null || after === null) return null;

  const oldLines = splitLines(before.slice(0, MAX_PREVIEW_CHARACTERS));
  const newLines = splitLines(after.slice(0, MAX_PREVIEW_CHARACTERS));
  const truncated = payload.truncated || before.length > MAX_PREVIEW_CHARACTERS ||
    after.length > MAX_PREVIEW_CHARACTERS || oldLines.length > MAX_PREVIEW_LINES || newLines.length > MAX_PREVIEW_LINES;
  const lines = compareLines(oldLines.slice(0, MAX_PREVIEW_LINES), newLines.slice(0, MAX_PREVIEW_LINES));
  const applied = message.status === "completed";
  const note = kind === "write"
    ? "写入内容预览；未提供原文件，无法计算实际增删。"
    : "粗略 diff · 行号相对于编辑片段，并非完整文件。";
  return {
    path, lines, truncated,
    stats: applied && kind === "edit" && !truncated ? calculateDiffStats(lines) : null,
    note: (applied ? "" : "拟议变更，尚未确认写入。") + note,
    text: lines.map((line) => (line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " ") + line.content).join("\n"),
  };
}

function readString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) if (typeof input[key] === "string") return input[key] as string;
  return null;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n?/g, "\n");
  return (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
}

function compareLines(before: string[], after: string[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  const addLine = (kind: "context" | "delete" | "add") => {
    lines.push({
      kind,
      content: kind === "add" ? after[newIndex]! : before[oldIndex]!,
      oldLine: kind === "add" ? null : oldIndex + 1,
      newLine: kind === "delete" ? null : newIndex + 1,
    });
    if (kind !== "add") oldIndex += 1;
    if (kind !== "delete") newIndex += 1;
  };
  // Bound quadratic work; large edits retain matching edges and replace the middle.
  if ((before.length + 1) * (after.length + 1) > MAX_DIFF_CELLS) {
    while (oldIndex < before.length && newIndex < after.length && before[oldIndex] === after[newIndex]) addLine("context");
    let tail = 0;
    while (tail < before.length - oldIndex && tail < after.length - newIndex && before[before.length - tail - 1] === after[after.length - tail - 1]) tail += 1;
    while (oldIndex < before.length - tail) addLine("delete");
    while (newIndex < after.length - tail) addLine("add");
    while (oldIndex < before.length) addLine("context");
    return lines;
  }
  const width = after.length + 1;
  const lengths = new Uint16Array((before.length + 1) * width);
  for (let old = before.length - 1; old >= 0; old -= 1) {
    for (let next = after.length - 1; next >= 0; next -= 1) {
      lengths[old * width + next] = before[old] === after[next]
        ? 1 + lengths[(old + 1) * width + next + 1]!
        : Math.max(lengths[(old + 1) * width + next]!, lengths[old * width + next + 1]!);
    }
  }
  while (oldIndex < before.length || newIndex < after.length) {
    if (oldIndex < before.length && newIndex < after.length && before[oldIndex] === after[newIndex]) addLine("context");
    else if (oldIndex < before.length && (newIndex === after.length || lengths[(oldIndex + 1) * width + newIndex]! >= lengths[oldIndex * width + newIndex + 1]!)) addLine("delete");
    else addLine("add");
  }
  return lines;
}
