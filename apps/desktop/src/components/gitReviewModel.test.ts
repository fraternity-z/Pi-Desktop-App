import { describe, expect, it } from "vitest";

import {
  addSplitWordSegments,
  buildGitApplyCommand,
  buildSplitDiffRows,
  buildUnifiedWordSegments,
  calculateDiffStats,
  collapseUnchangedLines,
  parseUnifiedDiff,
} from "./gitReviewModel";

describe("gitReviewModel", () => {
  it("解析 unified diff 的类型与行号并统计增删行", () => {
    const lines = parseUnifiedDiff(
      "diff --git a/a.ts b/a.ts\n@@ -2,2 +4,3 @@\n same\n-old\n+new\n+extra\n",
    );

    expect(lines.map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "context",
      "delete",
      "add",
      "add",
    ]);
    expect(lines[2]).toMatchObject({ oldLine: 2, newLine: 4, content: "same" });
    expect(lines[3]).toMatchObject({ oldLine: 3, newLine: null, content: "old" });
    expect(lines[4]).toMatchObject({ oldLine: null, newLine: 5, content: "new" });
    expect(calculateDiffStats(lines)).toEqual({ additions: 2, deletions: 1 });
  });

  it("折叠长上下文但保留变更两侧边缘", () => {
    const source = [
      "@@ -1,12 +1,12 @@",
      ...Array.from({ length: 10 }, (_, index) => ` line ${index}`),
      "-before",
      "+after",
    ].join("\n");
    const collapsed = collapseUnchangedLines(parseUnifiedDiff(source));

    expect(collapsed.some((line) => line.kind === "collapsed" && line.collapsedCount === 4)).toBe(true);
    expect(collapsed.filter((line) => line.kind === "context")).toHaveLength(6);
    expect(collapsed.at(-2)?.kind).toBe("delete");
    expect(collapsed.at(-1)?.kind).toBe("add");
  });

  it("按删除/新增块构建真实 split 行并计算词级 LCS", () => {
    const lines = parseUnifiedDiff(
      "@@ -1,2 +1,2 @@\n-const oldName = value;\n-keep left\n+const newName = value;\n+keep right",
    );
    const rows = buildSplitDiffRows(lines, true);
    const changedRow = rows.find((row) => row.left?.content.includes("oldName"));

    expect(changedRow?.right?.content).toContain("newName");
    expect(changedRow?.leftSegments?.filter((segment) => segment.changed).map((segment) => segment.text).join(""))
      .toContain("oldName");
    expect(changedRow?.rightSegments?.filter((segment) => segment.changed).map((segment) => segment.text).join(""))
      .toContain("newName");

    const unified = buildUnifiedWordSegments(lines);
    expect(unified.get(changedRow!.left!)?.some((segment) => segment.changed)).toBe(true);
  });

  it("分页只比较可见词级差异并保留跨页删除新增的配对", () => {
    const lines = parseUnifiedDiff("@@ -1,2 +1,2 @@\n-first before\n-second before\n+first after\n+second after");
    const visible = [lines[3]!];
    const segments = buildUnifiedWordSegments(lines, visible);
    expect(segments.get(lines[3]!)?.some((part) => !part.changed && part.text === "first " )).toBe(true);
    expect(segments.has(lines[2]!)).toBe(false);
    const rows = buildSplitDiffRows(lines, false).slice(1, 2);
    const enhanced = addSplitWordSegments(rows);
    expect(enhanced[0]?.left?.content).toBe("first before");
    expect(enhanced[0]?.right?.content).toBe("first after");
    expect(enhanced[0]?.rightSegments?.some((part) => part.changed)).toBe(true);
  });

  it("超长行退化到共同前后缀算法", () => {
    const left = Array.from({ length: 361 }, (_, index) => `old${index}`).join(" ");
    const right = left.replace("old180", "new180");
    const rows = buildSplitDiffRows(
      parseUnifiedDiff(`@@ -1 +1 @@\n-${left}\n+${right}`),
      true,
    );
    const pair = rows.find((row) => row.left?.kind === "delete");

    expect(pair?.leftSegments?.some((segment) => segment.changed)).toBe(true);
    expect(pair?.rightSegments?.some((segment) => segment.changed)).toBe(true);
  });

  it("极长单行保留全部内容并退化到共同前后缀", () => {
    const prefix = "token ".repeat(10000);
    const rows = buildSplitDiffRows(parseUnifiedDiff(`@@ -1 +1 @@\n-${prefix}before\n+${prefix}after`), true);
    const pair = rows.find((row) => row.left?.kind === "delete");
    expect(pair?.leftSegments?.map((segment) => segment.text).join("")).toBe(`${prefix}before`);
    expect(pair?.rightSegments?.map((segment) => segment.text).join("")).toBe(`${prefix}after`);
    expect(pair?.leftSegments).toHaveLength(2);
  });

  it("生成 PowerShell git apply 命令并拒绝可提前闭合的 here-string", () => {
    expect(buildGitApplyCommand("diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b\n"))
      .toBe("@'\ndiff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b\n'@ | git apply --whitespace=nowarn");
    expect(() => buildGitApplyCommand("diff --git a/a b/a\n'@\n")).toThrow(/here-string/);
    expect(() => buildGitApplyCommand("  ")).toThrow(/没有可复制/);
  });
});
