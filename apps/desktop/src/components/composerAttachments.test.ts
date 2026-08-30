import { describe, expect, it } from "vitest";

import {
  MAX_COMPOSER_ATTACHMENTS,
  displayPromptContent,
  isPromptImagePath,
  normalizeAttachedPaths,
  promptImagePaths,
  promptWithAttachedPaths,
} from "./composerAttachments";

describe("composerAttachments", () => {
  it("规范化、去重并限制附加路径数量", () => {
    const paths = [
      " C:\\Work\\a.ts ",
      "c:/work/a.ts",
      "",
      ...Array.from({ length: 20 }, (_, index) => `C:\\work\\file-${index}.ts`),
    ];

    const normalized = normalizeAttachedPaths(paths);
    expect(normalized[0]).toBe("C:\\Work\\a.ts");
    expect(normalized).toHaveLength(MAX_COMPOSER_ATTACHMENTS);
  });

  it("使用 Pix 兼容结构序列化路径并从展示内容中剥离元数据", () => {
    const wire = promptWithAttachedPaths("检查文件", ["C:\\work\\a&b<1>.ts"]);

    expect(wire).toBe(
      "检查文件\n\n<attached-paths>\n  <path>C:\\work\\a&amp;b&lt;1&gt;.ts</path>\n</attached-paths>",
    );
    expect(displayPromptContent(wire)).toBe("检查文件");
    expect(displayPromptContent("普通内容")).toBe("普通内容");
  });

  it("没有有效路径时保持原始提示不变", () => {
    expect(promptWithAttachedPaths("hello", [" "])).toBe("hello");
  });

  it("识别 SDK 支持的图片扩展名并筛出图片路径", () => {
    expect(isPromptImagePath("C:\\cache\\PASTE.PNG")).toBe(true);
    expect(isPromptImagePath("C:\\cache\\photo.jpeg")).toBe(true);
    expect(isPromptImagePath("C:\\cache\\animation.gif")).toBe(true);
    expect(isPromptImagePath("C:\\cache\\preview.webp")).toBe(true);
    expect(isPromptImagePath("C:\\cache\\vector.svg")).toBe(false);
    expect(promptImagePaths(["C:\\cache\\paste.png", "C:\\work\\notes.txt"])).toEqual([
      "C:\\cache\\paste.png",
    ]);
  });
});
