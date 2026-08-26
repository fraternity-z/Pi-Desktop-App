import {
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleX,
  Copy,
  LoaderCircle,
  Square,
  Wrench,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage, TimelineStatus } from "../stores/useChatSession";
import { MarkdownContent } from "./MarkdownContent";

interface ConversationTimelineProps {
  messages: ChatMessage[];
  streaming: boolean;
}

export const ConversationTimeline = memo(function ConversationTimeline({
  messages,
  streaming,
}: ConversationTimelineProps) {
  const activeThinkingId = useMemo(
    () => findActiveThinkingId(messages, streaming),
    [messages, streaming],
  );

  return (
    <div className="message-stream">
      {messages.map((message) => (
        <TimelineItem
          key={message.id}
          message={message}
          live={message.id === activeThinkingId}
        />
      ))}
      {streaming && (
        <div className="timeline-live-status" role="status">
          <LoaderCircle className="spin" size={14} />
          <span>Pi 正在处理</span>
        </div>
      )}
    </div>
  );
});

const TimelineItem = memo(function TimelineItem({
  message,
  live,
}: {
  message: ChatMessage;
  live: boolean;
}) {
  if (message.role === "user") {
    return (
      <article className="timeline-row timeline-user">
        <div className="user-message-bubble">{message.content}</div>
      </article>
    );
  }
  if (message.role === "thinking") {
    return <ThinkingBlock content={message.content} live={live} />;
  }
  if (message.role === "tool") {
    return <ToolRow message={message} />;
  }
  if (message.role === "system") {
    return (
      <div className={`timeline-system${message.status === "failed" ? " timeline-system-error" : ""}`} role={message.status === "failed" ? "alert" : "status"}>
        {message.status === "failed" ? <CircleX size={14} /> : <Check size={14} />}
        <span>{message.content}</span>
      </div>
    );
  }
  return <AssistantMessage message={message} />;
});

const AssistantMessage = memo(function AssistantMessage({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
  }
  return (
    <article className="timeline-row timeline-assistant">
      <div className="assistant-message-content">
        {message.content ? (
          <MarkdownContent>{message.content}</MarkdownContent>
        ) : (
          <span className="message-empty">本次任务没有返回文本。</span>
        )}
      </div>
      {message.content && (
        <div className="message-inline-actions">
          <button
            type="button"
            className="icon-button message-copy-button"
            onClick={() => void copyMessage()}
            aria-label="复制回复"
            title="复制"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}
    </article>
  );
});

function ThinkingBlock({ content, live }: { content: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);

  useEffect(() => {
    if (live !== wasLive.current) {
      setOpen(live);
      wasLive.current = live;
    }
  }, [live]);

  return (
    <details
      className="thinking-block"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {live ? <LoaderCircle className="spin" size={14} /> : <Brain size={14} />}
        <span>{live ? "思考中" : "思考过程"}</span>
        <ChevronDown className="thinking-chevron" size={14} />
      </summary>
      <MarkdownContent className="thinking-content">{content}</MarkdownContent>
    </details>
  );
}

function ToolRow({ message }: { message: ChatMessage }) {
  const status = message.status ?? "pending";
  const hasDetails = Boolean(message.toolCallId || message.content);
  const summary = (
    <>
      <span className="timeline-tool-icon" aria-hidden="true">
        <ToolIcon status={status} />
      </span>
      <span className="timeline-tool-copy">
        <strong className="timeline-tool-name">{message.toolName ?? "tool"}</strong>
        <small>工具调用</small>
      </span>
      <span className="timeline-tool-status">{toolStatusLabel(status)}</span>
      {hasDetails && <ChevronDown className="timeline-tool-chevron" size={14} />}
    </>
  );

  if (!hasDetails) {
    return <div className={`timeline-tool timeline-tool-${status}`}>{summary}</div>;
  }

  return (
    <details className={`timeline-tool timeline-tool-${status}`}>
      <summary>{summary}</summary>
      <div className="timeline-tool-details">
        {message.content && (
          <section>
            <span>执行结果</span>
            <pre>{message.content}</pre>
          </section>
        )}
        {message.toolCallId && (
          <section>
            <span>调用 ID</span>
            <code>{message.toolCallId}</code>
          </section>
        )}
      </div>
    </details>
  );
}

function ToolIcon({ status }: { status: TimelineStatus }) {
  if (status === "pending") return <Circle size={14} />;
  if (status === "running") return <LoaderCircle className="spin" size={14} />;
  if (status === "failed") return <CircleX size={14} />;
  if (status === "cancelled") return <Square size={13} />;
  if (status === "completed") return <CheckCircle2 size={14} />;
  return <Wrench size={14} />;
}

function toolStatusLabel(status: TimelineStatus): string {
  return {
    pending: "等待执行",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  }[status];
}

function findActiveThinkingId(messages: ChatMessage[], streaming: boolean): string | null {
  if (!streaming) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role === "user" || message.role === "assistant") return null;
    if (message.role === "thinking") return message.id;
  }
  return null;
}
