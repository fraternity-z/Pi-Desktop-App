import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  abortAgent,
  clampThinkingLevel,
  clearAgentQueue,
  configureAgentSession,
  createAgentSession,
  deleteAgentSessions,
  listAgentModels,
  listAgentSessions,
  listenToAgentEvents,
  normalizeThinkingLevels,
  openAgentSession,
  promptAgent,
  THINKING_LEVELS,
  type AgentEvent,
  type AgentModel,
  type AgentSession,
  type AgentSessionSummary,
  type ContextUsage,
  type DeleteAgentSessionsResult,
  type PromptStreamingBehavior,
  type QueuedMessages,
  type SessionConfiguration,
  type ThinkingLevel,
  isThinkingLevel,
} from "../ipc/agent";
import {
  ensureConversationWorkspace,
  getWorkspaceState,
  rememberWorkspace,
  removeRecentWorkspace,
  type WorkspaceState,
} from "../ipc/workspace";
import {
  displayPromptContent,
  normalizeAttachedPaths,
  promptWithAttachedPaths,
} from "../components/composerAttachments";
import { appendMonotonicText } from "./chatStream";

export type TimelineRole = "user" | "assistant" | "thinking" | "tool" | "system";
export type TimelineStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ChatMessage {
  id: string;
  role: TimelineRole;
  content: string;
  timestamp?: string;
  timer?: SessionTimerState;
  optimistic?: boolean;
  toolCallId?: string;
  toolName?: string;
  status?: TimelineStatus;
}

export interface ToolExecution {
  id: string;
  name: string;
  status: TimelineStatus;
}

export type ChatPhase = "idle" | "creating" | "ready" | "streaming";
export type AgentEventConnection = "connecting" | "ready" | "error";
export type CatalogPhase = "idle" | "loading" | "ready" | "error";
export type SessionLifecycle = "draft" | "live" | "persisted";

export interface SessionTimerState {
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
}

export interface SessionListItem extends Omit<AgentSessionSummary, "path"> {
  path: string | null;
  lifecycle: SessionLifecycle;
}

interface SessionProjection {
  sessionId: string;
  sessionPath: string | null;
  cwd: string;
  messages: ChatMessage[];
  configuration: SessionConfiguration | null;
  lifecycle: SessionLifecycle;
  createdAt: string;
  modifiedAt: string;
  phase: "ready" | "streaming";
  error: string | null;
  modelFallbackMessage: string | null;
  queuedMessages: QueuedMessages;
  queuePaused: boolean;
  contextUsage: ContextUsage | null;
  runStartedAt: number | null;
  runEndedAt: number | null;
  runDurationMs: number | null;
  activeRunUserId: string | null;
}

export interface ChatSessionState {
  phase: ChatPhase;
  sessionId: string | null;
  sessionPath: string | null;
  cwd: string;
  messages: ChatMessage[];
  sessions: SessionListItem[];
  models: AgentModel[];
  configuration: SessionConfiguration | null;
  displayThinkingLevel: ThinkingLevel | null;
  configuring: boolean;
  catalogPhase: CatalogPhase;
  catalogError: string | null;
  error: string | null;
  modelFallbackMessage: string | null;
  eventConnection: AgentEventConnection;
  recentWorkspaces: string[];
  conversationHome: string;
  runningSessionIds: string[];
  queuedMessages: QueuedMessages;
  queuePaused: boolean;
  contextUsage: ContextUsage | null;
  timer: SessionTimerState | null;
  loadCatalogs: () => Promise<void>;
  createSession: (cwd: string) => Promise<boolean>;
  createConversation: () => Promise<boolean>;
  openSession: (session: SessionListItem) => Promise<boolean>;
  removeWorkspace: (cwd: string) => Promise<void>;
  deleteSessions: (sessionIds: string[]) => Promise<DeleteAgentSessionsResult>;
  prepareConfiguration: () => Promise<boolean>;
  updateModel: (provider: string, id: string) => Promise<void>;
  updateThinkingLevel: (level: ThinkingLevel) => Promise<void>;
  sendPrompt: (
    text: string,
    behavior?: PromptStreamingBehavior,
    activeToolNames?: string[],
    attachedPaths?: string[],
  ) => Promise<boolean>;
  clearQueue: () => Promise<void>;
  abort: () => Promise<void>;
  retryEventListener: () => void;
}

const EMPTY_WORKSPACE_STATE: WorkspaceState = {
  recentWorkspaces: [],
  lastWorkspace: null,
  conversationHome: "",
};

