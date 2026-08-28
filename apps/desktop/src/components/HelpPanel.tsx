import {
  ArrowLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Info,
  MessageSquare,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

import appMetadata from "../../package.json";

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

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      setView("menu");
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
  }, [onClose, open]);

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
              >
                <span className="help-panel-option-icon" aria-hidden="true">
                  <RefreshCw size={18} />
                </span>
                <span className="help-panel-option-copy">
                  <strong>检查更新</strong>
                  <small>打开 GitHub Releases 查看最新版本</small>
                </span>
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
            <ProjectLink />
          </div>
        )}
      </section>
    </div>,
    document.body,
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
