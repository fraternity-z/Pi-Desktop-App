import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./providers";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe("provider IPC boundary", () => {
  it("maps account interactions to bounded commands", async () => {
    await api.getProviderSettings();
    await api.getProviderSettings(true);
    await api.startProviderLogin("example");
    await api.getProviderLogin("login");
    await api.replyProviderLogin("login", "prompt", "choice");
    await api.cancelProviderLogin("login");
    await api.logoutProvider("example");
    await api.setDefaultProviderModel("example", "one");
    await api.openProviderLogin("login");
    expect(invoke).toHaveBeenNthCalledWith(1, "agent_provider_settings", {
      request: { op: "provider.list", refresh: false },
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "agent_provider_settings", {
      request: {
        op: "provider.login.reply",
        loginId: "login",
        promptId: "prompt",
        value: "choice",
      },
    });
    expect(invoke).toHaveBeenLastCalledWith("agent_open_provider_login", {
      loginId: "login",
    });
  });
  it("passes model metadata without a key field and notifies catalog listeners", async () => {
    const input: api.ProviderModelInput = {
      provider: "custom",
      baseUrl: "https://example.test/v1",
      api: "openai-responses",
      apiKeyEnv: "EXAMPLE_API_KEY",
      modelId: "one",
      modelName: "One",
      reasoning: false,
      contextWindow: 32000,
      maxTokens: 4000,
      expectedRevision: "a".repeat(64),
    };
    await api.saveProviderModel(input);
    expect(invoke).toHaveBeenCalledWith("agent_provider_settings", {
      request: { op: "provider.model.save", input },
    });
    const listener = vi.fn();
    window.addEventListener(api.MODEL_SETTINGS_CHANGED, listener);
    api.notifyModelSettingsChanged();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(api.MODEL_SETTINGS_CHANGED, listener);
  });
});