export function useChatSession(): ChatSessionState {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [projections, setProjections] = useState<Record<string, SessionProjection>>({});
  const [catalogSessions, setCatalogSessions] = useState<AgentSessionSummary[]>([]);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(EMPTY_WORKSPACE_STATE);
  const [navigationPending, setNavigationPending] = useState(false);
  const [configuringSessionId, setConfiguringSessionId] = useState<string | null>(null);
  const [catalogPhase, setCatalogPhase] = useState<CatalogPhase>("idle");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [eventConnection, setEventConnection] = useState<AgentEventConnection>("connecting");
  const [listenerAttempt, setListenerAttempt] = useState(0);
  const projectionsRef = useRef(projections);
  const activeSessionIdRef = useRef(activeSessionId);
  const lastEventSequence = useRef(0);
  const itemSequence = useRef(1);
  const catalogRequestId = useRef(0);
  const promptRequests = useRef(new Map<string, number>());
  const materializingDrafts = useRef(new Set<string>());
  const draftSequence = useRef(1);
  const restoreAttempted = useRef(false);
  const lastConfirmedThinkingLevel = useRef<ThinkingLevel | null>(null);
  const loadCatalogsRef = useRef<() => Promise<void>>(async () => undefined);
  const pendingProjectionRender = useRef<(() => void) | null>(null);

  const commitProjections = useCallback(
    (update: (current: Record<string, SessionProjection>) => Record<string, SessionProjection>) => {
      const next = update(projectionsRef.current);
      projectionsRef.current = next;
      setProjections(next);
    },
    [],
  );

  const scheduleProjectionRender = useCallback(() => {
    if (pendingProjectionRender.current) return;
    pendingProjectionRender.current = scheduleAfterLayout(() => {
      pendingProjectionRender.current = null;
      setProjections(projectionsRef.current);
    });
  }, []);

  const nextItemId = useCallback((sessionId: string) => {
    return `${sessionId}:${itemSequence.current++}`;
  }, []);

  const installSession = useCallback(
    (
      session: AgentSession,
      lifecycle: Exclude<SessionLifecycle, "draft">,
      replacedSessionId?: string,
    ) => {
      const replaced = replacedSessionId ? projectionsRef.current[replacedSessionId] : undefined;
      const loaded = projectionFromSession(session, nextItemId, lifecycle, replaced);
      commitProjections((current) => {
        const existing = current[session.sessionId];
        const projection = existing
          ? {
              ...loaded,
              messages:
                existing.messages.length > 0 &&
                (existing.phase === "streaming" || existing.messages.length >= loaded.messages.length)
                  ? existing.messages
                  : loaded.messages,
              error: existing.error,
              queuedMessages: existing.phase === "streaming" ? existing.queuedMessages : loaded.queuedMessages,
              queuePaused: existing.phase === "streaming" ? existing.queuePaused : loaded.queuePaused,
              runStartedAt: existing.runStartedAt ?? loaded.runStartedAt,
              runEndedAt: existing.runEndedAt ?? loaded.runEndedAt,
              runDurationMs: existing.runDurationMs ?? loaded.runDurationMs,
              activeRunUserId:
                existing.messages.length > 0 &&
                (existing.phase === "streaming" || existing.messages.length >= loaded.messages.length)
                  ? existing.activeRunUserId
                  : loaded.activeRunUserId,
            }
          : loaded;
        const next = { ...current, [session.sessionId]: projection };
        if (replacedSessionId && replacedSessionId !== session.sessionId) delete next[replacedSessionId];
        return next;
      });
      activeSessionIdRef.current = session.sessionId;
      setActiveSessionId(session.sessionId);
      setGlobalError(null);
      if (session.cwd) {
        void rememberWorkspace(session.cwd)
          .then(setWorkspaceState)
          .catch((error: unknown) => setCatalogError(formatError(error)));
      }
      return projectionsRef.current[session.sessionId] ?? loaded;
    },
    [commitProjections, nextItemId],
  );

  const loadCatalogs = useCallback(async () => {
    const requestId = ++catalogRequestId.current;
    setCatalogPhase("loading");
    setCatalogError(null);
    const [sessionResult, modelResult, workspaceResult] = await Promise.allSettled([
      listAgentSessions(),
      listAgentModels(),
      getWorkspaceState(),
    ]);
    if (requestId !== catalogRequestId.current) return;

    const failures: string[] = [];
    if (sessionResult.status === "fulfilled") {
      setCatalogSessions(sessionResult.value);
      const persistedPaths = new Set(sessionResult.value.map((session) => normalizePath(session.path)));
      commitProjections((current) => {
        let changed = false;
        const next = { ...current };
        for (const [sessionId, projection] of Object.entries(current)) {
          if (
            projection.lifecycle === "live" &&
            projection.sessionPath &&
            persistedPaths.has(normalizePath(projection.sessionPath))
          ) {
            next[sessionId] = { ...projection, lifecycle: "persisted" };
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
    else failures.push(formatError(sessionResult.reason));
    if (modelResult.status === "fulfilled") setModels(modelResult.value);
    else failures.push(formatError(modelResult.reason));
    if (workspaceResult.status === "fulfilled") setWorkspaceState(workspaceResult.value);
    else failures.push(formatError(workspaceResult.reason));
    setCatalogPhase(failures.length > 0 ? "error" : "ready");
    setCatalogError(failures.length > 0 ? failures.join(" · ") : null);

    if (
      !restoreAttempted.current &&
      !activeSessionIdRef.current &&
      sessionResult.status === "fulfilled" &&
      workspaceResult.status === "fulfilled"
    ) {
      restoreAttempted.current = true;
      const lastWorkspace = workspaceResult.value.lastWorkspace;
      const recent = lastWorkspace
        ? sessionResult.value.find((session) => samePath(session.cwd, lastWorkspace))
        : undefined;
      if (recent) {
        setNavigationPending(true);
        try {
          installSession(await openAgentSession(recent.path), "persisted");
        } catch (error) {
          setGlobalError(formatError(error));
        } finally {
          setNavigationPending(false);
        }
      }
    }
  }, [commitProjections, installSession]);

  loadCatalogsRef.current = loadCatalogs;

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    setEventConnection("connecting");
    listenToAgentEvents((event) => {
      if (!active || event.seq <= lastEventSequence.current) return;
      const expected = lastEventSequence.current + 1;
      lastEventSequence.current = event.seq;
      if (event.seq !== expected) {
        setGlobalError(`AGENT_EVENT_SEQUENCE_GAP: 事件序号不连续（期望 ${expected}，收到 ${event.seq}）`);
      }
      const current = projectionsRef.current;
      const projection = current[event.sessionId];
      if (projection) {
        const updated = applyAgentEvent(projection, event, () => nextItemId(event.sessionId));
        if (updated !== projection) {
          // Bridge events can arrive faster than the display refresh rate. Keep the
          // authoritative projection current, then publish at most once per frame.
          projectionsRef.current = {
            ...current,
            [event.sessionId]: { ...updated, modifiedAt: new Date().toISOString() },
          };
          scheduleProjectionRender();
        }
      }
      if (event.name === "agent.settled") void loadCatalogsRef.current();
    })
      .then((stopListening) => {
        if (active) {
          unlisten = stopListening;
          setEventConnection("ready");
        } else {
          stopListening();
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setEventConnection("error");
        setGlobalError(`AGENT_EVENT_LISTEN_FAILED: ${formatError(error)}`);
      });
    return () => {
      active = false;
      unlisten?.();
      pendingProjectionRender.current?.();
      pendingProjectionRender.current = null;
    };
  }, [listenerAttempt, nextItemId, scheduleProjectionRender]);

  const createSession = useCallback(
    async (cwd: string) => {
      if (eventConnection !== "ready") {
        setGlobalError("AGENT_EVENT_LISTEN_UNAVAILABLE: 事件通道尚未就绪，请先重新连接");
        return false;
      }
      const requestedCwd = cwd.trim();
      if (!requestedCwd) {
        setGlobalError("WORKSPACE_PATH_INVALID: 请输入绝对工作区路径");
        return false;
      }
      if (navigationPending) return false;
      setNavigationPending(true);
      setGlobalError(null);
      try {
        const workspace = await rememberWorkspace(requestedCwd);
        setWorkspaceState(workspace);
        const canonicalCwd =
          workspace.recentWorkspaces.find((path) => samePath(path, requestedCwd)) ?? requestedCwd;
        const draft = createDraftProjection(`draft:${draftSequence.current++}`, canonicalCwd);
        commitProjections((current) => ({ ...current, [draft.sessionId]: draft }));
        activeSessionIdRef.current = draft.sessionId;
        setActiveSessionId(draft.sessionId);
        return true;
      } catch (error) {
        setGlobalError(formatError(error));
        return false;
      } finally {
        setNavigationPending(false);
      }
    },
    [commitProjections, eventConnection, navigationPending],
  );

  const createConversation = useCallback(async () => {
    if (eventConnection !== "ready" || navigationPending) return false;
    setGlobalError(null);
    const draft = createDraftProjection(`draft:${draftSequence.current++}`, "");
    commitProjections((current) => ({ ...current, [draft.sessionId]: draft }));
    activeSessionIdRef.current = draft.sessionId;
    setActiveSessionId(draft.sessionId);
    return true;
  }, [commitProjections, eventConnection, navigationPending]);

  const openSession = useCallback(
    async (session: SessionListItem) => {
      if (session.lifecycle !== "persisted") {
        const projection = projectionsRef.current[session.id];
        if (!projection) {
          setGlobalError("DRAFT_SESSION_NOT_FOUND: 草稿会话已失效，请重新创建");
          return false;
        }
        activeSessionIdRef.current = session.id;
        setActiveSessionId(session.id);
        setGlobalError(null);
        return true;
      }
      if (eventConnection !== "ready" || !session.path || navigationPending) return false;
      setNavigationPending(true);
      setGlobalError(null);
      try {
        installSession(await openAgentSession(session.path), "persisted");
        return true;
      } catch (error) {
        setGlobalError(formatError(error));
        return false;
      } finally {
        setNavigationPending(false);
      }
    },
    [eventConnection, installSession, navigationPending],
  );

  const removeWorkspace = useCallback(async (cwd: string) => {
    try {
      setWorkspaceState(await removeRecentWorkspace(cwd));
    } catch (error) {
      setCatalogError(formatError(error));
      throw error;
    }
  }, []);

  const deleteSessions = useCallback(
    async (sessionIds: string[]): Promise<DeleteAgentSessionsResult> => {
      const ids = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))];
      if (ids.length === 0) {
        return { deletedSessionIds: [], missingSessionIds: [] };
      }
      // Ignore catalog requests that started before the files were removed.
      const operationId = ++catalogRequestId.current;
      try {
        const result = await deleteAgentSessions(ids);
        const handled = new Set([...result.deletedSessionIds, ...result.missingSessionIds]);
        commitProjections((current) => {
          const next = Object.fromEntries(
            Object.entries(current).filter(([id]) => !handled.has(id)),
          );
          return Object.keys(next).length === Object.keys(current).length ? current : next;
        });
        setCatalogSessions((current) => current.filter((session) => !handled.has(session.id)));
        for (const id of handled) {
          promptRequests.current.delete(id);
          materializingDrafts.current.delete(id);
        }
        setConfiguringSessionId((current) => (current && handled.has(current) ? null : current));
        if (activeSessionIdRef.current && handled.has(activeSessionIdRef.current)) {
          activeSessionIdRef.current = null;
          setActiveSessionId(null);
        }
        if (catalogRequestId.current === operationId) {
          setCatalogPhase("ready");
          setCatalogError(null);
        }
        return result;
      } catch (error) {
        if (catalogRequestId.current === operationId) {
          setCatalogPhase("error");
          setCatalogError(formatError(error));
        }
        throw error;
      }
    },
    [commitProjections],
  );

  const materializeDraft = useCallback(
    async (draftSessionId: string): Promise<SessionProjection | null> => {
      const draft = projectionsRef.current[draftSessionId];
      if (!draft) return null;
      if (draft.lifecycle !== "draft") return draft;
      if (materializingDrafts.current.has(draftSessionId)) return null;
      materializingDrafts.current.add(draftSessionId);
      setNavigationPending(true);
      commitProjections((current) => updateProjectionError(current, draftSessionId, null));
      try {
        const cwd = draft.cwd || (await ensureConversationWorkspace());
        return installSession(await createAgentSession(cwd), "live", draftSessionId);
      } catch (error) {
        commitProjections((current) =>
          updateProjectionError(current, draftSessionId, formatError(error)),
        );
        return null;
      } finally {
        materializingDrafts.current.delete(draftSessionId);
        setNavigationPending(false);
      }
    },
    [commitProjections, installSession],
  );

  const prepareConfiguration = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const projection = sessionId ? projectionsRef.current[sessionId] : undefined;
    if (!sessionId || !projection || eventConnection !== "ready") return false;
    if (projection.lifecycle !== "draft") return projection.configuration !== null;
    return Boolean((await materializeDraft(sessionId))?.configuration);
  }, [eventConnection, materializeDraft]);

  const updateConfiguration = useCallback(
    async (update: {
      model?: Pick<AgentModel, "provider" | "id">;
      thinkingLevel?: ThinkingLevel;
    }) => {
      let sessionId = activeSessionIdRef.current;
      let projection: SessionProjection | null | undefined = sessionId
        ? projectionsRef.current[sessionId]
        : undefined;
      if (sessionId && projection?.lifecycle === "draft") {
        projection = await materializeDraft(sessionId);
        sessionId = projection?.sessionId ?? null;
      }
      if (
        !sessionId ||
        !projection ||
        projection.phase !== "ready" ||
        configuringSessionId
      ) {
        return;
      }
      setConfiguringSessionId(sessionId);
      commitProjections((current) => updateProjectionError(current, sessionId, null));
      try {
        const configuration = await configureAgentSession(sessionId, update);
        commitProjections((current) => {
          const currentProjection = current[sessionId];
          return currentProjection
            ? { ...current, [sessionId]: { ...currentProjection, configuration } }
            : current;
        });
      } catch (error) {
        commitProjections((current) => updateProjectionError(current, sessionId, formatError(error)));
      } finally {
        setConfiguringSessionId(null);
      }
    },
    [commitProjections, configuringSessionId, materializeDraft],
  );

  const updateModel = useCallback(
    async (provider: string, id: string) => updateConfiguration({ model: { provider, id } }),
    [updateConfiguration],
  );
  const updateThinkingLevel = useCallback(
    async (thinkingLevel: ThinkingLevel) => updateConfiguration({ thinkingLevel }),
    [updateConfiguration],
  );

  const sendPrompt = useCallback(
    async (
      text: string,
      behavior?: PromptStreamingBehavior,
      activeToolNames?: string[],
      attachedPaths: string[] = [],
    ) => {
      let sessionId = activeSessionIdRef.current;
      let projection: SessionProjection | null | undefined = sessionId
        ? projectionsRef.current[sessionId]
        : undefined;
      const paths = normalizeAttachedPaths(attachedPaths);
      const content = text.trim() || (paths.length > 0 ? "请查看附加的文件。" : "");
      const wireContent = promptWithAttachedPaths(content, paths);
      if (
        !sessionId ||
        !projection ||
        !content ||
        eventConnection !== "ready" ||
        configuringSessionId === sessionId
      ) {
        return false;
      }
      const requestStartedAt = Date.now();
      if (projection.lifecycle === "draft") {
        projection = await materializeDraft(sessionId);
        if (!projection) return false;
        sessionId = projection.sessionId;
      }
      const queued = projection.phase === "streaming";
      const streamingBehavior = queued ? (behavior ?? "steer") : undefined;
      const promptTools = queued
        ? undefined
        : resolvePromptTools(projection.configuration, activeToolNames);
      const previousQueue = projection.queuedMessages;
      const requestId = (promptRequests.current.get(sessionId) ?? 0) + 1;
      promptRequests.current.set(sessionId, requestId);
      commitProjections((current) => {
        const currentProjection = current[sessionId];
        if (!currentProjection) return current;
        const startedAt = queued ? currentProjection.runStartedAt : requestStartedAt;
        const userId = queued ? null : nextItemId(sessionId);
        return {
          ...current,
          [sessionId]: {
            ...currentProjection,
            phase: "streaming",
            runStartedAt: startedAt,
            runEndedAt: queued ? currentProjection.runEndedAt : null,
            runDurationMs: queued ? currentProjection.runDurationMs : null,
            activeRunUserId: queued
              ? currentProjection.activeRunUserId
              : userId,
            modifiedAt: new Date().toISOString(),
            error: null,
            queuePaused: false,
            queuedMessages: queued
              ? appendQueuedMessage(currentProjection.queuedMessages, streamingBehavior ?? "steer", content)
              : currentProjection.queuedMessages,
            messages: queued
              ? currentProjection.messages
              : [
                  ...currentProjection.messages,
                  {
                    id: userId!,
                    role: "user",
                    content,
                    optimistic: true,
                    timestamp: new Date().toISOString(),
                    timer: createRunningTimer(requestStartedAt),
                  },
                ],
          },
        };
      });
      try {
        await promptAgent(sessionId, wireContent, streamingBehavior, promptTools);
        void loadCatalogsRef.current();
        return true;
      } catch (error) {
        if ((promptRequests.current.get(sessionId) ?? 0) !== requestId) return false;
        const message = formatError(error);
        commitProjections((current) => {
          const currentProjection = current[sessionId];
          if (!currentProjection) return current;
          const finished = queued ? null : finishProjectionTimer(currentProjection, Date.now());
          return {
            ...current,
            [sessionId]: {
              ...currentProjection,
              phase: queued ? "streaming" : "ready",
              ...(finished ?? {}),
              error: message,
              queuedMessages: queued ? previousQueue : currentProjection.queuedMessages,
              messages: [
                ...(finished?.messages ?? currentProjection.messages).map((item) =>
                  item.role === "tool" && item.status === "running"
                    ? { ...item, status: "failed" as const }
                    : item,
                ),
                { id: nextItemId(sessionId), role: "system", content: message, status: "failed" },
              ],
            },
          };
        });
        return false;
      }
    },
    [commitProjections, configuringSessionId, eventConnection, materializeDraft, nextItemId],
  );

  const clearQueue = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const projection = sessionId ? projectionsRef.current[sessionId] : undefined;
    if (!sessionId || !projection || queueSize(projection.queuedMessages) === 0) return;
    const previousQueue = projection.queuedMessages;
    commitProjections((current) => {
      const currentProjection = current[sessionId];
      return currentProjection
        ? {
            ...current,
            [sessionId]: {
              ...currentProjection,
              queuedMessages: emptyQueue(),
              queuePaused: false,
              error: null,
            },
          }
        : current;
    });
    try {
      await clearAgentQueue(sessionId);
    } catch (error) {
      commitProjections((current) => {
        const currentProjection = current[sessionId];
        return currentProjection
          ? {
              ...current,
              [sessionId]: {
                ...currentProjection,
                queuedMessages: previousQueue,
                error: formatError(error),
              },
            }
          : current;
      });
    }
  }, [commitProjections]);

  const abort = useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const currentProjection = sessionId ? projectionsRef.current[sessionId] : undefined;
    if (!sessionId || !currentProjection || currentProjection.lifecycle === "draft") return;
    commitProjections((current) => updateProjectionError(current, sessionId, null));
    try {
      await abortAgent(sessionId);
      commitProjections((current) => {
        const projection = current[sessionId];
        if (!projection) return current;
        const finished = finishProjectionTimer(projection, Date.now());
        return {
          ...current,
          [sessionId]: {
            ...projection,
            phase: "ready",
            ...finished,
            queuePaused: queueSize(projection.queuedMessages) > 0,
            messages: finished.messages.map((item) =>
              item.role === "tool" && item.status === "running"
                ? { ...item, status: "cancelled" as const }
                : item,
            ),
          },
        };
      });
    } catch (error) {
      commitProjections((current) => updateProjectionError(current, sessionId, formatError(error)));
    }
  }, [commitProjections]);

  const retryEventListener = useCallback(() => {
    setGlobalError(null);
    setListenerAttempt((attempt) => attempt + 1);
  }, []);

  const active = activeSessionId ? projections[activeSessionId] : undefined;
  const activeThinkingLevel = active?.configuration?.thinkingLevel ?? null;
  useEffect(() => {
    if (activeThinkingLevel) lastConfirmedThinkingLevel.current = activeThinkingLevel;
  }, [activeThinkingLevel]);
  const sessions = useMemo(
    () => mergeSessionItems(catalogSessions, Object.values(projections)),
    [catalogSessions, projections],
  );
  const phase: ChatPhase = navigationPending ? "creating" : active?.phase ?? "idle";
  const runningSessionIds = Object.values(projections)
    .filter((projection) => projection.phase === "streaming")
    .map((projection) => projection.sessionId);
  const displayThinkingLevel = activeThinkingLevel ?? lastConfirmedThinkingLevel.current;

  return {
    phase,
    sessionId: active?.sessionId ?? null,
    sessionPath: active?.sessionPath ?? null,
    cwd: active?.cwd ?? "",
    messages: active?.messages ?? [],
    sessions,
    models,
    configuration: active?.configuration ?? null,
    displayThinkingLevel,
    configuring: configuringSessionId === active?.sessionId,
    catalogPhase,
    catalogError,
    error: active?.error ?? globalError,
    modelFallbackMessage: active?.modelFallbackMessage ?? null,
    eventConnection,
    recentWorkspaces: workspaceState.recentWorkspaces,
    conversationHome: workspaceState.conversationHome,
    runningSessionIds,
    queuedMessages: active?.queuedMessages ?? emptyQueue(),
    queuePaused: active?.queuePaused ?? false,
    contextUsage: active?.contextUsage ?? null,
    timer: active ? projectionTimer(active) : null,
    loadCatalogs,
    createSession,
    createConversation,
    openSession,
    removeWorkspace,
    deleteSessions,
    prepareConfiguration,
    updateModel,
    updateThinkingLevel,
    sendPrompt,
    clearQueue,
    abort,
    retryEventListener,
  };
}

