import { useProxySettings } from "../stores/useProxySettings";
import type { ProxyMode } from "../ipc/proxy";
import {
  GeneralSettingsRow,
  ProxyModeControl,
} from "./GeneralSettingsControls";

export function ProxySettings() {
  const controller = useProxySettings();
  const { draft, busy, error, status, dirty, validationError } = controller;
  function setMode(mode: ProxyMode) {
    const endpoint =
      mode === "custom"
        ? { ...draft.app, mode, noProxy: "" }
        : { mode, url: "", noProxy: "" };
    controller.setDraft({ ...draft, ai: { ...endpoint }, app: endpoint });
  }

  return (
    <div className="general-proxy-settings">
      <GeneralSettingsRow
        title="代理"
        help="AI 请求、更新检查与内置浏览器共用此设置。系统模式下，AI 请求读取 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY，应用使用系统或环境代理；直连绕过代理；自定义使用同一无认证 HTTP 代理地址。保存变更会重连并中断当前生成，内置浏览器需重启应用。外部浏览器和 Git 使用自身设置。"
      >
        <ProxyModeControl
          label="代理模式"
          value={draft.app.mode}
          disabled={busy}
          onChange={(mode) => setMode(mode)}
        />
      </GeneralSettingsRow>
      {draft.app.mode === "custom" && (
        <div className="general-proxy-fields">
          <label>
            代理地址
            <input
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={draft.app.url}
              placeholder="http://127.0.0.1:7890"
              disabled={busy}
              maxLength={2048}
              onChange={(event) => {
                const endpoint = {
                  ...draft.app,
                  url: event.target.value,
                  noProxy: "",
                };
                controller.setDraft({
                  ...draft,
                  ai: { ...endpoint },
                  app: endpoint,
                });
              }}
            />
          </label>
          <p className="general-settings-note">
            所有内置网络功能共用此地址，支持不含账号、密码的 HTTP 代理。
          </p>
        </div>
      )}
      {(dirty || error) && !busy && (
        <p className="general-settings-note">
          保存代理变更会重连 Agent
          并中断当前生成。内置浏览器代理需重启应用。
        </p>
      )}
      {(dirty || error || busy) && (
        <div className="general-settings-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void controller.refresh()}
          >
            重新加载代理设置
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !dirty || Boolean(validationError)}
            onClick={() => void controller.save()}
          >
            {busy ? "处理中…" : "保存代理设置"}
          </button>
        </div>
      )}
      {(error || validationError) && (
        <p className="settings-runtime-error" role="alert">
          {error || validationError}
        </p>
      )}
      {status && (
        <p className="settings-row-description" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
