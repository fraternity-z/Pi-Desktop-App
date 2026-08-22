import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  abortAgent,
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
  type SessionConfiguration,
  type ThinkingLevel,
} from "../ipc/agent";
import { appendMonotonicText } from "./chatStream";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools?: ToolExecution[];
}

export interface ToolExecution {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
}

export type ChatPhase = "idle" | "creating" | "ready" | "streaming";
export type AgentEventConnection = "connecting" | "ready" | "error";
export type CatalogPhase = "idle" | "loading" | "ready" | "error";

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
  loadCatalogs: () => Promise<void>;
  createSession: (cwd: string) => Promise<boolean>;
  openSession: (sessionPath: string) => Promise<boolean>;
  updateModel: (provider: string, id: string) => Promise<void>;
  updateThinkingLevel: (level: ThinkingLevel) => Promise<void>;
  sendPrompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  retryEventListener: () => void;
}

export function useChatSession(): ChatSessionState {
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionPath, setSessionPath] = useState<string | null>(null);
  const [cwd, setCwd] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [configuration, setConfiguration] = useState<SessionConfiguration | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [catalogPhase, setCatalogPhase] = useState<CatalogPhase>("idle");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelFallbackMessage, setModelFallbackMessage] = useState<string | null>(null);
  const [eventConnection, setEventConnection] = useState<AgentEventConnection>("connecting");
  const [listenerAttempt, setListenerAttempt] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const nextMessageId = useRef(1);
  const acceptingEvents = useRef(false);
  const lastEventSequence = useRef(0);
  const promptRequestId = useRef(0);
  const catalogRequestId = useRef(0);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    setEventConnection("connecting");
    listenToAgentEvents((event) => {
      if (
        active &&
        event.sessionId === sessionIdRef.current &&
        event.seq > lastEventSequence.current
      ) {
        lastEventSequence.current = event.seq;
        if (event.name === "session.configurationChanged") {
          const nextConfiguration = readConfiguration(event.data);
          if (nextConfiguration) {
            setConfiguration(nextConfiguration);
          }
          return;
        }
        if (!acceptingEvents.current) {
          return;
        }
        applyAgentEvent(event, setMessages, setPhase);
        if (event.name === "agent.settled") {
          acceptingEvents.current = false;
          setPhase("ready");
        }
      }
    })
      .then((stopListening) => {
        if (active) {
          unlisten = stopListening;
          setEventConnection("ready");
        } else {
          stopListening();
        }
      })
      .catch((listenError: unknown) => {
        if (active) {
          setEventConnection("error");
          setError(`AGENT_EVENT_LISTEN_FAILED: ${formatError(listenError)}`);
        }
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [listenerAttempt]);

  const loadCatalogs = useCallback(async () => {
    const requestId = ++catalogRequestId.current;
    setCatalogPhase("loading");
    setCatalogError(null);
    const [sessionResult, modelResult] = await Promise.allSettled([
      listAgentSessions(),
      listAgentModels(),
    ]);
    if (requestId !== catalogRequestId.current) {
      return;
    }

    const failures: string[] = [];
    if (sessionResult.status === "fulfilled") {
      setSessions(sessionResult.value);
    } else {
      failures.push(formatError(sessionResult.reason));
    }
    if (modelResult.status === "fulfilled") {
      setModels(modelResult.value);
    } else {
      failures.push(formatError(modelResult.reason));
    }
    setCatalogPhase(failures.length > 0 ? "error" : "ready");
    setCatalogError(failures.length > 0 ? failures.join(" · ") : null);
  }, []);

  const installSession = useCallback((session: AgentSession) => {
    sessionIdRef.current = session.sessionId;
    promptRequestId.current += 1;
    acceptingEvents.current = false;
    lastEventSequence.current = 0;
    nextMessageId.current = 1;
    setMessages(
      session.messages.map((message) => ({
        id: nextMessageId.current++,
        role: message.role,
        content: message.content,
        ...(message.role === "assistant" ? { tools: [] } : {}),
      })),
    );
    setSessionId(session.sessionId);
    setSessionPath(session.sessionPath);
    setCwd(session.cwd);
    setConfiguration(session.configuration);
    setModelFallbackMessage(session.modelFallbackMessage);
    setPhase("ready");
  }, []);

  const createSession = useCallback(
    async (nextCwd: string) => {
      if (eventConnection !== "ready") {
        setError("AGENT_EVENT_LISTEN_UNAVAILABLE: 事件通道尚未就绪，请先重新连接");
        return false;
      }
      if (!nextCwd.trim()) {
        setError("WORKSPACE_PATH_INVALID: 请输入绝对工作区路径");
        return false;
      }
      if (phase === "creating" || phase === "streaming") {
        return false;
      }
      const previousPhase = sessionIdRef.current ? "ready" : "idle";
      setPhase("creating");
      setError(null);
      try {
        const session = await createAgentSession(nextCwd.trim());
        installSession(session);
        void loadCatalogs();
        return true;
      } catch (createError) {
        setPhase(previousPhase);
        setError(formatError(createError));
        return false;
      }
    },
    [eventConnection, installSession, loadCatalogs, phase],
  );

  const openSession = useCallback(
    async (nextSessionPath: string) => {
      if (
        eventConnection !== "ready" ||
        !nextSessionPath ||
        phase === "creating" ||
        phase === "streaming"
      ) {
        return false;
      }
      const previousPhase = sessionIdRef.current ? "ready" : "idle";
      setPhase("creating");
      setError(null);
      try {
        installSession(await openAgentSession(nextSessionPath));
        return true;
      } catch (openError) {
        setPhase(previousPhase);
        setError(formatError(openError));
        return false;
      }
    },
    [eventConnection, installSession, phase],
  );

  const updateConfiguration = useCallback(
    async (update: {
      model?: Pick<AgentModel, "provider" | "id">;
      thinkingLevel?: ThinkingLevel;
    }) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId || phase !== "ready" || configuring) {
        return;
      }
      setConfiguring(true);
      setError(null);
      try {
        setConfiguration(await configureAgentSession(activeSessionId, update));
      } catch (configurationError) {
        setError(formatError(configurationError));
      } finally {
        setConfiguring(false);
      }
    },
    [configuring, phase],
  );

  const updateModel = useCallback(
    async (provider: string, id: string) => {
      await updateConfiguration({ model: { provider, id } });
    },
    [updateConfiguration],
  );

  const updateThinkingLevel = useCallback(
    async (level: ThinkingLevel) => {
      await updateConfiguration({ thinkingLevel: level });
    },
    [updateConfiguration],
  );

  const sendPrompt = useCallback(
    async (text: string) => {
      const activeSessionId = sessionIdRef.current;
      if (
        !activeSessionId ||
        !text.trim() ||
        phase !== "ready" ||
        eventConnection !== "ready" ||
        configuring
      ) {
        return;
      }

      const userMessage: ChatMessage = {
        id: nextMessageId.current++,
        role: "user",
        content: text.trim(),
      };
      const assistantMessage: ChatMessage = {
        id: nextMessageId.current++,
        role: "assistant",
        content: "",
        tools: [],
      };
      setMessages((current) => [...current, userMessage, assistantMessage]);
      const requestId = ++promptRequestId.current;
      setError(null);
      setPhase("streaming");
      acceptingEvents.current = true;

      try {
        await promptAgent(activeSessionId, userMessage.content);
        if (requestId !== promptRequestId.current) {
          return;
        }
        void loadCatalogs();
      } catch (promptError) {
        if (requestId !== promptRequestId.current) {
          return;
        }
        acceptingEvents.current = false;
        setMessages((current) =>
          current
            .map((message) =>
              message.id === assistantMessage.id
                ? updateRunningTools(message, "failed")
                : message,
            )
            .filter(
              (message) =>
                message.id !== assistantMessage.id ||
                message.content.length > 0 ||
                (message.tools?.length ?? 0) > 0,
            ),
        );
        setError(formatError(promptError));
        setPhase("ready");
      }
    },
    [configuring, eventConnection, loadCatalogs, phase],
  );

  const abort = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      return;
    }
    setError(null);
    const resumeEventsOnFailure = acceptingEvents.current;
    promptRequestId.current += 1;
    acceptingEvents.current = false;
    try {
      await abortAgent(activeSessionId);
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== "assistant") {
          return current;
        }
        const stopped = updateRunningTools(last, "cancelled");
        return stopped.content.length === 0 && (stopped.tools?.length ?? 0) === 0
          ? current.slice(0, -1)
          : [...current.slice(0, -1), stopped];
      });
      setPhase("ready");
    } catch (abortError) {
      acceptingEvents.current = resumeEventsOnFailure;
      setError(formatError(abortError));
    }
  }, []);

  const retryEventListener = useCallback(() => {
    setError(null);
    setListenerAttempt((attempt) => attempt + 1);
  }, []);

  return {
    phase,
    sessionId,
    sessionPath,
    cwd,
    messages,
    sessions,
    models,
    configuration,
    configuring,
    catalogPhase,
    catalogError,
    error,
    modelFallbackMessage,
    eventConnection,
    loadCatalogs,
    createSession,
    openSession,
    updateModel,
    updateThinkingLevel,
    sendPrompt,
    abort,
    retryEventListener,
  };
}