function projectionFromSession(
  session: AgentSession,
  nextId: (sessionId: string) => string,
  lifecycle: Exclude<SessionLifecycle, "draft">,
  replaced?: SessionProjection,
): SessionProjection {
  let messages = session.messages.map<ChatMessage>((message) => ({
    id: nextId(session.sessionId),
    role: message.role,
    content: message.role === "user" ? displayPromptContent(message.content) : message.content,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.role === "tool"
      ? { status: message.isError ? ("failed" as const) : ("completed" as const) }
      : {}),
  }));
  const restoredStartedAt = replaced?.runStartedAt ?? (session.streaming ? Date.now() : null);
  let activeRunUserId = replaced?.activeRunUserId ?? null;
  if (session.streaming) {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    activeRunUserId = activeRunUserId ?? lastUser?.id ?? null;
    if (lastUser && restoredStartedAt !== null && !lastUser.timer) {
      messages = messages.map((message) =>
        message.id === lastUser.id
          ? { ...message, timer: createRunningTimer(restoredStartedAt) }
          : message,
      );
    }
  }
  return {
    sessionId: session.sessionId,
    sessionPath: session.sessionPath,
    cwd: session.cwd,
    messages,
    configuration: readConfiguration(session.configuration) ?? emptyConfiguration(),
    lifecycle,
    createdAt: replaced?.createdAt ?? new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    queuedMessages: displayQueuedMessages(session.queuedMessages ?? emptyQueue()),
    queuePaused: !session.streaming && queueSize(session.queuedMessages ?? emptyQueue()) > 0,
    phase: session.streaming ? "streaming" : "ready",
    runStartedAt: restoredStartedAt,
    runEndedAt: replaced?.runEndedAt ?? null,
    runDurationMs: replaced?.runDurationMs ?? null,
    activeRunUserId,
    error: null,
    modelFallbackMessage: session.modelFallbackMessage,
    contextUsage: readContextUsage(session.contextUsage),
  };
}

