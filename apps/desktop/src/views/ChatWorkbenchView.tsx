import {
  AlertTriangle,
  ArrowDown,
  Ban,
  CheckCircle2,
  CircleX,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Menu,
  MessageSquarePlus,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { AppSidebar } from "../components/AppSidebar";
import { ChatComposer } from "../components/ChatComposer";
import { RuntimeStatusControl } from "../components/RuntimeStatusControl";
import type { AgentSessionSummary } from "../ipc/agent";
import { selectProjectDirectory } from "../ipc/project";
import { useChatSession, type ToolExecution } from "../stores/useChatSession";
import { useRuntimeStatus } from "../stores/useRuntimeStatus";
import appIconUrl from "../../../../src-tauri/icons/64x64.png";

export function ChatWorkbenchView() {
  const runtime = useRuntimeStatus();
  const session = useChatSession();
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowViewport());
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [projectSelectionError, setProjectSelectionError] = useState<string | null>(null);
  const [selectingProject, setSelectingProject] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const projectDialogTrigger = useRef<HTMLElement | null>(null);
  const [atConversationBottom, setAtConversationBottom] = useState(true);

  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const eventChannelReady = session.eventConnection === "ready";
  const hasSession = session.sessionId !== null;
  const workspaceName = getWorkspaceName(session.cwd);
  const activeSession = session.sessions.find((item) => item.path === session.sessionPath);
  const conversationTitle = activeSession ? getSessionTitle(activeSession) : workspaceName;
  const canSend =
    hasSession &&
    session.phase === "ready" &&
    eventChannelReady &&
    !session.configuring &&
    draft.trim().length > 0;

  useEffect(() => {
    if (shouldStickToBottom.current) {
      scrollConversationToBottom(conversationScroll.current, messagesEnd.current);
    }
  }, [session.messages]);

  useEffect(() => {
    shouldStickToBottom.current = true;
    setAtConversationBottom(true);
    scrollConversationToBottom(conversationScroll.current, messagesEnd.current);
  }, [session.sessionId]);

  useEffect(() => {
    try {
      window.localStorage.setItem("pi-desktop.sidebar-width", String(sidebarWidth));
    } catch {
      // Local persistence is optional; the in-memory width remains usable.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (runtimeReady && eventChannelReady && session.catalogPhase === "idle") {
      void session.loadCatalogs();
    }
  }, [eventChannelReady, runtimeReady, session.catalogPhase, session.loadCatalogs]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!runtimeReady || !eventChannelReady || session.phase === "streaming") {
      return;
    }
    if (await session.createSession(projectPath)) {
      setProjectPath("");
      setProjectSelectionError(null);
      setProjectDialogOpen(false);
      closeSidebarOnNarrowScreen(setSidebarOpen);
    }
  }

  function openProjectDialog() {
    projectDialogTrigger.current = document.activeElement as HTMLElement | null;
    setProjectSelectionError(null);
    setProjectDialogOpen(true);
  }

  function closeProjectDialog() {
    if (session.phase === "creating" || selectingProject) {
      return;
    }
    setProjectPath("");
    setProjectSelectionError(null);
    setProjectDialogOpen(false);
    window.setTimeout(() => projectDialogTrigger.current?.focus(), 0);
  }

  async function chooseProjectDirectory() {
    if (session.phase === "creating" || selectingProject) {
      return;
    }
    setProjectSelectionError(null);
    setSelectingProject(true);
    try {
      const selected = await selectProjectDirectory();
      if (selected !== null) {
        setProjectPath(selected);
      }
    } catch (selectionError) {
      setProjectSelectionError(formatProjectSelectionError(selectionError));
    } finally {
      setSelectingProject(false);
    }
  }

  async function createSession(cwd?: string) {
    if (!cwd) {
      openProjectDialog();
      return;
    }
    if (await session.createSession(cwd)) {
      closeSidebarOnNarrowScreen(setSidebarOpen);
    }
  }

  async function openSession(selected: AgentSessionSummary) {
    if (await session.openSession(selected.path)) {
      closeSidebarOnNarrowScreen(setSidebarOpen);
    }
  }

  function sendPrompt(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) {
      return;
    }
    const prompt = draft;
    shouldStickToBottom.current = true;
    setAtConversationBottom(true);
    setDraft("");
    void session.sendPrompt(prompt);
  }

  const runtimeMessage = getRuntimeMessage(runtime);
  const eventChannelFailed = session.eventConnection === "error";
  const sessionError =
    session.error && !session.error.startsWith("AGENT_EVENT_") ? session.error : null;

  return (
    <div
      className="desktop-shell"
      data-sidebar-open={sidebarOpen}
      style={{ "--sidebar-width": `${sidebarOpen ? sidebarWidth : 0}px` } as CSSProperties}
    >
      <AppSidebar
        open={sidebarOpen}
        width={sidebarWidth}
        activeCwd={session.cwd}
        activeSessionPath={session.sessionPath}
        sessions={session.sessions}
        catalogPhase={session.catalogPhase}
        phase={session.phase}
        runtime={runtime}
        onAddProject={openProjectDialog}
        onNewSession={(cwd) => void createSession(cwd)}
        onSelectSession={(selected) => void openSession(selected)}
        onRefresh={() => void session.loadCatalogs()}
        onClose={() => setSidebarOpen(false)}
        onWidthChange={setSidebarWidth}
      />
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭侧边栏"
        />
      )}

      <main className="workspace-main">
        <header className="topbar">
          <div className="topbar-title-group">
            {!sidebarOpen && (
              <button
                className="icon-button sidebar-open-button"
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开侧边栏"
                title="打开侧边栏"
              >
                <Menu size={19} />
              </button>
            )}
            <div className="topbar-title">
              <span>{hasSession ? workspaceName : "Pi Desktop"}</span>
              <h1>{hasSession ? conversationTitle : "会话工作台"}</h1>
            </div>
          </div>
          <RuntimeStatusControl runtime={runtime} eventConnection={session.eventConnection} />
        </header>

        <section className="conversation-shell" aria-label="Pi 会话工作台">
          <div className="notice-stack">
            {runtimeMessage && (
              <div className="inline-alert" role="alert">
                <AlertTriangle size={17} />
                <span>{runtimeMessage}</span>
                <button type="button" onClick={() => void runtime.refresh()}>
                  <RefreshCw size={15} />
                  重新检测
                </button>
              </div>
            )}
            {eventChannelFailed && (
              <div className="inline-alert" role="alert">
                <AlertTriangle size={17} />
                <span>{session.error ?? "AGENT_EVENT_LISTEN_FAILED: 无法接收 Pi 事件"}</span>
                <button type="button" onClick={session.retryEventListener}>
                  <RefreshCw size={15} />
                  重新连接
                </button>
              </div>
            )}
            {session.catalogError && (
              <div className="inline-alert inline-alert-secondary" role="alert">
                <AlertTriangle size={17} />
                <span>{session.catalogError}</span>
                <button type="button" onClick={() => void session.loadCatalogs()}>
                  <RefreshCw size={15} />
                  重试同步
                </button>
              </div>
            )}
            {session.modelFallbackMessage && (
              <p className="inline-notice">{session.modelFallbackMessage}</p>
            )}
            {sessionError && !projectDialogOpen && (
              <p className="inline-alert inline-alert-text" role="alert">
                {sessionError}
              </p>
            )}
          </div>

          <div
            className="conversation-scroll"
            aria-live="polite"
            ref={conversationScroll}
            onScroll={(event) => {
              const target = event.currentTarget;
              const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 72;
              shouldStickToBottom.current = atBottom;
              setAtConversationBottom(atBottom);
            }}
          >
            <div className="thread-content-column-stack">
              <div className={`thread-body${hasSession && session.messages.length > 0 ? "" : " thread-body-empty"}`}>
                {!hasSession ? (
                  <EmptyWorkspace
                    loading={session.catalogPhase === "loading"}
                    hasSavedSessions={session.sessions.length > 0}
                    disabled={!runtimeReady || !eventChannelReady}
                    onAddProject={openProjectDialog}
                    onOpenSidebar={() => setSidebarOpen(true)}
                  />
                ) : session.messages.length === 0 ? (
                  <div className="empty-conversation">
                    <img className="empty-product-logo" src={appIconUrl} alt="" aria-hidden="true" />
                    <h2>开始对话</h2>
                    <p>直接输入即可，Pi 会在 {workspaceName} 的项目上下文中执行。</p>
                  </div>
                ) : (
                  <div className="message-stream">
                    {session.messages.map((message) => (
                      <article className={`message message-${message.role}`} key={message.id}>
                        <p className="message-role">{message.role === "user" ? "你" : "Pi"}</p>
                        <div className="message-content">
                          {message.content ||
                            (session.phase === "streaming" ? (
                              <span className="message-loading">
                                <LoaderCircle className="spin" size={15} />
                                正在响应
                              </span>
                            ) : message.role === "assistant" && (message.tools?.length ?? 0) === 0 ? (
                              <span className="message-empty">本次任务没有返回文本。</span>
                            ) : null)}
                        </div>
                        {message.tools && message.tools.length > 0 && (
                          <ToolExecutionList tools={message.tools} />
                        )}
                      </article>
                    ))}
                    <div ref={messagesEnd} />
                  </div>
                )}
              </div>

              {hasSession && (
                <ChatComposer
                  workspaceName={workspaceName}
                  draft={draft}
                  phase={session.phase}
                  eventConnection={session.eventConnection}
                  models={session.models}
                  configuration={session.configuration}
                  configuring={session.configuring}
                  canSend={canSend}
                  onDraftChange={setDraft}
                  onModelChange={(provider, id) => void session.updateModel(provider, id)}
                  onThinkingLevelChange={(level) => void session.updateThinkingLevel(level)}
                  onSend={sendPrompt}
                  onAbort={() => void session.abort()}
                />
              )}
              {hasSession && session.messages.length > 0 && !atConversationBottom && (
                <button
                  className="scroll-latest-button"
                  type="button"
                  aria-label="跳到最新消息"
                  title="跳到最新消息"
                  onClick={() => {
                    shouldStickToBottom.current = true;
                    setAtConversationBottom(true);
                    scrollConversationToBottom(conversationScroll.current, messagesEnd.current);
                  }}
                >
                  <ArrowDown size={16} />
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      {projectDialogOpen && (
        <ProjectDialog
          path={projectPath}
          creating={session.phase === "creating"}
          selecting={selectingProject}
          disabled={!runtimeReady || !eventChannelReady}
          error={projectSelectionError ?? sessionError}
          onSelectPath={() => void chooseProjectDirectory()}
          onSubmit={createProject}
          onClose={closeProjectDialog}
        />
      )}
    </div>
  );
}

