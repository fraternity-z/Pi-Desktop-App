import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../stores/useChatSession";
import { buildToolDiffPreview, toolActionLabel, toolGroupSummary, toolKind } from "./toolActivityModel";

function edit(input: unknown, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: "edit", role: "tool", toolName: "edit", status: "completed", content: "",
    toolInput: { text: JSON.stringify(input), format: "json", truncated: false }, ...overrides };
}

describe("toolActivityModel", () => {
  it.each([
    ["bash", "command"], ["functions.exec_command", "command"], ["read", "read"],
    ["mcp__fastctx__replace", "edit"], ["apply_patch", "edit"], ["write", "write"],
    ["web.search_query", "search"], ["mcp__fetch__fetch", "fetch"], ["custom_tool", "integration"],
    [undefined, "integration"],
  ] as const)("分类 %s 使用对应动作图标", (name, kind) => expect(toolKind(name)).toBe(kind));

  it.each([
    ["pending", "等待编辑"], ["running", "正在编辑"], ["completed", "编辑了"],
    ["failed", "编辑失败"], ["cancelled", "已停止编辑"],
  ] as const)("动作标题准确区分 %s", (status, label) => expect(toolActionLabel("edit", status)).toBe(label));

  it("按首次出现顺序归纳动作而不重复工具名", () => {
    const messages = ["bash", "edit", "bash", "web_search", "custom"].map((toolName) => edit({}, { toolName }));
    expect(toolGroupSummary(messages, "completed")).toBe("运行了命令、编辑了文件、搜索了内容、调用了custom");
    expect(toolGroupSummary([edit({}, { toolName: undefined })], "pending")).toBe("等待调用工具");
    expect(toolGroupSummary([], "completed")).toBe("");
  });

  it("保留中间相同行，统计真实片段增删和相对行号", () => {
    const preview = buildToolDiffPreview(edit({ path: "src/app.ts", oldText: "a\nb\nc\nd\n", newText: "a\nB\nc\nD\ne\n" }))!;
    expect(preview.stats).toEqual({ additions: 3, deletions: 2 });
    expect(preview.lines.map((line) => line.kind)).toEqual(["context", "delete", "add", "context", "delete", "add", "add"]);
    expect(preview.lines[3]).toMatchObject({ oldLine: 3, newLine: 3, content: "c" });
    expect(preview.text).toBe(" a\n-b\n+B\n c\n-d\n+D\n+e");
    expect(preview.note).toContain("片段");
  });

  it.each([
    ["", "new", 1, 0], ["old", "", 0, 1], ["", "", 0, 0], ["same", "same", 0, 0],
    ["a\r\nb\r\n", "a\nb\n", 0, 0],
  ])("处理空片段、纯增删及换行 %s → %s", (before, after, additions, deletions) => {
    expect(buildToolDiffPreview(edit({ file_path: "a.ts", old_string: before, new_string: after }))?.stats).toEqual({ additions, deletions });
  });

  it("写入文件没有旧内容时不声称创建文件或显示真实增删", () => {
    const preview = buildToolDiffPreview(edit({ filePath: "a.ts", content: "hello\nworld" }, { toolName: "write" }))!;
    expect(preview.stats).toBeNull();
    expect(preview.note).toContain("无法计算实际增删");
    expect(preview.lines).toHaveLength(2);
  });

  it.each(["pending", "running", "failed", "cancelled"] as const)("%s 不能误报已经应用变更", (status) => {
    const preview = buildToolDiffPreview(edit({ path: "a", oldText: "x", newText: "y" }, { status }))!;
    expect(preview.stats).toBeNull();
    expect(preview.note).toContain("尚未确认写入");
  });

  it.each([null, [], {}, { path: " " }, { path: "x", oldText: 1, newText: "a" }, { path: "x", oldText: "a" }])("不为缺失或错误输入虚构差异 %j", (input) => {
    expect(buildToolDiffPreview(edit(input))).toBeNull();
  });

  it("非编辑工具和无效 JSON 安全降级", () => {
    expect(buildToolDiffPreview(edit({}, { toolName: "bash" }))).toBeNull();
    expect(buildToolDiffPreview(edit({}, { toolInput: undefined }))).toBeNull();
    expect(buildToolDiffPreview(edit({}, { toolInput: { text: "{", format: "json", truncated: true } }))).toBeNull();
    expect(buildToolDiffPreview(edit({}, { toolInput: { text: "text", format: "text", truncated: false } }))).toBeNull();
  });

  it("对截断载荷和过大内容标注不完整并隐藏统计", () => {
    const message = edit({ path: "a", oldText: "x", newText: "y" });
    message.toolInput!.truncated = true;
    expect(buildToolDiffPreview(message)).toMatchObject({ truncated: true, stats: null });
    for (const newText of ["a".repeat(60_000), "line\n".repeat(500)]) {
      const preview = buildToolDiffPreview(edit({ path: "a", oldText: "", newText }))!;
      expect(preview).toMatchObject({ truncated: true, stats: null });
      expect(preview.lines.length).toBeLessThanOrEqual(400);
    }
  });

  it("大编辑限制 LCS 运算量并保留相同首尾", () => {
    const before = ["start", ...Array.from({ length: 398 }, (_, i) => `old${i}`), "end"];
    const after = ["start", ...Array.from({ length: 398 }, (_, i) => `new${i}`), "end"];
    const preview = buildToolDiffPreview(edit({ path: "a", oldText: before.join("\n"), newText: after.join("\n") }))!;
    expect(preview.stats).toEqual({ additions: 398, deletions: 398 });
    expect(preview.lines[0]?.kind).toBe("context");
    expect(preview.lines.at(-1)?.kind).toBe("context");
  });
});
