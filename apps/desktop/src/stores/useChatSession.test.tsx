import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  abortAgent,
  configureAgentSession,
  createAgentSession,
  listAgentModels,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  promptAgent,
  type AgentEvent,
} from "../ipc/agent";
import { useChatSession } from "./useChatSession";

vi.mock("../ipc/agent", () => ({
  abortAgent: vi.fn(),
  configureAgentSession: vi.fn(),
  createAgentSession: vi.fn(),
  listAgentModels: vi.fn(),
  listAgentSessions: vi.fn(),
  listenToAgentEvents: vi.fn(),
  openAgentSession: vi.fn(),
  promptAgent: vi.fn(),
}));

let nextSequence = 1;

describe("useChatSession", () => {
  let emit: ((event: AgentEvent) => void) | undefined;
  const unlisten = vi.fn<() => void>();

  beforeEach(() => {
    emit = undefined;
    nextSequence = 1;
    unlisten.mockReset();
    vi.mocked(createAgentSession).mockReset().mockResolvedValue({
      sessionId: "s-1",
      cwd: "C:\\work",
      sessionPath: "C:\\agent\\sessions\\s-1.jsonl",
      modelFallbackMessage: "已切换到可用模型",
      configuration: {
        model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
        thinkingLevel: "medium",
        availableThinkingLevels: ["off", "medium", "high"],
      },
      messages: [],
    });
    vi.mocked(openAgentSession).mockReset().mockResolvedValue({
      sessionId: "saved",
      cwd: "C:\\work",
      sessionPath: "C:\\agent\\sessions\\saved.jsonl",
      modelFallbackMessage: null,
      configuration: {
        model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
        thinkingLevel: "high",
        availableThinkingLevels: ["off", "medium", "high"],
      },
      messages: [{ role: "user", content: "saved prompt" }],
    });
    vi.mocked(listAgentSessions).mockReset().mockResolvedValue([]);
    vi.mocked(listAgentModels).mockReset().mockResolvedValue([
      { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
    ]);
    vi.mocked(configureAgentSession).mockReset().mockResolvedValue({
      model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
      thinkingLevel: "high",
      availableThinkingLevels: ["off", "medium", "high"],
    });
    vi.mocked(promptAgent).mockReset().mockResolvedValue(0);
    vi.mocked(abortAgent).mockReset().mockResolvedValue(undefined);
    vi.mocked(listenToAgentEvents)
      .mockReset()
      .mockImplementation(async (handler) => {
        emit = handler;
        return unlisten;
      });
  });

  it("覆盖空输入、无会话和有效会话状态", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.sendPrompt("ignored"));
    await act(() => result.current.abort());
    await act(() => result.current.createSession("   "));
    expect(result.current.error).toContain("WORKSPACE_PATH_INVALID");

    await act(() => result.current.createSession(" C:\\work "));
    expect(result.current.phase).toBe("ready");
    expect(result.current.modelFallbackMessage).toBe("已切换到可用模型");
    expect(result.current.cwd).toBe("C:\\work");
    expect(result.current.configuration?.thinkingLevel).toBe("medium");
    expect(createAgentSession).toHaveBeenCalledWith("C:\\work");

    await act(() => result.current.sendPrompt("   "));
    await act(() => result.current.sendPrompt(" hello "));
    expect(promptAgent).toHaveBeenCalledWith("s-1", "hello");
    expect(result.current.messages).toHaveLength(2);

    await act(() => result.current.abort());
    expect(abortAgent).toHaveBeenCalledWith("s-1");
  });

  it("加载 SDK 目录、恢复会话并同步模型与思考强度", async () => {
    vi.mocked(listAgentSessions).mockResolvedValueOnce([
      {
        id: "saved",
        path: "C:\\agent\\sessions\\saved.jsonl",
        cwd: "C:\\work",
        name: null,
        created: "2026-08-20T08:00:00.000Z",
        modified: "2026-08-20T09:00:00.000Z",
        messageCount: 1,
        firstMessage: "saved prompt",
      },
    ]);
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.loadCatalogs());
    expect(result.current.catalogPhase).toBe("ready");
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.models[0]?.name).toBe("GPT");

    await act(() => result.current.openSession("C:\\agent\\sessions\\saved.jsonl"));
    expect(result.current.sessionId).toBe("saved");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "saved prompt" }),
    ]);

    await act(() => result.current.updateThinkingLevel("high"));
    expect(configureAgentSession).toHaveBeenCalledWith("saved", { thinkingLevel: "high" });
    expect(result.current.configuration?.thinkingLevel).toBe("high");
    await act(() => result.current.updateModel("openai", "gpt"));
    expect(configureAgentSession).toHaveBeenCalledWith("saved", {
      model: { provider: "openai", id: "gpt" },
    });
  });

  it("目录部分失败时保留可用数据并暴露可重试错误", async () => {
    vi.mocked(listAgentSessions).mockRejectedValueOnce({
      code: "SESSION_LIST_FAILED",
      message: "无法读取会话",
    });
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.loadCatalogs());

    expect(result.current.catalogPhase).toBe("error");
    expect(result.current.catalogError).toContain("SESSION_LIST_FAILED");
    expect(result.current.models).toHaveLength(1);
  });

  it("忽略其他会话和无效增量并处理完整事件生命周期", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    act(() => {
      emit?.(event("agent.started", undefined, "other"));
      emit?.(event("message.delta", null));
      emit?.(event("message.delta", { delta: 1 }));
      emit?.(event("message.delta", { delta: "orphan" }));
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.messages).toHaveLength(0);

    let resolvePrompt: ((finalSequence: number) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    act(() => {
      void result.current.sendPrompt("stream");
    });
    act(() => {
      emit?.(event("agent.started"));
      emit?.(event("tool.started", { toolCallId: "tool-1", toolName: "read" }));
      emit?.(event("message.delta", { delta: "A" }));
      emit?.(event("tool.completed", { toolCallId: "tool-1", toolName: "read" }));
      emit?.(event("tool.failed", { toolCallId: "tool-2", toolName: "bash" }));
      emit?.(event("agent.settled"));
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.messages.at(-1)?.content).toBe("A");
    expect(result.current.messages.at(-1)?.tools).toEqual([
      { id: "tool-1", name: "read", status: "completed" },
      { id: "tool-2", name: "bash", status: "failed" },
    ]);

    await act(async () => resolvePrompt?.(10));
    expect(result.current.phase).toBe("ready");
  });

  it("保留已有流式文本并展示 prompt 与 abort 错误", async () => {
    let rejectPrompt: ((reason: unknown) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((_, reject) => {
          rejectPrompt = reject;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    act(() => {
      void result.current.sendPrompt("fail");
    });
    act(() => emit?.(event("tool.started", { toolCallId: "tool-1", toolName: "bash" })));
    act(() => emit?.(event("message.delta", { delta: "partial" })));
    await act(async () => rejectPrompt?.(new Error("model failed")));

    expect(result.current.messages.at(-1)?.content).toBe("partial");
    expect(result.current.messages.at(-1)?.tools?.[0]?.status).toBe("failed");
    expect(result.current.error).toBe("model failed");
    vi.mocked(abortAgent).mockRejectedValue("abort failed");
    await act(() => result.current.abort());
    expect(result.current.error).toBe("abort failed");
  });

  it("等待消费 prompt 声明的最终事件序号后再结束流式状态", async () => {
    let resolvePrompt: ((finalSequence: number) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    act(() => {
      void result.current.sendPrompt("race");
    });

    await act(async () => resolvePrompt?.(2));
    expect(result.current.phase).toBe("streaming");
    act(() => {
      emit?.(event("agent.started"));
      emit?.(event("agent.settled"));
    });

    expect(result.current.phase).toBe("ready");
  });

  it("只应用完整有效的会话配置事件", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    act(() => {
      emit?.(
        event("session.configurationChanged", {
          model: null,
          thinkingLevel: "off",
          availableThinkingLevels: ["off"],
        }),
      );
    });
    expect(result.current.configuration).toEqual({
      model: null,
      thinkingLevel: "off",
      availableThinkingLevels: ["off"],
    });

    act(() => {
      emit?.(
        event("session.configurationChanged", {
          model: null,
          thinkingLevel: "ultra",
          availableThinkingLevels: [],
        }),
      );
    });
    expect(result.current.configuration?.thinkingLevel).toBe("off");
  });

  it("报告监听失败，并处理异步订阅晚于卸载的情况", async () => {
    vi.mocked(listenToAgentEvents).mockRejectedValueOnce(new Error("listen failed"));
    const failed = renderHook(() => useChatSession());
    await waitFor(() =>
      expect(failed.result.current.error).toBe("AGENT_EVENT_LISTEN_FAILED: listen failed"),
    );
    failed.unmount();

    let resolveListener: ((value: () => void) => void) | undefined;
    vi.mocked(listenToAgentEvents).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListener = resolve;
        }),
    );
    const late = renderHook(() => useChatSession());
    late.unmount();
    await act(async () => resolveListener?.(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("可重连事件通道，并在中止后忽略迟到增量", async () => {
    vi.mocked(listenToAgentEvents)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockImplementationOnce(async (handler) => {
        emit = handler;
        return unlisten;
      });
    let resolveAbortedPrompt: ((finalSequence: number) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveAbortedPrompt = resolve;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("error"));

    act(() => result.current.retryEventListener());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    act(() => {
      void result.current.sendPrompt("long task");
    });
    await waitFor(() => expect(result.current.phase).toBe("streaming"));
    act(() => emit?.(event("tool.started", { toolCallId: "tool-1", toolName: "bash" })));
    await act(() => result.current.abort());
    act(() => emit?.(event("message.delta", { delta: "late" })));
    await act(async () => resolveAbortedPrompt?.(nextSequence - 1));

    expect(result.current.phase).toBe("ready");
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "assistant",
        tools: [{ id: "tool-1", name: "bash", status: "cancelled" }],
      }),
    );
  });
});

function event(
  name: AgentEvent["name"],
  data?: unknown,
  sessionId = "s-1",
): AgentEvent {
  return {
    v: 1,
    kind: "event",
    seq: nextSequence++,
    sessionId,
    name,
    ...(data === undefined ? {} : { data }),
  };
}
