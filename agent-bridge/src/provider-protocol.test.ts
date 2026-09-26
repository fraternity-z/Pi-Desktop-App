import { describe, expect, it, vi } from "vitest";
import { parseRequest, createHello, type OutboundFrame } from "./protocol.js";
import { BridgeServer } from "./server.js";
import type { SessionRuntime } from "./session-runtime.js";
import { ProviderSettingsError } from "./provider-config.js";

const requests = [
  { op: "provider.list", refresh: true },
  { op: "provider.login.start", provider: "example" },
  { op: "provider.login.status", loginId: "login" },
  {
    op: "provider.login.reply",
    loginId: "login",
    promptId: "prompt",
    value: "choice",
  },
  { op: "provider.login.cancel", loginId: "login" },
  { op: "provider.logout", provider: "example" },
  {
    op: "provider.model.save",
    input: {
      provider: "example",
      baseUrl: "https://example.test/v1",
      api: "openai-completions",
      modelId: "one",
      modelName: "One",
      reasoning: false,
      contextWindow: 32000,
      maxTokens: 4000,
      expectedRevision: "a".repeat(64),
    },
  },
  { op: "model.default.set", provider: "example", modelId: "one" },
];
describe("provider settings protocol", () => {
  it.each(requests)("validates and preserves $op", (request) => {
    expect(parseRequest(JSON.stringify({ v: 1, id: "r", ...request }))).toEqual(
      { v: 1, id: "r", ...request },
    );
  });
  it("checks refresh and bounds replies", () => {
    expect(parseRequest('{"v":1,"id":"r","op":"provider.list"}')).toMatchObject(
      { refresh: false },
    );
    expect(() =>
      parseRequest('{"v":1,"id":"r","op":"provider.list","refresh":1}'),
    ).toThrow();
    expect(() =>
      parseRequest(
        JSON.stringify({
          v: 1,
          id: "r",
          ...requests[3],
          value: "a".repeat(8193),
        }),
      ),
    ).toThrow();
  });
  it("dispatches every operation to the provider adapter", async () => {
    const providers = {
      snapshot: vi.fn(),
      startLogin: vi.fn(),
      status: vi.fn(),
      reply: vi.fn(),
      cancel: vi.fn(),
      logout: vi.fn(),
      saveModel: vi.fn(),
      setDefault: vi.fn(),
    };
    const runtime = {
      providerSettings: providers,
      subscribe: () => () => undefined,
      shutdown: vi.fn(),
    } as unknown as SessionRuntime;
    const frames: OutboundFrame[] = [];
    const server = new BridgeServer(runtime, createHello("0.84.2"), (frame) =>
      frames.push(frame),
    );
    for (const request of requests)
      await server.handleLine(JSON.stringify({ v: 1, id: "r", ...request }));
    for (const fn of Object.values(providers))
      expect(fn).toHaveBeenCalledOnce();
    expect(providers.reply).toHaveBeenCalledWith("login", "prompt", "choice");
    expect(providers.setDefault).toHaveBeenCalledWith("example", "one");
    expect(frames).toHaveLength(8);
    expect(frames.every((frame) => "ok" in frame && frame.ok)).toBe(true);
  });
  it("degrades unsupported runtimes and passes only stable adapter errors", async () => {
    const frames: OutboundFrame[] = [];
    const runtime = {
      subscribe: () => () => undefined,
      shutdown: vi.fn(),
    } as unknown as SessionRuntime;
    const server = new BridgeServer(runtime, createHello("0.84.2"), (frame) =>
      frames.push(frame),
    );
    await server.handleLine(
      JSON.stringify({ v: 1, id: "r", op: "provider.list" }),
    );
    expect(frames[0]).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_SETTINGS_UNSUPPORTED" },
    });
    const service = {
      snapshot: vi
        .fn()
        .mockRejectedValue(
          new ProviderSettingsError("MODEL_CONFIG_INVALID", "safe message"),
        ),
    };
    const next = new BridgeServer(
      { ...runtime, providerSettings: service } as unknown as SessionRuntime,
      createHello("0.84.2"),
      (frame) => frames.push(frame),
    );
    await next.handleLine(
      JSON.stringify({ v: 1, id: "r", op: "provider.list" }),
    );
    expect(frames[1]).toMatchObject({
      ok: false,
      error: { code: "MODEL_CONFIG_INVALID", message: "safe message" },
    });
  });
});
