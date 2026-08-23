import { describe, expect, it, vi } from "vitest";

import {
  applyRequestHeaders,
  createRequestHeaderExtension,
  type RequestHeaderExtensionContextLike,
} from "./request-headers.js";

const context: RequestHeaderExtensionContextLike = {
  sessionManager: { getSessionId: () => "session-123" },
};

describe("applyRequestHeaders", () => {
  it("关闭时保持现有请求头不变", () => {
    const headers = { Authorization: "Bearer secret", Accept: "application/json" };

    applyRequestHeaders(headers, { enabled: false, client: "claude-code" }, context);

    expect(headers).toEqual({ Authorization: "Bearer secret", Accept: "application/json" });
  });

  it("大小写无关地应用 Claude Code 模板且不触碰鉴权头", () => {
    const headers: Record<string, string | null> = {
      accept: "text/plain",
      "user-agent": "pi",
      Authorization: "Bearer secret",
    };

    applyRequestHeaders(headers, { enabled: true, client: "claude-code" }, context);

    expect(headers.Accept).toBe("application/json");
    expect(headers["User-Agent"]).toBe("claude-cli/2.1.224 (external, cli)");
    expect(headers["X-Claude-Code-Session-Id"]).toBe("session-123");
    expect(headers.Authorization).toBe("Bearer secret");
    expect(headers).not.toHaveProperty("accept");
    expect(headers).not.toHaveProperty("user-agent");
  });

  it("应用 Codex 模板并生成同一会话内一致的动态元数据", () => {
    const headers: Record<string, string | null> = {
      Session_Id: "old-session",
      "SESSION-ID": "old-session",
    };

    applyRequestHeaders(headers, { enabled: true, client: "codex" }, context, {
      installationId: "install-123",
      now: 1_787_472_000_000,
      turnId: "0198d5f0-77c0-7000-8000-000000000001",
    });

    expect(headers["session-id"]).toBe("session-123");
    expect(headers["thread-id"]).toBe("session-123");
    expect(headers["x-client-request-id"]).toBe("session-123");
    expect(headers["x-codex-window-id"]).toBe("session-123:0");
    expect(headers).not.toHaveProperty("Session_Id");
    expect(headers).not.toHaveProperty("SESSION-ID");
    expect(JSON.parse(headers["x-codex-turn-metadata"] ?? "{}")).toEqual({
      installation_id: "install-123",
      session_id: "session-123",
      thread_id: "session-123",
      turn_id: "0198d5f0-77c0-7000-8000-000000000001",
      window_id: "session-123:0",
      request_kind: "turn",
      thread_source: "user",
      sandbox: "windows_sandbox",
      turn_started_at_unix_ms: 1_787_472_000_000,
    });
  });

  it("默认生成 UUIDv7 格式的 Codex turn id", () => {
    const headers: Record<string, string | null> = {};

    applyRequestHeaders(headers, { enabled: true, client: "codex" }, context);

    const metadata = JSON.parse(headers["x-codex-turn-metadata"] ?? "{}") as {
      turn_id?: string;
    };
    expect(metadata.turn_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("createRequestHeaderExtension", () => {
  it("扩展钩子失败时透明降级，不阻断请求", () => {
    let handler: ((event: { headers: Record<string, string | null> }, context: RequestHeaderExtensionContextLike) => void) | undefined;
    const extension = createRequestHeaderExtension(() => ({ enabled: true, client: "claude-code" }));
    extension({
      on: (_event, nextHandler) => {
        handler = nextHandler;
      },
    });
    const headers = { Accept: "text/plain" };
    const failingContext: RequestHeaderExtensionContextLike = {
      sessionManager: { getSessionId: vi.fn(() => { throw new Error("secret"); }) },
    };

    expect(() => handler?.({ headers }, failingContext)).not.toThrow();
    expect(headers).toEqual({ Accept: "text/plain" });
  });
});
