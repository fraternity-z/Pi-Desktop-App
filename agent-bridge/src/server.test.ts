import { describe, expect, it, vi } from "vitest";

import { createHello, type OutboundFrame } from "./protocol.js";
import { BridgeServer } from "./server.js";
import { RuntimeError, type RuntimeEvent, type SessionRuntime } from "./session-runtime.js";

interface RuntimeMock {
  runtime: SessionRuntime;
  emit(event: RuntimeEvent): void;
  createSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  openSession: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
  configureSession: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
}

function createRuntimeMock(): RuntimeMock {
  let listener: (event: RuntimeEvent) => void = () => undefined;
  const createSession = vi.fn(async () => ({
    sessionId: "s-1",
    cwd: "C:\\work",
    sessionPath: null,
    configuration: { model: null, thinkingLevel: "off" as const, availableThinkingLevels: ["off" as const] },
    messages: [],
  }));
  const listSessions = vi.fn(async () => []);
  const openSession = vi.fn(async () => ({
    sessionId: "s-2",
    cwd: "C:\\work",
    sessionPath: "C:\\agent\\sessions\\s.jsonl",
    configuration: { model: null, thinkingLevel: "off" as const, availableThinkingLevels: ["off" as const] },
    messages: [],
  }));
  const listModels = vi.fn(async () => []);
  const configureSession = vi.fn(async () => ({
    model: null,
    thinkingLevel: "off" as const,
    availableThinkingLevels: ["off" as const],
  }));
  const prompt = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const shutdown = vi.fn(async () => undefined);
  const runtime: SessionRuntime = {
    createSession,
    listSessions,
    openSession,
    listModels,
    configureSession,
    prompt,
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
    openSession,
    listModels,
    configureSession,
    prompt,
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
      '{"v":1,"id":"7","op":"session.open","sessionPath":"C:\\\\agent\\\\sessions\\\\s.jsonl"}',
    );
    await server.handleLine(
      '{"v":1,"id":"8","op":"session.configure","sessionId":"s-2","thinkingLevel":"high"}',
    );

    expect(frames[0]).toEqual(createHello("0.84.2", "22.19.0"));
    expect(frames).toContainEqual(expect.objectContaining({ id: "1", ok: true, data: { pong: true } }));
    expect(frames).toContainEqual(
      expect.objectContaining({ id: "2", ok: true, data: { status: "ok", protocolVersion: 1 } }),
    );
    expect(runtimeMock.createSession).toHaveBeenCalledWith("C:\\work");
    expect(runtimeMock.prompt).toHaveBeenCalledWith("s-1", "hello");
    expect(frames).toContainEqual(
      expect.objectContaining({ id: "4", ok: true, data: { finalSeq: 0 } }),
    );
    expect(runtimeMock.listModels).toHaveBeenCalledOnce();
    expect(runtimeMock.listSessions).toHaveBeenCalledOnce();
    expect(runtimeMock.openSession).toHaveBeenCalledWith("C:\\agent\\sessions\\s.jsonl");
    expect(runtimeMock.configureSession).toHaveBeenCalledWith("s-2", {
      thinkingLevel: "high",
    });
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
