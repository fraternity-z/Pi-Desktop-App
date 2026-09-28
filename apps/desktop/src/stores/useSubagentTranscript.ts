import { useEffect, useState } from "react";
import type { SubagentMessage, SubagentSnapshot } from "../ipc/agent";
import { readSubagentTranscript } from "../ipc/subagentTranscript";

interface State { key: string; messages?: SubagentMessage[]; loading: boolean; error?: string }

export function useSubagentTranscript(sessionId: string | undefined, subagent: SubagentSnapshot) {
  const key = JSON.stringify([sessionId, subagent.id]);
  const [state, setState] = useState<State>({ key, loading: false });
  const [retry, setRetry] = useState(0);
  const { id, transcriptAvailable, transcriptRevision, status } = subagent;
  useEffect(() => {
    if (!transcriptAvailable) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      setState((previous) => ({ key, ...(previous.key === key ? { messages: previous.messages } : {}), loading: true }));
      try {
        if (!sessionId) throw new Error("请先打开所属主会话，再读取完整子代理记录");
        const result = await readSubagentTranscript(sessionId, id, controller.signal);
        if (!controller.signal.aborted) setState({ key, messages: result.messages, loading: false });
      } catch (error) {
        if (!controller.signal.aborted) setState((previous) => ({ key, ...(previous.key === key ? { messages: previous.messages } : {}), loading: false,
          error: error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "完整子代理记录读取失败，请重试" }));
      }
      if (!controller.signal.aborted && (status === "running" || status === "pending")) timer = setTimeout(() => { void load(); }, 500);
    };
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [key, sessionId, id, transcriptAvailable, transcriptRevision, status, retry]);
  const current = state.key === key ? state : undefined;
  return {
    messages: transcriptAvailable ? current?.messages : subagent.messages,
    loading: transcriptAvailable === true && (current?.loading === true || (!current?.messages && !current?.error)),
    error: transcriptAvailable ? current?.error : undefined,
    retry: () => setRetry((value) => value + 1),
  };
}
