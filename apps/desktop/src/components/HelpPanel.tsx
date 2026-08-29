import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  Info,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

import appMetadata from "../../package.json";
import type { UpdateCheckResult } from "../ipc/update";
import { useAppUpdate, type AppUpdatePhase } from "../stores/useAppUpdate";

export const PI_DESKTOP_PROJECT_URL = "https://github.com/fraternity-z/Pi-Desktop-App";
export const PI_DESKTOP_FEEDBACK_URL = `${PI_DESKTOP_PROJECT_URL}/issues`;
export const PI_DESKTOP_RELEASES_URL = `${PI_DESKTOP_PROJECT_URL}/releases`;

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

type HelpPanelView = "menu" | "about";

export function HelpPanel({ open, onClose }: HelpPanelProps): ReactElement | null {
  const [view, setView] = useState<HelpPanelView>("menu");
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const update = useAppUpdate();

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      setView("menu");
      update.reset();
      return undefined;
    }

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusId = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('button:not(:disabled), a[href]')
        ?.focus();
    }, 0);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      window.clearTimeout(focusId);
      document.removeEventListener("keydown", closeOnEscape);
      previous?.focus();
    };
  }, [onClose, open, update.reset]);

  if (!open || typeof document === "undefined") return null;

  const about = view === "about";

  return createPortal(
    <div
      className="help-panel-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-panel-header">
          <div className="help-panel-heading">
            {about && (
              <button
                className="help-panel-back"
                type="button"
                aria-label="返回帮助"
                title="返回帮助"
                onClick={() => setView("menu")}
              >
                <ArrowLeft size={17} aria-hidden="true" />
              </button>
            )}
            <div>
              <h2 id={titleId}>{about ? "关于 Pi Desktop" : "帮助与支持"}</h2>
              <p>{about ? "一个简洁、原生的 Pi 桌面工作台。" : "了解应用、反馈问题或查看最新版本。"}</p>
            </div>
          </div>
          <button
            className="icon-button help-panel-close"
            type="button"
            aria-label="关闭帮助"
            title="关闭"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        {about ? (
          <div className="help-panel-body help-panel-about">
            <div className="help-panel-about-identity">
              <span className="help-panel-about-mark" aria-hidden="true">
                <CircleHelp size={22} />
              </span>
              <div>
                <strong>Pi Desktop</strong>
                <span>版本 {appMetadata.version}</span>
              </div>
            </div>
            <p className="help-panel-about-copy">
              使用本机已安装的 Pi 运行时，在桌面端管理项目、会话和扩展。
            </p>
            <ProjectLink />
          </div>
        ) : (
          <div className="help-panel-body">
            <div className="help-panel-options">
              <button
                className="help-panel-option"
                type="button"
                aria-label="关于"
                onClick={() => setView("about")}
              >
                <span className="help-panel-option-icon" aria-hidden="true">
                  <Info size={18} />
                </span>
                <span className="help-panel-option-copy">
                  <strong>关于</strong>
                  <small>查看版本和项目详情</small>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              <a
                className="help-panel-option"
                href={PI_DESKTOP_FEEDBACK_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="反馈"
              >
                <span className="help-panel-option-icon" aria-hidden="true">
                  <MessageSquare size={18} />
                </span>
                <span className="help-panel-option-copy">
                  <strong>反馈</strong>
                  <small>在 GitHub Issues 提交问题或建议</small>
                </span>
                <ExternalLink size={16} aria-hidden="true" />
              </a>
              <a
                className="help-panel-option"
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
                <span className="help-panel-option-icon" aria-hidden="true">
                  {update.phase === "checking" ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <RefreshCw size={18} />
                  )}
                </span>
                <span className="help-panel-option-copy">
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
            <UpdateStatus
              phase={update.phase}
              result={update.result}
              error={update.error}
            />
            <ProjectLink />
          </div>
        )}
      </section>
    </div>,
    document.body,
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
      <div className="help-panel-update-status" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={15} aria-hidden="true" />
        <span>正在检查更新…</span>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="help-panel-update-status" data-kind="error" role="alert">
        <AlertCircle size={15} aria-hidden="true" />
        <div className="help-panel-update-status-copy">
          <span>当前版本：{appMetadata.version}</span>
          <strong>检查更新失败：{error || "更新服务暂不可用"}</strong>
        </div>
      </div>
    );
  }
  if (!result) return null;

  return (
    <div
      className="help-panel-update-status"
      data-kind={result.updateAvailable ? "available" : "current"}
      role="status"
      aria-live="polite"
    >
      <CheckCircle2 size={15} aria-hidden="true" />
      <div className="help-panel-update-status-copy">
        <div className="help-panel-update-versions">
          <span>当前版本：{result.currentVersion}</span>
          <span>最新版本：{result.latestVersion}</span>
        </div>
        <strong>{result.updateAvailable ? "有新版本可用" : "已是最新版本"}</strong>
        {result.updateAvailable && (
          <div className="help-panel-update-links">
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
    <div className="help-panel-project">
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
