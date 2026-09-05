import { AlertTriangle, Check, MessagesSquare, Power, Radio, RefreshCw, Terminal } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import appIconUrl from "../../../../src-tauri/icons/128x128@2x.png";
import { StartupWordmark } from "./StartupWordmark";

export type StartupStage = "runtime" | "events" | "catalog";

export const STARTUP_MINIMUM_DURATION_MS = 0;
export const STARTUP_EXIT_DURATION_MS = 180;
export const STARTUP_SLOW_NOTICE_MS = 8_000;

const STARTUP_STEPS = [
  { stage: "runtime", label: "本机运行时", icon: Terminal },
  { stage: "events", label: "事件连接", icon: Radio },
  { stage: "catalog", label: "工作区与会话", icon: MessagesSquare },
] as const;

const STAGE_LABELS: Record<StartupStage, string> = {
  runtime: "正在连接本机 Pi 运行时",
  events: "正在准备会话事件通道",
  catalog: "正在同步工作区与会话数据",
};

interface StartupOverlayProps {
  ready: boolean;
  stage: StartupStage;
  error: string | null;
  onRetry: () => void;
  onExit: () => void;
  onFinished: () => void;
  minimumDurationMs?: number;
  exitDurationMs?: number;
}

export function StartupOverlay({
  ready,
  stage,
  error,
  onRetry,
  onExit,
  onFinished,
  minimumDurationMs = STARTUP_MINIMUM_DURATION_MS,
  exitDurationMs = STARTUP_EXIT_DURATION_MS,
}: StartupOverlayProps) {
  const [leaving, setLeaving] = useState(false);
  const [waitingTooLong, setWaitingTooLong] = useState(false);
  const mountedAt = useRef(Date.now());
  const overlay = useRef<HTMLElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const failed = error !== null;
  const complete = ready && !failed;
  const activeStep = STARTUP_STEPS.findIndex((step) => step.stage === stage);
  const statusLabel = complete ? "准备就绪" : STAGE_LABELS[stage];

  useEffect(() => {
    setWaitingTooLong(false);
    if (ready || failed) return;
    const noticeTimer = window.setTimeout(() => setWaitingTooLong(true), STARTUP_SLOW_NOTICE_MS);
    return () => window.clearTimeout(noticeTimer);
  }, [failed, ready]);

  useEffect(() => {
    if (error === null) {
      overlay.current?.focus({ preventScroll: true });
      return;
    }
    const focusTimer = window.setTimeout(() => retryButton.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [error]);

  useEffect(() => {
    if (!ready || error !== null) {
      setLeaving(false);
      return;
    }

    let finishTimer: number | null = null;
    const remainingDuration = Math.max(0, minimumDurationMs - (Date.now() - mountedAt.current));
    const leaveTimer = window.setTimeout(() => {
      setLeaving(true);
      const transitionDuration = reduceMotionEnabled() ? 0 : exitDurationMs;
      finishTimer = window.setTimeout(onFinished, transitionDuration);
    }, remainingDuration);

    return () => {
      window.clearTimeout(leaveTimer);
      if (finishTimer !== null) window.clearTimeout(finishTimer);
    };
  }, [error, exitDurationMs, minimumDurationMs, onFinished, ready]);

  return (
    <section
      ref={overlay}
      className="startup-overlay"
      style={{ "--startup-exit-duration": `${exitDurationMs}ms` } as CSSProperties}
      data-state={leaving ? "leaving" : failed ? "error" : "loading"}
      data-ready={complete}
      role="dialog"
      aria-modal="true"
      aria-label="PI Desktop 启动界面"
      tabIndex={-1}
    >
      <div className="startup-overlay-content">
        <div className="startup-brand">
          <div className="startup-brand-emblem" aria-hidden="true">
            <span className="startup-brand-icon">
              <img src={appIconUrl} alt="" width={40} height={40} />
            </span>
          </div>
          <h1 className="startup-brand-wordmark">
            <span className="sr-only">PI Desktop</span>
            <StartupWordmark />
          </h1>
        </div>

        <ol className="startup-steps" aria-label="启动进度">
          {STARTUP_STEPS.map(({ stage: step, label, icon: Icon }, index) => {
            const state = complete || index < activeStep
              ? "complete"
              : index === activeStep ? failed ? "error" : "active" : "pending";
            return (
              <li key={step} data-state={state} aria-current={state === "active" ? "step" : undefined}>
                <span className="startup-step-track" aria-hidden="true" />
                <span className="startup-step-label">
                  {state === "complete" ? <Check size={14} aria-hidden="true" />
                    : state === "error" ? <AlertTriangle size={14} aria-hidden="true" />
                      : <Icon size={14} aria-hidden="true" />}
                  <span>{label}</span>
                </span>
                <span className="sr-only">
                  {state === "complete" ? "已完成" : state === "active" ? "进行中"
                    : state === "error" ? "失败" : "等待中"}
                </span>
              </li>
            );
          })}
        </ol>

        {failed ? (
          <div
            className="startup-error"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <AlertTriangle size={20} strokeWidth={1.8} aria-hidden="true" />
            <div className="startup-error-copy">
              <h2>PI Desktop 启动失败</h2>
              <p>{error}</p>
            </div>
            <div className="startup-error-actions">
              <button ref={retryButton} className="primary-button" type="button" onClick={onRetry}>
                <RefreshCw size={16} aria-hidden="true" />
                重试启动
              </button>
              <button className="secondary-button" type="button" onClick={onExit}>
                <Power size={16} aria-hidden="true" />
                退出应用
              </button>
            </div>
          </div>
        ) : (
          <div
            className="startup-progress"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={statusLabel}
          >
            <p key={statusLabel} className="startup-status-label">{statusLabel}</p>
            <p className="startup-wait-notice">
              {waitingTooLong && !complete ? "启动耗时较长，仍在等待本机响应" : "\u00a0"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function reduceMotionEnabled(): boolean {
  return (
    document.documentElement.dataset.reduceMotion === "true" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
