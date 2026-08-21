import { describe, expect, it, vi } from "vitest";

import {
  PiSessionRuntime,
  RuntimeError,
  type PiModelLike,
  type PiSdkLike,
  type PiSessionLike,
  type RuntimeEvent,
} from "./session-runtime.js";

const reasoningModel: PiModelLike = {
  provider: "openai",
  id: "gpt-test",
  name: "GPT Test",
  reasoning: true,
};
const plainModel: PiModelLike = {
  provider: "example",
  id: "plain",
  reasoning: false,
};

interface SessionMock {
  session: PiSessionLike;
  emit(event: unknown): void;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setThinkingLevel: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  setStreaming(streaming: boolean): void;
}

function createSessionMock(
  sessionId = "s-1",
  options: {
    model?: PiModelLike;
    thinkingLevel?: PiSessionLike["thinkingLevel"];
    messages?: unknown[];
    sessionFile?: string;
    streaming?: boolean;
  } = {},
): SessionMock {
  let listener: (event: unknown) => void = () => undefined;
  let currentModel = options.model ?? reasoningModel;
  let thinkingLevel = options.thinkingLevel ?? "medium";
  let isStreaming = options.streaming ?? false;
  const prompt = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const dispose = vi.fn();
  const unsubscribe = vi.fn();
  const setModel = vi.fn(async (model: PiModelLike) => {
    currentModel = model;
  });
  const setThinkingLevel = vi.fn((level: PiSessionLike["thinkingLevel"]) => {
    thinkingLevel = currentModel.reasoning ? level : "off";
  });
  const session: PiSessionLike = {
    sessionId,
    sessionFile: options.sessionFile,
    get isStreaming() {
      return isStreaming;
    },
    get model() {
      return currentModel;
    },
    get thinkingLevel() {
      return thinkingLevel;
    },
    messages: options.messages ?? [],
    prompt,
    abort,
    setModel,
    setThinkingLevel,
    getAvailableThinkingLevels: () =>
      currentModel.reasoning ? ["off", "low", "medium", "high"] : ["off"],
    dispose,
    subscribe: vi.fn((nextListener: (event: unknown) => void) => {
      listener = nextListener;
      return unsubscribe;
    }),
  };
  return {
    session,
    emit: (event) => listener(event),
    prompt,
    abort,
    setModel,
    setThinkingLevel,
    dispose,
    unsubscribe,
    setStreaming: (streaming) => {
      isStreaming = streaming;
    },
  };
}

function sdkReturning(...sessions: SessionMock[]): PiSdkLike & {
  createAgentSession: ReturnType<typeof vi.fn>;
  modelRuntime: {
    getAvailable: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
  };
  listAll: ReturnType<typeof vi.fn>;
} {
  const modelRuntime = {
    getAvailable: vi.fn(async () => [reasoningModel, plainModel]),
    getModel: vi.fn((provider: string, id: string) =>
      [reasoningModel, plainModel].find((model) => model.provider === provider && model.id === id),
    ),
  };
  const listAll = vi.fn(async () => [
    {
      id: "saved-1",
      path: "C:\\agent\\sessions\\work\\saved.jsonl",
      cwd: "C:\\work",
      name: "Review",
      created: new Date("2026-08-20T08:00:00Z"),
      modified: new Date("2026-08-20T09:00:00Z"),
      messageCount: 2,
      firstMessage: "Inspect the project",
    },
  ]);
  const createAgentSession = vi.fn(async () => {
    const next = sessions.shift();
    if (!next) {
      throw new Error("test session exhausted");
    }
    return { session: next.session, modelFallbackMessage: "fallback" };
  });
  return {
    createAgentSession,
    ModelRuntime: { create: vi.fn(async () => modelRuntime) },
    SessionManager: {
      create: vi.fn((cwd: string) => ({ getCwd: () => cwd })),
      open: vi.fn(() => ({ getCwd: () => "C:\\work" })),
      listAll,
    },
    modelRuntime,
    listAll,
  };
}

