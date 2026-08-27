import { describe, expect, it, vi } from "vitest";

import {
  createRightPanelFileTarget,
  decodeBase64Bytes,
  decodeBase64Utf8,
  formatRightPanelError,
  getFileExtension,
  getFileName,
  getImageMimeType,
  getPreviewKind,
} from "./rightPanelFiles";

describe("rightPanelFiles", () => {
  it("按源程序白名单将文件分流到查看器或快速预览", () => {
    expect(createRightPanelFileTarget("C:\\work\\src\\main.ts")).toMatchObject({
      name: "main.ts",
      extension: "ts",
      tab: "file",
      previewKind: null,
    });
    expect(createRightPanelFileTarget("C:\\work\\README.md")).toMatchObject({
      tab: "preview",
      previewKind: "markdown",
    });
    expect(getPreviewKind("PNG")).toBe("image");
    expect(getPreviewKind("CSV")).toBe("text");
    expect(getPreviewKind("docx")).toBe("document");
    expect(getPreviewKind("exe")).toBeNull();
  });

  it("处理无扩展名、隐藏文件和混合路径分隔符", () => {
    expect(getFileName("C:\\work/src/file.txt")).toBe("file.txt");
    expect(getFileExtension("README")).toBe("");
    expect(getFileExtension(".env")).toBe("");
    expect(getFileExtension("report.PDF?download=1")).toBe("pdf");
  });

  it("解码 UTF-8 与二进制 Base64，并映射图片 MIME", () => {
    expect(decodeBase64Utf8("5L2g5aW9")).toBe("你好");
    expect(Array.from(decodeBase64Bytes("AAEC"))).toEqual([0, 1, 2]);
    expect(getImageMimeType("SVG")).toBe("image/svg+xml");
    expect(getImageMimeType("jpeg")).toBe("image/jpeg");
    expect(getImageMimeType("unknown")).toBe("application/octet-stream");
  });

  it("保留结构化错误并为未知错误提供稳定回退", () => {
    expect(formatRightPanelError({ code: "WORKSPACE_FILE_TOO_LARGE", message: "文件过大" }, "X", "Y"))
      .toBe("WORKSPACE_FILE_TOO_LARGE: 文件过大");
    expect(formatRightPanelError(new Error("读取失败"), "X", "Y")).toBe("读取失败");
    expect(formatRightPanelError(null, "WORKSPACE_FILE_READ_FAILED", "无法读取"))
      .toBe("WORKSPACE_FILE_READ_FAILED: 无法读取");
  });

  it("在浏览器 atob 不可用时使用 Buffer 解码", () => {
    const original = globalThis.atob;
    vi.stubGlobal("atob", undefined);
    expect(decodeBase64Utf8("aGVsbG8=")).toBe("hello");
    vi.stubGlobal("atob", original);
  });
});
