import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  abortAgent,
  clampThinkingLevel,
  checkAgentPackageUpdates,
  clearAgentQueue,
  configureAgentSession,
  createAgentSession,
  deleteAgentSessions,
  installAgentPackage,
  listAgentModels,
  listAgentPackages,
  listAgentResources,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  parseAgentEvent,
  promptAgent,
  removeAgentPackage,
  setAgentPackageEnabled,
  THINKING_LEVELS,
  normalizeThinkingLevels,
  updateAgentPackage,
} from "./agent";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("agent IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
  });

  it("按 Pi 标准顺序归一化多档能力并使用兼容 clamp 规则", () => {
    expect(THINKING_LEVELS).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(normalizeThinkingLevels(["max", "low", "unknown", "low"])).toEqual(["low", "max"]);
    expect(clampThinkingLevel("xhigh", ["off", "high", "max"])).toBe("max");
    expect(clampThinkingLevel("minimal", ["off", "high"])).toBe("high");
  });

  it("只调用固定、类型化的插件与资源命令", async () => {
    vi.mocked(invoke).mockResolvedValue([]);

    await listAgentPackages("C:\\work");
    await installAgentPackage("C:\\work", "npm:pi-test", "global");
    await setAgentPackageEnabled("C:\\work", "npm:pi-test", "global", false);
    await removeAgentPackage("C:\\work", "npm:pi-test", "global");
    await updateAgentPackage("C:\\work", "npm:pi-test");
    await updateAgentPackage("C:\\work");
    await checkAgentPackageUpdates("C:\\work");
    await listAgentResources("C:\\work");

    expect(invoke).toHaveBeenNthCalledWith(1, "agent_list_packages", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_install_package", {
      cwd: "C:\\work",
      source: "npm:pi-test",
      scope: "global",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_set_package_enabled", {
      cwd: "C:\\work",
      source: "npm:pi-test",
      scope: "global",
      enabled: false,
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "agent_remove_package", {
      cwd: "C:\\work",
      source: "npm:pi-test",
      scope: "global",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "agent_update_package", {
      cwd: "C:\\work",
      source: "npm:pi-test",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "agent_update_package", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(7, "agent_check_package_updates", {
      cwd: "C:\\work",
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "agent_list_resources", { cwd: "C:\\work" });
  });

  it("只调用固定、类型化的会话命令", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ sessionId: "s-1", modelFallbackMessage: null })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ sessionId: "saved" })
      .mockResolvedValueOnce([{ provider: "openai", id: "gpt", name: "GPT" }])
      .mockResolvedValueOnce({ thinkingLevel: "high" })
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ deletedSessionIds: ["saved"], missingSessionIds: [] });

    await expect(createAgentSession("C:\\work")).resolves.toEqual({
      sessionId: "s-1",
      modelFallbackMessage: null,
    });
    await listAgentSessions();
    await openAgentSession("C:\\agent\\sessions\\saved.jsonl");
    await listAgentModels();
    await configureAgentSession("saved", { thinkingLevel: "high" });
    await promptAgent("s-1", "hello", "steer");
    await clearAgentQueue("s-1");
    await abortAgent("s-1");
    await deleteAgentSessions(["saved"]);

    expect(invoke).toHaveBeenNthCalledWith(1, "agent_create_session", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_list_sessions");
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_open_session", {
      sessionPath: "C:\\agent\\sessions\\saved.jsonl",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "agent_list_models");
    expect(invoke).toHaveBeenNthCalledWith(5, "agent_configure_session", {
      sessionId: "saved",
      update: { thinkingLevel: "high" },
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "agent_prompt", {
      sessionId: "s-1",
      text: "hello",
      streamingBehavior: "steer",
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "agent_clear_queue", { sessionId: "s-1" });
    expect(invoke).toHaveBeenNthCalledWith(8, "agent_abort", { sessionId: "s-1" });
    expect(invoke).toHaveBeenNthCalledWith(9, "agent_delete_sessions", {
      sessionIds: ["saved"],
    });
  });

  it("超过协议上限时分批清理会话并合并结果", async () => {
    const sessionIds = Array.from({ length: 1025 }, (_, index) => `session-${index}`);
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        deletedSessionIds: sessionIds.slice(0, 1024),
        missingSessionIds: [],
      })
      .mockResolvedValueOnce({
        deletedSessionIds: [],
        missingSessionIds: [sessionIds[1024]!],
      });

    await expect(deleteAgentSessions(sessionIds)).resolves.toEqual({
      deletedSessionIds: sessionIds.slice(0, 1024),
      missingSessionIds: [sessionIds[1024]],
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, "agent_delete_sessions", {
      sessionIds: sessionIds.slice(0, 1024),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_delete_sessions", {
      sessionIds: [sessionIds[1024]],
    });
  });

  it("订阅经过边界校验的事件、丢弃无效载荷并返回解绑函数", async () => {
    const unlisten = vi.fn<() => void>();
    let tauriHandler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (_name, handler) => {
      tauriHandler = handler as (event: { payload: unknown }) => void;
      return unlisten;
    });
    const handler = vi.fn();

    await expect(listenToAgentEvents(handler)).resolves.toBe(unlisten);
    tauriHandler?.({
      payload: {
        v: 1,
        kind: "event",
        seq: 1,
        sessionId: "s-1",
        name: "agent.started",
      },
    });
    tauriHandler?.({
      payload: {
        v: 1,
        kind: "event",
        seq: 2,
        sessionId: "s-1",
        name: "tool.started",
        data: { toolCallId: "tool-1", toolName: "read" },
      },
    });
    tauriHandler?.({ payload: { v: 1, kind: "event", seq: 3, name: "unknown" } });

    expect(listen).toHaveBeenCalledWith("agent://event", expect.any(Function));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: "agent.started" }));
    expect(handler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: "tool.started" }),
    );
  });

  it("拒绝错误协议版本、无效序号和超长工具字段", () => {
    expect(parseAgentEvent({ v: 2, kind: "event" })).toBeNull();
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 0,
        sessionId: "s-1",
        name: "agent.started",
      }),
    ).toBeNull();
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 1,
        sessionId: "s-1",
        name: "tool.started",
        data: { toolCallId: "x".repeat(257), toolName: "read" },
      }),
    ).toBeNull();
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 1,
        sessionId: "s-1",
        name: "tool.started",
        data: { toolCallId: "tool-1", toolName: "read", args: { path: "secret" } },
      }),
    ).toBeNull();
  });

  it("接受合法文本、空数据、会话配置和上下文事件", () => {
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 1,
        sessionId: "s-1",
        name: "message.delta",
        data: { delta: "hello" },
      }),
    ).toEqual(expect.objectContaining({ name: "message.delta" }));
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 2,
        sessionId: "s-1",
        name: "agent.settled",
        data: null,
      }),
    ).toEqual(expect.objectContaining({ name: "agent.settled" }));
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 3,
        sessionId: "s-1",
        name: "session.configurationChanged",
        data: { model: null, thinkingLevel: "off", availableThinkingLevels: ["off"] },
      }),
    ).toEqual(expect.objectContaining({ name: "session.configurationChanged" }));
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 6,
        sessionId: "s-1",
        name: "session.configurationChanged",
        data: {
          model: null,
          thinkingLevel: "max",
          availableThinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        },
      }),
    ).toEqual(expect.objectContaining({ name: "session.configurationChanged" }));
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 7,
        sessionId: "s-1",
        name: "session.configurationChanged",
        data: { model: null, thinkingLevel: "high", availableThinkingLevels: ["off"] },
      }),
    ).toBeNull();
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 8,
        sessionId: "s-1",
        name: "session.configurationChanged",
        data: { model: null, thinkingLevel: "off", availableThinkingLevels: ["off", "off"] },
      }),
    ).toBeNull();
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 4,
        sessionId: "s-1",
        name: "session.usageChanged",
        data: { tokens: 2_048, contextWindow: 8_192, percent: 25 },
      }),
    ).toEqual(expect.objectContaining({ name: "session.usageChanged" }));
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 5,
        sessionId: "s-1",
        name: "session.usageChanged",
        data: { tokens: -1, contextWindow: 8_192, percent: 25 },
      }),
    ).toBeNull();
    expect(parseAgentEvent([])).toBeNull();
  });

  it("校验队列事件内容和总长度", () => {
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 1,
        sessionId: "s-1",
        name: "queue.updated",
        data: { steering: ["guide"], followUp: ["later"] },
      }),
    ).toEqual(expect.objectContaining({ name: "queue.updated" }));
    expect(
      parseAgentEvent({
        v: 1,
        kind: "event",
        seq: 2,
        sessionId: "s-1",
        name: "queue.updated",
        data: { steering: [1], followUp: [] },
      }),
    ).toBeNull();
  });
});
