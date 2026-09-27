import { useCallback, useRef, useState } from "react";

import type { SessionLifecycle } from "../stores/useChatSession";
import { loadToolPermissionPreference, type ToolPermissionPreference } from "../stores/useToolPermissions";

interface ComposerInput {
  draft: string;
  attachments: string[];
  pastedImagePaths: string[];
  attachmentError: string | null;
  pendingAttachments: number;
  permission: ToolPermissionPreference;
}

function emptyInput(): ComposerInput {
  return { draft: "", attachments: [], pastedImagePaths: [], attachmentError: null, pendingAttachments: 0, permission: loadToolPermissionPreference() };
}

/** Input is renderer memory, keyed by identity rather than the draft's workspace. */
export function useComposerInput(sessionId: string | null, lifecycle: SessionLifecycle | null) {
  const entries = useRef(new Map<string, ComposerInput>());
  const aliases = useRef(new Map<string, string>());
  const materializing = useRef<string | null>(null);
  const previous = useRef({ sessionId, lifecycle });
  const [, render] = useState(0);
  const key = sessionId ?? "";

  // Materialization replaces the draft identity before sendPrompt settles. Keep
  // its input (including edits made while creating) and pending async callbacks.
  if (previous.current.sessionId !== sessionId) {
    const source = previous.current.sessionId;
    if (source && sessionId && previous.current.lifecycle === "draft" &&
      lifecycle === "live" && materializing.current === source) {
      const input = entries.current.get(source);
      if (input) entries.current.set(sessionId, input);
      entries.current.delete(source);
      aliases.current.set(source, sessionId);
      materializing.current = null;
    }
    previous.current = { sessionId, lifecycle };
  }

  const resolve = useCallback((source: string) => aliases.current.get(source) ?? source, []);
  const read = useCallback(() => {
    const target = resolve(key);
    let input = entries.current.get(target);
    if (!input) { input = emptyInput(); entries.current.set(target, input); }
    return input;
  }, [key, resolve]);
  const update = useCallback((transform: (current: ComposerInput) => ComposerInput) => {
    entries.current.set(resolve(key), transform(read()));
    render((revision) => revision + 1);
  }, [key, read, resolve]);
  const beginSubmission = useCallback(() => {
    if (lifecycle === "draft") materializing.current = key;
  }, [key, lifecycle]);
  const beginNavigation = useCallback(() => { materializing.current = null; }, []);

  return { ...read(), read, update, beginSubmission, beginNavigation };
}