function createDraftProjection(sessionId: string, cwd: string): SessionProjection {
  const now = new Date().toISOString();
  return {
    sessionId,
    sessionPath: null,
    cwd,
    messages: [],
    configuration: null,
    lifecycle: "draft",
    createdAt: now,
    modifiedAt: now,
    phase: "ready",
    runStartedAt: null,
    runEndedAt: null,
    runDurationMs: null,
    activeRunUserId: null,
    error: null,
    modelFallbackMessage: null,
    queuedMessages: emptyQueue(),
    queuePaused: false,
    contextUsage: null,
  };
}

function mergeSessionItems(
  catalog: AgentSessionSummary[],
  projections: SessionProjection[],
): SessionListItem[] {
  const items: SessionListItem[] = catalog.map((session) => ({
    ...session,
    lifecycle: "persisted",
  }));
  for (const projection of projections) {
    const pathIndex = projection.sessionPath
      ? items.findIndex((session) => session.path && samePath(session.path, projection.sessionPath!))
      : -1;
    const idIndex = items.findIndex((session) => session.id === projection.sessionId);
    const existingIndex = pathIndex >= 0 ? pathIndex : idIndex;
    const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
    const firstMessage =
      projection.messages.find((message) => message.role === "user")?.content ?? "";
    const local: SessionListItem = {
      id: projection.sessionId,
      path: projection.sessionPath,
      cwd: projection.cwd,
      name: existing?.name ?? null,
      created: existing?.created ?? projection.createdAt,
      modified:
        existing && existing.modified > projection.modifiedAt
          ? existing.modified
          : projection.modifiedAt,
      messageCount: Math.max(
        existing?.messageCount ?? 0,
        projection.messages.filter(
          (message) => message.role === "user" || message.role === "assistant",
        ).length,
      ),
      firstMessage: firstMessage || existing?.firstMessage || "",
      lifecycle: existing ? "persisted" : projection.lifecycle,
    };
    if (existingIndex >= 0) items[existingIndex] = local;
    else items.push(local);
  }
  return items.sort((left, right) => right.modified.localeCompare(left.modified));
}

