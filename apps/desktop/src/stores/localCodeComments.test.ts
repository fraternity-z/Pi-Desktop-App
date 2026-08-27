import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_CODE_COMMENTS_STORAGE_KEY,
  commentsForFile,
  createLocalCodeComment,
  readLocalCodeComments,
  writeLocalCodeComments,
} from "./localCodeComments";

describe("localCodeComments", () => {
  beforeEach(() => window.localStorage.clear());

  it("创建、持久化、过滤并按行排序本地评论", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const second = createLocalCodeComment({
      rootPath: "C:\\work",
      filePath: "C:\\work\\src\\main.ts",
      line: 2,
      lineText: "second",
      text: "  第二条  ",
    });
    const first = { ...second, id: "first", line: 1, text: "第一条", createdAt: "2026-01-01" };
    writeLocalCodeComments([second, first]);

    expect(readLocalCodeComments()).toHaveLength(2);
    expect(commentsForFile(readLocalCodeComments(), "c:/work/src/main.ts").map((item) => item.line))
      .toEqual([1, 2]);
    expect(second.text).toBe("第二条");
  });

  it("忽略损坏、重复和无效的持久化数据", () => {
    const valid = {
      id: "one",
      rootPath: "C:\\work",
      filePath: "C:\\work\\main.ts",
      line: 1,
      lineText: "line",
      text: "comment",
      createdAt: "2026-01-01",
    };
    window.localStorage.setItem(LOCAL_CODE_COMMENTS_STORAGE_KEY, JSON.stringify([valid, valid, { line: 0 }]));
    expect(readLocalCodeComments()).toEqual([valid]);

    window.localStorage.setItem(LOCAL_CODE_COMMENTS_STORAGE_KEY, "not-json");
    expect(readLocalCodeComments()).toEqual([]);
  });
});
