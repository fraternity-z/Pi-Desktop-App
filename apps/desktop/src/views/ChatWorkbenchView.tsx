import { AlertTriangle, FolderOpen, LoaderCircle, Menu, RefreshCw, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppSidebar } from "../components/AppSidebar";
import { ChatComposer } from "../components/ChatComposer";
import { RuntimeStatusControl } from "../components/RuntimeStatusControl";
import { useChatSession } from "../stores/useChatSession";
import { useRuntimeStatus } from "../stores/useRuntimeStatus";

export function ChatWorkbenchView() {
  const runtime = useRuntimeStatus();
  const session = useChatSession();
  const [workspace, setWorkspace] = useState("");
  const [connectedWorkspace, setConnectedWorkspace] = useState("");
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const eventChannelReady = session.eventConnection === "ready";
  const hasSession = session.sessionId !== null;
  const workspaceName = getWorkspaceName(connectedWorkspace || workspace);
  const canSend =
    hasSession &&
    session.phase === "ready" &&
    eventChannelReady &&
    draft.trim().length > 0;

  useEffect(() => {
    messagesEnd.current?.scrollIntoView?.({ block: "end" });
  }, [session.messages]);

  async function createSession(event: FormEvent) {
    event.preventDefault();
    if (!runtimeReady || !eventChannelReady || session.phase !== "idle") {
      return;
    }
    const path = workspace.trim();
    const created = await session.createSession(path);
    if (created) {
      setConnectedWorkspace(path);
    }
  }

  function sendPrompt(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) {
      return;
    }
    const prompt = draft;
    setDraft("");
    void session.sendPrompt(prompt);
  }

  const runtimeMessage = getRuntimeMessage(runtime);
  const eventChannelFailed = session.eventConnection === "error";
  const sessionError =
    session.error && !session.error.startsWith("AGENT_EVENT_") ? session.error : null;

  return (
    <div className="desktop-shell">
      <AppSidebar
        open={sidebarOpen}
        workspacePath={connectedWorkspace}
        workspaceName={workspaceName}
        sessionId={session.sessionId}
        runtime={runtime}
        onClose={() => setSidebarOpen(false)}
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
            <button
              className="icon-button sidebar-open-button"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开侧边栏"
              title="打开侧边栏"
            >
              <Menu size={19} />
            </button>
            <div className="topbar-title">
              <span>Pi Desktop</span>
              <h1>{hasSession ? workspaceName : "会话工作台"}</h1>
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
            {session.modelFallbackMessage && (
              <p className="inline-notice">{session.modelFallbackMessage}</p>
            )}
            {sessionError && (
              <p className="inline-alert inline-alert-text" role="alert">
                {sessionError}
              </p>
            )}
          </div>

          <div className="conversation-scroll" aria-live="polite">
            {!hasSession ? (
              <WorkspaceConnector
                workspace={workspace}
                runtimeReady={runtimeReady}
                eventChannelReady={eventChannelReady}
                creating={session.phase === "creating"}
                onWorkspaceChange={setWorkspace}
                onSubmit={createSession}
              />
            ) : session.messages.length === 0 ? (
              <div className="empty-conversation">
                <TerminalSquare size={42} strokeWidth={1.5} aria-hidden="true" />
                <h2>准备好在 {workspaceName} 中开始</h2>
                <p>输入任务后，Pi 的响应会在这里实时显示。</p>
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
                        ) : message.role === "assistant" ? (
                          <span className="message-empty">本次任务没有返回文本。</span>
                        ) : null)}
                    </div>
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
              canSend={canSend}
              onDraftChange={setDraft}
              onSend={sendPrompt}
              onAbort={() => void session.abort()}
            />
          )}
        </section>
      </main>
    </div>
  );
}

interface WorkspaceConnectorProps {
  workspace: string;
  runtimeReady: boolean;
  eventChannelReady: boolean;
  creating: boolean;
  onWorkspaceChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

function WorkspaceConnector({
  workspace,
  runtimeReady,
  eventChannelReady,
  creating,
  onWorkspaceChange,
  onSubmit,
}: WorkspaceConnectorProps) {
  const canConnect = runtimeReady && eventChannelReady && workspace.trim().length > 0 && !creating;

  return (
    <div className="workspace-connector">
      <div className="workspace-connector-heading">
        <FolderOpen size={38} strokeWidth={1.5} aria-hidden="true" />
        <h2>连接一个工作区</h2>
        <p>选择 Pi 执行任务时使用的绝对目录。</p>
      </div>
      <form className="workspace-form" onSubmit={onSubmit}>
        <label htmlFor="workspace-path">工作区</label>
        <div className="workspace-input-row">
          <input
            id="workspace-path"
            value={workspace}
            onChange={(event) => onWorkspaceChange(event.target.value)}
            placeholder="C:\\path\\to\\project"
            disabled={creating}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="primary-button" type="submit" disabled={!canConnect}>
            {creating ? "正在连接" : "创建会话"}
          </button>
        </div>
      </form>
    </div>
  );
}

function getWorkspaceName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return "未连接工作区";
  }
  return normalized.split(/[\\/]/).at(-1) || normalized;
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
