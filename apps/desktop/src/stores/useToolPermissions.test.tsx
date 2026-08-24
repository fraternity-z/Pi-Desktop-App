import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionConfiguration } from "../ipc/agent";
import {
  DEFAULT_TOOL_PERMISSION_PREFERENCE,
  TOOL_PERMISSIONS_STORAGE_KEY,
  loadToolPermissionPreference,
  normalizeToolPermissionPreference,
  saveToolPermissionPreference,
  useToolPermissions,
} from "./useToolPermissions";

const configuration: SessionConfiguration = {
  model: null,
  thinkingLevel: "off",
  availableThinkingLevels: ["off"],
  availableTools: [
    { name: "read", description: "Read files" },
    { name: "bash", description: "Run commands" },
    { name: "review", description: "Review changes" },
  ],
  activeToolNames: ["read", "bash"],
  defaultToolNames: ["read", "bash"],
};

describe("tool permission preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("对损坏、重复和超界偏好回退到 SDK 默认模式", () => {
    expect(normalizeToolPermissionPreference(null)).toEqual(DEFAULT_TOOL_PERMISSION_PREFERENCE);
    expect(
      normalizeToolPermissionPreference({
        schemaVersion: 1,
        mode: "custom",
        toolNames: ["read", "read"],
      }),
    ).toEqual(DEFAULT_TOOL_PERMISSION_PREFERENCE);
    expect(
      normalizeToolPermissionPreference({
        schemaVersion: 1,
        mode: "custom",
        toolNames: ["x".repeat(129)],
      }),
    ).toEqual(DEFAULT_TOOL_PERMISSION_PREFERENCE);
  });

  it("持久化自定义工具并在存储异常时优雅回退", () => {
    const preference = saveToolPermissionPreference({
      schemaVersion: 1,
      mode: "custom",
      toolNames: ["read", "review"],
    });
    expect(preference.toolNames).toEqual(["read", "review"]);
    expect(loadToolPermissionPreference()).toEqual(preference);

    window.localStorage.setItem(TOOL_PERMISSIONS_STORAGE_KEY, "{");
    expect(loadToolPermissionPreference()).toEqual(DEFAULT_TOOL_PERMISSION_PREFERENCE);
  });

  it("以 SDK 默认值初始化，并跨草稿恢复最后工具目录", () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: SessionConfiguration | null }) => useToolPermissions(value),
      { initialProps: { value: configuration as SessionConfiguration | null } },
    );
    expect(result.current.mode).toBe("default");
    expect(result.current.selectedToolNames).toEqual(["read", "bash"]);

    act(() => result.current.setCustomTools(["review", "missing"]));
    expect(result.current.selectedToolNames).toEqual(["review"]);
    expect(result.current.promptToolNames).toEqual(["review"]);

    rerender({ value: null });
    expect(result.current.availableTools).toEqual(configuration.availableTools);
    expect(result.current.selectedToolNames).toEqual(["review"]);

    act(() => result.current.useDefaultTools());
    expect(result.current.promptToolNames).toBeUndefined();
  });

  it("工具清单异常时默认模式降级，自定义禁止工具保持显式空清单", () => {
    const unavailableConfiguration: SessionConfiguration = {
      ...configuration,
      availableTools: [],
      activeToolNames: [],
      defaultToolNames: [],
    };
    const { result } = renderHook(() => useToolPermissions(unavailableConfiguration));

    expect(result.current.promptToolNames).toBeUndefined();
    act(() => result.current.setCustomTools([]));
    expect(result.current.promptToolNames).toEqual([]);
  });
});
