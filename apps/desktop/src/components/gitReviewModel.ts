export type DiffLineKind = "add" | "delete" | "context" | "meta" | "collapsed";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly content: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly collapsedCount?: number;
}

export interface DiffStats {
  readonly additions: number;
  readonly deletions: number;
}

export interface WordSegment {
  readonly text: string;
  readonly changed: boolean;
}

export interface SplitDiffRow {
  readonly kind: "pair" | "meta";
  readonly left: DiffLine | null;
  readonly right: DiffLine | null;
  readonly meta: DiffLine | null;
  readonly leftSegments: ReadonlyArray<WordSegment> | null;
  readonly rightSegments: ReadonlyArray<WordSegment> | null;
}

const WORD_DIFF_TOKEN_LIMIT = 360;
const CONTEXT_EDGE_LINES = 3;

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const normalized = diff.replace(/\r\n?/g, "\n");
  const sourceLines = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  let oldLine = 0;
  let newLine = 0;

  return sourceLines.map((source): DiffLine => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(source);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return createMetaLine(source);
    }
    if (source.startsWith("+") && !source.startsWith("+++")) {
      return {
        kind: "add",
        content: source.slice(1),
        oldLine: null,
        newLine: newLine++,
      };
    }
    if (source.startsWith("-") && !source.startsWith("---")) {
      return {
        kind: "delete",
        content: source.slice(1),
        oldLine: oldLine++,
        newLine: null,
      };
    }
    if (source.startsWith(" ")) {
      return {
        kind: "context",
        content: source.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      };
    }
    return createMetaLine(source);
  });
}

export function collapseUnchangedLines(lines: ReadonlyArray<DiffLine>): DiffLine[] {
  const result: DiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index]?.kind !== "context") {
      result.push(lines[index]!);
      index += 1;
      continue;
    }

    let end = index;
    while (end < lines.length && lines[end]?.kind === "context") end += 1;
    const run = lines.slice(index, end);
    if (run.length <= CONTEXT_EDGE_LINES * 2 + 1) {
      result.push(...run);
    } else {
      result.push(...run.slice(0, CONTEXT_EDGE_LINES));
      const collapsedCount = run.length - CONTEXT_EDGE_LINES * 2;
      result.push({
        kind: "collapsed",
        content: `${collapsedCount} 行未修改内容`,
        oldLine: null,
        newLine: null,
        collapsedCount,
      });
      result.push(...run.slice(-CONTEXT_EDGE_LINES));
    }
    index = end;
  }
  return result;
}

