import { describe, expect, it, vi } from "vitest";

import { createHello, type OutboundFrame } from "./protocol.js";
import { BridgeServer } from "./server.js";
import { RuntimeError, type RuntimeEvent, type SessionRuntime } from "./session-runtime.js";

interface RuntimeMock {
  runtime: SessionRuntime;
  emit(event: RuntimeEvent): void;
  createSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  deleteSessions: ReturnType<typeof vi.fn>;
  openSession: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
  listPackages: ReturnType<typeof vi.fn>;
  installPackage: ReturnType<typeof vi.fn>;
  setPackageEnabled: ReturnType<typeof vi.fn>;
  removePackage: ReturnType<typeof vi.fn>;
  updatePackage: ReturnType<typeof vi.fn>;
  checkPackageUpdates: ReturnType<typeof vi.fn>;
  listResources: ReturnType<typeof vi.fn>;
  configureRequestHeaders: ReturnType<typeof vi.fn>;
  configureSession: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  clearQueue: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
}

function createRuntimeMock(): RuntimeMock {
  let listener: (event: RuntimeEvent) => void = () => undefined;
  const createSession = vi.fn(async () => ({
    sessionId: "s-1",
    cwd: "C:\\work",
    sessionPath: null,
    configuration: {
      model: null,
      thinkingLevel: "off" as const,
      availableThinkingLevels: ["off" as const],
      availableTools: [],
      activeToolNames: [],
      defaultToolNames: [],
    },
      messages: [],
      queuedMessages: { steering: [], followUp: [] },
      streaming: false,
  }));
  const listSessions = vi.fn(async () => []);
  const deleteSessions = vi.fn(async () => ({ deletedSessionIds: [], missingSessionIds: [] }));
  const openSession = vi.fn(async () => ({
    sessionId: "s-2",
    cwd: "C:\\work",
    sessionPath: "C:\\agent\\sessions\\s.jsonl",
    configuration: {
      model: null,
      thinkingLevel: "off" as const,
      availableThinkingLevels: ["off" as const],
      availableTools: [],
      activeToolNames: [],
      defaultToolNames: [],
    },
      messages: [],
      queuedMessages: { steering: [], followUp: [] },
      streaming: false,
  }));
  const listModels = vi.fn(async () => []);
  const listPackages = vi.fn(async () => []);
  const installPackage = vi.fn(async () => []);
  const setPackageEnabled = vi.fn(async () => []);
  const removePackage = vi.fn(async () => []);
  const updatePackage = vi.fn(async () => []);
  const checkPackageUpdates = vi.fn(async () => []);
  const listResources = vi.fn(async () => []);
  const configureRequestHeaders = vi.fn((settings) => settings);
  const configureSession = vi.fn(async () => ({
    model: null,
    thinkingLevel: "off" as const,
    availableThinkingLevels: ["off" as const],
    availableTools: [],
    activeToolNames: [],
    defaultToolNames: [],
  }));
  const prompt = vi.fn(async () => undefined);
  const clearQueue = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const shutdown = vi.fn(async () => undefined);
  const runtime: SessionRuntime = {
    configureRequestHeaders,
    createSession,
    listSessions,
    deleteSessions,
    openSession,
    listModels,
    listPackages,
    installPackage,
    setPackageEnabled,
    removePackage,
    updatePackage,
    checkPackageUpdates,
    listResources,
    configureSession,
    prompt,
    clearQueue,
    abort,
    shutdown,
    subscribe: vi.fn((nextListener: (event: RuntimeEvent) => void) => {
      listener = nextListener;
      return vi.fn();
    }),
  };
  return {
    runtime,
    emit: (event) => listener(event),
    createSession,
    listSessions,
    deleteSessions,
    openSession,
    listModels,
    listPackages,
    installPackage,
    setPackageEnabled,
    removePackage,
    updatePackage,
    checkPackageUpdates,
    listResources,
    configureRequestHeaders,
    configureSession,
    prompt,
    clearQueue,
    abort,
    shutdown,
  };
}

function setup(runtimeMock = createRuntimeMock()) {
  const frames: OutboundFrame[] = [];
  const server = new BridgeServer(
    runtimeMock.runtime,
    createHello("0.84.2", "22.19.0"),
    (frame) => frames.push(frame),
  );
  return { server, frames, runtimeMock };
}

