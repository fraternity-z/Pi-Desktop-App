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
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage, TimelineStatus } from "../stores/useChatSession";
import { MarkdownContent } from "./MarkdownContent";

interface ConversationTimelineProps {
  messages: ChatMessage[];
  streaming: boolean;
}

type TimelineGroup =
  | { kind: "message"; id: string; message: ChatMessage }
  | { kind: "activity"; id: string; messages: ChatMessage[] };

export const ConversationTimeline = memo(function ConversationTimeline({
  messages,
  streaming,
}: ConversationTimelineProps) {
  const activeThinkingId = useMemo(
    () => findActiveThinkingId(messages, streaming),
    [messages, streaming],
  );
  const groups = useMemo(() => groupTimelineMessages(messages), [messages]);
  const copyTargets = useMemo(() => findTurnCopyTargets(messages, streaming), [messages, streaming]);
  const showLiveStatus = streaming && activeThinkingId === null;

  return (
    <div className="message-stream" aria-busy={streaming}>
      {groups.map((group) => {
        const lastMessage = group.kind === "message" ? group.message : group.messages.at(-1);
        const copyText = lastMessage ? copyTargets.get(lastMessage.id) : undefined;
        return (
          <Fragment key={`${group.kind}:${group.id}`}>
            {group.kind === "message" ? (
              <TimelineItem
                message={group.message}
                live={group.message.id === activeThinkingId}
              />
            ) : (
              <div className="timeline-activity-group">
                {group.messages.map((message) => (
                  <TimelineItem
                    key={message.id}
                    message={message}
                    live={message.id === activeThinkingId}
                  />
                ))}
              </div>
            )}
            {copyText && <TurnCopyAction text={copyText} />}
          </Fragment>
        );
      })}
      {showLiveStatus && (
        <div className="timeline-live-status" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={14} />
          <span className="timeline-live-label">Pi 正在处理</span>
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
      <article
        className="timeline-row timeline-user"
        data-optimistic={message.optimistic || undefined}
      >
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
    const failed = message.status === "failed";
    return (
      <div
        className={`timeline-system${failed ? " timeline-system-error" : ""}`}
        role={failed ? "alert" : "status"}
      >
        {failed ? <CircleX size={14} /> : <Check size={14} />}
        <span className="timeline-system-message">{message.content}</span>
      </div>
    );
  }
  return <AssistantMessage message={message} />;
});

const AssistantMessage = memo(function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <article className="timeline-row timeline-assistant" data-status={message.status}>
      <div className="assistant-message-content">
        {message.content ? (
          <MarkdownContent>{message.content}</MarkdownContent>
        ) : (
          <span className="message-empty">本次任务没有返回文本。</span>
        )}
      </div>
    </article>
  );
});

const TurnCopyAction = memo(function TurnCopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copyTurn() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="timeline-turn-actions">
      <button
        type="button"
        className="icon-button message-copy-button"
        onClick={() => void copyTurn()}
        aria-label={copied ? "回复已复制" : "复制本轮回复"}
        title={copied ? "已复制" : "复制本轮回复"}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
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
      data-live={live || undefined}
      aria-busy={live}
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
  const statusLabel = toolStatusLabel(status);
  const summary = (
    <>
      <span className="timeline-tool-icon" aria-hidden="true">
        <ToolIcon status={status} />
      </span>
      <span className="timeline-tool-copy">
        <strong className="timeline-tool-name" title={message.toolName ?? "tool"}>
          {message.toolName ?? "tool"}
        </strong>
        <small className="timeline-tool-status" aria-live="polite">
          {statusLabel}
        </small>
      </span>
      {hasDetails && <ChevronDown className="timeline-tool-chevron" size={14} />}
    </>
  );

  if (!hasDetails) {
    return (
      <div
        className={`timeline-tool timeline-tool-${status}`}
        data-status={status}
        aria-busy={status === "running"}
      >
        {summary}
      </div>
    );
  }

  return (
    <details
      className={`timeline-tool timeline-tool-${status}`}
      data-status={status}
      aria-busy={status === "running"}
    >
      <summary>{summary}</summary>
      <div
        className="timeline-tool-details"
        role="region"
        aria-label={`${message.toolName ?? "tool"} 调用详情`}
      >
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

function groupTimelineMessages(messages: ChatMessage[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const message of messages) {
    const activity =
      message.role === "thinking" || message.role === "tool" || message.role === "system";
    const previous = groups.at(-1);
    if (activity && previous?.kind === "activity") {
      previous.messages.push(message);
      continue;
    }
    groups.push(
      activity
        ? { kind: "activity", id: message.id, messages: [message] }
        : { kind: "message", id: message.id, message },
    );
  }
  return groups;
}

function findTurnCopyTargets(messages: ChatMessage[], streaming: boolean): Map<string, string> {
  const targets = new Map<string, string>();
  let turnStart = 0;

  function addCompletedTurn(end: number, completed: boolean) {
    if (!completed || end < turnStart) return;
    const turn = messages.slice(turnStart, end + 1);
    const copyText = turn
      .filter((message) => message.role === "assistant" && message.content.trim())
      .map((message) => message.content.trim())
      .join("\n\n");
    const target = messages[end];
    if (copyText && target) targets.set(target.id, copyText);
  }

  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role !== "user") continue;
    addCompletedTurn(index - 1, true);
    turnStart = index + 1;
  }
  addCompletedTurn(messages.length - 1, !streaming);
  return targets;
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
