import { useCallback, useEffect, useRef, useState } from "react";

import {
  getPromptDocument,
  savePromptDocument,
  type PromptDocument,
  type PromptKind,
} from "../ipc/settings";

export function usePromptDocument(kind: PromptKind) {
  const [document, setDocument] = useState<PromptDocument | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const requestId = useRef(0);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const request = ++requestId.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const loaded = await getPromptDocument(kind);
      if (request !== requestId.current) return;
      setDocument(loaded);
      setDraft(loaded.content ?? "");
    } catch (cause) {
      if (request === requestId.current) setError(formatPromptError(cause));
    } finally {
      if (request === requestId.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }, [kind]);

  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
      pending.current = false;
    };
  }, [refresh]);

  async function save(content: string | null = draft) {
    if (!document || pending.current) return;
    pending.current = true;
    const request = ++requestId.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await savePromptDocument(kind, content, document.content);
      if (request !== requestId.current) return;
      setDocument(saved);
      setDraft(saved.content ?? "");
      setStatus(
        content === null
          ? "已移除用户级提示词；新会话生效。"
          : "已保存；新会话生效。现有会话需重启应用后重新打开。",
      );
    } catch (cause) {
      if (request === requestId.current) setError(formatPromptError(cause));
    } finally {
      if (request === requestId.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  return {
    document,
    draft,
    busy,
    error,
    status,
    refresh,
    save,
    dirty: document !== null && draft !== (document.content ?? ""),
    setDraft: (value: string) => {
      setDraft(value);
      setStatus(null);
    },
  };
}

function formatPromptError(cause: unknown): string {
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
  return "PROMPT_REQUEST_FAILED: 提示词操作失败，请确认桌面运行时可用后重试";
}
