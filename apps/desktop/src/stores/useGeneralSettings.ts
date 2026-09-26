import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_GENERAL_SETTINGS,
  getGeneralSettings,
  updateGeneralSettings,
  type GeneralSettings,
  type GeneralSettingsState,
} from "../ipc/general";

export function useGeneralSettings() {
  const [state, setState] = useState<GeneralSettingsState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const requestId = useRef(0);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const request = ++requestId.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const next = await getGeneralSettings();
      if (request === requestId.current) setState(next);
    } catch {
      if (request === requestId.current)
        setError("无法读取常规设置，请重试。损坏的配置可恢复为默认设置。");
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

  async function save(settings: GeneralSettings) {
    if (pending.current) return;
    const request = ++requestId.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const next = await updateGeneralSettings(settings);
      if (request === requestId.current) {
        const networkChanged =
          state?.settings.relaxedNetwork !== next.settings.relaxedNetwork;
        setState(next);
        setStatus(
          networkChanged
            ? "网络策略已保存，Agent 连接将重新建立。若正在修复配置，请重启应用。"
            : "电源设置已保存并生效。",
        );
      }
    } catch (cause) {
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? cause.code
          : null;
      if (request === requestId.current)
        setError(
          code === "BRIDGE_STARTING"
            ? "运行时正在启动，请稍后重试。"
            : code === "POWER_ROLLBACK_FAILED"
              ? "保存失败且系统电源状态未恢复，请重启应用。"
              : "常规设置保存失败，原配置保留。请检查系统电源策略和配置目录后重试。",
        );
    } finally {
      if (request === requestId.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  return {
    state,
    busy,
    error,
    status,
    refresh,
    update: (patch: Partial<Omit<GeneralSettings, "schemaVersion">>) =>
      state && save({ ...state.settings, ...patch }),
    reset: () => save(DEFAULT_GENERAL_SETTINGS),
  };
}
