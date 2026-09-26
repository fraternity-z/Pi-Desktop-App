import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../ipc/providers";
import {
  formatProviderError,
  useProviderSettings,
} from "./useProviderSettings";

vi.mock("../ipc/providers", () => ({
  getProviderSettings: vi.fn(),
  getProviderLogin: vi.fn(),
  startProviderLogin: vi.fn(),
  cancelProviderLogin: vi.fn(),
  replyProviderLogin: vi.fn(),
  openProviderLogin: vi.fn(),
  saveProviderModel: vi.fn(),
  setDefaultProviderModel: vi.fn(),
  logoutProvider: vi.fn(),
  notifyModelSettingsChanged: vi.fn(),
}));
const snapshot: api.ProviderSnapshot = {
  providers: [],
  defaultModel: null,
  revision: "revision",
  warning: null,
};
const login: api.ProviderLogin = {
  id: "login-1",
  provider: "example",
  status: "pending",
  message: "Waiting",
  url: null,
  userCode: null,
  prompt: null,
  errorCode: null,
};
const input: api.ProviderModelInput = {
  provider: "example",
  baseUrl: "https://example.com/v1",
  api: "openai-completions",
  modelId: "model",
  modelName: "Model",
  reasoning: false,
  contextWindow: 1000,
  maxTokens: 100,
  expectedRevision: "revision",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function ready() {
  const hook = renderHook(useProviderSettings);
  await waitFor(() => expect(hook.result.current.busy).toBe(false));
  return hook;
}

describe("provider settings state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getProviderSettings).mockResolvedValue(snapshot);
    vi.mocked(api.startProviderLogin).mockResolvedValue(login);
    vi.mocked(api.getProviderLogin).mockResolvedValue(login);
    vi.mocked(api.cancelProviderLogin).mockResolvedValue({
      ...login,
      status: "cancelled",
    });
    vi.mocked(api.replyProviderLogin).mockResolvedValue(login);
  });
  afterEach(() => vi.useRealTimers());

  it("loads in StrictMode and refreshes the composer catalog", async () => {
    const { result } = renderHook(useProviderSettings, { wrapper: StrictMode });
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    await act(async () => expect(await result.current.refresh()).toBe(true));
    expect(api.getProviderSettings).toHaveBeenLastCalledWith(true);
    expect(api.notifyModelSettingsChanged).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("模型目录已刷新。");
  });

  it("surfaces stable errors but never displays raw exceptions", async () => {
    vi.mocked(api.getProviderSettings).mockRejectedValueOnce(
      Error("private-credential"),
    );
    const { result } = await ready();
    expect(result.current.error).toContain("无法连接");
    expect(result.current.error).not.toContain("private-credential");
    vi.mocked(api.getProviderSettings).mockRejectedValueOnce({
      code: "BRIDGE_OFFLINE",
      message: "重启运行时",
    });
    await act(async () => expect(await result.current.refresh()).toBe(false));
    expect(result.current.error).toBe("BRIDGE_OFFLINE: 重启运行时");
    for (const error of [
      null,
      undefined,
      "secret",
      {},
      { code: 1, message: "secret" },
    ])
      expect(formatProviderError(error)).toContain("无法连接");
  });

  it("saves models, defaults and logout through IPC then reloads", async () => {
    const { result } = await ready();
    await act(async () =>
      expect(await result.current.saveModel(input)).toBe(true),
    );
    expect(api.saveProviderModel).toHaveBeenCalledWith(input);
    await act(async () =>
      expect(await result.current.setDefault("example", "model")).toBe(true),
    );
    expect(api.setDefaultProviderModel).toHaveBeenCalledWith(
      "example",
      "model",
    );
    expect(result.current.status).toContain("现有会话保持不变");
    await act(async () =>
      expect(await result.current.logout("example")).toBe(true),
    );
    expect(api.logoutProvider).toHaveBeenCalledWith("example");
    expect(api.notifyModelSettingsChanged).toHaveBeenCalledTimes(3);
    expect(api.getProviderSettings).toHaveBeenCalledTimes(4);
  });

  it("rejects duplicate submissions and clears busy on failure", async () => {
    const { result } = await ready();
    const saving = deferred<void>();
    vi.mocked(api.saveProviderModel).mockReturnValueOnce(saving.promise);
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.saveModel(input);
    });
    await act(async () => expect(await result.current.refresh()).toBe(false));
    expect(api.getProviderSettings).toHaveBeenCalledOnce();
    await act(async () => {
      saving.reject({ code: "CONFLICT", message: "重新加载" });
      expect(await first).toBe(false);
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe("CONFLICT: 重新加载");
  });

  it("polls official login, opens explicitly, replies and refreshes on success", async () => {
    const { result } = await ready();
    vi.useFakeTimers();
    await act(async () => {
      await result.current.startLogin("example");
    });
    expect(api.startProviderLogin).toHaveBeenCalledWith("example");
    await act(async () => {
      await result.current.openLogin();
    });
    expect(api.openProviderLogin).toHaveBeenCalledWith("login-1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(api.getProviderLogin).toHaveBeenCalledWith("login-1");
    await act(async () => {
      await result.current.reply("prompt-1", "code");
    });
    expect(api.replyProviderLogin).toHaveBeenCalledWith(
      "login-1",
      "prompt-1",
      "code",
    );
    vi.mocked(api.getProviderLogin).mockResolvedValueOnce({
      ...login,
      status: "success",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.login?.status).toBe("success");
    expect(result.current.status).toContain("账户已连接");
    expect(api.notifyModelSettingsChanged).toHaveBeenCalledOnce();
    const calls = vi.mocked(api.getProviderLogin).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.getProviderLogin).toHaveBeenCalledTimes(calls);
  });

  it("retries polling after errors and stops on cancellation", async () => {
    const { result } = await ready();
    vi.useFakeTimers();
    await act(async () => {
      await result.current.startLogin("example");
    });
    vi.mocked(api.getProviderLogin).mockRejectedValueOnce({
      code: "TIMEOUT",
      message: "稍后重试",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.error).toContain("TIMEOUT");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.getProviderLogin).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.cancelLogin();
    });
    expect(result.current.login?.status).toBe("cancelled");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(api.getProviderLogin).toHaveBeenCalledTimes(2);
  });

  it("ignores polling replies from before a user cancellation", async () => {
    const { result } = await ready();
    vi.useFakeTimers();
    const poll = deferred<api.ProviderLogin>();
    vi.mocked(api.getProviderLogin).mockReturnValueOnce(poll.promise);
    await act(async () => {
      await result.current.startLogin("example");
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      await result.current.cancelLogin();
    });
    await act(async () => {
      poll.resolve({ ...login, status: "success" });
    });
    expect(result.current.login?.status).toBe("cancelled");
    expect(api.notifyModelSettingsChanged).not.toHaveBeenCalled();
  });

  it("cancels pending and late-started logins when unmounted", async () => {
    const first = await ready();
    await act(async () => {
      await first.result.current.startLogin("example");
    });
    first.unmount();
    expect(api.cancelProviderLogin).toHaveBeenCalledWith("login-1");
    const second = await ready();
    const starting = deferred<api.ProviderLogin>();
    vi.mocked(api.startProviderLogin).mockReturnValueOnce(starting.promise);
    let promise!: Promise<boolean>;
    act(() => {
      promise = second.result.current.startLogin("example");
    });
    second.unmount();
    await act(async () => {
      starting.resolve({ ...login, id: "late-login" });
      expect(await promise).toBe(false);
    });
    expect(api.cancelProviderLogin).toHaveBeenCalledWith("late-login");
  });

  it("ignores load and mutation results after unmount", async () => {
    const load = deferred<api.ProviderSnapshot>();
    vi.mocked(api.getProviderSettings).mockReturnValueOnce(load.promise);
    const loading = renderHook(useProviderSettings);
    loading.unmount();
    await act(async () => {
      load.resolve(snapshot);
    });
    const { result, unmount } = await ready();
    const saving = deferred<void>();
    vi.mocked(api.saveProviderModel).mockReturnValueOnce(saving.promise);
    let promise!: Promise<boolean>;
    act(() => {
      promise = result.current.saveModel(input);
    });
    unmount();
    await act(async () => {
      saving.resolve();
      expect(await promise).toBe(false);
    });
    expect(api.notifyModelSettingsChanged).not.toHaveBeenCalled();
  });

  it("handles no active login and terminal failures without polling", async () => {
    const { result } = await ready();
    await act(async () => {
      await result.current.openLogin();
      await result.current.cancelLogin();
      await result.current.reply("p", "v");
    });
    expect(api.openProviderLogin).not.toHaveBeenCalled();
    expect(api.replyProviderLogin).not.toHaveBeenCalled();
    vi.useFakeTimers();
    vi.mocked(api.getProviderLogin).mockResolvedValueOnce({
      ...login,
      status: "error",
      errorCode: "LOGIN_FAILED",
    });
    await act(async () => {
      await result.current.startLogin("example");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.login?.status).toBe("error");
    expect(api.notifyModelSettingsChanged).not.toHaveBeenCalled();
  });
});
