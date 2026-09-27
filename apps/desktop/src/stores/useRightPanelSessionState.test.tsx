import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createRightPanelFileTarget } from "./rightPanelFiles";
import { useRightPanelSessionState } from "./useRightPanelSessionState";

describe("工作区侧栏上下文", () => {
  it("首次打开只显示工具选择列表", () => {
    const { result } = renderHook(() => useRightPanelSessionState("/repo/a"));
    expect(result.current).toMatchObject({ open: false, activeTab: null, toolTabs: [] });
    act(() => result.current.setOpen(true));
    expect(result.current).toMatchObject({ open: true, activeTab: null, toolTabs: [] });
  });

  it.each(["files", "review"] as const)("选择 %s 后保持打开并跟随 A→B→A 工作区", (tab) => {
    const { result, rerender } = renderHook(({ cwd }) => useRightPanelSessionState(cwd), { initialProps: { cwd: "/repo/a" } });
    act(() => { result.current.setOpen(true); result.current.setActiveTab(tab); });
    for (const cwd of ["/repo/b", "/repo/a"]) {
      rerender({ cwd });
      expect(result.current).toMatchObject({ open: true, activeTab: tab, toolTabs: [tab], fileTab: null });
    }
  });

  it("文件、预览和选择路径按工作区隔离，同工作区换会话保持资源", () => {
    const { result, rerender } = renderHook(({ cwd }) => useRightPanelSessionState(cwd), { initialProps: { cwd: "/repo/a", sessionId: "first" } });
    const file = createRightPanelFileTarget("/repo/a.ts");
    const preview = createRightPanelFileTarget("/repo/readme.md");
    act(() => {
      result.current.setOpen(true);
      result.current.setActiveTab("files");
      result.current.setFileTab(file);
      result.current.setPreviewTab(preview);
      result.current.setSelectedFilePath(file.path);
      result.current.setActiveTab("file");
      result.current.setReviewScope("session");
    });
    rerender({ cwd: "/repo/a", sessionId: "second" });
    expect(result.current).toMatchObject({ open: true, activeTab: "file", fileTab: file, previewTab: preview, selectedFilePath: file.path, reviewScope: "session" });
    rerender({ cwd: "/repo/b", sessionId: "third" });
    expect(result.current).toMatchObject({ open: true, activeTab: "files", fileTab: null, previewTab: null, selectedFilePath: null });
    rerender({ cwd: "/repo/a", sessionId: "fourth" });
    expect(result.current).toMatchObject({ activeTab: "file", fileTab: file, previewTab: preview, selectedFilePath: file.path });
  });

  it("关闭全部工具后回到选择列表，仅显式重新打开才恢复", () => {
    const { result, rerender } = renderHook(({ id }) => useRightPanelSessionState(id), { initialProps: { id: "a" } });
    act(() => { result.current.setActiveTab("review"); result.current.setActiveTab("files"); });
    act(() => { result.current.setActiveTab(null); result.current.closeToolTab("review"); result.current.closeToolTab("files"); });
    expect(result.current.toolTabs).toEqual([]);
    rerender({ id: "b" });
    expect(result.current).toMatchObject({ activeTab: null, toolTabs: [] });
    act(() => result.current.setActiveTab("files"));
    act(() => result.current.setActiveTab("files"));
    expect(result.current.toolTabs).toEqual(["files"]);
  });

  it("过期回调只更新原工作区资源，不改变当前工具或打开状态", () => {
    const { result, rerender } = renderHook(({ id }) => useRightPanelSessionState(id), { initialProps: { id: "a" } });
    const original = result.current;
    const file = createRightPanelFileTarget("/repo/a/late.ts");
    rerender({ id: "b" });
    act(() => {
      result.current.setActiveTab("review");
      original.setFileTab(file);
      original.setPreviewTab(file);
      original.setSelectedFilePath(file.path);
      original.setActiveTab("file");
      original.setReviewScope("session");
      original.setOpen(true);
      original.closeToolTab("review");
    });
    expect(result.current).toMatchObject({ open: false, activeTab: "review", reviewScope: "git", toolTabs: ["review"], fileTab: null, previewTab: null, selectedFilePath: null });
    rerender({ id: "a" });
    act(() => original.setActiveTab("file"));
    expect(result.current).toMatchObject({ activeTab: "review", fileTab: file, previewTab: file, selectedFilePath: file.path });
    act(() => result.current.setActiveTab((tab) => tab === "review" ? "files" : null));
    expect(result.current.activeTab).toBe("files");
  });
});
