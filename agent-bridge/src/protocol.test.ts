import { describe, expect, it } from "vitest";

import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  ProtocolError,
  createHello,
  parseRequest,
  serializeFrame,
} from "./protocol.js";

describe("parseRequest", () => {
  it("解析受支持的请求", () => {
    expect(parseRequest('{"v":1,"id":"r-1","op":"ping"}')).toEqual({
      v: PROTOCOL_VERSION,
      id: "r-1",
      op: "ping",
    });
  });

  it.each([
    ["INVALID_JSON", "{"],
    ["INVALID_REQUEST", "[]"],
    ["UNSUPPORTED_PROTOCOL", '{"v":2,"id":"r-1","op":"ping"}'],
    ["INVALID_REQUEST_ID", '{"v":1,"id":"","op":"ping"}'],
    ["UNSUPPORTED_OPERATION", '{"v":1,"id":"r-1","op":"prompt"}'],
  ])("对无效输入返回稳定错误码 %s", (code, line) => {
    expect(() => parseRequest(line)).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({ code }),
    );
  });

  it("拒绝超过最大长度的帧", () => {
    const line = "x".repeat(MAX_FRAME_BYTES + 1);

    expect(() => parseRequest(line)).toThrowError(
      expect.objectContaining<Partial<ProtocolError>>({ code: "FRAME_TOO_LARGE" }),
    );
  });
});

describe("outbound frames", () => {
  it("创建带运行时版本的握手", () => {
    expect(createHello("22.19.0")).toEqual({
      type: "hello",
      protocolVersion: 1,
      nodeVersion: "22.19.0",
      capabilities: ["ping", "health", "shutdown"],
    });
  });

  it("序列化为单行 JSONL", () => {
    const frame = serializeFrame(createHello("22.19.0"));

    expect(frame.endsWith("\n")).toBe(true);
    expect(frame.slice(0, -1)).not.toContain("\n");
  });
});

