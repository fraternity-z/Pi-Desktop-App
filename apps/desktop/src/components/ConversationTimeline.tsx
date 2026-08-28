import {
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleX,
  Copy,
  LoaderCircle,
  Square,
  Wrench,
} from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useState } from "react";

import type {
  ChatMessage,
  SessionTimerState,
  TimelineStatus,
} from "../stores/useChatSession";
import { MarkdownContent } from "./MarkdownContent";

interface ConversationTimelineProps {
  messages: ChatMessage[];
  streaming: boolean;
  timer?: SessionTimerState | null;
}

type TimelineGroup =
  | { kind: "message"; id: string; message: ChatMessage }
  | { kind: "tools"; id: string; messages: ChatMessage[] };

type TimelineTurn = {
  id: string;
  user: ChatMessage | null;
  messages: ChatMessage[];
};

export const ConversationTimeline = memo(function ConversationTimeline({
  messages,
  streaming,
  timer = null,
}: ConversationTimelineProps) {
  const turns = useMemo(() => {
    const grouped = groupTimelineTurns(messages);
    return grouped.length > 0
      ? grouped
      : [{ id: "empty", user: null, messages: [] } satisfies TimelineTurn];
  }, [messages]);
  const copyTargets = useMemo(
    () => findTurnCopyTargets(messages, streaming),
    [messages, streaming],
  );

  return (
    <div className="message-stream" aria-busy={streaming}>
      {turns.map((turn, index) => {
        const isCurrentTurn = streaming && index === turns.length - 1;
        const groups = groupTimelineMessages(turn.messages);
        const liveThinking = findLiveThinking(turn.messages, isCurrentTurn);
        // The store attaches a timer to each user message. Keep the prop as a
        // compatibility fallback for projections created before per-turn timers.
        const turnTimer = resolveTurnTimer(
          turn.user?.timer,
          index === turns.length - 1 ? timer : null,
        );
        return (
          <section className="timeline-turn" data-turn-id={turn.id} key={turn.id}>
            {turn.user && <TimelineItem message={turn.user} streaming={isCurrentTurn} />}
            {turnTimer && <ConversationTimer timer={turnTimer} />}
            {groups.map((group) => {
              const lastMessage = group.kind === "message" ? group.message : group.messages.at(-1);
              const copyText = lastMessage ? copyTargets.get(lastMessage.id) : undefined;
              return (
                <Fragment key={group.kind + ":" + group.id}>
                  {group.kind === "message" ? (
                    <TimelineItem message={group.message} streaming={isCurrentTurn} />
                  ) : (
                    <ToolGroup messages={group.messages} />
                  )}
                  {copyText && <TurnCopyAction text={copyText} />}
                </Fragment>
              );
            })}
            {isCurrentTurn && <ThinkingInline content={liveThinking?.content || "正在思考"} />}
          </section>
        );
      })}
    </div>
  );
});

const ConversationTimer = memo(function ConversationTimer({
  timer,
}: {
  timer: SessionTimerState | null;
}) {
  const startedAt = timer?.startedAt;
  const active = startedAt !== null && startedAt !== undefined && timer?.endedAt === null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active, startedAt]);

  if (startedAt === null || startedAt === undefined) return null;
  const elapsed = timer?.durationMs ?? Math.max(0, (timer?.endedAt ?? now) - startedAt);
  const label = formatSessionDuration(elapsed);
  return (
    <div
      className="conversation-run-timer"
      data-active={active ? "true" : undefined}
      role="status"
      aria-live={active ? "polite" : undefined}
      aria-label={"会话用时 " + label}
    >
      <span>用时 {label}</span>
      <ChevronRight size={16} aria-hidden="true" />
    </div>
  );
});

export function formatSessionDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return hours > 0 ? days + "d " + hours + "h" : days + "d";
  if (hours > 0) return minutes > 0 ? hours + "h " + minutes + "m" : hours + "h";
  if (minutes > 0) return seconds > 0 ? minutes + "m " + seconds + "s" : minutes + "m";
  return seconds + "s";
}

function resolveTurnTimer(
  userTimer: SessionTimerState | undefined,
  fallback: SessionTimerState | null,
): SessionTimerState | null {
  if (!userTimer) return fallback;
  if (
    fallback?.endedAt === null &&
    (userTimer.endedAt !== null || fallback.startedAt !== userTimer.startedAt)
  ) {
    return fallback;
  }
  return userTimer;
}

