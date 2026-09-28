import { ArrowDown, Bot } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { SubagentSnapshot } from "../ipc/agent";
import type { ChatMessage } from "../stores/useChatSession";
import { useSubagentTranscript } from "../stores/useSubagentTranscript";
import { ConversationTimeline } from "./ConversationTimeline";
import { subagentStatusLabels } from "./SubagentGroup";

export function SubagentTranscriptPanel({ subagent, sessionId }: { subagent: SubagentSnapshot; sessionId?: string }) {
  const full = useSubagentTranscript(sessionId, subagent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const messages = useMemo<ChatMessage[]>(() => {
    if (!full.messages) return [];
    const transcript = full.messages.map((message, index): ChatMessage => ({
      ...message, id: `${subagent.id}:message:${index}`,
      ...(message.role === "tool" ? { status: message.isError ? "failed" : message.isError === false || message.toolOutput ? "completed" : subagent.status === "running" ? "running" : "cancelled" } : message.isError ? { status: "failed" } : {}),
    }));
    return transcript[0]?.role === "user" && transcript[0].content === subagent.task
      ? transcript : [{ id: `${subagent.id}:task`, role: "user", content: subagent.task }, ...transcript];
  }, [subagent.id, full.messages, subagent.task, subagent.status]);

  useLayoutEffect(() => {
    if (following.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, subagent.status]);
  useLayoutEffect(() => {
    const body = contentRef.current;
    if (!body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  return <section className="subagent-transcript" aria-label={`${subagent.agent} 子代理会话`}>
    <header className="subagent-transcript-heading"><Bot size={16} aria-hidden="true" /><strong>{subagent.agent}</strong><span>{subagentStatusLabels[subagent.status]}</span>{subagent.model && <small title={subagent.model}>{subagent.model}</small>}</header>
    <div className="subagent-transcript-scroll" ref={scrollRef} tabIndex={0} aria-label="子代理会话消息" onScroll={(event) => {
      const target = event.currentTarget;
      const bottom = target.scrollHeight - target.scrollTop - target.clientHeight <= 80;
      following.current = bottom; setAtBottom(bottom);
    }}><div ref={contentRef}>
      <ConversationTimeline messages={messages} streaming={false} />
      {full.loading && <p className="subagent-empty" role="status">正在读取完整子代理会话…</p>}
      {full.error && <p className="subagent-truncation" role="alert">{full.error} <button type="button" onClick={full.retry}>重试</button></p>}
      {!full.loading && !full.error && full.messages?.length === 0 && <p className="subagent-empty">{subagent.status === "pending" ? "等待主代理开始任务。" : subagent.status === "running" ? "正在执行，等待子代理返回会话内容。" : "此任务未返回会话内容。"}</p>}
      {!subagent.transcriptAvailable && (subagent.truncated || subagent.messages.some((message) => message.toolInput?.truncated || message.toolOutput?.truncated)) && <p className="subagent-truncation" role="note">此旧版记录未保存完整内容，缺失部分无法恢复。</p>}
    </div></div>
    {!atBottom && <button type="button" className="subagent-jump" aria-label="跳到子代理最新消息" onClick={() => { following.current = true; setAtBottom(true); if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }}><ArrowDown size={16} /></button>}
    <footer className="subagent-readonly">子代理由主 Agent 驱动，此处会话只读。</footer>
  </section>;
}
