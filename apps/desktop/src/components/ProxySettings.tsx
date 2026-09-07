import { useProxySettings } from "../stores/useProxySettings";
import type { ProxyMode } from "../ipc/proxy";
import {
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "./SettingsControls";

export function ProxySettings() {
  const controller = useProxySettings();
  const { draft, busy, error, status, dirty, validationError } = controller;
  return (
    <div className="proxy-settings">
      <div className="shortcut-toolbar">
        <p className="settings-row-description">分别配置 AI 与应用网络连接。</p>
        <div className="prompt-editor-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void controller.refresh()}
          >
            重新加载
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !dirty || Boolean(validationError)}
            onClick={() => void controller.save()}
          >
            {busy ? "处理中…" : "保存"}
          </button>
        </div>
      </div>
      {(["ai", "app"] as const).map((scope) => {
        const label = scope === "ai" ? "AI 代理" : "应用代理";
        const endpoint = draft[scope];
        return (
          <SettingsSection key={scope} label={label}>
            <SettingsRow
              title="模式"
              description={
                scope === "ai"
                  ? "用于模型 API 及 Pi 网络请求。环境模式读取 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY；保存变更会重启 Agent 连接并中断当前生成。"
                  : "用于更新检查与内置浏览器。更新检查保存后生效；浏览器代理重启应用后生效。外部浏览器和 Git 使用自身设置。"
              }
              last={endpoint.mode !== "custom"}
              control={
                <SettingsSelect
                  label={`${label}模式`}
                  value={endpoint.mode}
                  disabled={busy}
                  options={[
                    {
                      value: "system",
                      label: scope === "ai" ? "环境变量" : "系统 / 环境变量",
                    },
                    { value: "direct", label: "直连（不使用代理）" },
                    { value: "custom", label: "自定义" },
                  ]}
                  onChange={(mode) =>
                    controller.setDraft({
                      ...draft,
                      [scope]: {
                        mode: mode as ProxyMode,
                        url: "",
                        noProxy: "",
                      },
                    })
                  }
                />
              }
            />
            {endpoint.mode === "custom" && (
              <div className="proxy-fields">
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
                    onChange={(event) =>
                      controller.setDraft({
                        ...draft,
                        [scope]: { ...endpoint, url: event.target.value },
                      })
                    }
                  />
                </label>
                {scope === "ai" && (
                  <label>
                    绕过代理
                    <input
                      type="text"
                      value={endpoint.noProxy}
                      placeholder="localhost,127.0.0.1,.example.com"
                      disabled={busy}
                      maxLength={2048}
                      onChange={(event) =>
                        controller.setDraft({
                          ...draft,
                          ai: { ...endpoint, noProxy: event.target.value },
                        })
                      }
                    />
                  </label>
                )}
                <p className="settings-row-description">
                  {scope === "ai"
                    ? "支持 HTTP / HTTPS 代理。"
                    : "支持 HTTP 代理。"}
                  请使用无认证的本地代理地址。
                </p>
              </div>
            )}
          </SettingsSection>
        );
      })}
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
