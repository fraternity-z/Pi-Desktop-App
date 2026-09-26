import { useState } from "react";
import { useProxySettings } from "../stores/useProxySettings";
import type { ProxyEndpoint, ProxyMode } from "../ipc/proxy";
import {
  GeneralSettingsRow,
  ProxyModeControl,
} from "./GeneralSettingsControls";

export function ProxySettings() {
  const controller = useProxySettings();
  const { draft, busy, error, status, dirty, validationError } = controller;
  const [expanded, setExpanded] = useState(false);
  const unified =
    draft.ai.mode === draft.app.mode && draft.ai.url === draft.app.url;
  const separate = !unified || expanded;

  function setMode(mode: ProxyMode, scope?: "ai" | "app") {
    const endpoint = (previous: ProxyEndpoint): ProxyEndpoint =>
      mode === "custom"
        ? { ...previous, mode }
        : { mode, url: "", noProxy: "" };
    if (scope)
      controller.setDraft({ ...draft, [scope]: endpoint(draft[scope]) });
    else {
      const common = endpoint(draft.app);
      controller.setDraft({
        ...draft,
        ai: { ...common, noProxy: mode === "custom" ? draft.ai.noProxy : "" },
        app: common,
      });
    }
  }

  function fields(scope?: "ai" | "app") {
    const endpoint = draft[scope ?? "app"];
    const label =
      scope === "ai" ? "AI 代理" : scope === "app" ? "应用代理" : "代理";
    if (endpoint.mode !== "custom") return null;
    return (
      <div className="general-proxy-fields">
        <label>
          {label}地址
          <input
            type="url"
            autoComplete="off"
            spellCheck={false}
            value={endpoint.url}
            placeholder="http://127.0.0.1:7890"
            disabled={busy}
            maxLength={2048}
            onChange={(event) => {
              const url = event.target.value;
              controller.setDraft(
                scope
                  ? { ...draft, [scope]: { ...endpoint, url } }
                  : {
                      ...draft,
                      ai: { ...draft.ai, url },
                      app: { ...draft.app, url },
                    },
              );
            }}
          />
        </label>
        {scope !== "app" && (
          <label>
            绕过代理（仅 AI）
            <input
              type="text"
              value={draft.ai.noProxy}
              placeholder="localhost,127.0.0.1,.example.com"
              disabled={busy}
              maxLength={2048}
              onChange={(event) =>
                controller.setDraft({
                  ...draft,
                  ai: { ...draft.ai, noProxy: event.target.value },
                })
              }
            />
          </label>
        )}
        <p className="general-settings-note">
          {scope === "ai" ? "支持 HTTP / HTTPS 代理。" : "支持 HTTP 代理。"}
          请使用不含账号、密码的本地代理地址。
        </p>
      </div>
    );
  }
  return (
    <div className="general-proxy-settings">
      <GeneralSettingsRow
        title="代理"
        help="系统模式下，AI 请求读取 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY，应用使用系统或环境代理。直连绕过代理。自定义支持无认证 HTTP 代理；可展开分别配置 AI 与应用。保存 AI 变更会重连并中断当前生成，内置浏览器代理需重启应用。"
      >
        <ProxyModeControl
          label="代理模式"
          value={unified ? draft.app.mode : undefined}
          disabled={busy}
          onChange={(mode) => setMode(mode)}
        />
      </GeneralSettingsRow>
      {!separate && fields()}
      {!unified && (
        <p className="general-settings-note">
          AI 与应用当前使用不同代理配置；选择上方模式会统一配置。
        </p>
      )}
      <details
        className="general-proxy-details"
        open={separate}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>分别配置 AI 与应用</summary>
        {(["ai", "app"] as const).map((scope) => (
          <div key={scope}>
            <GeneralSettingsRow
              title={scope === "ai" ? "AI 代理" : "应用代理"}
              help={
                scope === "ai"
                  ? "仅控制 Pi 全局 HTTP 客户端；系统模式继承环境变量，保存后重连 Agent。"
                  : "用于更新检查与内置浏览器；更新检查下次请求生效，浏览器需重启应用。外部浏览器和 Git 使用自身设置。"
              }
            >
              <ProxyModeControl
                label={`${scope === "ai" ? "AI" : "应用"}代理模式`}
                value={draft[scope].mode}
                disabled={busy}
                onChange={(mode) => setMode(mode, scope)}
              />
            </GeneralSettingsRow>
            {separate && fields(scope)}
          </div>
        ))}
      </details>
      {(dirty || error) && !busy && (
        <p className="general-settings-note">
          保存 AI 代理变更会重连 Agent
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
