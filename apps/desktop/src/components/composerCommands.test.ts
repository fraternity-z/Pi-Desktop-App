import { describe, expect, it } from "vitest";

import {
  buildComposerCommandCatalog,
  composerCommandsFromGroups,
  detectComposerTrigger,
  filterComposerCommands,
  groupComposerCommands,
  parseSlashLine,
  replaceTextRange,
  slashToPromptText,
} from "./composerCommands";

describe("composer command helpers", () => {
  it("只在当前行的 token 边界识别 slash，并支持光标位于文本中间", () => {
    expect(detectComposerTrigger("/", 1)).toEqual({
      kind: "slash",
      query: "",
      rangeStart: 0,
      rangeEnd: 1,
    });
    expect(detectComposerTrigger("请运行 /mod", 8)).toEqual({
      kind: "slash",
      query: "mod",
      rangeStart: 4,
      rangeEnd: 8,
    });
    expect(detectComposerTrigger("https://example", 15)).toBeNull();
    expect(detectComposerTrigger("/one/two", 8)).toBeNull();
    expect(detectComposerTrigger("上一行\n/set", 8)?.query).toBe("set");
  });

  it("替换命令 token 后把光标放在命令末尾", () => {
    expect(replaceTextRange("前缀 /mo后缀", 3, 6, "/model ")).toEqual({
      text: "前缀 /model 后缀",
      cursor: 10,
    });
  });

  it("合并内置与运行时命令并按前缀优先筛选、分组", () => {
    const catalog = buildComposerCommandCatalog([
      { name: "review", description: "审查变更", source: "extension" },
      { name: "Deploy", description: "部署", source: "prompt" },
      { name: "review", description: "重复", source: "skill" },
    ]);
    expect(catalog.map((item) => item.name)).toEqual(
      expect.arrayContaining(["review", "Deploy", "new", "settings"]),
    );
    expect(catalog.filter((item) => item.name.toLocaleLowerCase() === "review")).toHaveLength(1);
    const filtered = filterComposerCommands(catalog, "set");
    expect(filtered[0]?.name).toBe("settings");
    const groups = groupComposerCommands([
      ...catalog,
      { name: "skill:docs", description: "文档技能", source: "skill" },
    ]);
    expect(groups.map((group) => group.id)).toEqual(["command", "skill"]);
    expect(composerCommandsFromGroups(groups).length).toBe(catalog.length + 1);
  });

  it("只解析完整的一行 slash 命令", () => {
    expect(parseSlashLine(" /name   我的会话 ")).toEqual({ name: "name", args: "我的会话" });
    expect(parseSlashLine("普通文本")).toBeUndefined();
    expect(parseSlashLine("/two\nwords")).toBeUndefined();
  });

  it("处理光标、列表上限和非法命令边界", () => {
    expect(detectComposerTrigger("/rev", Number.NaN)?.rangeEnd).toBe(4);
    expect(detectComposerTrigger("/rev", -4)).toBeNull();
    expect(replaceTextRange("abc", 99, 120, "x")).toEqual({ text: "abcx", cursor: 4 });
    expect(filterComposerCommands([{ name: "review", description: "审查", source: "extension" }], "", 0)).toEqual([]);
    expect(groupComposerCommands([])).toEqual([]);
    expect(
      buildComposerCommandCatalog([
        { name: " ", description: "无效", source: "extension" },
        { name: "bad/name", description: "无效", source: "extension" },
        { name: "review", description: "  ", argumentHint: " ", source: "extension" },
      ]).find((item) => item.name === "review"),
    ).toMatchObject({ name: "review", description: "" });
    expect(slashToPromptText("review", "  now  ")).toBe("/review now");
    expect(slashToPromptText("review")).toBe("/review");
  });
});
