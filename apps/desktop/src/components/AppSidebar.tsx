import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Folder,
  MessageSquare,
  PanelLeftClose,
  PenLine,
  Plus,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AgentSessionSummary } from "../ipc/agent";
import type { CatalogPhase, ChatPhase } from "../stores/useChatSession";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";

interface AppSidebarProps {
  open: boolean;
  activeCwd: string;
  activeSessionPath: string | null;
  sessions: AgentSessionSummary[];
  catalogPhase: CatalogPhase;
  phase: ChatPhase;
  runtime: RuntimeStatusController;
  onAddProject: () => void;
  onNewSession: (cwd?: string) => void;
  onSelectSession: (session: AgentSessionSummary) => void;
  onRefresh: () => void;
  onClose: () => void;
}

interface ProjectGroup {
  cwd: string;
  name: string;
  sessions: AgentSessionSummary[];
}

export function AppSidebar({
  open,
  activeCwd,
  activeSessionPath,
  sessions,
  catalogPhase,
  phase,
  runtime,
  onAddProject,
  onNewSession,
  onSelectSession,
  onRefresh,
  onClose,
}: AppSidebarProps) {
  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const projects = useMemo(() => groupSessionsByProject(sessions, activeCwd), [activeCwd, sessions]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const switchingDisabled = phase === "creating" || phase === "streaming";

  useEffect(() => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      for (const project of projects) {
        if (project.cwd === activeCwd || current.size === 0) {
          next.add(project.cwd);
        }
      }
      return next;
    });
  }, [activeCwd, projects]);

  function toggleProject(cwd: string) {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(cwd)) {
        next.delete(cwd);
      } else {
        next.add(cwd);
      }
      return next;
    });
  }

  return (
    <aside className={`app-sidebar${open ? " app-sidebar-open" : ""}`} aria-label="项目与会话导航">
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
        <nav className="sidebar-primary-actions" aria-label="会话操作">
          <button
            type="button"
            onClick={() => onNewSession(activeCwd || undefined)}
            disabled={switchingDisabled || !runtimeReady}
          >
            <PenLine size={17} />
            <span>新建会话</span>
          </button>
        </nav>

        <section className="sidebar-section">
          <div className="sidebar-section-heading">
            <h2 className="sidebar-section-title">项目</h2>
            <div className="sidebar-section-tools">
              <button
                className="icon-button sidebar-section-button"
                type="button"
                onClick={onRefresh}
                disabled={catalogPhase === "loading" || !runtimeReady}
                aria-label="刷新项目与会话"
                title="刷新"
              >
                <RefreshCw className={catalogPhase === "loading" ? "spin" : undefined} size={14} />
              </button>
              <button
                className="icon-button sidebar-section-button"
                type="button"
                onClick={onAddProject}
                disabled={switchingDisabled || !runtimeReady}
                aria-label="添加项目"
                title="添加项目"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>

          {projects.length === 0 ? (
            <div className="sidebar-empty-state">
              <p>{catalogPhase === "loading" ? "正在读取 Pi 会话" : "尚未添加项目"}</p>
              <button type="button" onClick={onAddProject} disabled={!runtimeReady}>
                <Plus size={14} />
                添加项目
              </button>
            </div>
          ) : (
            <div className="project-list">
              {projects.map((project) => {
                const expanded = expandedProjects.has(project.cwd);
                const active = project.cwd === activeCwd;
                return (
                  <div className="project-group" key={project.cwd}>
                    <div className={`project-row${active ? " project-row-active" : ""}`}>
                      <button
                        className="project-select"
                        type="button"
                        disabled={switchingDisabled}
                        onClick={() => {
                          const recentSession = project.sessions[0];
                          if (recentSession) {
                            onSelectSession(recentSession);
                          } else {
                            onNewSession(project.cwd);
                          }
                        }}
                        aria-current={active ? "page" : undefined}
                        title={project.cwd}
                      >
                        <Folder size={17} />
                        <span>{project.name}</span>
                      </button>
                      <button
                        className="icon-button project-toggle"
                        type="button"
                        onClick={() => toggleProject(project.cwd)}
                        aria-label={`${expanded ? "折叠" : "展开"}${project.name}`}
                        title={expanded ? "折叠" : "展开"}
                      >
                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    </div>

                    {expanded && (
                      <div className="session-list">
                        {project.sessions.length > 0 ? (
                          project.sessions.map((session) => (
                            <button
                              className={`session-row${session.path === activeSessionPath ? " session-row-active" : ""}`}
                              type="button"
                              key={session.path}
                              onClick={() => onSelectSession(session)}
                              disabled={switchingDisabled}
                              aria-current={session.path === activeSessionPath ? "page" : undefined}
                              title={session.name || session.firstMessage || session.id}
                            >
                              <MessageSquare size={14} />
                              <span>{getSessionTitle(session)}</span>
                              <time dateTime={session.modified}>{formatSessionTime(session.modified)}</time>
                            </button>
                          ))
                        ) : (
                          <button
                            className="session-empty-action"
                            type="button"
                            onClick={() => onNewSession(project.cwd)}
                            disabled={switchingDisabled}
                          >
                            <Plus size={13} />
                            创建首个会话
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <footer className="sidebar-footer">
        <div className={`runtime-summary${runtimeReady ? " runtime-summary-ready" : ""}`}>
          {runtimeReady ? <CircleCheck size={17} /> : <CircleX size={17} />}
          <span>
            <strong>{runtimeReady ? "Pi 运行时已就绪" : "Pi 运行时未就绪"}</strong>
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

function groupSessionsByProject(
  sessions: AgentSessionSummary[],
  activeCwd: string,
): ProjectGroup[] {
  const groups = new Map<string, AgentSessionSummary[]>();
  for (const session of sessions) {
    const group = groups.get(session.cwd) ?? [];
    group.push(session);
    groups.set(session.cwd, group);
  }
  if (activeCwd && !groups.has(activeCwd)) {
    groups.set(activeCwd, []);
  }
  return [...groups.entries()].map(([cwd, projectSessions]) => ({
    cwd,
    name: getWorkspaceName(cwd),
    sessions: projectSessions,
  }));
}

function getWorkspaceName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function getSessionTitle(session: AgentSessionSummary): string {
  return session.name || session.firstMessage || "未命名会话";
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}