function ToolExecutionList({ tools }: { tools: ToolExecution[] }) {
  return (
    <ul className="tool-execution-list" aria-label="工具执行状态">
      {tools.map((tool) => (
        <li className={`tool-execution tool-execution-${tool.status}`} key={tool.id}>
          <ToolStatusIcon status={tool.status} />
          <span>{tool.name}</span>
          <small>{getToolStatusLabel(tool.status)}</small>
        </li>
      ))}
    </ul>
  );
}

function ToolStatusIcon({ status }: { status: ToolExecution["status"] }) {
  if (status === "running") {
    return <LoaderCircle className="spin" size={14} aria-hidden="true" />;
  }
  if (status === "completed") {
    return <CheckCircle2 size={14} aria-hidden="true" />;
  }
  if (status === "failed") {
    return <CircleX size={14} aria-hidden="true" />;
  }
  return <Ban size={14} aria-hidden="true" />;
}

function getToolStatusLabel(status: ToolExecution["status"]): string {
  return {
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  }[status];
}

interface EmptyWorkspaceProps {
  loading: boolean;
  hasSavedSessions: boolean;
  disabled: boolean;
  onAddProject: () => void;
  onOpenSidebar: () => void;
}

function EmptyWorkspace({
  loading,
  hasSavedSessions,
  disabled,
  onAddProject,
  onOpenSidebar,
}: EmptyWorkspaceProps) {
  return (
    <div className="empty-workspace">
      {loading ? (
        <LoaderCircle className="spin" size={36} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <img className="empty-product-logo" src={appIconUrl} alt="" aria-hidden="true" />
      )}
      <h2>{hasSavedSessions ? "选择一个 Pi 会话" : "添加项目并开始会话"}</h2>
      <p>
        {hasSavedSessions
          ? "从侧边栏继续已有工作，或为项目创建新会话。"
          : "项目会使用本机 Pi 配置，并保存在 Pi 的原生会话目录中。"}
      </p>
      <div className="empty-workspace-actions">
        {hasSavedSessions && (
          <button className="secondary-button" type="button" onClick={onOpenSidebar}>
            <MessageSquarePlus size={16} />
            查看会话
          </button>
        )}
        <button className="primary-button" type="button" onClick={onAddProject} disabled={disabled}>
          <FolderPlus size={16} />
          添加项目
        </button>
      </div>
    </div>
  );
}