describe("PiSessionRuntime", () => {
  it("创建会话、列出真实模型与会话并映射 SDK 事件", async () => {
    const sessionMock = createSessionMock();
    const sdk = sdkReturning(sessionMock);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));

    await expect(runtime.createSession("C:\\work")).resolves.toEqual(
      expect.objectContaining({
        sessionId: "s-1",
        cwd: "C:\\work",
        modelFallbackMessage: "fallback",
        configuration: expect.objectContaining({ thinkingLevel: "medium" }),
      }),
    );
    expect(sdk.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "C:\\work", agentDir: "C:\\agent" }),
    );
    await expect(runtime.listModels()).resolves.toEqual([
      { ...reasoningModel, name: "GPT Test" },
      { ...plainModel, name: "plain" },
    ]);
    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "saved-1", name: "Review", cwd: "C:\\work" }),
    ]);
    expect(sdk.listAll).toHaveBeenCalledWith("C:\\agent\\sessions");

    await runtime.prompt("s-1", "hello");
    expect(sessionMock.prompt).toHaveBeenCalledWith("hello", { streamingBehavior: "followUp" });
    sessionMock.emit({ type: "agent_start" });
    sessionMock.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hi" },
    });
    sessionMock.emit({ type: "thinking_level_changed" });
    sessionMock.emit({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "read",
      args: { path: "C:\\secret" },
    });
    sessionMock.emit({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "read",
      result: { content: "secret result" },
      isError: false,
    });
    sessionMock.emit({
      type: "tool_execution_end",
      toolCallId: "tool-2",
      toolName: "bash",
      result: { content: "secret error" },
      isError: true,
    });
    sessionMock.emit({ type: "tool_execution_start" });
    sessionMock.emit({ type: "agent_settled" });
    expect(events).toEqual([
      { sessionId: "s-1", name: "agent.started" },
      { sessionId: "s-1", name: "message.delta", data: { delta: "Hi" } },
      expect.objectContaining({ sessionId: "s-1", name: "session.configurationChanged" }),
      {
        sessionId: "s-1",
        name: "tool.started",
        data: { toolCallId: "tool-1", toolName: "read" },
      },
      {
        sessionId: "s-1",
        name: "tool.completed",
        data: { toolCallId: "tool-1", toolName: "read" },
      },
      {
        sessionId: "s-1",
        name: "tool.failed",
        data: { toolCallId: "tool-2", toolName: "bash" },
      },
      { sessionId: "s-1", name: "agent.settled" },
    ]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("打开持久会话、恢复文本消息并释放此前会话", async () => {
    const first = createSessionMock("first");
    const opened = createSessionMock("opened", {
      sessionFile: "C:\\agent\\sessions\\work\\saved.jsonl",
      messages: [
        { role: "system", content: "hidden" },
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "world" }] },
      ],
    });
    const sdk = sdkReturning(first, opened);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");
    await runtime.createSession("C:\\one");

    await expect(runtime.openSession("C:\\agent\\sessions\\work\\saved.jsonl")).resolves.toEqual(
      expect.objectContaining({
        sessionId: "opened",
        cwd: "C:\\work",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "world" },
        ],
      }),
    );
    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it("更新模型和思考强度并返回 SDK 的有效配置", async () => {
    const sessionMock = createSessionMock();
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");
    await runtime.createSession("C:\\work");

    await expect(
      runtime.configureSession("s-1", {
        model: { provider: "example", id: "plain" },
        thinkingLevel: "high",
      }),
    ).resolves.toEqual({
      model: { ...plainModel, name: "plain" },
      thinkingLevel: "off",
      availableThinkingLevels: ["off"],
    });
    expect(sessionMock.setModel).toHaveBeenCalledWith(plainModel);
    expect(sessionMock.setThinkingLevel).toHaveBeenCalledWith("high");

    await expect(
      runtime.configureSession("s-1", { model: { provider: "missing", id: "none" } }),
    ).rejects.toEqual(expect.objectContaining<Partial<RuntimeError>>({ code: "MODEL_NOT_FOUND" }));
  });

  it("阻止流式期间切换或配置，并对不存在会话返回稳定错误", async () => {
    const streaming = createSessionMock("streaming", { streaming: true });
    const second = createSessionMock("second");
    const runtime = new PiSessionRuntime(sdkReturning(streaming, second), "C:\\agent");
    await runtime.createSession("C:\\work");

    await expect(runtime.createSession("C:\\two")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_BUSY" }),
    );
    await expect(runtime.configureSession("streaming", { thinkingLevel: "low" })).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_BUSY" }),
    );
    await expect(runtime.prompt("missing", "hello")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_NOT_FOUND" }),
    );
  });

  it("将 SDK prompt 与 abort 异常转换为稳定且不泄露细节的错误", async () => {
    const sessionMock = createSessionMock();
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");
    await runtime.createSession("C:\\work");
    sessionMock.prompt.mockRejectedValueOnce(new Error("token=secret"));
    sessionMock.abort.mockRejectedValueOnce(new Error("authorization secret"));

    await expect(runtime.prompt("s-1", "hello")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({
        code: "PROMPT_FAILED",
        message: "Pi 无法完成当前提示",
      }),
    );
    await expect(runtime.abort("s-1")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({
        code: "ABORT_FAILED",
        message: "无法停止当前 Pi 任务",
      }),
    );
  });

  it("拒绝重复会话 id，并在订阅失败时释放未托管会话", async () => {
    const first = createSessionMock("same");
    const duplicate = createSessionMock("same");
    const runtime = new PiSessionRuntime(sdkReturning(first, duplicate), "C:\\agent");
    await runtime.createSession("C:\\one");
    await expect(runtime.createSession("C:\\two")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "INVALID_SESSION" }),
    );
    expect(duplicate.dispose).toHaveBeenCalledOnce();

    const failed = createSessionMock("failed");
    vi.mocked(failed.session.subscribe).mockImplementationOnce(() => {
      throw new Error("subscribe failed");
    });
    const failedRuntime = new PiSessionRuntime(sdkReturning(failed), "C:\\agent");
    await expect(failedRuntime.createSession("C:\\work")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_SUBSCRIBE_FAILED" }),
    );
    expect(failed.dispose).toHaveBeenCalledOnce();
  });

  it("关闭时中止流式会话并幂等清理资源", async () => {
    const streaming = createSessionMock("streaming", { streaming: true });
    streaming.abort.mockRejectedValueOnce(new Error("abort failed"));
    const runtime = new PiSessionRuntime(sdkReturning(streaming), "C:\\agent");
    await runtime.createSession("C:\\one");

    await runtime.shutdown();
    await runtime.shutdown();

    expect(streaming.abort).toHaveBeenCalledOnce();
    expect(streaming.unsubscribe).toHaveBeenCalledOnce();
    expect(streaming.dispose).toHaveBeenCalledOnce();
    await expect(runtime.abort("streaming")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "RUNTIME_CLOSED" }),
    );
  });
});