function applyAgentEvent(
  projection: SessionProjection,
  event: AgentEvent,
  nextId: () => string,
): SessionProjection {
  if (event.name === "agent.started") {
    if (
      projection.phase !== "streaming" &&
      projection.runEndedAt !== null &&
      (queueSize(projection.queuedMessages) === 0 || projection.queuePaused)
    ) {
      return projection;
    }
    const continuing =
      projection.phase === "streaming" &&
      projection.runStartedAt !== null &&
      projection.runEndedAt === null;
    const startedAt = continuing ? projection.runStartedAt! : Date.now();
    const base = continuing
      ? projection
      : {
          ...projection,
          runStartedAt: startedAt,
          runEndedAt: null,
          runDurationMs: null,
          activeRunUserId: null,
        };
    return {
      ...ensureRunningProjectionTimer(base, startedAt),
      phase: "streaming",
      error: null,
      queuePaused: false,
    };
  }
  if (event.name === "agent.settled") {
    const endedAt = Date.now();
    const finished = finishProjectionTimer(projection, endedAt);
    return {
      ...projection,
      phase: "ready",
      ...finished,
      messages: finished.messages.map((item) =>
        item.role === "tool" && item.status === "running"
          ? { ...item, status: "completed" as const }
          : item,
      ),
    };
  }
  if (event.name === "session.configurationChanged") {
    const configuration = readConfiguration(event.data);
    return configuration ? { ...projection, configuration } : projection;
  }
  if (event.name === "session.usageChanged") {
    return { ...projection, contextUsage: readContextUsage(event.data) };
  }
  if (event.name === "queue.updated") {
    const queuedMessages = readQueuedMessages(event.data);
    return queuedMessages
      ? {
          ...projection,
          queuedMessages,
          queuePaused: queueSize(queuedMessages) > 0 ? projection.queuePaused : false,
        }
      : projection;
  }
  if (event.name === "user.message") {
    if (projection.phase !== "streaming") return projection;
    const wireContent = readEventText(event.data, "content");
    if (!wireContent) return projection;
    const content = displayPromptContent(wireContent);
    const receivedAt = Date.now();
    const optimisticIndex = findLastOptimisticUser(projection.messages, content);
    if (optimisticIndex >= 0) {
      const optimistic = projection.messages[optimisticIndex]!;
      const startedAt = optimistic.timer?.startedAt ?? projection.runStartedAt ?? receivedAt;
      return {
        ...projection,
        phase: "streaming",
        runStartedAt: projection.runStartedAt ?? startedAt,
        runEndedAt: null,
        runDurationMs: null,
        activeRunUserId: optimistic.id,
        messages: projection.messages.map((item, index) =>
          index === optimisticIndex
            ? {
                ...item,
                optimistic: false,
                timer: item.timer ?? createRunningTimer(startedAt),
              }
            : item,
        ),
      };
    }

    const activeIndex = findActiveUserIndex(projection);
    const activeUser = activeIndex >= 0 ? projection.messages[activeIndex] : undefined;
    if (
      activeUser?.role === "user" &&
      activeUser.content === content &&
      activeUser.timer?.endedAt === null &&
      projection.runEndedAt === null
    ) {
      return {
        ...projection,
        phase: "streaming",
        activeRunUserId: activeUser.id,
      };
    }

    const previousMessages = finishPreviousUserTimer(projection, activeIndex, receivedAt);
    const userId = nextId();
    return {
      ...projection,
      phase: "streaming",
      runStartedAt: receivedAt,
      runEndedAt: null,
      runDurationMs: null,
      activeRunUserId: userId,
      messages: [
        ...previousMessages,
        { id: userId, role: "user", content, timer: createRunningTimer(receivedAt) },
      ],
    };
  }
  if (event.name === "message.delta" || event.name === "thinking.delta") {
    if (projection.phase !== "streaming") return projection;
    const delta = readEventText(event.data, "delta");
    if (!delta) return projection;
    const role = event.name === "thinking.delta" ? "thinking" : "assistant";
    const runningProjection = ensureRunningProjectionTimer(projection, Date.now());
    return {
      ...runningProjection,
      messages: appendTimelineText(runningProjection.messages, role, delta, nextId),
    };
  }
  if (event.name.startsWith("tool.")) {
    if (projection.phase !== "streaming") return projection;
    const tool = readToolEvent(event.data);
    if (!tool) return projection;
    const status: TimelineStatus =
      event.name === "tool.started"
        ? "running"
        : event.name === "tool.failed"
          ? "failed"
          : "completed";
    const runningProjection = ensureRunningProjectionTimer(projection, Date.now());
    return {
      ...runningProjection,
      messages: upsertTimelineTool(runningProjection.messages, tool, status, nextId),
    };
  }
  if (event.name === "message.completed") {
    if (!isRecord(event.data) || event.data.reason === "toolUse") return projection;
    const lastUserIndex = findLastRole(projection.messages, "user");
    const hasAssistantResult = projection.messages
      .slice(lastUserIndex + 1)
      .some((item) => item.role === "assistant");
    return hasAssistantResult
      ? projection
      : {
          ...projection,
          messages: [...projection.messages, { id: nextId(), role: "assistant", content: "" }],
        };
  }
  if (event.name === "message.failed") {
    const message = readEventText(event.data, "message");
    if (!message) return projection;
    return {
      ...projection,
      messages: [
        ...projection.messages,
        { id: nextId(), role: "system", content: message, status: "failed" },
      ],
    };
  }
  return projection;
}