interface ProjectDialogProps {
  path: string;
  creating: boolean;
  selecting: boolean;
  disabled: boolean;
  error: string | null;
  onSelectPath: () => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

function ProjectDialog({
  path,
  creating,
  selecting,
  disabled,
  error,
  onSelectPath,
  onSubmit,
  onClose,
}: ProjectDialogProps) {
  const canSubmit = !disabled && !creating && !selecting && path.trim().length > 0;

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !creating && !selecting) {
        onClose();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [creating, onClose, selecting]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="project-dialog-header">
          <div>
            <h2 id="project-dialog-title">添加项目</h2>
            <p>从资源管理器选择 Pi 可以访问的本机项目文件夹。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={creating || selecting}
            aria-label="关闭"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <span className="project-source-label">项目文件夹</span>
          <button
            className={`project-folder-picker${path ? " project-folder-picker-selected" : ""}`}
            type="button"
            onClick={onSelectPath}
            disabled={disabled || creating || selecting}
            aria-label={path ? "重新选择项目文件夹" : "选择项目文件夹"}
            autoFocus
          >
            {selecting ? (
              <LoaderCircle className="spin" size={22} aria-hidden="true" />
            ) : path ? (
              <FolderOpen size={22} aria-hidden="true" />
            ) : (
              <FolderPlus size={22} aria-hidden="true" />
            )}
            <span className="project-folder-picker-copy">
              <strong>
                {selecting
                  ? "正在打开资源管理器"
                  : path
                    ? getWorkspaceName(path)
                    : "选择项目文件夹"}
              </strong>
              <small title={path || undefined}>
                {path || "使用系统文件夹选择器选择项目"}
              </small>
            </span>
          </button>
          {error && (
            <p className="project-dialog-error" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
          <div className="project-dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
              disabled={creating || selecting}
            >
              取消
            </button>
            <button className="primary-button" type="submit" disabled={!canSubmit}>
              {creating ? <LoaderCircle className="spin" size={15} /> : <FolderPlus size={15} />}
              {creating ? "正在添加" : "添加并创建会话"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function getWorkspaceName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return "未选择项目";
  }
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function getSessionTitle(session: AgentSessionSummary): string {
  return session.name || session.firstMessage || "未命名会话";
}

function getRuntimeMessage(runtime: ReturnType<typeof useRuntimeStatus>): string | null {
  if (runtime.phase === "error") {
    return `RUNTIME_STATUS_FAILED: ${runtime.message}`;
  }
  if (runtime.phase === "ready" && runtime.status.status === "unavailable") {
    return `${runtime.status.error?.code ?? "RUNTIME_UNAVAILABLE"}: ${runtime.status.error?.message ?? "未找到可用 Pi 运行时"}`;
  }
  return null;
}

function formatProjectSelectionError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return "PROJECT_DIRECTORY_SELECTION_FAILED: 无法打开资源管理器，请重试";
}

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= 900;
}

function closeSidebarOnNarrowScreen(setOpen: (open: boolean) => void) {
  if (isNarrowViewport()) {
    setOpen(false);
  }
}

function readSidebarWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem("pi-desktop.sidebar-width"));
    if (Number.isFinite(stored) && stored >= 232 && stored <= 360) {
      return Math.round(stored);
    }
  } catch {
    // Fall through to the target product's default rail width.
  }
  return 300;
}

function scrollConversationToBottom(
  scrollElement: HTMLDivElement | null,
  endElement: HTMLDivElement | null,
) {
  if (scrollElement?.scrollTo) {
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "auto" });
    return;
  }
  endElement?.scrollIntoView?.({ block: "end" });
}