function applyAgentEvent(
  event: AgentEvent,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  setPhase: Dispatch<SetStateAction<ChatPhase>>,
): void {
  if (event.name === "agent.started") {
    setPhase("streaming");
    return;
  }
  if (event.name === "agent.settled") {
    setPhase("ready");
    setMessages((current) => updateLastAssistant(current, (message) => updateRunningTools(message, "completed")));
    return;
  }
  if (event.name.startsWith("tool.")) {
    const tool = readToolEvent(event.data);
    if (!tool) {
      return;
    }
    const status =
      event.name === "tool.started"
        ? "running"
        : event.name === "tool.failed"
          ? "failed"
          : "completed";
    setMessages((current) =>
      updateLastAssistant(current, (message) => upsertTool(message, tool, status)),
    );
    return;
  }
  if (event.name !== "message.delta") {
    return;
  }

  const delta = readDelta(event.data);
  if (!delta) {
    return;
  }
  setMessages((current) =>
    updateLastAssistant(current, (message) => ({
      ...message,
      content: appendMonotonicText(message.content, delta),
    })),
  );
}

function updateLastAssistant(
  messages: ChatMessage[],
  update: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const last = messages.at(-1);
  return last?.role === "assistant"
    ? [...messages.slice(0, -1), update(last)]
    : messages;
}

