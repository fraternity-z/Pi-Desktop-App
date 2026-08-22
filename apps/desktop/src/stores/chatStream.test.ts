import { describe, expect, it } from "vitest";

import { appendMonotonicText } from "./chatStream";

describe("appendMonotonicText", () => {
  it("按顺序追加增量且不缩短已有文本", () => {
    expect(appendMonotonicText("", "Hel")).toBe("Hel");
    expect(appendMonotonicText("Hel", "lo")).toBe("Hello");
    expect(appendMonotonicText("Hello", "")).toBe("Hello");
  });

  it("保留具有不同事件序号的重复文本块", () => {
    expect(appendMonotonicText("ha", "ha")).toBe("haha");
    expect(appendMonotonicText("\n", "\n")).toBe("\n\n");
  });
});
