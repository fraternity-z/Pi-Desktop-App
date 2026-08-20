import { CircleCheck, CircleX, Folder, MessageSquare, PanelLeftClose, Radio } from "lucide-react";

import type { RuntimeStatusController } from "../stores/useRuntimeStatus";

interface AppSidebarProps {
  open: boolean;
  workspacePath: string;
  workspaceName: string;
  sessionId: string | null;
  runtime: RuntimeStatusController;
  onClose: () => void;
}

export function AppSidebar({
  open,
  workspacePath,
  workspaceName,
  sessionId,
  runtime,
  onClose,
}: AppSidebarProps) {
  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";

  return (
    <aside className={`app-sidebar${open ? " app-sidebar-open" : ""}`} aria-label="工作区导航">
      <div className="sidebar-brand-row">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">Pi</span>
          <span>Pi Desktop</span>
        </div>
        <button
          className="icon-button sidebar-close-button"
          type="button"
          onClick={onClose}
          aria-label="关闭侧边栏"
          title="关闭侧边栏"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <section className="sidebar-section">
          <h2 className="sidebar-section-title">工作区</h2>
          {workspacePath ? (
            <div className="sidebar-entry sidebar-entry-active" aria-current="page">
              <Folder size={17} />
              <span className="sidebar-entry-copy">
                <strong title={workspacePath}>{workspaceName}</strong>
                <small title={workspacePath}>{workspacePath}</small>
              </span>
            </div>
          ) : (
            <p className="sidebar-empty">连接工作区后会显示在这里</p>
          )}
        </section>

        <section className="sidebar-section">
          <h2 className="sidebar-section-title">当前会话</h2>
          {sessionId ? (
            <div className="sidebar-entry">
              <MessageSquare size={17} />
              <span className="sidebar-entry-copy">
                <strong>会话已连接</strong>
                <small title={sessionId}>{sessionId}</small>
              </span>
            </div>
          ) : (
            <p className="sidebar-empty">尚未创建会话</p>
          )}
        </section>
      </div>

      <footer className="sidebar-footer">
        <div className={`runtime-summary${runtimeReady ? " runtime-summary-ready" : ""}`}>
          {runtimeReady ? <CircleCheck size={17} /> : <CircleX size={17} />}
          <span>
            <strong>{runtimeReady ? "运行时已就绪" : "运行时未就绪"}</strong>
            <small>
              {runtime.phase === "loading"
                ? "正在检测"
                : runtimeReady
                  ? runtime.status.runtimeSource ?? "系统运行时"
                  : "可在主区域重试"}
            </small>
          </span>
          <Radio size={14} aria-hidden="true" />
        </div>
      </footer>
    </aside>
  );
}