function upsertTool(
  message: ChatMessage,
  tool: { toolCallId: string; toolName: string },
  status: ToolExecution["status"],
): ChatMessage {
  const tools = message.tools ?? [];
  const existing = tools.findIndex((item) => item.id === tool.toolCallId);
  const next = { id: tool.toolCallId, name: tool.toolName, status };
  return {
    ...message,
    tools:
      existing < 0
        ? [...tools, next]
        : tools.map((item, index) => (index === existing ? next : item)),
  };
}

function updateRunningTools(
  message: ChatMessage,
  status: Exclude<ToolExecution["status"], "running">,
): ChatMessage {
  return {
    ...message,
    tools: message.tools?.map((tool) =>
      tool.status === "running" ? { ...tool, status } : tool,
    ),
  };
}

function readToolEvent(data: unknown): { toolCallId: string; toolName: string } | null {
  if (
    typeof data !== "object" ||
    data === null ||
    !("toolCallId" in data) ||
    !("toolName" in data) ||
    typeof data.toolCallId !== "string" ||
    typeof data.toolName !== "string"
  ) {
    return null;
  }
  return { toolCallId: data.toolCallId, toolName: data.toolName };
}

function readDelta(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("delta" in data)) {
    return null;
  }
  return typeof data.delta === "string" ? data.delta : null;
}

function readConfiguration(data: unknown): SessionConfiguration | null {
  if (
    typeof data !== "object" ||
    data === null ||
    !("thinkingLevel" in data) ||
    !("availableThinkingLevels" in data) ||
    !isThinkingLevel(data.thinkingLevel) ||
    !Array.isArray(data.availableThinkingLevels) ||
    !data.availableThinkingLevels.every(isThinkingLevel) ||
    !("model" in data) ||
    !isAgentModel(data.model)
  ) {
    return null;
  }
  return data as SessionConfiguration;
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
    (typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 4 &&
      "provider" in value &&
      "id" in value &&
      "name" in value &&
      "reasoning" in value &&
      typeof value.provider === "string" &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      typeof value.reasoning === "boolean")
  );
}

function formatError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