describe("BridgeServer", () => {
  it("发送握手并路由基础请求", async () => {
    const { server, frames, runtimeMock } = setup();
    server.start();
    await server.handleLine('{"v":1,"id":"1","op":"ping"}');
    await server.handleLine('{"v":1,"id":"2","op":"health"}');
    await server.handleLine(
      '{"v":1,"id":"3","op":"session.create","cwd":"C:\\\\work"}',
    );
    await server.handleLine(
      '{"v":1,"id":"4","op":"prompt","sessionId":"s-1","text":"hello"}',
    );
    await server.handleLine('{"v":1,"id":"5","op":"model.list"}');
    await server.handleLine('{"v":1,"id":"6","op":"session.list"}');
    await server.handleLine(
      '{"v":1,"id":"6-delete","op":"session.delete","sessionIds":["saved","older"]}',
    );
    await server.handleLine(
      '{"v":1,"id":"6b","op":"request-headers.configure","enabled":true,"client":"codex"}',
    );
    await server.handleLine(
      '{"v":1,"id":"7","op":"session.open","sessionPath":"C:\\\\agent\\\\sessions\\\\s.jsonl"}',
    );
    await server.handleLine(
      '{"v":1,"id":"8","op":"session.configure","sessionId":"s-2","thinkingLevel":"high"}',
    );
    await server.handleLine(
      '{"v":1,"id":"9","op":"queue.clear","sessionId":"s-1"}',
    );

    expect(frames[0]).toEqual(createHello("0.84.2", "22.19.0"));
    expect(frames).toContainEqual(expect.objectContaining({ id: "1", ok: true, data: { pong: true } }));
    expect(frames).toContainEqual(
      expect.objectContaining({ id: "2", ok: true, data: { status: "ok", protocolVersion: 1 } }),
    );
    expect(runtimeMock.createSession).toHaveBeenCalledWith("C:\\work");
    expect(runtimeMock.prompt).toHaveBeenCalledWith("s-1", "hello", undefined, undefined);
    expect(frames).toContainEqual(
      expect.objectContaining({ id: "4", ok: true, data: { finalSeq: 0 } }),
    );
    expect(runtimeMock.listModels).toHaveBeenCalledOnce();
    expect(runtimeMock.listSessions).toHaveBeenCalledOnce();
    expect(runtimeMock.deleteSessions).toHaveBeenCalledWith(["saved", "older"]);
    expect(runtimeMock.configureRequestHeaders).toHaveBeenCalledWith({
      enabled: true,
      client: "codex",
    });
    expect(runtimeMock.openSession).toHaveBeenCalledWith("C:\\agent\\sessions\\s.jsonl");
    expect(runtimeMock.configureSession).toHaveBeenCalledWith("s-2", {
      thinkingLevel: "high",
    });
    expect(runtimeMock.clearQueue).toHaveBeenCalledWith("s-1");
  });

  it("将流式发送行为传递给运行时", async () => {
    const { server, runtimeMock } = setup();
    await server.handleLine(
      '{"v":1,"id":"steer","op":"prompt","sessionId":"s-1","text":"guide","streamingBehavior":"steer"}',
    );
    await server.handleLine(
      '{"v":1,"id":"follow","op":"prompt","sessionId":"s-1","text":"later","streamingBehavior":"followUp"}',
    );

    expect(runtimeMock.prompt).toHaveBeenNthCalledWith(1, "s-1", "guide", "steer", undefined);
    expect(runtimeMock.prompt).toHaveBeenNthCalledWith(2, "s-1", "later", "followUp", undefined);
  });

  it("将工具权限选择传递给运行时", async () => {
    const { server, runtimeMock } = setup();
    await server.handleLine(
      '{"v":1,"id":"tools","op":"prompt","sessionId":"s-1","text":"inspect","activeTools":["read","edit"]}',
    );

    expect(runtimeMock.prompt).toHaveBeenCalledWith(
      "s-1",
      "inspect",
      undefined,
      ["read", "edit"],
    );
  });

  it("路由插件与资源管理请求", async () => {
    const { server, frames, runtimeMock } = setup();
    const requests = [
      { v: 1, id: "packages", op: "package.list", cwd: "C:\\work" },
      {
        v: 1,
        id: "install",
        op: "package.install",
        cwd: "C:\\work",
        source: "npm:pi-test",
        scope: "global",
      },
      {
        v: 1,
        id: "disable",
        op: "package.set-enabled",
        cwd: "C:\\work",
        source: "npm:pi-test",
        scope: "global",
        enabled: false,
      },
      {
        v: 1,
        id: "remove",
        op: "package.remove",
        cwd: "C:\\work",
        source: "npm:pi-test",
        scope: "project",
      },
      {
        v: 1,
        id: "update",
        op: "package.update",
        cwd: "C:\\work",
        source: "npm:pi-test",
      },
      { v: 1, id: "updates", op: "package.check-updates", cwd: "C:\\work" },
      { v: 1, id: "resources", op: "resource.list", cwd: "C:\\work" },
    ];

    for (const request of requests) {
      await server.handleLine(JSON.stringify(request));
    }

    expect(runtimeMock.listPackages).toHaveBeenCalledWith("C:\\work");
    expect(runtimeMock.installPackage).toHaveBeenCalledWith(
      "C:\\work",
      "npm:pi-test",
      "global",
    );
    expect(runtimeMock.setPackageEnabled).toHaveBeenCalledWith(
      "C:\\work",
      "npm:pi-test",
      "global",
      false,
    );
    expect(runtimeMock.removePackage).toHaveBeenCalledWith(
      "C:\\work",
      "npm:pi-test",
      "project",
    );
    expect(runtimeMock.updatePackage).toHaveBeenCalledWith("C:\\work", "npm:pi-test");
    expect(runtimeMock.checkPackageUpdates).toHaveBeenCalledWith("C:\\work");
    expect(runtimeMock.listResources).toHaveBeenCalledWith("C:\\work");
    for (const request of requests) {
      expect(frames).toContainEqual(expect.objectContaining({ id: request.id, ok: true }));
    }
  });

  it("给流事件分配单调序号", () => {
    const { frames, runtimeMock } = setup();
    runtimeMock.emit({ sessionId: "s-1", name: "agent.started" });
    runtimeMock.emit({ sessionId: "s-1", name: "message.delta", data: { delta: "a" } });
    runtimeMock.emit({
      sessionId: "s-1",
      name: "tool.started",
      data: { toolCallId: "tool-1", toolName: "read" },
    });

    expect(frames).toEqual([
      expect.objectContaining({ kind: "event", seq: 1, name: "agent.started" }),
      expect.objectContaining({ kind: "event", seq: 2, name: "message.delta" }),
      expect.objectContaining({
        kind: "event",
        seq: 3,
        name: "tool.started",
        data: { toolCallId: "tool-1", toolName: "read" },
      }),
    ]);
  });

  it("prompt 响应与后续流事件保持独立", async () => {
    const { server, frames, runtimeMock } = setup();

    await server.handleLine(
      '{"v":1,"id":"prompt","op":"prompt","sessionId":"s-1","text":"hello"}',
    );
    runtimeMock.emit({ sessionId: "s-1", name: "message.delta", data: { delta: "late" } });
    runtimeMock.emit({ sessionId: "s-1", name: "agent.settled" });

    expect(frames).toEqual([
      expect.objectContaining({ id: "prompt", ok: true, data: { finalSeq: 0 } }),
      expect.objectContaining({ kind: "event", seq: 1, name: "message.delta" }),
      expect.objectContaining({ kind: "event", seq: 2, name: "agent.settled" }),
    ]);
  });

  it("允许在 prompt 尚未结束时并发处理中止", async () => {
    let finishPrompt: () => void = () => undefined;
    const promptPending = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });
    const runtimeMock = createRuntimeMock();
    runtimeMock.prompt.mockReturnValueOnce(promptPending);
    const { server, frames } = setup(runtimeMock);

    const promptTask = server.handleLine(
      '{"v":1,"id":"prompt","op":"prompt","sessionId":"s-1","text":"hello"}',
    );
    await server.handleLine('{"v":1,"id":"abort","op":"abort","sessionId":"s-1"}');

    expect(runtimeMock.abort).toHaveBeenCalledWith("s-1");
    expect(frames).toContainEqual(expect.objectContaining({ id: "abort", ok: true }));
    expect(frames).not.toContainEqual(expect.objectContaining({ id: "prompt", ok: true }));
    runtimeMock.emit({ sessionId: "s-1", name: "agent.settled" });
    finishPrompt();
    await promptTask;
    expect(frames).toContainEqual(
      expect.objectContaining({ id: "prompt", ok: true, data: { finalSeq: 1 } }),
    );
  });

  it.each([
    ["INVALID_JSON", "{"],
    ["SESSION_NOT_FOUND", '{"v":1,"id":"1","op":"abort","sessionId":"missing"}'],
  ])("将边界异常转换为响应 %s", async (code, line) => {
    const runtimeMock = createRuntimeMock();
    if (code === "SESSION_NOT_FOUND") {
      runtimeMock.abort.mockRejectedValueOnce(
        new RuntimeError("SESSION_NOT_FOUND", "找不到会话 missing"),
      );
    }
    const { server, frames } = setup(runtimeMock);
    await server.handleLine(line);

    expect(frames).toContainEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) }),
    );
  });

  it("隐藏未知内部异常，并在 shutdown 后停止读取", async () => {
    const runtimeMock = createRuntimeMock();
    runtimeMock.createSession.mockRejectedValueOnce(new Error("secret detail"));
    const { server, frames } = setup(runtimeMock);
    await server.handleLine(
      '{"v":1,"id":"failure","op":"session.create","cwd":"C:\\\\work"}',
    );
    const keepRunning = await server.handleLine('{"v":1,"id":"stop","op":"shutdown"}');

    expect(frames).toContainEqual(
      expect.objectContaining({
        id: "failure",
        error: { code: "INTERNAL_ERROR", message: "Bridge 处理请求失败" },
      }),
    );
    expect(keepRunning).toBe(false);
    expect(runtimeMock.shutdown).toHaveBeenCalledOnce();
  });
});
