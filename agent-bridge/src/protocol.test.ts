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
      '{"v":1,"id":"r-4","op":"abort","sessionId":"s-1"}',
      { v: 1, id: "r-4", op: "abort", sessionId: "s-1" },
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
      capabilities: ["sessions", "streaming", "abort", "extensions"],
    });
  });

  it("序列化为单行 JSONL", () => {
    const frame = serializeFrame(createHello("0.84.2", "22.19.0"));
    expect(frame.endsWith("\n")).toBe(true);
    expect(frame.slice(0, -1)).not.toContain("\n");
  });
});
