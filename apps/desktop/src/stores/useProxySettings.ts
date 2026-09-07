import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_PROXY_SETTINGS,
  getProxySettings,
  proxyValidationError,
  updateProxySettings,
  type ProxySettings,
} from "../ipc/proxy";

export function useProxySettings() {
  const [saved, setSaved] = useState<ProxySettings | null>(null);
  const [draft, setDraft] = useState(DEFAULT_PROXY_SETTINGS);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const requestId = useRef(0);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const request = ++requestId.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const settings = await getProxySettings();
      if (request === requestId.current) {
        setSaved(settings);
        setDraft(settings);
      }
    } catch {
      if (request === requestId.current)
        setError("无法读取代理设置。可重新加载，或选择模式后保存以修复配置。");
    } finally {
      if (request === requestId.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
      pending.current = false;
    };
  }, [refresh]);
  const validationError = proxyValidationError(draft);
  async function save() {
    if (pending.current || validationError) return;
    pending.current = true;
    const request = ++requestId.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const settings = await updateProxySettings(draft);
      if (request === requestId.current) {
        setSaved(settings);
        setDraft(settings);
        setStatus(
          "代理设置已保存。AI 代理变更会重连；更新检查立即生效，内置浏览器请重启应用。若正在修复损坏的配置，也请重启应用。",
        );
      }
    } catch (cause) {
      if (request === requestId.current)
        setError(
          cause &&
            typeof cause === "object" &&
            "code" in cause &&
            cause.code === "BRIDGE_STARTING"
            ? "运行时正在启动，请稍后重试保存。"
            : "代理设置保存失败，请检查配置目录和运行时状态后重试。",
        );
    } finally {
      if (request === requestId.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return {
    draft,
    busy,
    error,
    status,
    validationError,
    refresh,
    save,
    dirty: JSON.stringify(draft) !== JSON.stringify(saved),
    setDraft: (value: ProxySettings) => {
      setDraft(value);
      setStatus(null);
    },
  };
}
