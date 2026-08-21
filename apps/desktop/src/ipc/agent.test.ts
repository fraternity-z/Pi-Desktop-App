import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  abortAgent,
  configureAgentSession,
  createAgentSession,
  listAgentModels,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  parseAgentEvent,
  promptAgent,
} from "./agent";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("agent IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
  });

  it("只调用固定、类型化的会话命令", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ sessionId: "s-1", modelFallbackMessage: null })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ sessionId: "saved" })
      .mockResolvedValueOnce([{ provider: "openai", id: "gpt", name: "GPT" }])
      .mockResolvedValueOnce({ thinkingLevel: "high" })
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(undefined);

    await expect(createAgentSession("C:\\work")).resolves.toEqual({
      sessionId: "s-1",
      modelFallbackMessage: null,
    });
    await listAgentSessions();
    await openAgentSession("C:\\agent\\sessions\\saved.jsonl");
    await listAgentModels();
    await configureAgentSession("saved", { thinkingLevel: "high" });
    await promptAgent("s-1", "hello");
    await abortAgent("s-1");

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
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "agent_abort", { sessionId: "s-1" });
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

  it("接受合法文本、空数据和会话配置事件", () => {
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
    expect(parseAgentEvent([])).toBeNull();
  });
});