const TimelineItem = memo(function TimelineItem({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
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
  if (message.role === "system") {
    const failed = message.status === "failed";
    return (
      <div
        className={"timeline-system" + (failed ? " timeline-system-error" : "")}
        role={failed ? "alert" : "status"}
      >
        {failed ? <CircleX size={14} /> : <Check size={14} />}
        <span className="timeline-system-message">{message.content}</span>
      </div>
    );
  }
  if (message.role === "assistant") {
    return <AssistantMessage message={message} streaming={streaming} />;
  }
  // Thinking is rendered once as the live inline indicator below the transcript.
  return null;
});

const AssistantMessage = memo(function AssistantMessage({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  if (!message.content && streaming) return null;
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

const ThinkingInline = memo(function ThinkingInline({ content }: { content: string }) {
  return (
    <div className="timeline-thinking-inline" role="status" aria-live="polite" aria-busy="true">
      <MarkdownContent className="timeline-thinking-text">{content}</MarkdownContent>
    </div>
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

const ToolGroup = memo(function ToolGroup({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(false);
  const running = messages.some((message) => message.status === "running");
  const failed = messages.some((message) => message.status === "failed");
  const cancelled = messages.some((message) => message.status === "cancelled");
  const names = [...new Set(messages.map((message) => message.toolName?.trim()).filter(Boolean))] as string[];
  const summary = toolGroupLabel(names, messages.length);

  return (
    <section className="timeline-tool-group" data-tool-count={messages.length}>
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        data-status={running ? "running" : failed ? "failed" : cancelled ? "cancelled" : "completed"}
        aria-busy={running}
      >
        <summary
          className="timeline-tool-group-summary"
          onClick={(event) => {
            event.preventDefault();
            setOpen((current) => !current);
          }}
        >
          <span className="timeline-tool-group-icon" aria-hidden="true">
            <ToolGroupIcon running={running} failed={failed} cancelled={cancelled} />
          </span>
          <span className="timeline-tool-group-summary-text" title={summary}>
            {summary}
          </span>
          <span className="timeline-tool-group-chevron" aria-hidden="true" />
        </summary>
        {open && (
          <div className="timeline-tool-group-body">
            {messages.map((message) => (
              <ToolDetailRow key={message.id} message={message} />
            ))}
          </div>
        )}
      </details>
    </section>
  );
});

function ToolDetailRow({ message }: { message: ChatMessage }) {
  const status = message.status ?? "pending";
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(message.toolCallId || message.content);
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
          {toolStatusLabel(status)}
        </small>
      </span>
      {hasDetails && <span className="timeline-tool-chevron" aria-hidden="true" />}
    </>
  );

  if (!hasDetails) {
    return (
      <div
        className={"timeline-tool timeline-tool-" + status}
        data-status={status}
        aria-busy={status === "running"}
      >
        {summary}
      </div>
    );
  }

  return (
    <details
      className={"timeline-tool timeline-tool-" + status}
      data-status={status}
      aria-busy={status === "running"}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        {summary}
      </summary>
      {open && (
        <div
          className="timeline-tool-details"
          role="region"
          aria-label={(message.toolName ?? "tool") + " 调用详情"}
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
      )}
    </details>
  );
}

function ToolGroupIcon({
  running,
  failed,
  cancelled,
}: {
  running: boolean;
  failed: boolean;
  cancelled: boolean;
}) {
  if (running) return <LoaderCircle className="spin" size={14} />;
  if (failed) return <CircleX size={14} />;
  if (cancelled) return <Square size={13} />;
  return <Wrench size={14} />;
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

function toolGroupLabel(names: string[], count: number): string {
  if (count === 1) return "已使用 " + (names[0] ?? "工具");
  return "已运行" + count + "个工具";
}

function groupTimelineMessages(messages: ChatMessage[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let previousWasTool = false;
  for (const message of messages) {
    if (message.role === "thinking") {
      // A hidden thinking segment still separates non-consecutive tool calls.
      previousWasTool = false;
      continue;
    }
    if (message.role === "tool") {
      const previous = groups.at(-1);
      if (previousWasTool && previous?.kind === "tools") {
        previous.messages.push(message);
      } else {
        groups.push({ kind: "tools", id: message.id, messages: [message] });
      }
      previousWasTool = true;
      continue;
    }
    groups.push({ kind: "message", id: message.id, message });
    previousWasTool = false;
  }
  return groups;
}

function groupTimelineTurns(messages: ChatMessage[]): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  let current: TimelineTurn = { id: "prelude", user: null, messages: [] };

  for (const message of messages) {
    if (message.role === "user") {
      if (current.user || current.messages.length > 0) turns.push(current);
      current = { id: message.id, user: message, messages: [] };
    } else {
      current.messages.push(message);
    }
  }

  if (current.user || current.messages.length > 0) turns.push(current);
  return turns;
}

function findLiveThinking(messages: ChatMessage[], streaming: boolean): ChatMessage | null {
  if (!streaming) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "thinking" && message.content.trim()) return message;
    if (message.role === "user") break;
  }
  return null;
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
