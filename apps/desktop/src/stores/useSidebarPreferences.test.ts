import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  loadSidebarPreferences,
  normalizeSidebarPath,
  useSidebarPreferences,
} from "./useSidebarPreferences";

describe("useSidebarPreferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("使用 Pix 的默认分组、排序和折叠设置", () => {
    expect(loadSidebarPreferences()).toEqual(
      expect.objectContaining({
        groupMode: "project",
        projectSortMode: "priority",
        conversationSortMode: "priority",
        projectsOpen: true,
        conversationsOpen: true,
        pinnedOpen: true,
      }),
    );
  });

  it("规范化 Windows 路径并持久化项目元数据", () => {
    const { result } = renderHook(() => useSidebarPreferences());

    act(() => {
      result.current.setProjectAlias("C:\\Work\\Demo\\", "演示项目");
      result.current.togglePinnedProject("c:/work/demo");
      result.current.toggleExpandedProject("C:\\WORK\\DEMO");
    });

    const key = normalizeSidebarPath("C:\\Work\\Demo");
    expect(result.current.preferences.projectAliases[key]).toBe("演示项目");
    expect(result.current.preferences.pinnedProjects).toContain(key);
    expect(result.current.preferences.expandedProjects).toContain(key);
    expect(loadSidebarPreferences().projectAliases[key]).toBe("演示项目");
  });

  it("删除会话仅更新桌面元数据并清理关联状态", () => {
    const { result } = renderHook(() => useSidebarPreferences());

    act(() => {
      result.current.setThreadAlias("thread-1", "重要会话");
      result.current.togglePinnedThread("thread-1");
      result.current.markThreadUnread("thread-1", true);
      result.current.setThreadProject("thread-1", "C:\\work");
      result.current.deleteThread("thread-1");
    });

    expect(result.current.preferences.deletedThreads).toContain("thread-1");
    expect(result.current.preferences.pinnedThreads).not.toContain("thread-1");
    expect(result.current.preferences.unreadThreads).not.toContain("thread-1");
    expect(result.current.preferences.threadAliases).not.toHaveProperty("thread-1");
    expect(result.current.preferences.threadProjectOverrides).not.toHaveProperty("thread-1");
  });

  it("归档会话保存恢复展示所需的非敏感元数据", () => {
    const { result } = renderHook(() => useSidebarPreferences());
    act(() =>
      result.current.setThreadArchived("thread-1", true, {
        title: "会话标题",
        cwd: "C:\\work",
      }),
    );

    expect(result.current.preferences.archivedThreads).toContain("thread-1");
    expect(result.current.preferences.archivedThreadMeta["thread-1"]).toEqual(
      expect.objectContaining({ title: "会话标题", cwd: "C:\\work" }),
    );
  });
});

