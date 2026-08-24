import { describe, expect, it, vi } from "vitest";

import {
  PiSessionRuntime,
  RuntimeError,
  type PiModelLike,
  type PiSdkLike,
  type PiSessionLike,
  type RuntimeEvent,
} from "./session-runtime.js";
import type {
  RequestHeaderExtensionContextLike,
  RequestHeaderExtensionFactory,
} from "./request-headers.js";

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
  clearQueue: ReturnType<typeof vi.fn>;
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
    steering?: string[];
    followUp?: string[];
  } = {},
): SessionMock {
  let listener: (event: unknown) => void = () => undefined;
  let currentModel = options.model ?? reasoningModel;
  let thinkingLevel = options.thinkingLevel ?? "medium";
  let isStreaming = options.streaming ?? false;
  const prompt = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const clearQueue = vi.fn();
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
    clearQueue,
    getSteeringMessages: () => options.steering ?? [],
    getFollowUpMessages: () => options.followUp ?? [],
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
    clearQueue,
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
    await runtime.prompt("s-1", "guide", "steer");
    expect(sessionMock.prompt).toHaveBeenNthCalledWith(1, "hello", undefined);
    expect(sessionMock.prompt).toHaveBeenNthCalledWith(2, "guide", { streamingBehavior: "steer" });
    sessionMock.emit({ type: "agent_start" });
    sessionMock.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hi" },
    });
    sessionMock.emit({ type: "thinking_level_changed" });
    sessionMock.emit({ type: "queue_update", steering: ["guide"], followUp: ["later"] });
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
        name: "queue.updated",
        data: { steering: ["guide"], followUp: ["later"] },
      },
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

  it("通过隐藏内联扩展将最新请求头配置应用到既有会话", async () => {
    const sessionMock = createSessionMock();
    const sdk = sdkReturning(sessionMock);
    type LoaderOptions = ConstructorParameters<
      NonNullable<PiSdkLike["DefaultResourceLoader"]>
    >[0];
    let extensionFactory: RequestHeaderExtensionFactory | undefined;
    const reload = vi.fn(async () => undefined);
    sdk.DefaultResourceLoader = class {
      constructor(options: LoaderOptions) {
        extensionFactory = options.extensionFactories[0]?.factory;
      }

      reload(): Promise<void> {
        return reload();
      }
    };
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");
    runtime.configureRequestHeaders({ enabled: true, client: "claude-code" });

    await runtime.createSession("C:\\work");

    expect(reload).toHaveBeenCalledOnce();
    expect(sdk.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ resourceLoader: expect.any(Object) }),
    );
    let handler:
      | ((
          event: { headers: Record<string, string | null> },
          context: RequestHeaderExtensionContextLike,
        ) => void)
      | undefined;
    extensionFactory?.({
      on: (_event, nextHandler) => {
        handler = nextHandler;
      },
    });
    const headerContext = { sessionManager: { getSessionId: () => "s-1" } };
    const claudeHeaders: Record<string, string | null> = {};
    handler?.({ headers: claudeHeaders }, headerContext);
    expect(claudeHeaders["X-Claude-Code-Session-Id"]).toBe("s-1");

    runtime.configureRequestHeaders({ enabled: true, client: "codex" });
    const codexHeaders: Record<string, string | null> = {};
    handler?.({ headers: codexHeaders }, headerContext);
    expect(codexHeaders.originator).toBe("codex-tui");
  });

  it("开启请求头伪装时拒绝不支持资源加载器的 SDK", () => {
    const runtime = new PiSessionRuntime(sdkReturning(createSessionMock()), "C:\\agent");

    expect(() =>
      runtime.configureRequestHeaders({ enabled: true, client: "claude-code" }),
    ).toThrowError(expect.objectContaining<Partial<RuntimeError>>({ code: "REQUEST_HEADERS_UNSUPPORTED" }));
  });

  it("通过官方 SDK 管理插件、启用状态、更新与资源清单", async () => {
    const sessionMock = createSessionMock();
    const reloadSession = vi.fn(async () => undefined);
    sessionMock.session.reload = reloadSession;
    const sdk = sdkReturning(sessionMock);
    let globalPackages: unknown[] = ["npm:pi-global"];
    let projectPackages: unknown[] = ["./local-plugin"];
    const settingsManager = {
      getGlobalSettings: () => ({ packages: globalPackages }),
      getProjectSettings: () => ({ packages: projectPackages }),
      setPackages: vi.fn((packages: unknown[]) => {
        globalPackages = packages;
      }),
      setProjectPackages: vi.fn((packages: unknown[]) => {
        projectPackages = packages;
      }),
    };
    const listConfiguredPackages = vi.fn(() => [
      {
        source: "npm:pi-global",
        scope: "user",
        installedPath: "C:\\agent\\git\\pi-global",
        filtered: false,
      },
      {
        source: "./local-plugin",
        scope: "project",
        installedPath: "C:\\work\\.pi\\local-plugin",
        filtered: true,
      },
    ]);
    const installAndPersist = vi.fn(async () => undefined);
    const removeAndPersist = vi.fn(async () => true);
    const update = vi.fn(async () => undefined);
    const checkForAvailableUpdates = vi.fn(async () => [
      {
        source: "npm:pi-global",
        displayName: "Pi Global",
        type: "npm",
        scope: "user",
      },
    ]);
    sdk.SettingsManager = { create: vi.fn(() => settingsManager) };
    sdk.DefaultPackageManager = class {
      listConfiguredPackages = listConfiguredPackages;
      installAndPersist = installAndPersist;
      removeAndPersist = removeAndPersist;
      update = update;
      checkForAvailableUpdates = checkForAvailableUpdates;
    };
    const reloadResource = vi.fn(async () => undefined);
    sdk.DefaultResourceLoader = class {
      reload = reloadResource;
      getExtensions = () => ({
        extensions: [
          {
            path: "C:\\work\\.pi\\extensions\\review.ts",
            sourceInfo: { source: "./local-plugin" },
          },
        ],
      });
      getSkills = () => ({
        skills: [
          {
            name: "review",
            filePath: "C:\\work\\.pi\\skills\\review\\SKILL.md",
            sourceInfo: { source: "./local-plugin" },
          },
        ],
      });
      getPrompts = () => ({ prompts: [] });
      getThemes = () => ({ themes: [{ name: "plain", path: "C:\\agent\\themes\\plain.json" }] });
      getAgentsFiles = () => ({ agentsFiles: [{ path: "C:\\work\\AGENTS.md" }] });
    };
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");
    await runtime.createSession("C:\\work");

    await expect(runtime.listPackages("C:\\work")).resolves.toEqual([
      expect.objectContaining({ source: "npm:pi-global", scope: "global", kind: "npm", enabled: true }),
      expect.objectContaining({ source: "./local-plugin", scope: "project", kind: "local", enabled: true }),
    ]);
    await runtime.setPackageEnabled("C:\\work", "npm:pi-global", "global", false);
    expect(settingsManager.setPackages).toHaveBeenCalledWith([
      expect.objectContaining({ source: "npm:pi-global", autoload: false }),
    ]);
    await expect(runtime.listPackages("C:\\work")).resolves.toEqual([
      expect.objectContaining({ source: "npm:pi-global", enabled: false }),
      expect.objectContaining({ source: "./local-plugin", enabled: true }),
    ]);
    await runtime.setPackageEnabled("C:\\work", "npm:pi-global", "global", true);
    await runtime.installPackage("C:\\work", "npm:pi-extra", "project");
    expect(installAndPersist).toHaveBeenCalledWith("npm:pi-extra", { local: true });
    await runtime.removePackage("C:\\work", "./local-plugin", "project");
    expect(removeAndPersist).toHaveBeenCalledWith("C:\\work\\.pi\\local-plugin", {
      local: true,
    });
    await runtime.updatePackage("C:\\work", "npm:pi-global");
    expect(update).toHaveBeenCalledWith("npm:pi-global");
    await expect(runtime.checkPackageUpdates("C:\\work")).resolves.toEqual([
      {
        source: "npm:pi-global",
        displayName: "Pi Global",
        type: "npm",
        scope: "global",
      },
    ]);
    await expect(runtime.listResources("C:\\work")).resolves.toEqual([
      {
        kind: "extension",
        name: "review.ts",
        path: "C:\\work\\.pi\\extensions\\review.ts",
        source: "./local-plugin",
      },
      {
        kind: "skill",
        name: "review",
        path: "C:\\work\\.pi\\skills\\review\\SKILL.md",
        source: "./local-plugin",
      },
      { kind: "theme", name: "plain", path: "C:\\agent\\themes\\plain.json" },
      { kind: "context", name: "AGENTS.md", path: "C:\\work\\AGENTS.md" },
    ]);
    expect(reloadSession).toHaveBeenCalledTimes(5);
  });

  it("打开持久会话、恢复富文本历史并保留此前会话", async () => {
    const first = createSessionMock("first");
    const opened = createSessionMock("opened", {
      sessionFile: "C:\\agent\\sessions\\work\\saved.jsonl",
      messages: [
        { role: "system", content: "hidden" },
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "world" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "reasoning" },
            { type: "text", text: "done" },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "sensitive output" }],
          isError: false,
        },
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
          { role: "thinking", content: "reasoning" },
          { role: "assistant", content: "done" },
          {
            role: "tool",
            content: "",
            toolCallId: "tool-1",
            toolName: "read",
            isError: false,
          },
        ],
      }),
    );
    expect(first.unsubscribe).not.toHaveBeenCalled();
    expect(first.dispose).not.toHaveBeenCalled();
    await expect(runtime.openSession("C:\\agent\\sessions\\work\\saved.jsonl")).resolves.toEqual(
      expect.objectContaining({ sessionId: "opened" }),
    );
    expect(sdk.createAgentSession).toHaveBeenCalledTimes(2);
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

  it("允许流式期间打开后台会话，但阻止修改繁忙会话配置", async () => {
    const streaming = createSessionMock("streaming", { streaming: true });
    const second = createSessionMock("second");
    const runtime = new PiSessionRuntime(sdkReturning(streaming, second), "C:\\agent");
    await runtime.createSession("C:\\work");

    await expect(runtime.createSession("C:\\two")).resolves.toEqual(
      expect.objectContaining({ sessionId: "second" }),
    );
    await expect(runtime.configureSession("streaming", { thinkingLevel: "low" })).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_BUSY" }),
    );
    await expect(runtime.prompt("missing", "hello")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_NOT_FOUND" }),
    );
  });

  it("投影用户、思考、完成和失败事件，且不泄露模型错误详情", async () => {
    const sessionMock = createSessionMock();
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    await runtime.createSession("C:\\work");

    sessionMock.emit({ type: "message_start", message: { role: "user", content: "hello" } });
    sessionMock.emit({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "plan" },
    });
    sessionMock.emit({
      type: "message_end",
      message: { role: "assistant", stopReason: "stop" },
    });
    sessionMock.emit({
      type: "message_end",
      message: { role: "assistant", stopReason: "error", errorMessage: "token=secret" },
    });

    expect(events).toEqual([
      { sessionId: "s-1", name: "user.message", data: { content: "hello" } },
      { sessionId: "s-1", name: "thinking.delta", data: { delta: "plan" } },
      { sessionId: "s-1", name: "message.completed", data: { reason: "stop" } },
      {
        sessionId: "s-1",
        name: "message.failed",
        data: { reason: "error", message: "模型响应失败" },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("将 SDK prompt 与 abort 异常转换为稳定且不泄露细节的错误", async () => {
    const sessionMock = createSessionMock();
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");
    await runtime.createSession("C:\\work");
    sessionMock.prompt.mockRejectedValueOnce(new Error("token=secret"));
    sessionMock.abort.mockRejectedValueOnce(new Error("authorization secret"));
    sessionMock.clearQueue.mockImplementationOnce(() => {
      throw new Error("queue token");
    });

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
    await expect(runtime.clearQueue("s-1")).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({
        code: "QUEUE_CLEAR_FAILED",
        message: "无法清空当前 Pi 消息队列",
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

  it("过滤畸形历史记录，并用活动会话覆盖磁盘目录项", async () => {
    const longPrompt = `  ${"x".repeat(270)}  `;
    const sessionMock = createSessionMock("edge", {
      sessionFile: "C:\\agent\\sessions\\work\\saved.jsonl",
      model: { provider: "", id: "invalid" },
      thinkingLevel: "invalid" as PiSessionLike["thinkingLevel"],
      messages: [
        null,
        { role: "user", content: longPrompt, timestamp: "2026-08-21T00:00:00Z" },
        {
          role: "user",
          content: [
            { type: "image", data: "hidden" },
            { type: "text", text: "array user" },
          ],
        },
        { role: "user", content: { text: "ignored" } },
        { role: "assistant", content: "plain assistant", timestamp: 1_787_270_400_000 },
        { role: "assistant", content: { text: "ignored" } },
        {
          role: "assistant",
          timestamp: "not-a-date",
          content: [
            null,
            { type: "thinking", text: "edge reasoning" },
            { type: "text", text: "edge answer" },
            { type: "text", text: "" },
            { type: "other", text: "ignored" },
          ],
        },
        { role: "toolResult", toolCallId: "tool-edge", toolName: "read", isError: true },
        { role: "toolResult", toolCallId: "", toolName: "read" },
        { role: "system", content: "hidden" },
      ],
    });
    sessionMock.session.getAvailableThinkingLevels = () =>
      ["invalid"] as unknown as PiSessionLike["thinkingLevel"][];
    const sdk = sdkReturning(sessionMock);
    sdk.createAgentSession.mockResolvedValueOnce({ session: sessionMock.session });
    sdk.listAll.mockResolvedValueOnce([
      {
        id: "saved-1",
        path: "C:\\agent\\sessions\\work\\saved.jsonl",
        cwd: "C:\\work",
        name: "  Disk title  ",
        created: "2026-08-20T08:00:00Z",
        modified: "2099-08-20T09:00:00Z",
        messageCount: Number.NaN,
        firstMessage: 123,
      },
      {
        id: "",
        path: "C:\\agent\\sessions\\invalid.jsonl",
        cwd: "C:\\work",
        created: "2026-08-20T08:00:00Z",
        modified: "2026-08-20T09:00:00Z",
        messageCount: 0,
        firstMessage: "ignored",
      },
      {
        id: "invalid-date",
        path: "C:\\agent\\sessions\\invalid-date.jsonl",
        cwd: "C:\\work",
        created: "not-a-date",
        modified: "2026-08-20T09:00:00Z",
        messageCount: 0,
        firstMessage: "ignored",
      },
    ]);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");

    const created = await runtime.createSession("C:\\work");
    expect(created).toEqual(
      expect.objectContaining({
        sessionPath: "C:\\agent\\sessions\\work\\saved.jsonl",
        streaming: false,
        configuration: {
          model: null,
          thinkingLevel: "off",
          availableThinkingLevels: ["off"],
        },
      }),
    );
    expect(created).not.toHaveProperty("modelFallbackMessage");
    expect(created.messages).toEqual([
      expect.objectContaining({ role: "user", content: longPrompt }),
      { role: "user", content: "array user" },
      expect.objectContaining({ role: "assistant", content: "plain assistant" }),
      { role: "thinking", content: "edge reasoning" },
      { role: "assistant", content: "edge answer" },
      {
        role: "tool",
        content: "",
        toolCallId: "tool-edge",
        toolName: "read",
        isError: true,
      },
    ]);

    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: "edge",
        name: "Disk title",
        modified: "2099-08-20T09:00:00.000Z",
        messageCount: 4,
        firstMessage: `${"x".repeat(239)}…`,
      }),
    ]);
  });

  it("将配置 setter 异常映射为稳定错误码", async () => {
    const modelFailure = createSessionMock("model-failure");
    modelFailure.setModel.mockRejectedValueOnce(new Error("provider token"));
    const thinkingFailure = createSessionMock("thinking-failure");
    thinkingFailure.setThinkingLevel.mockImplementationOnce(() => {
      throw new Error("provider token");
    });
    const runtime = new PiSessionRuntime(
      sdkReturning(modelFailure, thinkingFailure),
      "C:\\agent",
    );
    await runtime.createSession("C:\\one");
    await runtime.createSession("C:\\two");

    await expect(
      runtime.configureSession("model-failure", {
        model: { provider: reasoningModel.provider, id: reasoningModel.id },
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<RuntimeError>>({ code: "MODEL_UPDATE_FAILED" }));
    await expect(
      runtime.configureSession("thinking-failure", { thinkingLevel: "high" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "THINKING_LEVEL_UPDATE_FAILED" }),
    );
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