export function calculateDiffStats(lines: ReadonlyArray<DiffLine>): DiffStats {
  return lines.reduce<DiffStats>(
    (stats, line) => ({
      additions: stats.additions + (line.kind === "add" ? 1 : 0),
      deletions: stats.deletions + (line.kind === "delete" ? 1 : 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

export function buildSplitDiffRows(
  lines: ReadonlyArray<DiffLine>,
  wordDiff: boolean,
): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === "meta" || line.kind === "collapsed") {
      rows.push({
        kind: "meta",
        left: null,
        right: null,
        meta: line,
        leftSegments: null,
        rightSegments: null,
      });
      index += 1;
      continue;
    }
    if (line.kind === "context") {
      rows.push(createSplitPair(line, line, false));
      index += 1;
      continue;
    }
    if (line.kind === "add") {
      rows.push(createSplitPair(null, line, false));
      index += 1;
      continue;
    }

    const deleted: DiffLine[] = [];
    while (lines[index]?.kind === "delete") deleted.push(lines[index++]!);
    const added: DiffLine[] = [];
    while (lines[index]?.kind === "add") added.push(lines[index++]!);
    const pairCount = Math.max(deleted.length, added.length);
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      rows.push(createSplitPair(deleted[pairIndex] ?? null, added[pairIndex] ?? null, wordDiff));
    }
  }
  return rows;
}

export function buildUnifiedWordSegments(
  lines: ReadonlyArray<DiffLine>,
): ReadonlyMap<DiffLine, ReadonlyArray<WordSegment>> {
  const segments = new Map<DiffLine, ReadonlyArray<WordSegment>>();
  for (const row of buildSplitDiffRows(lines, true)) {
    if (row.left && row.leftSegments) segments.set(row.left, row.leftSegments);
    if (row.right && row.rightSegments) segments.set(row.right, row.rightSegments);
  }
  return segments;
}

export function buildGitApplyCommand(patch: string): string {
  const trimmed = patch.trimEnd();
  if (!trimmed) throw new Error("当前分组没有可复制的补丁内容。");
  if (trimmed.split("\n").some((line) => line === "'@")) {
    throw new Error("补丁包含 PowerShell here-string 结束标记，无法安全复制命令。");
  }
  return `@'\n${trimmed}\n'@ | git apply --whitespace=nowarn`;
}

function createMetaLine(content: string): DiffLine {
  return { kind: "meta", content, oldLine: null, newLine: null };
}

function createSplitPair(
  left: DiffLine | null,
  right: DiffLine | null,
  wordDiff: boolean,
): SplitDiffRow {
  const wordSegments = wordDiff && (left?.kind === "delete" || right?.kind === "add")
    ? compareWords(left?.content ?? "", right?.content ?? "")
    : null;
  return {
    kind: "pair",
    left,
    right,
    meta: null,
    leftSegments: left && wordSegments ? wordSegments.left : null,
    rightSegments: right && wordSegments ? wordSegments.right : null,
  };
}

function compareWords(
  left: string,
  right: string,
): { left: ReadonlyArray<WordSegment>; right: ReadonlyArray<WordSegment> } {
  if (!left) return { left: [], right: [{ text: right, changed: true }] };
  if (!right) return { left: [{ text: left, changed: true }], right: [] };

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length > WORD_DIFF_TOKEN_LIMIT || rightTokens.length > WORD_DIFF_TOKEN_LIMIT) {
    return compareByCommonEdges(left, right);
  }

  const columns = rightTokens.length + 1;
  const table = new Uint16Array((leftTokens.length + 1) * columns);
  for (let leftIndex = leftTokens.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightTokens.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const offset = leftIndex * columns + rightIndex;
      table[offset] = leftTokens[leftIndex] === rightTokens[rightIndex]
        ? table[(leftIndex + 1) * columns + rightIndex + 1]! + 1
        : Math.max(
            table[(leftIndex + 1) * columns + rightIndex]!,
            table[leftIndex * columns + rightIndex + 1]!,
          );
    }
  }

  const leftChanged = new Array(leftTokens.length).fill(true) as boolean[];
  const rightChanged = new Array(rightTokens.length).fill(true) as boolean[];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftTokens.length && rightIndex < rightTokens.length) {
    if (leftTokens[leftIndex] === rightTokens[rightIndex]) {
      leftChanged[leftIndex] = false;
      rightChanged[rightIndex] = false;
      leftIndex += 1;
      rightIndex += 1;
    } else if (
      table[(leftIndex + 1) * columns + rightIndex]! >=
      table[leftIndex * columns + rightIndex + 1]!
    ) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return {
    left: mergeSegments(leftTokens, leftChanged),
    right: mergeSegments(rightTokens, rightChanged),
  };
}

function tokenize(value: string): string[] {
  return value.match(/\s+|[A-Za-z0-9_$]+|./g) ?? [];
}

function compareByCommonEdges(
  left: string,
  right: string,
): { left: ReadonlyArray<WordSegment>; right: ReadonlyArray<WordSegment> } {
  let prefix = 0;
  const maxPrefix = Math.min(left.length, right.length);
  while (prefix < maxPrefix && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(left.length - prefix, right.length - prefix);
  while (
    suffix < maxSuffix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  ) suffix += 1;

  return {
    left: edgeSegments(left, prefix, suffix),
    right: edgeSegments(right, prefix, suffix),
  };
}

function edgeSegments(value: string, prefix: number, suffix: number): WordSegment[] {
  const segments: WordSegment[] = [];
  if (prefix > 0) segments.push({ text: value.slice(0, prefix), changed: false });
  const changedEnd = value.length - suffix;
  if (changedEnd > prefix) segments.push({ text: value.slice(prefix, changedEnd), changed: true });
  if (suffix > 0) segments.push({ text: value.slice(changedEnd), changed: false });
  return segments;
}

function mergeSegments(tokens: ReadonlyArray<string>, changed: ReadonlyArray<boolean>): WordSegment[] {
  const segments: WordSegment[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const isChanged = changed[index] ?? true;
    const previous = segments.at(-1);
    if (previous?.changed === isChanged) {
      segments[segments.length - 1] = { text: previous.text + token, changed: isChanged };
    } else {
      segments.push({ text: token, changed: isChanged });
    }
  }
  return segments;
}
