import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  PanelLeftClose,
  PenLine,
  Plus,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { AgentSessionSummary } from "../ipc/agent";
import type { CatalogPhase, ChatPhase } from "../stores/useChatSession";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import appIconUrl from "../../../../src-tauri/icons/64x64.png";

interface AppSidebarProps {
  open: boolean;
  width: number;
  activeCwd: string;
  activeSessionPath: string | null;
  sessions: AgentSessionSummary[];
  recentWorkspaces: string[];
  conversationHome: string;
  runningSessionIds: string[];
  catalogPhase: CatalogPhase;
  phase: ChatPhase;
  runtime: RuntimeStatusController;
  onAddProject: () => void;
  onNewConversation: () => void;
  onNewSession: (cwd?: string) => void;
  onRemoveWorkspace: (cwd: string) => void;
  onSelectSession: (session: AgentSessionSummary) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  onWidthChange: (width: number) => void;
}

interface ProjectGroup {
  cwd: string;
  name: string;
  sessions: AgentSessionSummary[];
}

export function AppSidebar({
  open,
  width,
  activeCwd,
  activeSessionPath,
  sessions,
  recentWorkspaces,
  conversationHome,
  runningSessionIds,
  catalogPhase,
  phase,
  runtime,
  onAddProject,
  onNewConversation,
  onNewSession,
  onRemoveWorkspace,
  onSelectSession,
  onRefresh,
  onOpenSettings,
  onClose,
  onWidthChange,
}: AppSidebarProps) {
  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const projects = useMemo(
    () => groupSessionsByProject(sessions, recentWorkspaces, activeCwd, conversationHome),
    [activeCwd, conversationHome, recentWorkspaces, sessions],
  );
  const conversationSessions = useMemo(
    () => sessions.filter((session) => samePath(session.cwd, conversationHome)),
    [conversationHome, sessions],
  );
  const runningIds = useMemo(() => new Set(runningSessionIds), [runningSessionIds]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(readExpandedProjects);
  const switchingDisabled = phase === "creating";

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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "pi-desktop.expanded-workspaces",
        JSON.stringify([...expandedProjects]),
      );
    } catch {
      // Sidebar expansion remains available in memory when storage is unavailable.
    }
  }, [expandedProjects]);

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
    <aside
      className={`app-sidebar${open ? " app-sidebar-open" : " app-sidebar-collapsed"}`}
      aria-label="项目与会话导航"
      aria-hidden={!open}
      inert={!open}
      style={{ width: open ? `${width}px` : 0 }}
    >
      <div className="sidebar-brand-row">
        <div className="sidebar-brand">
          <img className="brand-mark" src={appIconUrl} alt="" aria-hidden="true" />
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
            onClick={onNewConversation}
            disabled={switchingDisabled || !runtimeReady}
          >
            <PenLine size={17} />
            <span>新建会话</span>
          </button>
        </nav>

        {conversationSessions.length > 0 && (
          <section className="sidebar-section sidebar-conversation-section">
            <div className="sidebar-section-heading">
              <h2 className="sidebar-section-title">对话</h2>
            </div>
            <div className="session-list conversation-session-list">
              {conversationSessions.map((session) => (
                <SessionRow
                  key={session.path}
                  session={session}
                  active={session.path === activeSessionPath}
                  running={runningIds.has(session.id)}
                  disabled={switchingDisabled}
                  onSelect={onSelectSession}
                />
              ))}
            </div>
          </section>
        )}

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
                        className="icon-button project-remove"
                        type="button"
                        onClick={() => onRemoveWorkspace(project.cwd)}
                        aria-label={`从列表移除${project.name}`}
                        title="从列表移除"
                      >
                        <X size={13} />
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
                            <SessionRow
                              key={session.path}
                              session={session}
                              active={session.path === activeSessionPath}
                              running={runningIds.has(session.id)}
                              disabled={switchingDisabled}
                              onSelect={onSelectSession}
                            />
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
      <nav className="sidebar-footer" aria-label="应用导航">
        <button type="button" onClick={onOpenSettings}>
          <Settings size={17} />
          <span>设置</span>
        </button>
      </nav>
      <SidebarResizer open={open} width={width} onWidthChange={onWidthChange} />
    </aside>
  );
}

export function SidebarResizer({
  open,
  width,
  onWidthChange,
}: {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
}) {
  function beginResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;

    function handlePointerMove(pointerEvent: globalThis.PointerEvent) {
      onWidthChange(clampSidebarWidth(startWidth + pointerEvent.clientX - startX));
    }

    function finishResize() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize, { once: true });
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onWidthChange(clampSidebarWidth(width + (event.key === "ArrowRight" ? 8 : -8)));
  }

  return open ? (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-label="调整侧边栏宽度"
      aria-orientation="vertical"
      aria-valuemin={232}
      aria-valuemax={360}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={beginResize}
      onKeyDown={resizeWithKeyboard}
    />
  ) : null;
}

export function clampSidebarWidth(width: number): number {
  return Math.min(360, Math.max(232, Math.round(width)));
}

function groupSessionsByProject(
  sessions: AgentSessionSummary[],
  recentWorkspaces: string[],
  activeCwd: string,
  conversationHome: string,
): ProjectGroup[] {
  const groups = new Map<string, { cwd: string; sessions: AgentSessionSummary[] }>();
  for (const cwd of recentWorkspaces) {
    if (!samePath(cwd, conversationHome)) {
      groups.set(normalizePath(cwd), { cwd, sessions: [] });
    }
  }
  if (activeCwd && !samePath(activeCwd, conversationHome)) {
    const key = normalizePath(activeCwd);
    if (!groups.has(key)) groups.set(key, { cwd: activeCwd, sessions: [] });
  }
  for (const session of sessions) {
    const group = groups.get(normalizePath(session.cwd));
    if (group) group.sessions.push(session);
  }
  const rank = new Map(recentWorkspaces.map((cwd, index) => [normalizePath(cwd), index]));
  return [...groups.values()]
    .map((group) => ({
      cwd: group.cwd,
      name: getWorkspaceName(group.cwd),
      sessions: [...group.sessions].sort((left, right) => right.modified.localeCompare(left.modified)),
    }))
    .sort((left, right) => {
      const leftRank = rank.get(normalizePath(left.cwd)) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(normalizePath(right.cwd)) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.name.localeCompare(right.name);
    });
}

function SessionRow({
  session,
  active,
  running,
  disabled,
  onSelect,
}: {
  session: AgentSessionSummary;
  active: boolean;
  running: boolean;
  disabled: boolean;
  onSelect: (session: AgentSessionSummary) => void;
}) {
  return (
    <button
      className={`session-row${active ? " session-row-active" : ""}`}
      type="button"
      onClick={() => onSelect(session)}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      title={session.name || session.firstMessage || session.id}
    >
      <span className="session-row-icon">
        <MessageSquare size={14} />
        {running && <span className="session-running-dot" aria-label="正在运行" />}
      </span>
      <span>{getSessionTitle(session)}</span>
      <time dateTime={session.modified}>{formatSessionTime(session.modified)}</time>
    </button>
  );
}

function readExpandedProjects(): Set<string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem("pi-desktop.expanded-workspaces") ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function samePath(left: string, right: string): boolean {
  return Boolean(left && right) && normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLocaleLowerCase();
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
