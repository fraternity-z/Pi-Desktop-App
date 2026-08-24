import { useCallback, useEffect, useRef, useState } from "react";

import {
  abortAgent,
  clearAgentQueue,
  configureAgentSession,
  createAgentSession,
  listAgentModels,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  promptAgent,
  type AgentEvent,
  type AgentModel,
  type AgentSession,
  type AgentSessionSummary,
  type PromptStreamingBehavior,
  type QueuedMessages,
  type SessionConfiguration,
  type ThinkingLevel,
} from "../ipc/agent";
import {
  ensureConversationWorkspace,
  getWorkspaceState,
  rememberWorkspace,
  removeRecentWorkspace,
  type WorkspaceState,
} from "../ipc/workspace";
import { appendMonotonicText } from "./chatStream";

export type TimelineRole = "user" | "assistant" | "thinking" | "tool" | "system";
export type TimelineStatus = "running" | "completed" | "failed" | "cancelled";

export interface ChatMessage {
  id: string;
  role: TimelineRole;
  content: string;
  timestamp?: string;
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

interface SessionProjection {
  sessionId: string;
  sessionPath: string | null;
  cwd: string;
  messages: ChatMessage[];
  configuration: SessionConfiguration;
  phase: "ready" | "streaming";
  error: string | null;
  modelFallbackMessage: string | null;
  queuedMessages: QueuedMessages;
  queuePaused: boolean;
}

export interface ChatSessionState {
  phase: ChatPhase;
  sessionId: string | null;
  sessionPath: string | null;
  cwd: string;
  messages: ChatMessage[];
  sessions: AgentSessionSummary[];
  models: AgentModel[];
  configuration: SessionConfiguration | null;
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
  loadCatalogs: () => Promise<void>;
  createSession: (cwd: string) => Promise<boolean>;
  createConversation: () => Promise<boolean>;
  openSession: (sessionPath: string) => Promise<boolean>;
  removeWorkspace: (cwd: string) => Promise<void>;
  updateModel: (provider: string, id: string) => Promise<void>;
  updateThinkingLevel: (level: ThinkingLevel) => Promise<void>;
  sendPrompt: (text: string, behavior?: PromptStreamingBehavior) => Promise<boolean>;
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
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
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
  const restoreAttempted = useRef(false);
  const loadCatalogsRef = useRef<() => Promise<void>>(async () => undefined);

  const commitProjections = useCallback(
    (update: (current: Record<string, SessionProjection>) => Record<string, SessionProjection>) => {
      setProjections((current) => {
        const next = update(current);
        projectionsRef.current = next;
        return next;
      });
    },
    [],
  );

  const nextItemId = useCallback((sessionId: string) => {
    return `${sessionId}:${itemSequence.current++}`;
  }, []);

