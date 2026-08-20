import { ArrowUp, Folder, Square } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";

import type { AgentEventConnection, ChatPhase } from "../stores/useChatSession";

interface ChatComposerProps {
  workspaceName: string;
  draft: string;
  phase: ChatPhase;
  eventConnection: AgentEventConnection;
  canSend: boolean;
  onDraftChange: (value: string) => void;
  onSend: (event?: FormEvent) => void;
  onAbort: () => void;
}

export function ChatComposer({
  workspaceName,
  draft,
  phase,
  eventConnection,
  canSend,
  onDraftChange,
  onSend,
  onAbort,
}: ChatComposerProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  const streaming = phase === "streaming";

  return (
    <div className="composer-dock">
      <form className="composer-frame" onSubmit={onSend}>
        <div className="composer-context" title={workspaceName}>
          <Folder size={15} />
          <span>{workspaceName}</span>
        </div>
        <textarea
          aria-label="发送给 Pi 的消息"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={streaming ? "Pi 正在处理当前任务" : "给 Pi 一个任务"}
          disabled={streaming || eventConnection !== "ready"}
          rows={3}
        />
        <div className="composer-actions">
          <span className="composer-status" aria-live="polite">
            {streaming
              ? "Pi 正在处理"
              : eventConnection === "ready"
                ? "会话已就绪"
                : "事件通道未连接"}
          </span>
          {streaming ? (
            <button
              className="composer-submit composer-stop"
              type="button"
              onClick={onAbort}
              aria-label="停止"
              title="停止"
            >
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="composer-submit"
              type="submit"
              disabled={!canSend}
              aria-label="发送"
              title="发送"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
