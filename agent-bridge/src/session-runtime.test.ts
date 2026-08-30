import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { describe, expect, it, vi } from "vitest";

import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  normalizeThinkingLevels,
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

describe("Pi thinking levels", () => {
  it("按 Pi SDK 的 map 语义支持完整档位、空洞和不支持思考的模型", () => {
    const fullModel: PiModelLike = {
      provider: "openai",
      id: "full",
      reasoning: true,
      thinkingLevelMap: {
        off: "off",
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
    };
    const partialModel: PiModelLike = {
      provider: "openai",
      id: "partial",
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      },
    };

    expect(getSupportedThinkingLevels(fullModel)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(getSupportedThinkingLevels(partialModel)).toEqual(["off", "high", "max"]);
    expect(getSupportedThinkingLevels(plainModel)).toEqual(["off"]);
    expect(normalizeThinkingLevels(["max", "bogus", "off", "off"])).toEqual(["off", "max"]);
    expect(clampThinkingLevel("xhigh", ["off", "high", "max"])).toBe("max");
    expect(clampThinkingLevel("minimal", ["off", "high"])).toBe("high");
  });
});

interface SessionMock {
  session: PiSessionLike;
  emit(event: unknown): void;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  clearQueue: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setThinkingLevel: ReturnType<typeof vi.fn>;
  setActiveToolsByName: ReturnType<typeof vi.fn>;
  setContextUsage(value: unknown): void;
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
    tools?: Array<{ name: string; description?: string }>;
    activeTools?: string[];
    contextUsage?: unknown;
  } = {},
): SessionMock {
  let listener: (event: unknown) => void = () => undefined;
  let currentModel = options.model ?? reasoningModel;
  let thinkingLevel = options.thinkingLevel ?? "medium";
  let isStreaming = options.streaming ?? false;
  const tools =
    options.tools ??
    [
      { name: "read", description: "Read files" },
      { name: "bash", description: "Run shell commands" },
      { name: "edit", description: "Edit files" },
      { name: "write", description: "Write files" },
    ];
  let activeTools = options.activeTools ?? tools.map((tool) => tool.name);
  let contextUsage: unknown = options.contextUsage ?? null;
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
  const setActiveToolsByName = vi.fn((names: string[]) => {
    const available = new Set(tools.map((tool) => tool.name));
    activeTools = names.filter((name) => available.has(name));
  });
  const setContextUsage = (value: unknown) => {
    contextUsage = value;
  };
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
    getAllTools: () => tools,
    getActiveToolNames: () => activeTools,
    getContextUsage: () => contextUsage,
    setActiveToolsByName,
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
    setActiveToolsByName,
    setContextUsage,
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
    getModels: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
  };
  listAll: ReturnType<typeof vi.fn>;
} {
  const modelRuntime = {
    getAvailable: vi.fn(async () => [reasoningModel, plainModel]),
    getModels: vi.fn(() => [reasoningModel, plainModel]),
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
        configuration: expect.objectContaining({
          thinkingLevel: "medium",
          availableTools: expect.arrayContaining([
            { name: "read", description: "Read files" },
            { name: "bash", description: "Run shell commands" },
          ]),
          activeToolNames: ["read", "bash", "edit", "write"],
          defaultToolNames: ["read", "bash", "edit", "write"],
        }),
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
    expect(sdk.listAll).toHaveBeenCalledWith();

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
      args: { path: "C:\\work\\README.md", token: "sk-live-token" },
    });
    sessionMock.emit({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "read",
      result: { content: "read ok\nAuthorization: Bearer live-secret\ntoken=plain-secret" },
      isError: false,
    });
    sessionMock.emit({
      type: "tool_execution_end",
      toolCallId: "tool-2",
      toolName: "bash",
      result: { content: "failed with apiKey=failed-secret" },
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
        data: {
          toolCallId: "tool-1",
          toolName: "read",
          input: {
            text: '{\n  "path": "C:\\\\work\\\\README.md",\n  "token": "[REDACTED]"\n}',
            format: "json",
            truncated: false,
          },
        },
      },
      {
        sessionId: "s-1",
        name: "tool.completed",
        data: {
          toolCallId: "tool-1",
          toolName: "read",
          output: {
            text: "read ok\nAuthorization: [REDACTED]\ntoken=[REDACTED]",
            format: "text",
            truncated: false,
          },
        },
      },
      {
        sessionId: "s-1",
        name: "tool.failed",
        data: {
          toolCallId: "tool-2",
          toolName: "bash",
          output: {
            text: "failed with apiKey=[REDACTED]",
            format: "text",
            truncated: false,
          },
        },
      },
      { sessionId: "s-1", name: "agent.settled" },
    ]);
    expect(JSON.stringify(events)).not.toContain("sk-live-token");
    expect(JSON.stringify(events)).not.toContain("live-secret");
    expect(JSON.stringify(events)).not.toContain("plain-secret");
    expect(JSON.stringify(events)).not.toContain("failed-secret");
  });

  it("重复刷新会话目录时复用未变化会话的摘要元数据", async () => {
    const messages = [
      { role: "user", content: "cached prompt" },
      { role: "assistant", content: "cached answer" },
    ];
    const managed = createSessionMock("managed", {
      sessionFile: "C:\\agent\\sessions\\work\\saved.jsonl",
      messages,
    });
    const sdk = sdkReturning(managed);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");
    await runtime.createSession("C:\\work");

    let reads = 0;
    Object.defineProperty(managed.session, "messages", {
      configurable: true,
      get: () => {
        reads += 1;
        return messages;
      },
    });

    await runtime.listSessions();
    const readsAfterFirstList = reads;
    expect(readsAfterFirstList).toBe(0);

    await runtime.listSessions();
    expect(reads).toBe(readsAfterFirstList);

    managed.emit({ type: "agent_start" });
    await runtime.listSessions();
    expect(reads).toBeGreaterThan(readsAfterFirstList);
  });

  it("读取受支持的图片并按官方 SDK ImageContent 结构发送", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-desktop-prompt-image-"));
    try {
      const imagePath = join(root, "paste.png");
      const spoofedPath = join(root, "spoofed.png");
      const imageBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
      ]);
      await writeFile(imagePath, imageBytes);
      await writeFile(spoofedPath, "not a png", "utf8");
      const sessionMock = createSessionMock();
      const runtime = new PiSessionRuntime(sdkReturning(sessionMock), root);
      await runtime.createSession(root);

      await runtime.prompt("s-1", "分析图片", "followUp", undefined, [imagePath]);

      expect(sessionMock.prompt).toHaveBeenCalledWith("分析图片", {
        streamingBehavior: "followUp",
        images: [
          {
            type: "image",
            data: imageBytes.toString("base64"),
            mimeType: "image/png",
          },
        ],
      });
      await expect(
        runtime.prompt("s-1", "伪装图片", undefined, undefined, [spoofedPath]),
      ).rejects.toEqual(
        expect.objectContaining<Partial<RuntimeError>>({
          code: "PROMPT_IMAGE_TYPE_UNSUPPORTED",
          message: "图片内容与扩展名不匹配，或格式不受支持",
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("能力 API 缺失时按模型 map 计算完整、部分和不支持档位", async () => {
    const fullModel: PiModelLike = {
      provider: "openai",
      id: "full",
      reasoning: true,
      thinkingLevelMap: {
        off: "off",
        minimal: "minimal",
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
    };
    const partialModel: PiModelLike = {
      provider: "openai",
      id: "partial",
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      },
    };
    const full = createSessionMock("full", { model: fullModel, thinkingLevel: "max" });
    const partial = createSessionMock("partial", { model: partialModel, thinkingLevel: "xhigh" });
    const plain = createSessionMock("plain", { model: plainModel, thinkingLevel: "off" });
    full.session.getAvailableThinkingLevels = () =>
      ["low", "low"] as unknown as PiSessionLike["thinkingLevel"][];
    delete partial.session.getAvailableThinkingLevels;
    plain.session.getAvailableThinkingLevels = () => {
      throw new Error("capability probe unavailable");
    };
    const sdk = sdkReturning(full, partial, plain);
    const runtime = new PiSessionRuntime(sdk, "C:\\\\agent");

    await expect(runtime.createSession("C:\\\\full")).resolves.toEqual(
      expect.objectContaining({
        configuration: expect.objectContaining({
          thinkingLevel: "max",
          availableThinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        }),
      }),
    );
    await expect(runtime.createSession("C:\\\\partial")).resolves.toEqual(
      expect.objectContaining({
        configuration: expect.objectContaining({
          thinkingLevel: "max",
          availableThinkingLevels: ["off", "high", "max"],
        }),
      }),
    );
    await expect(runtime.createSession("C:\\\\plain")).resolves.toEqual(
      expect.objectContaining({
        configuration: expect.objectContaining({
          thinkingLevel: "off",
          availableThinkingLevels: ["off"],
        }),
      }),
    );

    await expect(runtime.configureSession("plain", { thinkingLevel: "max" })).resolves.toEqual(
      expect.objectContaining({ thinkingLevel: "off", availableThinkingLevels: ["off"] }),
    );
    expect(plain.setThinkingLevel).toHaveBeenCalledWith("off");
  });

  it("模型切换后重新读取能力并把当前值回退到合法档位", async () => {
    const broadModel: PiModelLike = {
      provider: "openai",
      id: "broad",
      reasoning: true,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
    };
    const narrowModel: PiModelLike = {
      provider: "openai",
      id: "narrow",
      reasoning: true,
      thinkingLevelMap: {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
        max: null,
      },
    };
    const session = createSessionMock("switch", { model: broadModel, thinkingLevel: "max" });
    session.session.getAvailableThinkingLevels = () =>
      getSupportedThinkingLevels(session.session.model);
    const sdk = sdkReturning(session);
    sdk.modelRuntime.getModel.mockImplementation((provider: string, id: string) =>
      [broadModel, narrowModel].find((model) => model.provider === provider && model.id === id),
    );
    const runtime = new PiSessionRuntime(sdk, "C:\\\\agent");
    await runtime.createSession("C:\\\\work");
    session.setThinkingLevel.mockClear();

    await expect(
      runtime.configureSession("switch", {
        model: { provider: "openai", id: "narrow" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        thinkingLevel: "high",
        availableThinkingLevels: ["off", "high"],
      }),
    );
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");

    session.setThinkingLevel.mockClear();
    await expect(runtime.configureSession("switch", { thinkingLevel: "xhigh" })).resolves.toEqual(
      expect.objectContaining({ thinkingLevel: "high", availableThinkingLevels: ["off", "high"] }),
    );
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(session.setThinkingLevel).not.toHaveBeenCalledWith("xhigh");
  });

  it("仅有 off 能力的兼容会话即使 setter 失败也不阻断请求", async () => {
    const session = createSessionMock("off-only");
    session.session.getAvailableThinkingLevels = () => ["off"];
    session.setThinkingLevel.mockImplementationOnce(() => {
      throw new Error("legacy setter unavailable");
    });
    const runtime = new PiSessionRuntime(sdkReturning(session), "C:\\agent");
    await runtime.createSession("C:\\work");

    await expect(runtime.configureSession("off-only", { thinkingLevel: "max" })).resolves.toEqual(
      expect.objectContaining({ thinkingLevel: "off", availableThinkingLevels: ["off"] }),
    );
  });

  it("能力探测失败且模型未提供 map 时兼容旧版 setter 异常", async () => {
    const session = createSessionMock("unknown-capability");
    delete session.session.getAvailableThinkingLevels;
    session.setThinkingLevel.mockImplementationOnce(() => {
      throw new Error("legacy setter unavailable");
    });
    const runtime = new PiSessionRuntime(sdkReturning(session), "C:\\agent");
    await runtime.createSession("C:\\work");

    await expect(
      runtime.configureSession("unknown-capability", { thinkingLevel: "max" }),
    ).resolves.toEqual(
      expect.objectContaining({
        thinkingLevel: "medium",
        availableThinkingLevels: ["off", "minimal", "low", "medium", "high"],
      }),
    );
  });

  it("可用性探测失败时回退到真实模型目录并去重", async () => {
    const sdk = sdkReturning(createSessionMock());
    sdk.modelRuntime.getAvailable.mockRejectedValueOnce(new Error("availability failed"));
    sdk.modelRuntime.getModels.mockReturnValueOnce([
      reasoningModel,
      reasoningModel,
      plainModel,
      { provider: "", id: "invalid" },
    ]);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");

    await expect(runtime.listModels()).resolves.toEqual([
      { ...reasoningModel, name: "GPT Test" },
      { ...plainModel, name: "plain" },
    ]);
  });

  it("预热、模型目录和会话打开复用同一个模型初始化任务，失败后允许重试", async () => {
    const opened = createSessionMock("opened", {
      sessionFile: "C:\\agent\\sessions\\work\\saved.jsonl",
    });
    const sdk = sdkReturning(opened);
    const createModelRuntime = vi.mocked(sdk.ModelRuntime.create);
    createModelRuntime.mockRejectedValueOnce(new Error("model startup failed"));
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");

    runtime.warmUp();
    await expect(runtime.listModels()).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "MODEL_LIST_FAILED" }),
    );

    const [models, session] = await Promise.all([
      runtime.listModels(),
      runtime.openSession("C:\\agent\\sessions\\work\\saved.jsonl"),
    ]);
    expect(models).toHaveLength(2);
    expect(session.sessionId).toBe("opened");
    expect(createModelRuntime).toHaveBeenCalledTimes(2);
  });

  it("返回 SDK 上下文占用量并仅在数值变化时广播", async () => {
    const sessionMock = createSessionMock("usage", {
      contextUsage: { tokens: 1_024, contextWindow: 8_192, percent: 12.5 },
    });
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));

    await expect(runtime.createSession("C:\\work")).resolves.toEqual(
      expect.objectContaining({
        contextUsage: { tokens: 1_024, contextWindow: 8_192, percent: 12.5 },
      }),
    );
    sessionMock.emit({ type: "agent_start" });
    expect(events).toEqual([{ sessionId: "usage", name: "agent.started" }]);

    sessionMock.setContextUsage({ tokens: 2_048, contextWindow: 8_192 });
    sessionMock.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
    expect(events).toContainEqual({
      sessionId: "usage",
      name: "session.usageChanged",
      data: { tokens: 2_048, contextWindow: 8_192, percent: 25 },
    });

    const usageEventCount = events.filter((event) => event.name === "session.usageChanged").length;
    sessionMock.emit({ type: "agent_settled" });
    expect(events.filter((event) => event.name === "session.usageChanged")).toHaveLength(
      usageEventCount,
    );
  });

  it("在首条非排队提示前应用 SDK 工具权限并广播有效配置", async () => {
    const sessionMock = createSessionMock();
    const runtime = new PiSessionRuntime(sdkReturning(sessionMock), "C:\\agent");
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    await runtime.createSession("C:\\work");

    await runtime.prompt("s-1", "inspect", undefined, ["read", "edit"]);

    expect(sessionMock.setActiveToolsByName).toHaveBeenCalledWith(["read", "edit"]);
    expect(sessionMock.prompt).toHaveBeenCalledWith("inspect", undefined);
    expect(events).toContainEqual({
      sessionId: "s-1",
      name: "session.configurationChanged",
      data: expect.objectContaining({
        activeToolNames: ["read", "edit"],
        defaultToolNames: ["read", "bash", "edit", "write"],
      }),
    });
  });

  it("拒绝未知工具、流式期间改权和不支持权限 API 的 SDK", async () => {
    const regular = createSessionMock("regular");
    const streaming = createSessionMock("streaming", { streaming: true });
    const unsupported = createSessionMock("unsupported");
    delete unsupported.session.getAllTools;
    delete unsupported.session.getActiveToolNames;
    delete unsupported.session.setActiveToolsByName;
    const runtime = new PiSessionRuntime(
      sdkReturning(regular, streaming, unsupported),
      "C:\\agent",
    );
    await runtime.createSession("C:\\one");
    await runtime.createSession("C:\\two");
    await runtime.createSession("C:\\three");

    await expect(runtime.prompt("regular", "hello", undefined, ["unknown"])).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "TOOL_SELECTION_INVALID" }),
    );
    await expect(runtime.prompt("streaming", "hello", "steer", ["read"])).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_BUSY" }),
    );
    await expect(runtime.prompt("unsupported", "hello", undefined, [])).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "TOOL_PERMISSIONS_UNSUPPORTED" }),
    );
    expect(regular.prompt).not.toHaveBeenCalled();
  });

  it("SDK 工具清单读取异常时降级展示并返回稳定错误", async () => {
    const failing = createSessionMock("tool-read-failure");
    failing.session.getAllTools = () => {
      throw new Error("token=secret");
    };
    const runtime = new PiSessionRuntime(sdkReturning(failing), "C:\\agent");

    await expect(runtime.createSession("C:\\work")).resolves.toEqual(
      expect.objectContaining({
        configuration: expect.objectContaining({
          availableTools: [],
          activeToolNames: [],
          defaultToolNames: [],
        }),
      }),
    );
    await expect(runtime.prompt("tool-read-failure", "hello", undefined, [])).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({
        code: "TOOL_PERMISSION_UPDATE_FAILED",
        message: "无法读取当前 Pi SDK 工具权限",
      }),
    );
  });

  it("不把仅分配预期路径但尚未落盘的活动会话暴露为正式目录项", async () => {
    const sessionPath = "C:\\agent\\sessions\\work\\pending.jsonl";
    const pending = createSessionMock("pending", { sessionFile: sessionPath });
    const sdk = sdkReturning(pending);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");
    await runtime.createSession("C:\\work");

    sdk.listAll.mockResolvedValueOnce([
      {
        id: "saved-other",
        path: "C:\\agent\\sessions\\other\\saved.jsonl",
        cwd: "C:\\other",
        created: "2026-08-23T08:00:00.000Z",
        modified: "2026-08-23T08:01:00.000Z",
        messageCount: 2,
        firstMessage: "saved",
      },
    ]);
    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "saved-other", cwd: "C:\\other" }),
    ]);

    sdk.listAll.mockResolvedValueOnce([
      {
        id: "pending",
        path: sessionPath,
        cwd: "C:\\work",
        created: "2026-08-24T08:00:00.000Z",
        modified: "2026-08-24T08:01:00.000Z",
        messageCount: 1,
        firstMessage: "hello",
      },
    ]);
    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: "pending", path: sessionPath, firstMessage: "hello" }),
    ]);
  });

  it("会话目录枚举失败时返回稳定且不泄露细节的错误", async () => {
    const sdk = sdkReturning();
    sdk.listAll.mockRejectedValueOnce(new Error("token=secret"));
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");

    await expect(runtime.listSessions()).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({
        code: "SESSION_LIST_FAILED",
        message: "无法读取 Pi 会话列表",
      }),
    );
  });

  it("只删除授权 sessions 目录内的 JSONL，并释放已管理会话", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-desktop-delete-"));
    try {
      const sessionsDir = join(agentDir, "sessions");
      await mkdir(sessionsDir);
      const sessionPath = join(sessionsDir, "saved.jsonl");
      await writeFile(sessionPath, "session data", "utf8");
      const managed = createSessionMock("saved", { sessionFile: sessionPath });
      const sdk = sdkReturning(managed);
      const runtime = new PiSessionRuntime(sdk, agentDir);
      await runtime.createSession("C:\\work");
      sdk.listAll.mockResolvedValueOnce([
        {
          id: "saved",
          path: sessionPath,
          cwd: "C:\\work",
          created: "2026-08-20T08:00:00.000Z",
          modified: "2026-08-20T09:00:00.000Z",
          messageCount: 1,
          firstMessage: "hello",
        },
      ]);

      await expect(runtime.deleteSessions(["saved"])).resolves.toEqual({
        deletedSessionIds: ["saved"],
        missingSessionIds: [],
      });
      await expect(readFile(sessionPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(managed.dispose).toHaveBeenCalledOnce();
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("SDK 清单暂未包含活动会话时仍使用托管会话文件删除 JSONL", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-desktop-delete-"));
    try {
      const sessionsDir = join(agentDir, "sessions");
      await mkdir(sessionsDir);
      const sessionPath = join(sessionsDir, "pending.jsonl");
      await writeFile(sessionPath, "pending session", "utf8");
      const managed = createSessionMock("pending", { sessionFile: sessionPath });
      const sdk = sdkReturning(managed);
      const runtime = new PiSessionRuntime(sdk, agentDir);
      await runtime.createSession("C:\\work");
      sdk.listAll.mockResolvedValueOnce([]);

      await expect(runtime.deleteSessions(["pending"])).resolves.toEqual({
        deletedSessionIds: ["pending"],
        missingSessionIds: [],
      });
      await expect(readFile(sessionPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(managed.dispose).toHaveBeenCalledOnce();
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("拒绝流式会话和越界文件，不执行任何删除", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-desktop-delete-"));
    try {
      const sessionsDir = join(agentDir, "sessions");
      await mkdir(sessionsDir);
      const sessionPath = join(sessionsDir, "streaming.jsonl");
      await writeFile(sessionPath, "streaming", "utf8");
      const streaming = createSessionMock("streaming", {
        sessionFile: sessionPath,
        streaming: true,
      });
      const sdk = sdkReturning(streaming);
      const runtime = new PiSessionRuntime(sdk, agentDir);
      await runtime.createSession("C:\\work");

      await expect(runtime.deleteSessions(["streaming"])).rejects.toEqual(
        expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_BUSY" }),
      );
      await expect(readFile(sessionPath, "utf8")).resolves.toBe("streaming");

      const outsidePath = join(agentDir, "outside.jsonl");
      await writeFile(outsidePath, "outside", "utf8");
      streaming.setStreaming(false);
      sdk.listAll.mockResolvedValueOnce([
        {
          id: "outside",
          path: outsidePath,
          cwd: "C:\\work",
          created: "2026-08-20T08:00:00.000Z",
          modified: "2026-08-20T09:00:00.000Z",
          messageCount: 1,
          firstMessage: "outside",
        },
      ]);
      await expect(runtime.deleteSessions(["outside"])).rejects.toEqual(
        expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_PATH_INVALID" }),
      );
      await expect(readFile(outsidePath, "utf8")).resolves.toBe("outside");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("将不存在的会话归类为 missing，并拒绝重复或空 id", async () => {
    const runtime = new PiSessionRuntime(sdkReturning(), "C:\\agent");

    await expect(runtime.deleteSessions(["missing"])).resolves.toEqual({
      deletedSessionIds: [],
      missingSessionIds: ["missing"],
    });
    await expect(runtime.deleteSessions([])).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_IDS_INVALID" }),
    );
    await expect(runtime.deleteSessions(["same", "same"])).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeError>>({ code: "SESSION_IDS_INVALID" }),
    );
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
    expect(reloadResource).toHaveBeenCalledOnce();
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
            {
              type: "toolCall",
              id: "tool-1",
              name: "read",
              arguments: { path: "C:\\work\\README.md", apiKey: "sk-history-token" },
            },
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

    const restored = await runtime.openSession("C:\\agent\\sessions\\work\\saved.jsonl");
    expect(restored).toEqual(
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
            toolInput: {
              text: '{\n  "path": "C:\\\\work\\\\README.md",\n  "apiKey": "[REDACTED]"\n}',
              format: "json",
              truncated: false,
            },
            toolOutput: {
              text: "sensitive output",
              format: "text",
              truncated: false,
            },
            isError: false,
          },
        ],
      }),
    );
    expect(JSON.stringify(restored)).not.toContain("sk-history-token");
    expect(first.unsubscribe).not.toHaveBeenCalled();
    expect(first.dispose).not.toHaveBeenCalled();
    await expect(runtime.openSession("C:/agent/sessions/work/saved.jsonl")).resolves.toEqual(
      expect.objectContaining({ sessionId: "opened" }),
    );
    expect(sdk.createAgentSession).toHaveBeenCalledTimes(2);
  });

  it("合并同一路径的并发打开，仅创建一个 SDK 会话", async () => {
    const opened = createSessionMock("opened", {
      sessionFile: "C:\\agent\\sessions\\work\\saved.jsonl",
    });
    const sdk = sdkReturning(opened);
    const runtime = new PiSessionRuntime(sdk, "C:\\agent");

    const [first, second] = await Promise.all([
      runtime.openSession("C:\\agent\\sessions\\work\\saved.jsonl"),
      runtime.openSession("C:/agent/sessions/work/saved.jsonl"),
    ]);

    expect(first.sessionId).toBe("opened");
    expect(second.sessionId).toBe("opened");
    expect(sdk.SessionManager.open).toHaveBeenCalledOnce();
    expect(sdk.createAgentSession).toHaveBeenCalledOnce();
  });

  it("只投影 10,000 条历史的有界尾部且不读取截断区工具参数", async () => {
    const inaccessibleArguments = {};
    Object.defineProperty(inaccessibleArguments, "apiKey", {
      enumerable: true,
      get: () => {
        throw new Error("截断区不应被序列化");
      },
    });
    const messages: unknown[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "old-tool",
            name: "read",
            arguments: inaccessibleArguments,
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "old-tool",
        toolName: "read",
        content: "old output",
      },
      ...Array.from({ length: 10_000 }, (_, index) => ({
        role: "user",
        content: `tail-${index}`,
      })),
    ];
    const opened = createSessionMock("large-history", {
      sessionFile: "C:\\agent\\sessions\\work\\large.jsonl",
      messages,
    });
    const runtime = new PiSessionRuntime(sdkReturning(opened), "C:\\agent");

    const startedAt = performance.now();
    const restored = await runtime.openSession("C:\\agent\\sessions\\work\\large.jsonl");
    const durationMs = performance.now() - startedAt;

    expect(restored.messages).toHaveLength(200);
    expect(restored.messages[0]).toEqual({ role: "user", content: "tail-9800" });
    expect(restored.messages.at(-1)).toEqual({ role: "user", content: "tail-9999" });
    expect(durationMs).toBeLessThan(100);
  });

  it("仅序列化有返回结果的工具输入", async () => {
    const unusedArguments = {};
    Object.defineProperty(unusedArguments, "token", {
      enumerable: true,
      get: () => {
        throw new Error("未匹配的工具输入不应被序列化");
      },
    });
    const opened = createSessionMock("unused-tool-input", {
      sessionFile: "C:\\agent\\sessions\\work\\unused-tool-input.jsonl",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "unused-tool",
              name: "read",
              arguments: unusedArguments,
            },
          ],
        },
        { role: "user", content: "keep this message" },
      ],
    });
    const runtime = new PiSessionRuntime(sdkReturning(opened), "C:\\agent");

    await expect(
      runtime.openSession("C:\\agent\\sessions\\work\\unused-tool-input.jsonl"),
    ).resolves.toEqual(
      expect.objectContaining({ messages: [{ role: "user", content: "keep this message" }] }),
    );
  });

  it("达到历史字符预算后不再读取更早的工具输入", async () => {
    const excludedArguments = {};
    Object.defineProperty(excludedArguments, "token", {
      enumerable: true,
      get: () => {
        throw new Error("字符预算外的工具输入不应被序列化");
      },
    });
    const opened = createSessionMock("bounded-history-characters", {
      sessionFile: "C:\\agent\\sessions\\work\\bounded-history-characters.jsonl",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "excluded-tool",
              name: "read",
              arguments: excludedArguments,
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "excluded-tool",
          toolName: "read",
          content: "excluded output",
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          role: "user",
          content: `${index}:${"x".repeat(120_000)}`,
        })),
      ],
    });
    const runtime = new PiSessionRuntime(sdkReturning(opened), "C:\\agent");

    const restored = await runtime.openSession(
      "C:\\agent\\sessions\\work\\bounded-history-characters.jsonl",
    );

    expect(restored.messages).toHaveLength(3);
    expect(restored.messages.map((message) => message.content.slice(0, 2))).toEqual([
      "1:",
      "2:",
      "3:",
    ]);
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
      availableTools: [
        { name: "read", description: "Read files" },
        { name: "bash", description: "Run shell commands" },
        { name: "edit", description: "Edit files" },
        { name: "write", description: "Write files" },
      ],
      activeToolNames: ["read", "bash", "edit", "write"],
      defaultToolNames: ["read", "bash", "edit", "write"],
    });
    expect(sessionMock.setModel).toHaveBeenCalledWith(plainModel);
    expect(sessionMock.setThinkingLevel).toHaveBeenCalledWith("off");

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
          availableTools: [
            { name: "read", description: "Read files" },
            { name: "bash", description: "Run shell commands" },
            { name: "edit", description: "Edit files" },
            { name: "write", description: "Write files" },
          ],
          activeToolNames: ["read", "bash", "edit", "write"],
          defaultToolNames: ["read", "bash", "edit", "write"],
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
