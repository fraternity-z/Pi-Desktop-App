import {
  Brain,
  Check,
  ChevronDown,
  CircleX,
  Copy,
  LoaderCircle,
  Square,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import type { ChatMessage, TimelineStatus } from "../stores/useChatSession";
import { MarkdownContent } from "./MarkdownContent";

interface ConversationTimelineProps {
  messages: ChatMessage[];
  streaming: boolean;
}

export function ConversationTimeline({ messages, streaming }: ConversationTimelineProps) {
  return (
    <div className="message-stream">
      {messages.map((message, index) => (
        <TimelineItem
          key={message.id}
          message={message}
          live={streaming && index === messages.length - 1}
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
}

function TimelineItem({ message, live }: { message: ChatMessage; live: boolean }) {
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
}

function AssistantMessage({ message }: { message: ChatMessage }) {
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
}

function ThinkingBlock({ content, live }: { content: string; live: boolean }) {
  return (
    <details className="thinking-block" open={live}>
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
  const status = message.status ?? "completed";
  return (
    <div className={`timeline-tool timeline-tool-${status}`}>
      <ToolIcon status={status} />
      <span className="timeline-tool-name">{message.toolName ?? "tool"}</span>
      <small>{toolStatusLabel(status)}</small>
    </div>
  );
}

function ToolIcon({ status }: { status: TimelineStatus }) {
  if (status === "running") return <LoaderCircle className="spin" size={14} />;
  if (status === "failed") return <CircleX size={14} />;
  if (status === "cancelled") return <Square size={13} />;
  return <Wrench size={14} />;
}

function toolStatusLabel(status: TimelineStatus): string {
  return {
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  }[status];
}