function appendTimelineText(
  messages: ChatMessage[],
  role: "assistant" | "thinking",
  delta: string,
  nextId: () => string,
): ChatMessage[] {
  const last = messages.at(-1);
  return last?.role === role
    ? [...messages.slice(0, -1), { ...last, content: appendMonotonicText(last.content, delta) }]
    : [...messages, { id: nextId(), role, content: delta }];
}

function upsertTimelineTool(
  messages: ChatMessage[],
  tool: { toolCallId: string; toolName: string },
  status: TimelineStatus,
  nextId: () => string,
): ChatMessage[] {
  const existing = messages.findIndex(
    (item) => item.role === "tool" && item.toolCallId === tool.toolCallId,
  );
  if (existing < 0) {
    return [
      ...messages,
      {
        id: nextId(),
        role: "tool",
        content: "",
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        status,
      },
    ];
  }
  return messages.map((item, index) =>
    index === existing ? { ...item, toolName: tool.toolName, status } : item,
  );
}

function findLastOptimisticUser(messages: ChatMessage[], content: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role === "user" && item.optimistic && item.content === content) return index;
  }
  return -1;
}

function findLastRole(messages: ChatMessage[], role: TimelineRole): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) return index;
  }
  return -1;
}

function updateProjectionError(
  current: Record<string, SessionProjection>,
  sessionId: string,
  error: string | null,
): Record<string, SessionProjection> {
  const projection = current[sessionId];
  return projection ? { ...current, [sessionId]: { ...projection, error } } : current;
}

