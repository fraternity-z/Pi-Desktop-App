import { describe, expect, it, vi } from "vitest";

import {
  PiSessionRuntime,
  RuntimeError,
  type PiSdkLike,
  type PiSessionLike,
  type RuntimeEvent,
} from "./session-runtime.js";

interface SessionMock {
  session: PiSessionLike;
  emit(event: unknown): void;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function createSessionMock(sessionId = "s-1", isStreaming = false): SessionMock {
  let listener: (event: unknown) => void = () => undefined;
  const prompt = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const dispose = vi.fn();
  const unsubscribe = vi.fn();
  const session: PiSessionLike = {
    sessionId,
    isStreaming,
    prompt,
    abort,
    dispose,
    subscribe: vi.fn((nextListener: (event: unknown) => void) => {
      listener = nextListener;
      return unsubscribe;
    }),
  };
  return { session, emit: (event) => listener(event), prompt, abort, dispose, unsubscribe };
}

function sdkReturning(...sessions: SessionMock[]): PiSdkLike & {
  createAgentSession: ReturnType<typeof vi.fn>;
} {
  const createAgentSession = vi.fn(async () => {
    const next = sessions.shift();
    if (!next) {
      throw new Error("test session exhausted");
    }
    return { session: next.session, modelFallbackMessage: "fallback" };
  });
  return { createAgentSession };
}

describe("PiSessionRuntime", () => {
  it("创建会话、发送提示词并映射 SDK 流事件", async () => {
    const sessionMock = createSessionMock();
    const sdk = sdkReturning(sessionMock);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));

    await expect(runtime.createSession("C:\\work")).resolves.toEqual({
      sessionId: "s-1",
      modelFallbackMessage: "fallback",
    });
    expect(sdk.createAgentSession).toHaveBeenCalledWith({
      cwd: "C:\\work",
      agentDir: "C:\\agent",
    });

    await runtime.prompt("s-1", "hello");
    expect(sessionMock.prompt).toHaveBeenCalledWith("hello", { streamingBehavior: "followUp" });

    sessionMock.emit({ type: "agent_start" });
    sessionMock.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hi" },
    });
    sessionMock.emit({ type: "agent_settled" });
    sessionMock.emit({ type: "tool_execution_start" });
    expect(events).toEqual([
      { sessionId: "s-1", name: "agent.started" },
      { sessionId: "s-1", name: "message.delta", data: { delta: "Hi" } },
      { sessionId: "s-1", name: "agent.settled" },
    ]);
  });

  it("对不存在的会话返回稳定错误并支持中止", async () => {
    const sessionMock = createSessionMock();
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");
    await runtime.createSession("C:\\work");

    await runtime.abort("s-1");
    expect(sessionMock.abort).toHaveBeenCalledOnce();
    await expect(runtime.prompt("missing", "hello")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_NOT_FOUND" }),
    );
  });

  it("拒绝重复会话 id，并释放后创建的 SDK 会话", async () => {
    const first = createSessionMock("same");
    const duplicate = createSessionMock("same");
    const runtime = new PiSessionRuntime(sdkReturning(first, duplicate), "C:\\agent");
    await runtime.createSession("C:\\one");

    await expect(runtime.createSession("C:\\two")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "INVALID_SESSION" }),
    );
    expect(duplicate.dispose).toHaveBeenCalledOnce();
  });

  it("订阅 SDK 事件失败时释放未托管会话", async () => {
    const sessionMock = createSessionMock();
    vi.mocked(sessionMock.session.subscribe).mockImplementationOnce(() => {
      throw new Error("subscribe failed");
    });
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");

    await expect(runtime.createSession("C:\\work")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_SUBSCRIBE_FAILED" }),
    );
    expect(sessionMock.dispose).toHaveBeenCalledOnce();
  });

  it("关闭时中止流式会话并清理所有资源", async () => {
    const streaming = createSessionMock("streaming", true);
    const idle = createSessionMock("idle", false);
    streaming.abort.mockRejectedValueOnce(new Error("abort failed"));
    const runtime = new PiSessionRuntime(sdkReturning(streaming, idle), "C:\\agent");
    await runtime.createSession("C:\\one");
    await runtime.createSession("C:\\two");

    await runtime.shutdown();
    await runtime.shutdown();

    expect(streaming.abort).toHaveBeenCalledOnce();
    expect(idle.abort).not.toHaveBeenCalled();
    expect(streaming.unsubscribe).toHaveBeenCalledOnce();
    expect(idle.unsubscribe).toHaveBeenCalledOnce();
    expect(streaming.dispose).toHaveBeenCalledOnce();
    expect(idle.dispose).toHaveBeenCalledOnce();
    await expect(runtime.abort("idle")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "RUNTIME_CLOSED" }),
    );
  });
});
