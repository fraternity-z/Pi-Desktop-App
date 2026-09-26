import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelProviderLogin,
  getProviderLogin,
  getProviderSettings,
  logoutProvider,
  notifyModelSettingsChanged,
  openProviderLogin,
  replyProviderLogin,
  saveProviderModel,
  setDefaultProviderModel,
  startProviderLogin,
  type ProviderLogin,
  type ProviderModelInput,
  type ProviderSnapshot,
} from "../ipc/providers";

export function formatProviderError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return "无法连接 Pi 模型设置，请确认桌面运行时已就绪后重新加载。";
}

export function useProviderSettings() {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [login, setLogin] = useState<ProviderLogin | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const snapshotVersion = useRef(0);
  const interactionVersion = useRef(0);
  const pending = useRef(false);
  const loginRef = useRef<ProviderLogin | null>(null);

  const updateLogin = useCallback((value: ProviderLogin) => {
    loginRef.current = value;
    setLogin(value);
  }, []);
  const load = useCallback(async (refresh = false) => {
    const version = ++snapshotVersion.current;
    const result = await getProviderSettings(refresh);
    if (mounted.current && version === snapshotVersion.current)
      setSnapshot(result);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const current = ++generation.current;
    void load()
      .catch((cause) => {
        if (generation.current === current)
          setError(formatProviderError(cause));
      })
      .finally(() => {
        if (generation.current === current) setBusy(false);
      });
    return () => {
      mounted.current = false;
      generation.current++;
      snapshotVersion.current++;
      interactionVersion.current++;
      if (loginRef.current?.status === "pending")
        void cancelProviderLogin(loginRef.current.id).catch(() => undefined);
    };
  }, [load]);

  useEffect(() => {
    if (!login || login.status !== "pending") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = interactionVersion.current;
      try {
        const next = await getProviderLogin(login.id);
        if (stopped || version !== interactionVersion.current) return;
        updateLogin(next);
        if (next.status !== "pending") {
          if (next.status === "success") {
            setStatus("账户已连接，可以选择默认模型。");
            notifyModelSettingsChanged();
            await load();
          }
          return;
        }
      } catch (cause) {
        if (!stopped && version === interactionVersion.current)
          setError(formatProviderError(cause));
      } finally {
        if (!stopped && loginRef.current?.status === "pending")
          timer = setTimeout(() => void poll(), 1000);
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [login?.id, login?.status, load, updateLogin]);

  async function perform(
    operation: (isCurrent: () => boolean) => Promise<void>,
    message?: string,
    reload = false,
  ): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true;
    const current = generation.current;
    const isCurrent = () => mounted.current && current === generation.current;
    interactionVersion.current++;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await operation(isCurrent);
      if (!isCurrent()) return false;
      if (reload) {
        notifyModelSettingsChanged();
        await load();
      }
      if (!isCurrent()) return false;
      if (message) setStatus(message);
      return true;
    } catch (cause) {
      if (mounted.current && current === generation.current)
        setError(formatProviderError(cause));
      return false;
    } finally {
      pending.current = false;
      if (mounted.current && current === generation.current) setBusy(false);
    }
  }

  return {
    snapshot,
    login,
    busy,
    error,
    status,
    refresh: () =>
      perform(async (isCurrent) => {
        await load(true);
        if (isCurrent()) notifyModelSettingsChanged();
      }, "模型目录已刷新。"),
    startLogin: (provider: string) =>
      perform(async (isCurrent) => {
        const result = await startProviderLogin(provider);
        if (!isCurrent()) {
          await cancelProviderLogin(result.id);
          return;
        }
        updateLogin(result);
      }),
    reply: (promptId: string, value: string) =>
      perform(async (isCurrent) => {
        if (loginRef.current) {
          const result = await replyProviderLogin(
            loginRef.current.id,
            promptId,
            value,
          );
          if (isCurrent()) updateLogin(result);
        }
      }),
    cancelLogin: () =>
      perform(async (isCurrent) => {
        if (loginRef.current) {
          const result = await cancelProviderLogin(loginRef.current.id);
          if (isCurrent()) updateLogin(result);
        }
      }),
    openLogin: () =>
      perform(async () => {
        if (loginRef.current) await openProviderLogin(loginRef.current.id);
      }),
    logout: (provider: string) =>
      perform(
        () => logoutProvider(provider),
        "已移除 Pi 保存的认证；环境变量与模型配置保持不变。",
        true,
      ),
    saveModel: (input: ProviderModelInput) =>
      perform(
        () => saveProviderModel(input),
        "模型已保存到 Pi 配置，可选择为默认模型。",
        true,
      ),
    setDefault: (provider: string, model: string) =>
      perform(
        () => setDefaultProviderModel(provider, model),
        "默认模型已保存，将用于新会话；现有会话保持不变。",
        true,
      ),
  };
}

export type ProviderSettingsController = ReturnType<typeof useProviderSettings>;
