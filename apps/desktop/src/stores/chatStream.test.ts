import { describe, expect, it } from "vitest";

import { appendMonotonicText } from "./chatStream";

describe("appendMonotonicText", () => {
  it("按顺序追加增量且不缩短已有文本", () => {
    expect(appendMonotonicText("", "Hel")).toBe("Hel");
    expect(appendMonotonicText("Hel", "lo")).toBe("Hello");
    expect(appendMonotonicText("Hello", "")).toBe("Hello");
  });

  it("忽略累计快照和重复块", () => {
    expect(appendMonotonicText("Hel", "Hello")).toBe("Hello");
    expect(appendMonotonicText("Hello", "Hello")).toBe("Hello");
    expect(appendMonotonicText("Hello", "lo")).toBe("Hello");
  });

  it("合并重叠增量而不重复内容", () => {
    expect(appendMonotonicText("Hello wor", "world!")).toBe("Hello world!");
    expect(appendMonotonicText("ha", "ha")).toBe("ha");
    expect(appendMonotonicText("\n", "\n")).toBe("\n");
  });
});