function createRunningTimer(startedAt: number): SessionTimerState {
  return { startedAt, endedAt: null, durationMs: null };
}

function finishTimerState(timer: SessionTimerState, endedAt: number): SessionTimerState {
  if (timer.startedAt === null || timer.endedAt !== null) return timer;
  return {
    startedAt: timer.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - timer.startedAt),
  };
}

function findActiveUserIndex(projection: SessionProjection): number {
  if (!projection.activeRunUserId) return -1;
  return projection.messages.findIndex(
    (message) => message.id === projection.activeRunUserId && message.role === "user",
  );
}

function ensureRunningProjectionTimer(
  projection: SessionProjection,
  startedAt: number,
): SessionProjection {
  const restarting = projection.runStartedAt === null || projection.runEndedAt !== null;
  let activeRunUserId = projection.activeRunUserId;
  let activeIndex = findActiveUserIndex(projection);
  let messages = projection.messages;

  // A new agent loop must not reuse the completed user row while the SDK is
  // still delivering its next user.message event.
  if (projection.runEndedAt !== null && activeIndex >= 0) {
    activeRunUserId = null;
    activeIndex = -1;
  }

  if (!activeRunUserId && projection.runStartedAt === null) {
    const lastUserIndex = findLastRole(messages, "user");
    const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
    if (lastUser?.timer && lastUser.timer.endedAt !== null) {
      activeIndex = -1;
    } else if (lastUser) {
      activeRunUserId = lastUser.id;
      activeIndex = lastUserIndex;
    }
  }

  const runStartedAt = restarting ? startedAt : projection.runStartedAt!;
  if (activeIndex >= 0) {
    const currentTimer = messages[activeIndex]?.timer;
    if (
      !currentTimer ||
      currentTimer.endedAt !== null ||
      currentTimer.startedAt !== runStartedAt
    ) {
      messages = messages.map((message, index) =>
        index === activeIndex ? { ...message, timer: createRunningTimer(runStartedAt) } : message,
      );
    }
  }

  return {
    ...projection,
    runStartedAt,
    runEndedAt: null,
    runDurationMs: null,
    activeRunUserId,
    messages,
  };
}

function finishPreviousUserTimer(
  projection: SessionProjection,
  activeIndex: number,
  endedAt: number,
): ChatMessage[] {
  if (activeIndex < 0) return projection.messages;
  const previous = projection.messages[activeIndex];
  if (!previous || previous.role !== "user") return projection.messages;
  const startedAt = previous.timer?.startedAt ?? projection.runStartedAt;
  if (startedAt === null || startedAt === undefined) return projection.messages;
  const timer = finishTimerState(previous.timer ?? createRunningTimer(startedAt), endedAt);
  return projection.messages.map((message, index) =>
    index === activeIndex ? { ...message, timer } : message,
  );
}

function finishProjectionTimer(
  projection: SessionProjection,
  endedAt: number,
): Pick<SessionProjection, "runStartedAt" | "runEndedAt" | "runDurationMs" | "messages"> {
  const fields = finishRunTimer(projection, endedAt);
  let messages = projection.messages;
  let activeIndex = findActiveUserIndex(projection);
  if (activeIndex < 0 && projection.runStartedAt !== null) {
    activeIndex = findLastRole(projection.messages, "user");
  }
  if (activeIndex >= 0) {
    const current = projection.messages[activeIndex];
    const startedAt = current?.timer?.startedAt ?? fields.runStartedAt;
    if (current?.role === "user" && startedAt !== null && startedAt !== undefined) {
      const end = fields.runEndedAt ?? endedAt;
      const timer = finishTimerState(current.timer ?? createRunningTimer(startedAt), end);
      messages = projection.messages.map((message, index) =>
        index === activeIndex ? { ...message, timer } : message,
      );
      if (fields.runStartedAt === null) {
        return {
          runStartedAt: timer.startedAt,
          runEndedAt: timer.endedAt,
          runDurationMs: timer.durationMs,
          messages,
        };
      }
    }
  }
  return { ...fields, messages };
}

function projectionTimer(projection: SessionProjection): SessionTimerState {
  const timer: SessionTimerState = {
    startedAt: projection.runStartedAt,
    endedAt: projection.runEndedAt,
    durationMs: projection.runDurationMs,
  };
  const activeIndex = findActiveUserIndex(projection);
  const userTimer = activeIndex >= 0 ? projection.messages[activeIndex]?.timer : undefined;
  return userTimer &&
    (timer.startedAt === null || userTimer.startedAt === timer.startedAt) &&
    (timer.endedAt === null || userTimer.endedAt === timer.endedAt)
    ? userTimer
    : timer;
}

