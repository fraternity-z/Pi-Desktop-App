import { DEFAULT_GENERAL_SETTINGS } from "../ipc/general";
import { useGeneralSettings } from "../stores/useGeneralSettings";
import { GeneralSettingsRow } from "./GeneralSettingsControls";
import { ProxySettings } from "./ProxySettings";
import { SettingsToggle } from "./SettingsControls";

export function GeneralSystemSettings() {
  const controller = useGeneralSettings();
  const { state, busy, error, status } = controller;
  const settings = state?.settings ?? DEFAULT_GENERAL_SETTINGS;
  return (
    <div className="general-system-settings" aria-busy={busy}>
      <section className="general-system-section" aria-label="网络">
        <h2>网络</h2>
        <ProxySettings />
        <GeneralSettingsRow
          title="网络宽松模式"
          help="允许 Pi 的全局 HTTP 客户端连接你配置的本机或局域网服务，允许明文 HTTP，并容忍 TUN 代理的 fake-IP。关闭后仅允许公网 HTTPS；不会跳过 TLS 证书校验。更改会重连 Agent 并中断当前生成。Git、浏览器及自行联网的扩展不受此设置控制。"
        >
          <SettingsToggle
            label="网络宽松模式"
            checked={settings.relaxedNetwork}
            disabled={busy || !state}
            onChange={(relaxedNetwork) =>
              void controller.update({ relaxedNetwork })
            }
          />
        </GeneralSettingsRow>
        {settings.relaxedNetwork && (
          <p className="general-settings-note">
            宽松模式下，明文 HTTP 可能暴露请求内容或凭据，请仅连接可信服务。
          </p>
        )}
      </section>
      <section className="general-system-section" aria-label="电源">
        <h2>电源</h2>
        <GeneralSettingsRow
          title="保持电脑唤醒"
          help="Pi Desktop 运行期间阻止系统自动进入空闲休眠。最小化或隐藏到托盘后继续生效，退出应用后恢复系统策略。不阻止主动休眠、合盖或按电源键。"
        >
          <SettingsToggle
            label="保持电脑唤醒"
            checked={settings.keepAwakeWhileRunning}
            disabled={busy || !state?.powerSupported}
            onChange={(keepAwakeWhileRunning) =>
              void controller.update({ keepAwakeWhileRunning })
            }
          />
        </GeneralSettingsRow>
        <GeneralSettingsRow
          title="阻止屏幕休眠"
          help="Pi Desktop 运行期间阻止屏幕因空闲自动关闭，并维持系统唤醒。退出应用后释放；不改变系统的永久电源计划，也不阻止手动锁屏。开启可能增加耗电。"
        >
          <SettingsToggle
            label="阻止屏幕休眠"
            checked={settings.preventScreenSleep}
            disabled={busy || !state?.powerSupported}
            onChange={(preventScreenSleep) =>
              void controller.update({ preventScreenSleep })
            }
          />
        </GeneralSettingsRow>
        {state && !state.powerSupported && (
          <p className="general-settings-note">
            当前平台暂不支持应用内电源控制，请使用系统电源设置。
          </p>
        )}
        {state?.powerError && (
          <p className="settings-runtime-error" role="alert">
            已保存的电源设置未能应用。请关闭相关开关后重试，或重启应用检查系统电源策略。
          </p>
        )}
      </section>
      {(error || status) && (
        <div className="general-settings-feedback">
          {error && (
            <>
              <p className="settings-runtime-error" role="alert">
                {error}
              </p>
              <div className="general-settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void controller.refresh()}
                >
                  重新加载常规设置
                </button>
                {!state && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void controller.reset()}
                  >
                    恢复默认常规设置
                  </button>
                )}
              </div>
            </>
          )}
          {status && (
            <p className="general-settings-note" role="status">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
