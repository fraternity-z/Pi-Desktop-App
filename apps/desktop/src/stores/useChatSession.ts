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
  createAgentSession,
  listenToAgentEvents,
  promptAgent,
  type AgentEvent,
} from "../ipc/agent";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type ChatPhase = "idle" | "creating" | "ready" | "streaming";
export type AgentEventConnection = "connecting" | "ready" | "error";

export interface ChatSessionState {
  phase: ChatPhase;
  sessionId: string | null;
  messages: ChatMessage[];
  error: string | null;
  modelFallbackMessage: string | null;
  eventConnection: AgentEventConnection;
  createSession: (cwd: string) => Promise<boolean>;
  sendPrompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  retryEventListener: () => void;
}

export function useChatSession(): ChatSessionState {
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modelFallbackMessage, setModelFallbackMessage] = useState<string | null>(null);
  const [eventConnection, setEventConnection] = useState<AgentEventConnection>("connecting");
  const [listenerAttempt, setListenerAttempt] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const nextMessageId = useRef(1);
  const acceptingEvents = useRef(false);
  const lastEventSequence = useRef(0);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    setEventConnection("connecting");
    listenToAgentEvents((event) => {
      if (
        active &&
        acceptingEvents.current &&
        event.sessionId === sessionIdRef.current &&
        event.seq > lastEventSequence.current
      ) {
        lastEventSequence.current = event.seq;
        applyAgentEvent(event, setMessages, setPhase);
        if (event.name === "agent.settled") {
          acceptingEvents.current = false;
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

  const createSession = useCallback(
    async (cwd: string) => {
      if (eventConnection !== "ready") {
        setError("AGENT_EVENT_LISTEN_UNAVAILABLE: 事件通道尚未就绪，请先重新连接");
        return false;
      }
      if (!cwd.trim()) {
        setError("WORKSPACE_PATH_INVALID: 请输入绝对工作区路径");
        return false;
      }
      setPhase("creating");
      setError(null);
      try {
        const session = await createAgentSession(cwd.trim());
        sessionIdRef.current = session.sessionId;
        acceptingEvents.current = false;
        lastEventSequence.current = 0;
        nextMessageId.current = 1;
        setMessages([]);
        setSessionId(session.sessionId);
        setModelFallbackMessage(session.modelFallbackMessage);
        setPhase("ready");
        return true;
      } catch (createError) {
        setPhase("idle");
        setError(formatError(createError));
        return false;
      }
    },
    [eventConnection],
  );

  const sendPrompt = useCallback(
    async (text: string) => {
      const activeSessionId = sessionIdRef.current;
      if (
        !activeSessionId ||
        !text.trim() ||
        phase !== "ready" ||
        eventConnection !== "ready"
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
      };
      setMessages((current) => [...current, userMessage, assistantMessage]);
      setError(null);
      setPhase("streaming");
      acceptingEvents.current = true;

      try {
        await promptAgent(activeSessionId, userMessage.content);
        acceptingEvents.current = false;
        setPhase((current) => (current === "streaming" ? "ready" : current));
      } catch (promptError) {
        acceptingEvents.current = false;
        setMessages((current) =>
          current.filter(
            (message) => message.id !== assistantMessage.id || message.content.length > 0,
          ),
        );
        setError(formatError(promptError));
        setPhase("ready");
      }
    },
    [eventConnection, phase],
  );

  const abort = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) {
      return;
    }
    setError(null);
    acceptingEvents.current = false;
    try {
      await abortAgent(activeSessionId);
      setMessages((current) => {
        const last = current.at(-1);
        return last?.role === "assistant" && last.content.length === 0
          ? current.slice(0, -1)
          : current;
      });
      setPhase("ready");
    } catch (abortError) {
      acceptingEvents.current = true;
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
    messages,
    error,
    modelFallbackMessage,
    eventConnection,
    createSession,
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
    return;
  }
  if (event.name !== "message.delta") {
    return;
  }

  const delta = readDelta(event.data);
  if (!delta) {
    return;
  }
  setMessages((current) => {
    const last = current.at(-1);
    if (!last || last.role !== "assistant") {
      return current;
    }
    return [
      ...current.slice(0, -1),
      { ...last, content: `${last.content}${delta}` },
    ];
  });
}

function readDelta(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("delta" in data)) {
    return null;
  }
  return typeof data.delta === "string" ? data.delta : null;
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
