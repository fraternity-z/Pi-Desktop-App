import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionLifecycle } from "../stores/useChatSession";
import { useComposerInput } from "./useComposerInput";

describe("useComposerInput", () => {
  beforeEach(() => window.localStorage.clear());

  function setup() {
    return renderHook(({ id, lifecycle }: { id: string; lifecycle: SessionLifecycle }) => useComposerInput(id, lifecycle), {
      initialProps: { id: "draft:1", lifecycle: "draft" as SessionLifecycle },
    });
  }

  it("按会话身份保留文字图片附件和权限，异步更新只写回来源", () => {
    const { result, rerender } = setup();
    act(() => result.current.update((current) => ({ ...current, draft: "草稿内容", attachments: ["C:/file.txt"], permission: { schemaVersion: 1, mode: "custom", toolNames: ["read"] } })));
    const finishPaste = result.current.update;
    rerender({ id: "history", lifecycle: "persisted" });
    expect(result.current.draft).toBe("");
    act(() => result.current.update((current) => ({ ...current, draft: "历史会话输入" })));
    act(() => finishPaste((current) => ({ ...current, attachments: [...current.attachments, "C:/paste.png"], pastedImagePaths: ["C:/paste.png"] })));
    expect(result.current.attachments).toEqual([]);
    rerender({ id: "draft:1", lifecycle: "draft" });
    expect(result.current.draft).toBe("草稿内容");
    expect(result.current.attachments).toEqual(["C:/file.txt", "C:/paste.png"]);
    expect(result.current.permission.toolNames).toEqual(["read"]);
    rerender({ id: "history", lifecycle: "persisted" });
    expect(result.current.draft).toBe("历史会话输入");
  });

  it("首次发送身份替换后将失败恢复和迟到回调路由到真实会话", () => {
    const { result, rerender } = setup();
    act(() => result.current.beginSubmission());
    const recover = result.current.update;
    rerender({ id: "live", lifecycle: "live" });
    act(() => recover((current) => ({ ...current, draft: "重试内容" })));
    expect(result.current.draft).toBe("重试内容");
    rerender({ id: "draft:2", lifecycle: "draft" });
    expect(result.current.draft).toBe("");
    act(() => recover((current) => ({ ...current, attachments: ["C:/late.png"] })));
    expect(result.current.attachments).toEqual([]);
    rerender({ id: "live", lifecycle: "live" });
    expect(result.current.attachments).toEqual(["C:/late.png"]);
  });

  it("创建失败后打开历史会话不把草稿迁移到历史输入", () => {
    const { result, rerender } = setup();
    act(() => {
      result.current.beginSubmission();
      result.current.update((current) => ({ ...current, draft: "保留重试" }));
      result.current.beginNavigation();
    });
    rerender({ id: "existing-live", lifecycle: "live" });
    expect(result.current.draft).toBe("");
    rerender({ id: "draft:1", lifecycle: "draft" });
    expect(result.current.draft).toBe("保留重试");
  });
});