function finishRunTimer(
  projection: SessionProjection,
  endedAt: number,
): Pick<SessionProjection, "runStartedAt" | "runEndedAt" | "runDurationMs"> {
  if (projection.runStartedAt === null || projection.runEndedAt !== null) {
    return {
      runStartedAt: projection.runStartedAt,
      runEndedAt: projection.runEndedAt,
      runDurationMs: projection.runDurationMs,
    };
  }
  return {
    runStartedAt: projection.runStartedAt,
    runEndedAt: endedAt,
    runDurationMs: Math.max(0, endedAt - projection.runStartedAt),
  };
}

function emptyQueue(): QueuedMessages {
  return { steering: [], followUp: [] };
}

function queueSize(queue: QueuedMessages): number {
  return queue.steering.length + queue.followUp.length;
}

function appendQueuedMessage(
  queue: QueuedMessages,
  behavior: PromptStreamingBehavior,
  content: string,
): QueuedMessages {
  return behavior === "followUp"
    ? { steering: queue.steering, followUp: [...queue.followUp, content] }
    : { steering: [...queue.steering, content], followUp: queue.followUp };
}

function readQueuedMessages(data: unknown): QueuedMessages | null {
  if (!isRecord(data) || !Array.isArray(data.steering) || !Array.isArray(data.followUp)) {
    return null;
  }
  if (
    !data.steering.every((item) => typeof item === "string") ||
    !data.followUp.every((item) => typeof item === "string")
  ) {
    return null;
  }
  return displayQueuedMessages({ steering: data.steering, followUp: data.followUp });
}

function displayQueuedMessages(queue: QueuedMessages): QueuedMessages {
  return {
    steering: queue.steering.map(displayPromptContent),
    followUp: queue.followUp.map(displayPromptContent),
  };
}

function readContextUsage(data: unknown): ContextUsage | null {
  if (!isRecord(data)) return null;
  const { tokens, contextWindow, percent } = data;
  return Number.isSafeInteger(tokens) &&
    Number(tokens) >= 0 &&
    Number.isSafeInteger(contextWindow) &&
    Number(contextWindow) > 0 &&
    typeof percent === "number" &&
    Number.isFinite(percent) &&
    percent >= 0 &&
    percent <= 100
    ? { tokens: Number(tokens), contextWindow: Number(contextWindow), percent }
    : null;
}

function readToolEvent(data: unknown): { toolCallId: string; toolName: string } | null {
  if (!isRecord(data) || typeof data.toolCallId !== "string" || typeof data.toolName !== "string") {
    return null;
  }
  return { toolCallId: data.toolCallId, toolName: data.toolName };
}

function readEventText(data: unknown, field: "content" | "delta" | "message"): string | null {
  return isRecord(data) && typeof data[field] === "string" ? data[field] : null;
}

function readConfiguration(data: unknown): SessionConfiguration | null {
  if (
    !isRecord(data) ||
    !Array.isArray(data.availableThinkingLevels) ||
    data.availableThinkingLevels.length === 0 ||
    data.availableThinkingLevels.length > THINKING_LEVELS.length ||
    !data.availableThinkingLevels.every(isThinkingLevel) ||
    new Set(data.availableThinkingLevels).size !== data.availableThinkingLevels.length ||
    !("model" in data) ||
    !isAgentModel(data.model)
  ) {
    return null;
  }
  const availableThinkingLevels = normalizeThinkingLevels(data.availableThinkingLevels);
  if (availableThinkingLevels.length === 0 || !isThinkingLevel(data.thinkingLevel)) {
    return null;
  }
  const availableTools = readAgentTools(data.availableTools);
  const availableNames = new Set(availableTools.map((tool) => tool.name));
  const activeToolNames = readToolNames(data.activeToolNames)?.filter((name) => availableNames.has(name));
  const defaultToolNames = readToolNames(data.defaultToolNames)?.filter((name) => availableNames.has(name));
  if (data.availableTools !== undefined) {
    if (
      !Array.isArray(data.availableTools) ||
      availableTools.length !== data.availableTools.length ||
      !activeToolNames ||
      !defaultToolNames
    ) {
      return null;
    }
  }
  return {
    model: data.model,
    thinkingLevel: clampThinkingLevel(data.thinkingLevel, availableThinkingLevels),
    availableThinkingLevels,
    availableTools,
    activeToolNames: activeToolNames ?? [],
    defaultToolNames: defaultToolNames ?? [],
  };
}

function readAgentTools(value: unknown): SessionConfiguration["availableTools"] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) return [];
  const names = new Set<string>();
  return value.flatMap((tool) => {
    if (
      !isRecord(tool) ||
      typeof tool.name !== "string" ||
      !tool.name.trim() ||
      tool.name.length > 128 ||
      /[\r\n\0]/.test(tool.name) ||
      names.has(tool.name) ||
      typeof tool.description !== "string" ||
      tool.description.length > 1_024
    ) {
      return [];
    }
    names.add(tool.name);
    return [{ name: tool.name, description: tool.description }];
  });
}

function readToolNames(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 256) return null;
  const names = new Set<string>();
  for (const name of value) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 128 ||
      /[\r\n\0]/.test(name) ||
      names.has(name)
    ) {
      return null;
    }
    names.add(name);
  }
  return [...names];
}

function resolvePromptTools(
  configuration: SessionConfiguration | null,
  requested: string[] | undefined,
): string[] | undefined {
  if (!configuration || configuration.availableTools.length === 0) return requested;
  const selected = new Set(requested ?? configuration.defaultToolNames);
  return configuration.availableTools
    .map((tool) => tool.name)
    .filter((name) => selected.has(name));
}

function emptyConfiguration(): SessionConfiguration {
  return {
    model: null,
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    availableTools: [],
    activeToolNames: [],
    defaultToolNames: [],
  };
}

function isAgentModel(value: unknown): value is AgentModel | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.provider === "string" &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.reasoning === "boolean")
  );
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLocaleLowerCase();
}

function formatError(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scheduleAfterLayout(callback: () => void): () => void {
  if (typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }
  const timeout = window.setTimeout(callback, 16);
  return () => window.clearTimeout(timeout);
}