  const installSession = useCallback(
    (session: AgentSession) => {
      const loaded = projectionFromSession(session, nextItemId);
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
            }
          : loaded;
        return { ...current, [session.sessionId]: projection };
      });
      activeSessionIdRef.current = session.sessionId;
      setActiveSessionId(session.sessionId);
      setGlobalError(null);
      void rememberWorkspace(session.cwd)
        .then(setWorkspaceState)
        .catch((error: unknown) => setCatalogError(formatError(error)));
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
    if (sessionResult.status === "fulfilled") setSessions(sessionResult.value);
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
          installSession(await openAgentSession(recent.path));
        } catch (error) {
          setGlobalError(formatError(error));
        } finally {
          setNavigationPending(false);
        }
      }
    }
  }, [installSession]);

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
      commitProjections((current) => {
        const projection = current[event.sessionId];
        if (!projection) return current;
        return {
          ...current,
          [event.sessionId]: applyAgentEvent(projection, event, () => nextItemId(event.sessionId)),
        };
      });
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
    };
  }, [commitProjections, listenerAttempt, nextItemId]);

  const createSession = useCallback(
    async (cwd: string) => {
      if (eventConnection !== "ready") {
        setGlobalError("AGENT_EVENT_LISTEN_UNAVAILABLE: 事件通道尚未就绪，请先重新连接");
        return false;
      }
      if (!cwd.trim()) {
        setGlobalError("WORKSPACE_PATH_INVALID: 请输入绝对工作区路径");
        return false;
      }
      if (navigationPending) return false;
      setNavigationPending(true);
      setGlobalError(null);
      try {
        installSession(await createAgentSession(cwd.trim()));
        void loadCatalogsRef.current();
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

  const createConversation = useCallback(async () => {
    try {
      return await createSession(await ensureConversationWorkspace());
    } catch (error) {
      setGlobalError(formatError(error));
      return false;
    }
  }, [createSession]);

  const openSession = useCallback(
    async (sessionPath: string) => {
      if (eventConnection !== "ready" || !sessionPath || navigationPending) return false;
      setNavigationPending(true);
      setGlobalError(null);
      try {
        installSession(await openAgentSession(sessionPath));
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

  const updateConfiguration = useCallback(
    async (update: {
      model?: Pick<AgentModel, "provider" | "id">;
      thinkingLevel?: ThinkingLevel;
    }) => {
      const sessionId = activeSessionIdRef.current;
      const projection = sessionId ? projectionsRef.current[sessionId] : undefined;
      if (!sessionId || !projection || projection.phase !== "ready" || configuringSessionId) return;
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
    [commitProjections, configuringSessionId],
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
    async (text: string, behavior?: PromptStreamingBehavior) => {
      const sessionId = activeSessionIdRef.current;
      const projection = sessionId ? projectionsRef.current[sessionId] : undefined;
      const content = text.trim();
      if (
        !sessionId ||
        !projection ||
        !content ||
        eventConnection !== "ready" ||
        configuringSessionId === sessionId
      ) {
        return false;
      }
      const queued = projection.phase === "streaming";
      const streamingBehavior = queued ? (behavior ?? "steer") : undefined;
      const previousQueue = projection.queuedMessages;
      const requestId = (promptRequests.current.get(sessionId) ?? 0) + 1;
      promptRequests.current.set(sessionId, requestId);
      commitProjections((current) => {
        const currentProjection = current[sessionId];
        if (!currentProjection) return current;
        return {
          ...current,
          [sessionId]: {
            ...currentProjection,
            phase: "streaming",
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
                    id: nextItemId(sessionId),
                    role: "user",
                    content,
                    optimistic: true,
                    timestamp: new Date().toISOString(),
                  },
                ],
          },
        };
      });
      try {
        await promptAgent(sessionId, content, streamingBehavior);
        void loadCatalogsRef.current();
        return true;
      } catch (error) {
        if ((promptRequests.current.get(sessionId) ?? 0) !== requestId) return false;
        const message = formatError(error);
        commitProjections((current) => {
          const currentProjection = current[sessionId];
          if (!currentProjection) return current;
          return {
            ...current,
            [sessionId]: {
              ...currentProjection,
              phase: queued ? "streaming" : "ready",
              error: message,
              queuedMessages: queued ? previousQueue : currentProjection.queuedMessages,
              messages: [
                ...currentProjection.messages.map((item) =>
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
    [commitProjections, configuringSessionId, eventConnection, nextItemId],
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
    if (!sessionId) return;
    commitProjections((current) => updateProjectionError(current, sessionId, null));
    try {
      await abortAgent(sessionId);
      commitProjections((current) => {
        const projection = current[sessionId];
        if (!projection) return current;
        return {
          ...current,
          [sessionId]: {
            ...projection,
            phase: "ready",
            queuePaused: queueSize(projection.queuedMessages) > 0,
            messages: projection.messages.map((item) =>
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
  const phase: ChatPhase = navigationPending ? "creating" : active?.phase ?? "idle";
  const runningSessionIds = Object.values(projections)
    .filter((projection) => projection.phase === "streaming")
    .map((projection) => projection.sessionId);

  return {
    phase,
    sessionId: active?.sessionId ?? null,
    sessionPath: active?.sessionPath ?? null,
    cwd: active?.cwd ?? "",
    messages: active?.messages ?? [],
    sessions,
    models,
    configuration: active?.configuration ?? null,
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
    loadCatalogs,
    createSession,
    createConversation,
    openSession,
    removeWorkspace,
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
): SessionProjection {
  const messages = session.messages.map<ChatMessage>((message) => ({
    id: nextId(session.sessionId),
    role: message.role,
    content: message.content,
    ...(message.timestamp ? { timestamp: message.timestamp } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.role === "tool"
      ? { status: message.isError ? ("failed" as const) : ("completed" as const) }
      : {}),
  }));
  return {
    sessionId: session.sessionId,
    sessionPath: session.sessionPath,
    cwd: session.cwd,
    messages,
    configuration: session.configuration,
    queuedMessages: session.queuedMessages ?? emptyQueue(),
    queuePaused: !session.streaming && queueSize(session.queuedMessages ?? emptyQueue()) > 0,
    phase: session.streaming ? "streaming" : "ready",
    error: null,
    modelFallbackMessage: session.modelFallbackMessage,
  };
}

function applyAgentEvent(
  projection: SessionProjection,
  event: AgentEvent,
  nextId: () => string,
): SessionProjection {
  if (event.name === "agent.started") {
    return { ...projection, phase: "streaming", error: null, queuePaused: false };
  }
  if (event.name === "agent.settled") {
    return {
      ...projection,
      phase: "ready",
      messages: projection.messages.map((item) =>
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
    const content = readEventText(event.data, "content");
    if (!content) return projection;
    const match = findLastOptimisticUser(projection.messages, content);
    return match < 0
      ? {
          ...projection,
          messages: [...projection.messages, { id: nextId(), role: "user", content }],
        }
      : {
          ...projection,
          messages: projection.messages.map((item, index) =>
            index === match ? { ...item, optimistic: false } : item,
          ),
        };
  }
  if (event.name === "message.delta" || event.name === "thinking.delta") {
    if (projection.phase !== "streaming") return projection;
    const delta = readEventText(event.data, "delta");
    if (!delta) return projection;
    const role = event.name === "thinking.delta" ? "thinking" : "assistant";
    return { ...projection, messages: appendTimelineText(projection.messages, role, delta, nextId) };
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
    return { ...projection, messages: upsertTimelineTool(projection.messages, tool, status, nextId) };
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
  return { steering: data.steering, followUp: data.followUp };
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
    !isThinkingLevel(data.thinkingLevel) ||
    !Array.isArray(data.availableThinkingLevels) ||
    !data.availableThinkingLevels.every(isThinkingLevel) ||
    !("model" in data) ||
    !isAgentModel(data.model)
  ) {
    return null;
  }
  return data as unknown as SessionConfiguration;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
  );
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
