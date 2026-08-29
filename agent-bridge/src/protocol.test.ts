import { describe, expect, it } from "vitest";

import {
  MAX_FRAME_BYTES,
  MAX_PROMPT_CHARS,
  PROTOCOL_VERSION,
  ProtocolError,
  createHello,
  parseRequest,
  serializeFrame,
} from "./protocol.js";

describe("parseRequest", () => {
  it.each([
    ['{"v":1,"id":"r-1","op":"ping"}', { v: 1, id: "r-1", op: "ping" }],
    [
      '{"v":1,"id":"r-2","op":"session.create","cwd":"C:\\\\work"}',
      { v: 1, id: "r-2", op: "session.create", cwd: "C:\\work" },
    ],
    [
      '{"v":1,"id":"r-3","op":"prompt","sessionId":"s-1","text":"hello"}',
      { v: 1, id: "r-3", op: "prompt", sessionId: "s-1", text: "hello" },
    ],
    [
      '{"v":1,"id":"r-3b","op":"prompt","sessionId":"s-1","text":"guide","streamingBehavior":"steer"}',
      {
        v: 1,
        id: "r-3b",
        op: "prompt",
        sessionId: "s-1",
        text: "guide",
        streamingBehavior: "steer",
      },
    ],
    [
      '{"v":1,"id":"r-3-tools","op":"prompt","sessionId":"s-1","text":"safe","activeTools":["read","edit"]}',
      {
        v: 1,
        id: "r-3-tools",
        op: "prompt",
        sessionId: "s-1",
        text: "safe",
        activeTools: ["read", "edit"],
      },
    ],
    [
      '{"v":1,"id":"r-3c","op":"queue.clear","sessionId":"s-1"}',
      { v: 1, id: "r-3c", op: "queue.clear", sessionId: "s-1" },
    ],
    [
      '{"v":1,"id":"r-4","op":"abort","sessionId":"s-1"}',
      { v: 1, id: "r-4", op: "abort", sessionId: "s-1" },
    ],
    ['{"v":1,"id":"r-5","op":"model.list"}', { v: 1, id: "r-5", op: "model.list" }],
    ['{"v":1,"id":"r-6","op":"session.list"}', { v: 1, id: "r-6", op: "session.list" }],
    [
      '{"v":1,"id":"r-6-delete","op":"session.delete","sessionIds":["saved","older"]}',
      { v: 1, id: "r-6-delete", op: "session.delete", sessionIds: ["saved", "older"] },
    ],
    [
      '{"v":1,"id":"r-6b","op":"request-headers.configure","enabled":true,"client":"codex"}',
      { v: 1, id: "r-6b", op: "request-headers.configure", enabled: true, client: "codex" },
    ],
    [
      '{"v":1,"id":"r-7","op":"session.open","sessionPath":"C:\\\\agent\\\\sessions\\\\s.jsonl"}',
      {
        v: 1,
        id: "r-7",
        op: "session.open",
        sessionPath: "C:\\agent\\sessions\\s.jsonl",
      },
    ],
    [
      '{"v":1,"id":"r-8","op":"session.configure","sessionId":"s-1","model":{"provider":"openai","id":"gpt"},"thinkingLevel":"high"}',
      {
        v: 1,
        id: "r-8",
        op: "session.configure",
        sessionId: "s-1",
        model: { provider: "openai", id: "gpt" },
        thinkingLevel: "high",
      },
    ],
    [
      '{"v":1,"id":"r-8b","op":"session.configure","sessionId":"s-1","thinkingLevel":"xhigh"}',
      {
        v: 1,
        id: "r-8b",
        op: "session.configure",
        sessionId: "s-1",
        thinkingLevel: "xhigh",
      },
    ],
    [
      JSON.stringify({ v: 1, id: "r-9", op: "package.list", cwd: "C:\\work" }),
      { v: 1, id: "r-9", op: "package.list", cwd: "C:\\work" },
    ],
    [
      JSON.stringify({
        v: 1,
        id: "r-10",
        op: "package.install",
        cwd: "C:\\work",
        source: "npm:pi-test",
        scope: "global",
      }),
      {
        v: 1,
        id: "r-10",
        op: "package.install",
        cwd: "C:\\work",
        source: "npm:pi-test",
        scope: "global",
      },
    ],
    [
      JSON.stringify({
        v: 1,
        id: "r-11",
        op: "package.set-enabled",
        cwd: "C:\\work",
        source: "npm:pi-test",
        scope: "project",
        enabled: false,
      }),
      {
        v: 1,
        id: "r-11",
        op: "package.set-enabled",
        cwd: "C:\\work",
        source: "npm:pi-test",
        scope: "project",
        enabled: false,
      },
    ],
    [
      JSON.stringify({
        v: 1,
        id: "r-12",
        op: "package.update",
        cwd: "C:\\work",
        source: "npm:pi-test",
      }),
      {
        v: 1,
        id: "r-12",
        op: "package.update",
        cwd: "C:\\work",
        source: "npm:pi-test",
      },
    ],
    [
      JSON.stringify({ v: 1, id: "r-13", op: "resource.list", cwd: "C:\\work" }),
      { v: 1, id: "r-13", op: "resource.list", cwd: "C:\\work" },
    ],
  ])("解析受支持的请求 %s", (line, expected) => {
    expect(parseRequest(line)).toEqual(expected);
  });

  it.each([
    ["INVALID_JSON", "{"],
    ["INVALID_REQUEST", "[]"],
    ["UNSUPPORTED_PROTOCOL", '{"v":2,"id":"r-1","op":"ping"}'],
    ["INVALID_REQUEST", '{"v":1,"id":"","op":"ping"}'],
    ["UNSUPPORTED_OPERATION", '{"v":1,"id":"r-1","op":"unknown"}'],
    ["INVALID_REQUEST", '{"v":1,"id":"r-1","op":"session.create","cwd":"relative"}'],
    ["INVALID_REQUEST", '{"v":1,"id":"r-1","op":"prompt","sessionId":"s-1"}'],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"prompt","sessionId":"s-1","text":"hello","streamingBehavior":"later"}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"prompt","sessionId":"s-1","text":"hello","activeTools":["read","read"]}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"prompt","sessionId":"s-1","text":"hello","activeTools":"read"}',
    ],
    ["INVALID_REQUEST", '{"v":1,"id":"r-1","op":"session.open","sessionPath":"relative"}'],
    ["INVALID_REQUEST", '{"v":1,"id":"r-1","op":"session.delete","sessionIds":[]}'],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"session.delete","sessionIds":["saved","saved"]}',
    ],
    ["INVALID_REQUEST", '{"v":1,"id":"r-1","op":"session.configure","sessionId":"s-1"}'],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"request-headers.configure","enabled":"yes","client":"codex"}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"request-headers.configure","enabled":true,"client":"custom"}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"session.configure","sessionId":"s-1","thinkingLevel":"ultra"}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"package.list","cwd":"relative"}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"package.install","cwd":"C:\\\\work","source":"npm:test","scope":"workspace"}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"package.install","cwd":"C:\\\\work","source":"","scope":"global"}',
    ],
    [
      "INVALID_REQUEST",
      '{"v":1,"id":"r-1","op":"package.set-enabled","cwd":"C:\\\\work","source":"npm:test","scope":"global","enabled":"yes"}',
    ],
  ])("对无效输入返回稳定错误码 %s", (code, line) => {
    expect(() => parseRequest(line)).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({ code }),
    );
  });

  it("拒绝超过最大长度的帧和提示词", () => {
    expect(() => parseRequest("x".repeat(MAX_FRAME_BYTES + 1))).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({ code: "FRAME_TOO_LARGE" }),
    );
    const line = JSON.stringify({
      v: 1,
      id: "r-1",
      op: "prompt",
      sessionId: "s-1",
      text: "x".repeat(MAX_PROMPT_CHARS + 1),
    });
    expect(() => parseRequest(line)).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({ code: "INVALID_REQUEST" }),
    );
  });
});

describe("outbound frames", () => {
  it("创建带 Pi 和 Node 版本的握手", () => {
    expect(createHello("0.84.2", "22.19.0")).toEqual({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      piVersion: "0.84.2",
      nodeVersion: "22.19.0",
      capabilities: [
        "sessions",
        "streaming",
        "abort",
        "extensions",
        "models",
        "session-history",
        "session-configuration",
        "tool-status",
        "tool-permissions",
        "background-sessions",
        "thinking-stream",
        "queue",
        "request-header-profiles",
        "packages",
        "resources",
        "context-usage",
      ],
    });
  });

  it("序列化为单行 JSONL", () => {
    const frame = serializeFrame(createHello("0.84.2", "22.19.0"));
    expect(frame.endsWith("\n")).toBe(true);
    expect(frame.slice(0, -1)).not.toContain("\n");
  });
});
