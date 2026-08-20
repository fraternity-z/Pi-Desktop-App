import { describe, expect, it, vi } from "vitest";

import { createHello, type OutboundFrame } from "./protocol.js";
import { BridgeServer } from "./server.js";
import { RuntimeError, type RuntimeEvent, type SessionRuntime } from "./session-runtime.js";

interface RuntimeMock {
  runtime: SessionRuntime;
  emit(event: RuntimeEvent): void;
  createSession: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
}

function createRuntimeMock(): RuntimeMock {
  let listener: (event: RuntimeEvent) => void = () => undefined;
  const createSession = vi.fn(async () => ({ sessionId: "s-1" }));
  const prompt = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const shutdown = vi.fn(async () => undefined);
  const runtime: SessionRuntime = {
    createSession,
    prompt,
    abort,
    shutdown,
    subscribe: vi.fn((nextListener: (event: RuntimeEvent) => void) => {
      listener = nextListener;
      return vi.fn();
    }),
  };
  return { runtime, emit: (event) => listener(event), createSession, prompt, abort, shutdown };
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

    expect(frames[0]).toEqual(createHello("0.84.2", "22.19.0"));
    expect(frames).toContainEqual(expect.objectContaining({ id: "1", ok: true, data: { pong: true } }));
    expect(frames).toContainEqual(
      expect.objectContaining({ id: "2", ok: true, data: { status: "ok", protocolVersion: 1 } }),
    );
    expect(runtimeMock.createSession).toHaveBeenCalledWith("C:\\work");
    expect(runtimeMock.prompt).toHaveBeenCalledWith("s-1", "hello");
  });

  it("给流事件分配单调序号", () => {
    const { frames, runtimeMock } = setup();
    runtimeMock.emit({ sessionId: "s-1", name: "agent.started" });
    runtimeMock.emit({ sessionId: "s-1", name: "message.delta", data: { delta: "a" } });

    expect(frames).toEqual([
      expect.objectContaining({ kind: "event", seq: 1, name: "agent.started" }),
      expect.objectContaining({ kind: "event", seq: 2, name: "message.delta" }),
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
    finishPrompt();
    await promptTask;
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
