import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  abortAgent,
  createAgentSession,
  listenToAgentEvents,
  promptAgent,
  type AgentEvent,
} from "../ipc/agent";
import { useChatSession } from "./useChatSession";

vi.mock("../ipc/agent", () => ({
  abortAgent: vi.fn(),
  createAgentSession: vi.fn(),
  listenToAgentEvents: vi.fn(),
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
      modelFallbackMessage: "已切换到可用模型",
    });
    vi.mocked(promptAgent).mockReset().mockResolvedValue(undefined);
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
    expect(createAgentSession).toHaveBeenCalledWith("C:\\work");

    await act(() => result.current.sendPrompt("   "));
    await act(() => result.current.sendPrompt(" hello "));
    expect(promptAgent).toHaveBeenCalledWith("s-1", "hello");
    expect(result.current.messages).toHaveLength(2);

    await act(() => result.current.abort());
    expect(abortAgent).toHaveBeenCalledWith("s-1");
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

    let resolvePrompt: (() => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    act(() => {
      void result.current.sendPrompt("stream");
    });
    act(() => {
      emit?.(event("agent.started"));
      emit?.(event("message.delta", { delta: "A" }));
      emit?.(event("agent.settled"));
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.messages.at(-1)?.content).toBe("A");

    await act(async () => resolvePrompt?.());
    expect(result.current.phase).toBe("ready");
  });

  it("保留已有流式文本并展示 prompt 与 abort 错误", async () => {
    let rejectPrompt: ((reason: unknown) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectPrompt = reject;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    act(() => {
      void result.current.sendPrompt("fail");
    });
    act(() => emit?.(event("message.delta", { delta: "partial" })));
    await act(async () => rejectPrompt?.(new Error("model failed")));

    expect(result.current.messages.at(-1)?.content).toBe("partial");
    expect(result.current.error).toBe("model failed");
    vi.mocked(abortAgent).mockRejectedValue("abort failed");
    await act(() => result.current.abort());
    expect(result.current.error).toBe("abort failed");
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
    vi.mocked(promptAgent).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("error"));

    act(() => result.current.retryEventListener());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    act(() => {
      void result.current.sendPrompt("long task");
    });
    await waitFor(() => expect(result.current.phase).toBe("streaming"));
    await act(() => result.current.abort());
    act(() => emit?.(event("message.delta", { delta: "late" })));

    expect(result.current.phase).toBe("ready");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "long task" }),
    ]);
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
