import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import type { ReactElement } from "react";

import appMetadata from "../../package.json";
import type { UpdateCheckResult } from "../ipc/update";
import { useAppUpdate, type AppUpdatePhase } from "../stores/useAppUpdate";
import { SettingsSection } from "./SettingsControls";

export const PI_DESKTOP_PROJECT_URL = "https://github.com/fraternity-z/Pi-Desktop-App";
export const PI_DESKTOP_FEEDBACK_URL = `${PI_DESKTOP_PROJECT_URL}/issues`;
export const PI_DESKTOP_RELEASES_URL = `${PI_DESKTOP_PROJECT_URL}/releases`;

export function AboutSettings(): ReactElement {
  const update = useAppUpdate();

  return (
    <SettingsSection label="Pi Desktop">
      <div className="about-settings">
        <div className="about-settings-identity">
          <span className="about-settings-mark" aria-hidden="true">
            <Info size={22} />
          </span>
          <div>
            <strong>Pi Desktop</strong>
            <span>版本 {appMetadata.version}</span>
          </div>
        </div>
        <p className="about-settings-copy">
          使用本机已安装的 Pi 运行时，在桌面端管理项目、会话和扩展。
        </p>
        <div className="about-settings-options">
          <a
            className="about-settings-option"
            href={PI_DESKTOP_FEEDBACK_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="反馈"
          >
            <span className="about-settings-option-icon" aria-hidden="true">
              <MessageSquare size={18} />
            </span>
            <span className="about-settings-option-copy">
              <strong>反馈</strong>
              <small>在 GitHub Issues 提交问题或建议</small>
            </span>
            <ExternalLink size={16} aria-hidden="true" />
          </a>
          <a
            className="about-settings-option"
            href={PI_DESKTOP_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="检查更新"
            aria-disabled={update.phase === "checking"}
            data-update-checking={update.phase === "checking" || undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              void update.check();
            }}
          >
            <span className="about-settings-option-icon" aria-hidden="true">
              {update.phase === "checking" ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <RefreshCw size={18} />
              )}
            </span>
            <span className="about-settings-option-copy">
              <strong>检查更新</strong>
              <small>
                {update.phase === "checking"
                  ? "正在检查 GitHub 最新版本"
                  : "检查 GitHub Releases 中的最新版本"}
              </small>
            </span>
            {update.phase === "checking" ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <ExternalLink size={16} aria-hidden="true" />
            )}
          </a>
        </div>
        <UpdateStatus phase={update.phase} result={update.result} error={update.error} />
        <ProjectLink />
      </div>
    </SettingsSection>
  );
}

interface UpdateStatusProps {
  phase: AppUpdatePhase;
  result: UpdateCheckResult | null;
  error: string | null;
}

function UpdateStatus({ phase, result, error }: UpdateStatusProps): ReactElement | null {
  if (phase === "idle") return null;
  if (phase === "checking") {
    return (
      <div className="about-settings-update-status" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={15} aria-hidden="true" />
        <span>正在检查更新…</span>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="about-settings-update-status" data-kind="error" role="alert">
        <AlertCircle size={15} aria-hidden="true" />
        <div className="about-settings-update-status-copy">
          <span>当前版本：{appMetadata.version}</span>
          <strong>检查更新失败：{error || "更新服务暂不可用"}</strong>
        </div>
      </div>
    );
  }
  if (!result) return null;

  return (
    <div
      className="about-settings-update-status"
      data-kind={result.updateAvailable ? "available" : "current"}
      role="status"
      aria-live="polite"
    >
      <CheckCircle2 size={15} aria-hidden="true" />
      <div className="about-settings-update-status-copy">
        <div className="about-settings-update-versions">
          <span>当前版本：{result.currentVersion}</span>
          <span>最新版本：{result.latestVersion}</span>
        </div>
        <strong>{result.updateAvailable ? "有新版本可用" : "已是最新版本"}</strong>
        {result.updateAvailable && (
          <div className="about-settings-update-links">
            <a href={result.releaseUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" />
              查看 GitHub 发布页面
            </a>
            {result.downloadUrl && (
              <a href={result.downloadUrl} target="_blank" rel="noreferrer">
                <Download size={13} aria-hidden="true" />
                下载更新
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectLink(): ReactElement {
  return (
    <div className="about-settings-project">
      <span>项目地址</span>
      <a
        href={PI_DESKTOP_PROJECT_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="项目地址"
      >
        <span>fraternity-z/Pi-Desktop-App</span>
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    </div>
  );
}
