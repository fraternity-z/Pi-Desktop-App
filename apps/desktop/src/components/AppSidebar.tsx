import {
  Archive,
  AlertCircle,
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  ExternalLink,
  Folder,
  FolderGit2,
  FolderPlus,
  GitFork,
  Layers3,
  List,
  MessageSquare,
  Package,
  PanelLeftClose,
  PenLine,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import type {
  CreatedWorktree,
  CreateWorktreeInput,
  WorktreeOptions,
} from "../ipc/workspace";
import type { EcosystemPhase } from "../stores/useAgentEcosystem";
import {
  normalizeSidebarPath,
  useSidebarPreferences,
  type SidebarSortMode,
} from "../stores/useSidebarPreferences";
import type { CatalogPhase, ChatPhase, SessionListItem } from "../stores/useChatSession";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import {
  FloatingMenu,
  FloatingMenuItem,
  FloatingMenuSeparator,
  pointFromElement,
  type MenuPoint,
} from "./FloatingMenu";
import {
  ConfirmSidebarDialog,
  CreateWorktreeDialog,
  RenameSidebarDialog,
} from "./SidebarDialog";

const PAGE_SIZE = 5;
const CONVERSATION_TARGET = "__pix_conversation__";

interface AppSidebarProps {
  open: boolean;
  width: number;
  activeCwd: string;
  activeSessionId: string | null;
  activeView: "chat" | "packages" | "resources";
  sessions: SessionListItem[];
  recentWorkspaces: string[];
  conversationHome: string;
  runningSessionIds: string[];
  catalogPhase: CatalogPhase;
  ecosystemPhase: EcosystemPhase;
  packageCount: number;
  resourceCount: number;
  phase: ChatPhase;
  runtime: RuntimeStatusController;
  onAddProject: () => void;
  onNewConversation: () => void;
  onNewSession: (cwd?: string) => void;
  onRemoveWorkspace: (cwd: string) => void | Promise<void>;
  onRevealWorkspace: (cwd: string) => void | Promise<void>;
  onLoadWorktreeOptions: (cwd: string) => Promise<WorktreeOptions>;
  onCreateWorktree: (input: CreateWorktreeInput) => Promise<CreatedWorktree>;
  onOpenCreatedWorktree: (cwd: string) => void | Promise<void>;
  onSelectSession: (session: SessionListItem) => void;
  onRefresh: () => void;
  onOpenPackages: () => void;
  onOpenResources: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  onWidthChange: (width: number) => void;
}

interface ProjectGroup {
  cwd: string;
  key: string;
  name: string;
  sessions: SessionListItem[];
}

type SidebarMenu =
  | { kind: "organize"; point: MenuPoint }
  | { kind: "project"; point: MenuPoint; cwd: string }
  | { kind: "thread"; point: MenuPoint; session: SessionListItem }
  | { kind: "move"; point: MenuPoint; session: SessionListItem };

type SidebarMenuTarget =
  | { kind: "organize" }
  | { kind: "project"; cwd: string }
  | { kind: "thread"; session: SessionListItem }
  | { kind: "move"; session: SessionListItem };

type RenameTarget =
  | { kind: "project"; cwd: string; value: string }
  | { kind: "thread"; session: SessionListItem; value: string };

type ConfirmTarget =
  | { kind: "archive-project"; cwd: string; name: string }
  | { kind: "remove-project"; cwd: string; name: string }
  | { kind: "archive-thread"; session: SessionListItem; name: string }
  | { kind: "delete-thread"; session: SessionListItem; name: string };

export function AppSidebar(props: AppSidebarProps) {
  const {
    open,
    width,
    activeCwd,
    activeSessionId,
    activeView,
    sessions,
    recentWorkspaces,
    conversationHome,
    runningSessionIds,
    catalogPhase,
    ecosystemPhase,
    packageCount,
    resourceCount,
    phase,
    runtime,
    onAddProject,
    onNewConversation,
    onNewSession,
    onRemoveWorkspace,
    onRevealWorkspace,
    onLoadWorktreeOptions,
    onCreateWorktree,
    onOpenCreatedWorktree,
    onSelectSession,
    onRefresh,
    onOpenPackages,
    onOpenResources,
    onOpenSettings,
    onClose,
    onWidthChange,
  } = props;
  const sidebar = useSidebarPreferences();
  const { preferences } = sidebar;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [worktreeTarget, setWorktreeTarget] = useState<ProjectGroup | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [visibleByProject, setVisibleByProject] = useState<Record<string, number>>({});
  const [visibleConversations, setVisibleConversations] = useState(PAGE_SIZE);
  const [draggedProject, setDraggedProject] = useState<string | null>(null);
  const [draggedThread, setDraggedThread] = useState<string | null>(null);
  const [fixed, setFixed] = useState(readSidebarFixed);
  const closeTimer = useRef<number | null>(null);
  const lastAutoExpandedProject = useRef("");
  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const switchingDisabled = phase === "creating";
  const runningIds = useMemo(() => new Set(runningSessionIds), [runningSessionIds]);
  const visibleSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !preferences.deletedThreads.includes(threadKey(session)) &&
          !preferences.archivedThreads.includes(threadKey(session)),
      ),
    [preferences.archivedThreads, preferences.deletedThreads, sessions],
  );
  const allProjectPaths = useMemo(
    () =>
      collectProjectPaths(
        [
          ...recentWorkspaces,
          ...sessions
            .filter((session) => session.lifecycle !== "persisted")
            .map((session) => session.cwd),
        ],
        activeCwd,
        conversationHome,
      ),
    [activeCwd, conversationHome, recentWorkspaces, sessions],
  );
  const projectGroups = useMemo(
    () =>
      buildProjectGroups(
        allProjectPaths,
        visibleSessions,
        preferences.projectAliases,
        preferences.threadProjectOverrides,
      ),
    [allProjectPaths, preferences.projectAliases, preferences.threadProjectOverrides, visibleSessions],
  );
  const sortedProjects = useMemo(
    () =>
      sortProjects(
        projectGroups.filter((project) => !preferences.archivedProjects.includes(project.key)),
        preferences.projectSortMode,
        recentWorkspaces,
        preferences.projectManualOrder,
        preferences.projectPriorityOrder,
      ),
    [
      preferences.archivedProjects,
      preferences.projectManualOrder,
      preferences.projectPriorityOrder,
      preferences.projectSortMode,
      projectGroups,
      recentWorkspaces,
    ],
  );
  const pinnedProjects = sortedProjects.filter((project) => preferences.pinnedProjects.includes(project.key));
  const regularProjects = sortedProjects.filter((project) => !preferences.pinnedProjects.includes(project.key));
  const knownProjectKeys = useMemo(
    () => new Set(projectGroups.map((project) => project.key)),
    [projectGroups],
  );
  const conversations = useMemo(() => {
    const candidates =
      preferences.groupMode === "list"
        ? visibleSessions
        : visibleSessions.filter((session) => {
            const override = preferences.threadProjectOverrides[threadKey(session)];
            if (override === CONVERSATION_TARGET) return true;
            const cwd = override || session.cwd;
            return samePath(cwd, conversationHome) || !knownProjectKeys.has(normalizeSidebarPath(cwd));
          });
    return sortThreads(
      candidates,
      preferences.conversationSortMode,
      preferences.pinnedThreads,
      preferences.threadManualOrder,
    );
  }, [
    conversationHome,
    knownProjectKeys,
    preferences.conversationSortMode,
    preferences.groupMode,
    preferences.pinnedThreads,
    preferences.threadManualOrder,
    preferences.threadProjectOverrides,
    visibleSessions,
  ]);
  const searchNeedle = query.trim().toLocaleLowerCase();
  const searchActive = searchNeedle.length > 0;
  const filteredPinned = filterProjects(pinnedProjects, searchNeedle, preferences.threadAliases);
  const filteredProjects = filterProjects(regularProjects, searchNeedle, preferences.threadAliases);
  const filteredConversations = conversations.filter((session) =>
    sessionMatches(session, searchNeedle, preferences.threadAliases),
  );

  useEffect(() => {
    const missing = allProjectPaths
      .map(normalizeSidebarPath)
      .filter((key) => !preferences.projectPriorityOrder.includes(key));
    if (missing.length > 0) {
      sidebar.setProjectPriorityOrder([...preferences.projectPriorityOrder, ...missing]);
    }
  }, [allProjectPaths, preferences.projectPriorityOrder, sidebar]);

  useEffect(() => {
    const autoExpandCwd =
      activeCwd && !samePath(activeCwd, conversationHome)
        ? activeCwd
        : sortedProjects.find((project) => project.sessions.length > 0)?.cwd;
    if (!autoExpandCwd) return;
    const key = normalizeSidebarPath(autoExpandCwd);
    if (lastAutoExpandedProject.current === key) return;
    lastAutoExpandedProject.current = key;
    if (!preferences.expandedProjects.includes(key)) sidebar.toggleExpandedProject(autoExpandCwd);
  }, [activeCwd, conversationHome, preferences.expandedProjects, sidebar, sortedProjects]);

  useEffect(() => {
    if (!searchOpen) setQuery("");
  }, [searchOpen]);

  useEffect(() => {
    setConfirmError(null);
  }, [confirmTarget]);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = window.setTimeout(() => setActionFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  function openMenuFromButton(event: MouseEvent<HTMLElement>, target: SidebarMenuTarget) {
    event.stopPropagation();
    setMenu({ ...target, point: pointFromElement(event.currentTarget) } as SidebarMenu);
  }

  function openContextMenu(event: MouseEvent<HTMLElement>, target: SidebarMenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ ...target, point: { x: event.clientX + 200, y: event.clientY } } as SidebarMenu);
  }

  function chooseSession(session: SessionListItem) {
    sidebar.markThreadUnread(threadKey(session), false);
    onSelectSession(session);
  }

  function toggleFixed() {
    const next = !fixed;
    setFixed(next);
    try {
      window.localStorage.setItem("pix.sidebar.fixed", next ? "1" : "0");
    } catch {
      // Pinning remains available for the current window.
    }
  }

  function scheduleAutoClose() {
    if (fixed || window.innerWidth <= 900) return;
    closeTimer.current = window.setTimeout(onClose, 260);
  }

  function cancelAutoClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  async function runConfirm() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (target.kind === "remove-project") {
        await onRemoveWorkspace(target.cwd);
        sidebar.removeProjectMetadata(target.cwd);
      } else if (target.kind === "archive-project") {
        sidebar.setProjectArchived(target.cwd, true);
      } else if (target.kind === "archive-thread") {
        const session = target.session;
        sidebar.setThreadArchived(threadKey(session), true, {
          title: threadTitle(session, preferences.threadAliases),
          cwd: session.cwd,
        });
      } else {
        sidebar.deleteThread(threadKey(target.session));
      }
      setConfirmTarget(null);
    } catch (cause) {
      setConfirmError(formatSidebarActionError(cause));
    } finally {
      setConfirmBusy(false);
    }
  }

  function confirmRename(value: string) {
    if (!renameTarget) return;
    if (renameTarget.kind === "project") sidebar.setProjectAlias(renameTarget.cwd, value);
    else sidebar.setThreadAlias(threadKey(renameTarget.session), value);
    setRenameTarget(null);
  }

  async function revealProject(project: ProjectGroup) {
    setMenu(null);
    try {
      await onRevealWorkspace(project.cwd);
      setActionFeedback({ kind: "success", message: `已在文件夹中显示“${project.name}”` });
    } catch (cause) {
      setActionFeedback({ kind: "error", message: formatSidebarActionError(cause) });
    }
  }

  async function openCreatedWorktree(worktree: CreatedWorktree) {
    try {
      await onOpenCreatedWorktree(worktree.path);
      setActionFeedback({ kind: "success", message: "工作树已创建并打开" });
    } catch (cause) {
      setActionFeedback({ kind: "error", message: formatSidebarActionError(cause) });
    }
  }

  function renderProject(project: ProjectGroup, scope: "pinned" | "projects") {
    const expanded = searchActive || preferences.expandedProjects.includes(project.key);
    const projectSessions = sortThreads(
      project.sessions,
      preferences.conversationSortMode,
      preferences.pinnedThreads,
      preferences.threadManualOrder,
    ).filter((session) => sessionMatches(session, searchNeedle, preferences.threadAliases));
    const visibleCount = searchActive ? projectSessions.length : (visibleByProject[project.key] ?? PAGE_SIZE);
    const manuallySortable = preferences.projectSortMode === "manual";
    return (
      <div
        className="project-group"
        data-dragging={draggedProject === project.key || undefined}
        key={project.key}
        draggable={manuallySortable}
        onDragStart={(event) => {
          if (!manuallySortable) return;
          setDraggedProject(project.key);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-pi-project", project.key);
        }}
        onDragEnd={() => setDraggedProject(null)}
        onDragOver={(event) => {
          if (draggedProject && draggedProject !== project.key) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!draggedProject || draggedProject === project.key) return;
          const source = scope === "pinned" ? filteredPinned : filteredProjects;
          sidebar.setProjectManualOrder(
            moveBefore(source.map((item) => item.key), draggedProject, project.key),
          );
          setDraggedProject(null);
        }}
      >
        <div
          className="project-row"
          data-active={samePath(project.cwd, activeCwd) || undefined}
          onContextMenu={(event) => openContextMenu(event, { kind: "project", cwd: project.cwd })}
        >
          <button
            className="project-toggle"
            type="button"
            aria-label={`${expanded ? "折叠" : "展开"}${project.name}`}
            aria-expanded={expanded}
            onClick={() => sidebar.toggleExpandedProject(project.cwd)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <button
            className="project-select"
            type="button"
            disabled={switchingDisabled}
            aria-current={samePath(project.cwd, activeCwd) ? "page" : undefined}
            title={project.cwd}
            onClick={() => {
              const recent = projectSessions[0] ?? project.sessions[0];
              if (recent) chooseSession(recent);
              else onNewSession(project.cwd);
            }}
          >
            <Folder size={16} />
            <span>{project.name}</span>
          </button>
          <button
            className="sidebar-row-menu"
            type="button"
            aria-label={`${project.name}更多操作`}
            title="更多"
            onClick={(event) => openMenuFromButton(event, { kind: "project", cwd: project.cwd })}
          >
            <Ellipsis size={15} />
          </button>
        </div>
        {expanded && preferences.groupMode === "project" && (
          <div className="session-list project-session-list">
            {projectSessions.length === 0 ? (
              <button
                className="session-empty-action"
                type="button"
                disabled={switchingDisabled}
                onClick={() => onNewSession(project.cwd)}
              >
                <Plus size={13} />
                创建首个会话
              </button>
            ) : (
              <>
                {projectSessions.slice(0, visibleCount).map((session) =>
                  renderSession(session, { indent: true, manual: false }),
                )}
                {visibleCount < projectSessions.length && (
                  <button
                    className="sidebar-show-more"
                    type="button"
                    onClick={() =>
                      setVisibleByProject((current) => ({
                        ...current,
                        [project.key]: visibleCount + PAGE_SIZE,
                      }))
                    }
                  >
                    展开显示
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderSession(
    session: SessionListItem,
    options: { indent: boolean; manual: boolean },
  ) {
    const id = threadKey(session);
    const pinned = preferences.pinnedThreads.includes(id);
    return (
      <SessionRow
        key={session.id}
        session={session}
        title={threadTitle(session, preferences.threadAliases)}
        active={session.id === activeSessionId && activeView === "chat"}
        running={runningIds.has(session.id)}
        unread={preferences.unreadThreads.includes(id)}
        pinned={pinned}
        indent={options.indent}
        disabled={switchingDisabled}
        draggable={options.manual}
        dragging={draggedThread === id}
        onSelect={() => chooseSession(session)}
        onPin={() => sidebar.togglePinnedThread(id)}
        onArchive={() =>
          setConfirmTarget({
            kind: "archive-thread",
            session,
            name: threadTitle(session, preferences.threadAliases),
          })
        }
        onMenu={(event) => openMenuFromButton(event, { kind: "thread", session })}
        onContextMenu={(event) => openContextMenu(event, { kind: "thread", session })}
        onDragStart={(event) => {
          setDraggedThread(id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-pi-thread", id);
        }}
        onDragEnd={() => setDraggedThread(null)}
        onDrop={(event) => {
          event.preventDefault();
          if (!draggedThread || draggedThread === id) return;
          sidebar.setThreadManualOrder(
            moveBefore(filteredConversations.map(threadKey), draggedThread, id),
          );
          setDraggedThread(null);
        }}
      />
    );
  }

  const selectedProject =
    menu?.kind === "project" ? projectGroups.find((item) => item.cwd === menu.cwd) : undefined;
  const selectedThread =
    menu?.kind === "thread" || menu?.kind === "move" ? menu.session : undefined;
  const selectedThreadId = selectedThread ? threadKey(selectedThread) : "";
  const titleNames = sessions.map((session) => threadTitle(session, preferences.threadAliases));
  const projectNames = projectGroups.map((project) => project.name);

  return (
    <aside
      className={`app-sidebar${open ? " app-sidebar-open" : " app-sidebar-collapsed"}`}
      data-fixed={fixed || undefined}
      aria-label="项目与会话导航"
      aria-hidden={!open}
      inert={!open}
      style={{ width: open ? `${width}px` : 0 }}
      onPointerEnter={cancelAutoClose}
      onPointerLeave={scheduleAutoClose}
    >
      <div className="sidebar-brand-row">
        {searchOpen ? (
          <label className="sidebar-search-field">
            <Search size={15} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              placeholder="搜索"
              aria-label="搜索项目和会话"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchOpen(false);
              }}
            />
          </label>
        ) : (
          <strong className="sidebar-brand">Pix</strong>
        )}
        <div className="sidebar-brand-actions">
          <button
            className="icon-button"
            type="button"
            aria-label={searchOpen ? "关闭搜索" : "搜索"}
            title={searchOpen ? "关闭搜索" : "搜索"}
            onClick={() => setSearchOpen((current) => !current)}
          >
            {searchOpen ? <PanelLeftClose size={17} /> : <Search size={17} />}
          </button>
          <button
            className="icon-button sidebar-fixed-button"
            type="button"
            aria-label={fixed ? "取消固定侧边栏" : "固定侧边栏"}
            title={fixed ? "取消固定" : "固定"}
            onClick={toggleFixed}
          >
            {fixed ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
          <button
            className="icon-button sidebar-close-button"
            type="button"
            onClick={onClose}
            aria-label="收起侧边栏"
            title="收起侧边栏"
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
      </div>

      <nav className="sidebar-primary-actions" aria-label="主要导航">
        <button
          type="button"
          onClick={onNewConversation}
          disabled={switchingDisabled || !runtimeReady}
        >
          <PenLine size={17} />
          <span>新建会话</span>
        </button>
        <button
          type="button"
          aria-label="插件"
          data-active={activeView === "packages" || undefined}
          onClick={onOpenPackages}
          disabled={!runtimeReady}
        >
          <Package size={17} />
          <span>插件</span>
          <small>{ecosystemPhase === "loading" ? "…" : packageCount}</small>
        </button>
        <button
          type="button"
          aria-label="资源"
          data-active={activeView === "resources" || undefined}
          onClick={onOpenResources}
          disabled={!runtimeReady}
        >
          <Layers3 size={17} />
          <span>资源</span>
          <small>{ecosystemPhase === "loading" ? "…" : resourceCount}</small>
        </button>
      </nav>

      <div className="sidebar-scroll">
        {filteredPinned.length > 0 && (
          <SidebarSection
            title="置顶"
            open={searchActive || preferences.pinnedOpen}
            onToggle={() => sidebar.setPinnedOpen(!preferences.pinnedOpen)}
          >
            <div className="project-list">
              {filteredPinned.map((project) => renderProject(project, "pinned"))}
            </div>
          </SidebarSection>
        )}

        {preferences.groupMode === "project" && (
          <SidebarSection
            title="项目"
            open={searchActive || preferences.projectsOpen}
            onToggle={() => sidebar.setProjectsOpen(!preferences.projectsOpen)}
            actions={
              <SidebarOrganizeActions
                runtimeReady={runtimeReady}
                switchingDisabled={switchingDisabled}
                onAddProject={onAddProject}
                onOpenMenu={(event) => openMenuFromButton(event, { kind: "organize" })}
              />
            }
          >
            {catalogPhase === "loading" && regularProjects.length === 0 ? (
              <div className="sidebar-status" role="status">
                <RefreshCw className="spin" size={14} />
                正在读取项目
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="sidebar-empty-state">
                <span>{searchActive ? "没有匹配的项目" : "尚未添加项目"}</span>
                {!searchActive && (
                  <button type="button" onClick={onAddProject} disabled={!runtimeReady}>
                    <Plus size={13} />
                    添加项目
                  </button>
                )}
              </div>
            ) : (
              <div className="project-list">
                {filteredProjects.map((project) => renderProject(project, "projects"))}
              </div>
            )}
          </SidebarSection>
        )}

        <SidebarSection
          title="对话"
          open={searchActive || preferences.conversationsOpen}
          onToggle={() => sidebar.setConversationsOpen(!preferences.conversationsOpen)}
          actions={
            preferences.groupMode === "list" ? (
              <SidebarOrganizeActions
                runtimeReady={runtimeReady}
                switchingDisabled={switchingDisabled}
                onAddProject={onAddProject}
                onOpenMenu={(event) => openMenuFromButton(event, { kind: "organize" })}
              />
            ) : undefined
          }
        >
          {filteredConversations.length === 0 ? (
            <div className="sidebar-empty-state sidebar-empty-compact">
              <span>{searchActive ? "没有匹配的对话" : "暂无对话"}</span>
            </div>
          ) : (
            <div className="session-list conversation-session-list">
              {filteredConversations
                .slice(0, searchActive ? filteredConversations.length : visibleConversations)
                .map((session) =>
                  renderSession(session, {
                    indent: false,
                    manual: preferences.conversationSortMode === "manual",
                  }),
                )}
              {!searchActive && visibleConversations < filteredConversations.length && (
                <button
                  className="sidebar-show-more"
                  type="button"
                  onClick={() => setVisibleConversations((count) => count + PAGE_SIZE)}
                >
                  展开显示
                </button>
              )}
            </div>
          )}
        </SidebarSection>
      </div>

      <nav className="sidebar-footer" aria-label="应用导航">
        <button type="button" onClick={onOpenSettings}>
          <Settings size={17} />
          <span>系统设置</span>
        </button>
        <a
          href="https://github.com/badlogic/pi-mono"
          target="_blank"
          rel="noreferrer"
          aria-label="打开 Pi GitHub"
          title="GitHub"
        >
          <GitFork size={18} />
        </a>
      </nav>
      {actionFeedback && (
        <div
          className="sidebar-action-feedback"
          data-kind={actionFeedback.kind}
          role={actionFeedback.kind === "error" ? "alert" : "status"}
        >
          {actionFeedback.kind === "error" ? <AlertCircle size={15} /> : <Check size={15} />}
          <span>{actionFeedback.message}</span>
          <button
            type="button"
            aria-label="关闭操作反馈"
            title="关闭"
            onClick={() => setActionFeedback(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <SidebarResizer open={open} width={width} onWidthChange={onWidthChange} />

      {menu?.kind === "organize" && (
        <FloatingMenu point={menu.point} width={220} label="整理侧边栏" onClose={() => setMenu(null)}>
          <div className="floating-menu-heading">分组方式</div>
          <FloatingMenuItem
            icon={preferences.groupMode === "project" ? <Check size={14} /> : <Folder size={14} />}
            label="按项目分组"
            selected={preferences.groupMode === "project"}
            onSelect={() => {
              sidebar.setGroupMode("project");
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={preferences.groupMode === "list" ? <Check size={14} /> : <List size={14} />}
            label="列表显示"
            selected={preferences.groupMode === "list"}
            onSelect={() => {
              sidebar.setGroupMode("list");
              setMenu(null);
            }}
          />
          <FloatingMenuSeparator />
          <div className="floating-menu-heading">排序</div>
          {(["priority", "recent", "manual"] as SidebarSortMode[]).map((mode) => (
            <FloatingMenuItem
              key={mode}
              icon={
                (preferences.groupMode === "list"
                  ? preferences.conversationSortMode
                  : preferences.projectSortMode) === mode ? (
                  <Check size={14} />
                ) : (
                  <ArrowDownUp size={14} />
                )
              }
              label={sortModeLabel(mode)}
              selected={
                (preferences.groupMode === "list"
                  ? preferences.conversationSortMode
                  : preferences.projectSortMode) === mode
              }
              onSelect={() => {
                if (preferences.groupMode === "list") {
                  sidebar.setConversationSortMode(mode);
                  if (mode === "manual") {
                    sidebar.setThreadManualOrder(conversations.map(threadKey));
                  }
                } else {
                  sidebar.setProjectSortMode(mode);
                  if (mode === "manual") {
                    sidebar.setProjectManualOrder(regularProjects.map((project) => project.cwd));
                  }
                }
                setMenu(null);
              }}
            />
          ))}
          <FloatingMenuSeparator />
          <FloatingMenuItem
            icon={<RefreshCw size={14} />}
            label="刷新列表"
            disabled={catalogPhase === "loading"}
            onSelect={() => {
              onRefresh();
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<FolderPlus size={14} />}
            label="添加项目"
            onSelect={() => {
              onAddProject();
              setMenu(null);
            }}
          />
        </FloatingMenu>
      )}

      {menu?.kind === "project" && selectedProject && (
        <FloatingMenu point={menu.point} label={`${selectedProject.name}操作`} onClose={() => setMenu(null)}>
          <FloatingMenuItem
            icon={preferences.pinnedProjects.includes(selectedProject.key) ? <PinOff size={14} /> : <Pin size={14} />}
            label={preferences.pinnedProjects.includes(selectedProject.key) ? "取消置顶" : "置顶"}
            onSelect={() => {
              sidebar.togglePinnedProject(selectedProject.cwd);
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<ExternalLink size={14} />}
            label="在文件夹中显示"
            onSelect={() => void revealProject(selectedProject)}
          />
          <FloatingMenuItem
            icon={<FolderGit2 size={14} />}
            label="创建永久工作树"
            onSelect={() => {
              setWorktreeTarget(selectedProject);
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<PenLine size={14} />}
            label="新建会话"
            onSelect={() => {
              onNewSession(selectedProject.cwd);
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<Pencil size={14} />}
            label="重命名"
            onSelect={() => {
              setRenameTarget({ kind: "project", cwd: selectedProject.cwd, value: selectedProject.name });
              setMenu(null);
            }}
          />
          <FloatingMenuSeparator />
          <FloatingMenuItem
            icon={<Archive size={14} />}
            label="归档项目"
            onSelect={() => {
              setConfirmTarget({
                kind: "archive-project",
                cwd: selectedProject.cwd,
                name: selectedProject.name,
              });
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<Trash2 size={14} />}
            label="从列表移除"
            danger
            onSelect={() => {
              setConfirmTarget({
                kind: "remove-project",
                cwd: selectedProject.cwd,
                name: selectedProject.name,
              });
              setMenu(null);
            }}
          />
        </FloatingMenu>
      )}

      {menu?.kind === "thread" && selectedThread && (
        <FloatingMenu
          point={menu.point}
          label={`${threadTitle(selectedThread, preferences.threadAliases)}操作`}
          onClose={() => setMenu(null)}
        >
          <FloatingMenuItem
            icon={preferences.pinnedThreads.includes(selectedThreadId) ? <PinOff size={14} /> : <Pin size={14} />}
            label={preferences.pinnedThreads.includes(selectedThreadId) ? "取消置顶" : "置顶"}
            onSelect={() => {
              sidebar.togglePinnedThread(selectedThreadId);
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<Pencil size={14} />}
            label="重命名"
            onSelect={() => {
              setRenameTarget({
                kind: "thread",
                session: selectedThread,
                value: threadTitle(selectedThread, preferences.threadAliases),
              });
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<Folder size={14} />}
            label="移动到项目…"
            onSelect={() => setMenu({ kind: "move", point: menu.point, session: selectedThread })}
          />
          <FloatingMenuItem
            icon={<MessageSquare size={14} />}
            label={preferences.unreadThreads.includes(selectedThreadId) ? "标记为已读" : "标记为未读"}
            onSelect={() => {
              sidebar.markThreadUnread(
                selectedThreadId,
                !preferences.unreadThreads.includes(selectedThreadId),
              );
              setMenu(null);
            }}
          />
          <FloatingMenuSeparator />
          <FloatingMenuItem
            icon={<Archive size={14} />}
            label="归档"
            onSelect={() => {
              setConfirmTarget({
                kind: "archive-thread",
                session: selectedThread,
                name: threadTitle(selectedThread, preferences.threadAliases),
              });
              setMenu(null);
            }}
          />
          <FloatingMenuItem
            icon={<Trash2 size={14} />}
            label="删除"
            danger
            onSelect={() => {
              setConfirmTarget({
                kind: "delete-thread",
                session: selectedThread,
                name: threadTitle(selectedThread, preferences.threadAliases),
              });
              setMenu(null);
            }}
          />
        </FloatingMenu>
      )}

      {menu?.kind === "move" && selectedThread && (
        <FloatingMenu point={menu.point} width={220} label="移动会话" onClose={() => setMenu(null)}>
          <div className="floating-menu-heading">移动到</div>
          <FloatingMenuItem
            icon={<MessageSquare size={14} />}
            label="对话"
            selected={preferences.threadProjectOverrides[selectedThreadId] === CONVERSATION_TARGET}
            onSelect={() => {
              sidebar.setThreadProject(selectedThreadId, CONVERSATION_TARGET);
              setMenu(null);
            }}
          />
          {projectGroups.map((project) => (
            <FloatingMenuItem
              key={project.key}
              icon={<Folder size={14} />}
              label={project.name}
              selected={samePath(
                preferences.threadProjectOverrides[selectedThreadId] ?? selectedThread.cwd,
                project.cwd,
              )}
              onSelect={() => {
                sidebar.setThreadProject(selectedThreadId, project.cwd);
                setMenu(null);
              }}
            />
          ))}
          {preferences.threadProjectOverrides[selectedThreadId] && (
            <>
              <FloatingMenuSeparator />
              <FloatingMenuItem
                icon={<RefreshCw size={14} />}
                label="恢复原始归类"
                onSelect={() => {
                  sidebar.setThreadProject(selectedThreadId);
                  setMenu(null);
                }}
              />
            </>
          )}
        </FloatingMenu>
      )}

      {renameTarget && (
        <RenameSidebarDialog
          title={renameTarget.kind === "project" ? "重命名项目" : "重命名会话"}
          label="名称"
          initialValue={renameTarget.value}
          existingNames={renameTarget.kind === "project" ? projectNames : titleNames}
          onConfirm={confirmRename}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {confirmTarget && (
        <ConfirmSidebarDialog
          title={confirmDialogTitle(confirmTarget.kind)}
          description={confirmDialogDescription(confirmTarget)}
          confirmLabel={
            confirmTarget.kind.includes("archive")
              ? "归档"
              : confirmTarget.kind === "remove-project"
                ? "移除"
                : "删除"
          }
          danger={!confirmTarget.kind.includes("archive")}
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void runConfirm()}
          onClose={() => setConfirmTarget(null)}
        />
      )}

      {worktreeTarget && (
        <CreateWorktreeDialog
          cwd={worktreeTarget.cwd}
          loadOptions={onLoadWorktreeOptions}
          onCreate={onCreateWorktree}
          onCreated={openCreatedWorktree}
          onClose={() => setWorktreeTarget(null)}
        />
      )}
    </aside>
  );
}

function SidebarOrganizeActions({
  runtimeReady,
  switchingDisabled,
  onAddProject,
  onOpenMenu,
}: {
  runtimeReady: boolean;
  switchingDisabled: boolean;
  onAddProject: () => void;
  onOpenMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      <button type="button" aria-label="整理侧边栏" title="更多" onClick={onOpenMenu}>
        <Ellipsis size={15} />
      </button>
      <button
        type="button"
        aria-label="添加项目文件夹"
        title="添加项目"
        disabled={!runtimeReady || switchingDisabled}
        onClick={onAddProject}
      >
        <FolderPlus size={15} />
      </button>
    </>
  );
}

function SidebarSection({
  title,
  open,
  actions,
  children,
  onToggle,
}: {
  title: string;
  open: boolean;
  actions?: ReactNode;
  children: ReactNode;
  onToggle: () => void;
}) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-section-heading">
        <button className="sidebar-section-toggle" type="button" aria-expanded={open} onClick={onToggle}>
          <span>{title}</span>
          <ChevronRight className={open ? "sidebar-chevron-open" : undefined} size={14} />
        </button>
        {actions && <div className="sidebar-section-tools">{actions}</div>}
      </div>
      {open && children}
    </section>
  );
}

function SessionRow({
  title,
  active,
  running,
  unread,
  pinned,
  indent,
  disabled,
  draggable,
  dragging,
  onSelect,
  onPin,
  onArchive,
  onMenu,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  session: SessionListItem;
  title: string;
  active: boolean;
  running: boolean;
  unread: boolean;
  pinned: boolean;
  indent: boolean;
  disabled: boolean;
  draggable: boolean;
  dragging: boolean;
  onSelect: () => void;
  onPin: () => void;
  onArchive: () => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="session-row"
      data-active={active || undefined}
      data-indent={indent || undefined}
      data-dragging={dragging || undefined}
      draggable={draggable}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (draggable) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <button
        className="session-row-select"
        type="button"
        disabled={disabled}
        aria-current={active ? "page" : undefined}
        title={title}
        onClick={onSelect}
      >
        <span className="session-row-title">{title}</span>
        {unread && <span className="session-unread-dot" aria-label="未读" />}
        {pinned && <Pin className="session-pin-marker" size={12} aria-label="已置顶" />}
        {running && <span className="session-running-dot" aria-label="正在运行" />}
      </button>
      <div className="session-row-actions">
        <button type="button" aria-label={pinned ? "取消置顶" : "置顶"} title={pinned ? "取消置顶" : "置顶"} onClick={onPin}>
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button type="button" aria-label="归档" title="归档" onClick={onArchive}>
          <Archive size={13} />
        </button>
        <button type="button" aria-label={`${title}更多操作`} title="更多" onClick={onMenu}>
          <Ellipsis size={14} />
        </button>
      </div>
    </div>
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
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);

    function handlePointerMove(pointerEvent: globalThis.PointerEvent) {
      onWidthChange(clampSidebarWidth(startWidth + pointerEvent.clientX - startX));
    }

    function finishResize(pointerEvent: globalThis.PointerEvent) {
      handle.releasePointerCapture?.(pointerEvent.pointerId);
      handle.removeEventListener("pointermove", handlePointerMove);
      handle.removeEventListener("pointerup", finishResize);
      handle.removeEventListener("pointercancel", finishResize);
    }

    handle.addEventListener("pointermove", handlePointerMove);
    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
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

function collectProjectPaths(
  recentWorkspaces: string[],
  activeCwd: string,
  conversationHome: string,
): string[] {
  const paths = [...recentWorkspaces];
  if (activeCwd) paths.push(activeCwd);
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = normalizeSidebarPath(path);
    if (!key || samePath(path, conversationHome) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildProjectGroups(
  paths: string[],
  sessions: SessionListItem[],
  aliases: Record<string, string>,
  overrides: Record<string, string>,
): ProjectGroup[] {
  const groups = new Map(
    paths.map((cwd) => {
      const key = normalizeSidebarPath(cwd);
      return [key, { cwd, key, name: aliases[key] || workspaceName(cwd), sessions: [] as SessionListItem[] }];
    }),
  );
  for (const session of sessions) {
    const override = overrides[threadKey(session)];
    if (override === CONVERSATION_TARGET) continue;
    groups.get(normalizeSidebarPath(override || session.cwd))?.sessions.push(session);
  }
  return [...groups.values()];
}

function sortProjects(
  projects: ProjectGroup[],
  mode: SidebarSortMode,
  recent: string[],
  manual: string[],
  priority: string[],
): ProjectGroup[] {
  const order = mode === "recent" ? recent.map(normalizeSidebarPath) : mode === "manual" ? manual : priority;
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...projects].sort(
    (left, right) =>
      (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER) || left.name.localeCompare(right.name),
  );
}

function sortThreads(
  sessions: SessionListItem[],
  mode: SidebarSortMode,
  pinned: string[],
  manual: string[],
): SessionListItem[] {
  const pinRank = new Map(pinned.map((id, index) => [id, index]));
  const manualRank = new Map(manual.map((id, index) => [id, index]));
  return [...sessions].sort((left, right) => {
    const leftId = threadKey(left);
    const rightId = threadKey(right);
    const leftPinned = pinRank.has(leftId);
    const rightPinned = pinRank.has(rightId);
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    if (leftPinned && rightPinned) return (pinRank.get(leftId) ?? 0) - (pinRank.get(rightId) ?? 0);
    if (mode === "manual") {
      const delta =
        (manualRank.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
        (manualRank.get(rightId) ?? Number.MAX_SAFE_INTEGER);
      if (delta) return delta;
    }
    return right.modified.localeCompare(left.modified);
  });
}

function filterProjects(
  projects: ProjectGroup[],
  needle: string,
  aliases: Record<string, string>,
): ProjectGroup[] {
  if (!needle) return projects;
  return projects.filter(
    (project) =>
      project.name.toLocaleLowerCase().includes(needle) ||
      project.cwd.toLocaleLowerCase().includes(needle) ||
      project.sessions.some((session) => sessionMatches(session, needle, aliases)),
  );
}

function sessionMatches(
  session: SessionListItem,
  needle: string,
  aliases: Record<string, string>,
): boolean {
  if (!needle) return true;
  return (
    threadTitle(session, aliases).toLocaleLowerCase().includes(needle) ||
    session.cwd.toLocaleLowerCase().includes(needle)
  );
}

function threadKey(session: SessionListItem): string {
  return session.id;
}

export function threadTitle(
  session: SessionListItem,
  aliases: Record<string, string>,
): string {
  return aliases[threadKey(session)] || session.name || session.firstMessage || "未命名会话";
}

function workspaceName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function samePath(left: string, right: string): boolean {
  return Boolean(left && right) && normalizeSidebarPath(left) === normalizeSidebarPath(right);
}

function moveBefore(values: string[], source: string, target: string): string[] {
  const next = values.filter((value) => value !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
  return next;
}

function sortModeLabel(mode: SidebarSortMode): string {
  return mode === "recent" ? "最近使用" : mode === "manual" ? "手动排序" : "优先级";
}

function readSidebarFixed(): boolean {
  try {
    return window.localStorage.getItem("pix.sidebar.fixed") !== "0";
  } catch {
    return true;
  }
}

function confirmDialogTitle(kind: ConfirmTarget["kind"]): string {
  if (kind === "archive-project") return "归档项目";
  if (kind === "remove-project") return "移除项目";
  if (kind === "archive-thread") return "归档会话";
  return "删除会话";
}

function confirmDialogDescription(target: ConfirmTarget): string {
  if (target.kind === "archive-project") {
    return `归档“${target.name}”后，它会从侧边栏隐藏，但不会删除本机文件。`;
  }
  if (target.kind === "remove-project") {
    return `从最近项目中移除“${target.name}”？项目文件和 Pi 会话不会被删除。`;
  }
  if (target.kind === "archive-thread") {
    return `归档“${target.name}”后，可在设置中恢复；Pi 原生会话文件不会被改写。`;
  }
  return `从侧边栏删除“${target.name}”？此操作只隐藏本机会话索引，不会删除 Pi 原生 JSONL。`;
}

function formatSidebarActionError(cause: unknown): string {
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    "message" in cause &&
    typeof cause.code === "string" &&
    typeof cause.message === "string"
  ) {
    return `${cause.code}: ${cause.message}`;
  }
  return "SIDEBAR_ACTION_FAILED: 操作未完成，请重试";
}
