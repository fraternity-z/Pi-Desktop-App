import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderSettingsService,
  type OfficialModelSettings,
  type OfficialProviderRuntime,
} from "./provider-settings.js";

type Interaction = Parameters<NonNullable<OfficialProviderRuntime["login"]>>[2];
let dir: string;
let runtime: OfficialProviderRuntime;
let settings: OfficialModelSettings;
let service: ProviderSettingsService;
let interaction: Interaction | undefined;
let complete: (value: unknown) => void;
let fail: (error: unknown) => void;
const model = { provider: "example", id: "one", name: "One", reasoning: true };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-provider-runtime-"));
  interaction = undefined;
  runtime = {
    getModel: vi.fn(() => model),
    getModels: vi.fn(() => [model]),
    getAvailable: vi.fn(async () => [model]),
    getProviders: vi.fn(() => [
      { id: "example", name: "Example", auth: { oauth: {} } },
      { id: "apikey", name: "API", auth: {} },
    ]),
    getProviderAuthStatus: vi.fn((provider) => ({
      configured: provider === "example",
    })),
    isUsingOAuth: vi.fn(() => true),
    listCredentials: vi.fn(async () => [
      { providerId: "example", type: "oauth" as const },
    ]),
    refresh: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    login: vi.fn((_provider, _type, value) => {
      interaction = value;
      return new Promise((resolve, reject) => {
        complete = resolve;
        fail = reject;
      });
    }),
  };
  settings = {
    getDefaultProvider: () => "example",
    getDefaultModel: () => "one",
    setDefaultModelAndProvider: vi.fn(),
    flush: vi.fn(async () => undefined),
    drainErrors: vi.fn(() => []),
  };
  service = new ProviderSettingsService(
    dir,
    async () => runtime,
    () => settings,
  );
});
afterEach(async () => {
  service.close();
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("provider catalog and defaults", () => {
  it("uses official capabilities and returns credential-blind metadata", async () => {
    const result = await service.snapshot(true);
    expect(runtime.refresh).toHaveBeenCalledWith({ allowNetwork: false });
    expect(result.defaultModel).toEqual({ provider: "example", id: "one" });
    expect(result.providers[0]).toMatchObject({
      id: "example",
      connected: true,
      oauth: true,
      authType: "oauth",
      storedCredential: true,
      models: [{ ...model, available: true }],
    });
    expect(result.providers[1]?.oauth).toBe(false);
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  });
  it("supports missing optional metadata and no default selection", async () => {
    runtime.getProviderAuthStatus = undefined;
    runtime.listCredentials = undefined;
    runtime.isUsingOAuth = undefined;
    runtime.getModels = undefined;
    runtime.getError = () => "private config error";
    settings.getDefaultModel = undefined;
    const result = await service.snapshot();
    expect(result.defaultModel).toBeNull();
    expect(result.providers[0]?.authType).toBe("api_key");
    expect(result.warning).not.toContain("private");
  });
  it("rejects unsupported SDKs and excessive catalogs", async () => {
    runtime.getProviders = undefined;
    await expect(service.snapshot()).rejects.toMatchObject({
      code: "PROVIDER_SETTINGS_UNSUPPORTED",
    });
    runtime.getProviders = () => [];
    runtime.getModels = () => Array(4001).fill(model);
    await expect(service.snapshot()).rejects.toMatchObject({
      code: "MODEL_CATALOG_TOO_LARGE",
    });
  });
  it("saves a real available model through official SettingsManager and flush", async () => {
    await service.setDefault("example", "one");
    expect(settings.setDefaultModelAndProvider).toHaveBeenCalledWith(
      "example",
      "one",
    );
    expect(settings.flush).toHaveBeenCalledOnce();
    await expect(
      service.setDefault("example", "missing"),
    ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
  it("reports settings persistence failures rather than claiming success", async () => {
    settings.drainErrors = () => [new Error("private path")];
    await expect(service.setDefault("example", "one")).rejects.toMatchObject({
      code: "DEFAULT_MODEL_SAVE_FAILED",
    });
    settings.flush = undefined;
    await expect(service.setDefault("example", "one")).rejects.toMatchObject({
      code: "PROVIDER_SETTINGS_UNSUPPORTED",
    });
  });
  it("delegates logout to Pi without altering model files", async () => {
    await service.logout("example");
    expect(runtime.logout).toHaveBeenCalledWith("example");
    runtime.logout = undefined;
    await expect(service.logout("example")).rejects.toMatchObject({
      code: "PROVIDER_SETTINGS_UNSUPPORTED",
    });
  });
  it("saves a custom model and refreshes the same runtime", async () => {
    const snapshot = await service.snapshot();
    await service.saveModel({
      provider: "custom",
      baseUrl: "https://example.test/v1",
      api: "openai-completions",
      modelId: "new",
      modelName: "New",
      reasoning: false,
      contextWindow: 32000,
      maxTokens: 4000,
      expectedRevision: snapshot.revision,
    });
    expect(runtime.refresh).toHaveBeenCalledWith({ allowNetwork: false });
    runtime.refresh = undefined;
    await expect(service.saveModel({} as never)).rejects.toMatchObject({
      code: "PROVIDER_SETTINGS_UNSUPPORTED",
    });
  });
});

describe("official login state machine", () => {
  it("starts OAuth and never returns the resolved SDK credential", async () => {
    const login = await service.startLogin("example");
    expect(runtime.login).toHaveBeenCalledWith(
      "example",
      "oauth",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    interaction!.notify({
      type: "auth_url",
      url: "https://example.test/auth?state=test",
    });
    expect(service.status(login.id).url).toContain("state=test");
    complete({
      access: "private-access-fixture",
      refresh: "private-refresh-fixture",
    });
    await flush();
    const result = service.status(login.id);
    expect(result.status).toBe("success");
    expect(result.url).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("supports device codes, choices, manual callbacks and one-shot replies", async () => {
    const login = await service.startLogin("example");
    interaction!.notify({
      type: "device_code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://example.test/device",
    });
    expect(service.status(login.id).userCode).toBe("ABCD-EFGH");
    const prompt = interaction!.prompt({
      type: "select",
      message: "Choose account",
      options: [{ id: "one", label: "One" }],
    });
    const id = service.status(login.id).prompt!.id;
    expect(() => service.reply(login.id, id, "not-listed")).toThrow();
    service.reply(login.id, id, "one");
    expect(await prompt).toBe("one");
    expect(() => service.reply(login.id, id, "one")).toThrow();
    const manual = interaction!.prompt({
      type: "manual_code",
      message: "Paste callback",
    });
    service.reply(
      login.id,
      service.status(login.id).prompt!.id,
      "https://localhost/callback?code=test",
    );
    expect(await manual).toContain("code=test");
  });
  it("cancels prompt when the SDK callback wins without cancelling the login", async () => {
    const login = await service.startLogin("example");
    const controller = new AbortController();
    const prompt = interaction!
      .prompt({
        type: "manual_code",
        message: "callback",
        signal: controller.signal,
      })
      .catch(() => "aborted");
    controller.abort();
    expect(await prompt).toBe("aborted");
    expect(service.status(login.id).prompt).toBeNull();
    complete({});
    await flush();
    expect(service.status(login.id).status).toBe("success");
  });
  it("cancels active flows and clears transient authorization data", async () => {
    const login = await service.startLogin("example");
    const prompt = interaction!
      .prompt({ type: "text", message: "Enter" })
      .catch(() => "cancelled");
    service.cancel(login.id);
    expect(interaction!.signal.aborted).toBe(true);
    expect(await prompt).toBe("cancelled");
    complete({});
    await flush();
    expect(service.status(login.id).status).toBe("cancelled");
    expect(service.cancel(login.id).status).toBe("cancelled");
    interaction!.notify({ type: "progress", message: "ignored" });
    expect(service.status(login.id).message).not.toBe("ignored");
  });
  it("blocks simultaneous logins and logout, rejects unsupported account providers", async () => {
    await expect(service.startLogin("apikey")).rejects.toMatchObject({
      code: "OAUTH_UNSUPPORTED",
    });
    await service.startLogin("example");
    await expect(service.startLogin("example")).rejects.toMatchObject({
      code: "LOGIN_BUSY",
    });
    await expect(service.logout("example")).rejects.toMatchObject({
      code: "LOGIN_BUSY",
    });
    expect(() => service.status("old")).toThrow();
  });
  it("terminates unsafe URLs and refuses secret prompts", async () => {
    const login = await service.startLogin("example");
    await expect(
      interaction!.prompt({ type: "secret", message: "API key" }),
    ).rejects.toMatchObject({ code: "LOGIN_SECRET_UNSUPPORTED" });
    interaction!.notify({ type: "auth_url", url: "file:///secret" });
    expect(service.status(login.id)).toMatchObject({
      status: "error",
      errorCode: "INVALID_AUTH_URL",
    });
    expect(interaction!.signal.aborted).toBe(true);
  });
  it("does not expose raw provider errors or common secret strings", async () => {
    const login = await service.startLogin("example");
    interaction!.notify({
      type: "info",
      message: "authorization: Bearer-private-fixture",
      links: [{ url: "https://example.test/help" }],
    });
    expect(service.status(login.id).message).not.toContain("Bearer-private");
    fail(new Error("refresh_token=private-fixture"));
    await flush();
    expect(service.status(login.id).errorCode).toBe("LOGIN_FAILED");
    expect(JSON.stringify(service.status(login.id))).not.toContain(
      "private-fixture",
    );
  });
  it("expires abandoned login and cancels on shutdown", async () => {
    vi.useFakeTimers();
    const login = await service.startLogin("example");
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(service.status(login.id)).toMatchObject({
      status: "error",
      errorCode: "LOGIN_TIMEOUT",
    });
    expect(interaction!.signal.aborted).toBe(true);
    const next = await service.startLogin("example");
    service.close();
    expect(service.status(next.id).status).toBe("cancelled");
    await expect(service.startLogin("example")).rejects.toMatchObject({
      code: "PROVIDER_SETTINGS_CLOSED",
    });
  });
});
