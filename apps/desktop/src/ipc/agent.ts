import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

export interface AgentMessageSummary {
  role: "user" | "assistant";
  content: string;
}

export interface SessionConfiguration {
  model: AgentModel | null;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
}

export interface AgentSession {
  sessionId: string;
  cwd: string;
  sessionPath: string | null;
  modelFallbackMessage: string | null;
  configuration: SessionConfiguration;
  messages: AgentMessageSummary[];
}

export interface AgentSessionSummary {
  id: string;
  path: string;
  cwd: string;
  name: string | null;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface AgentEvent {
  v: 1;
  kind: "event";
  seq: number;
  sessionId: string;
  name: AgentEventName;
  data?: unknown;
}

export type AgentEventName =
  | "agent.started"
  | "message.delta"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "agent.settled"
  | "session.configurationChanged";

const AGENT_EVENT_NAMES = new Set<AgentEventName>([
  "agent.started",
  "message.delta",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "agent.settled",
  "session.configurationChanged",
]);
const MAX_SESSION_ID_CHARS = 128;
const MAX_TOOL_CALL_ID_CHARS = 256;
const MAX_TOOL_NAME_CHARS = 128;
const MAX_EVENT_TEXT_CHARS = 1_048_576;

export async function createAgentSession(cwd: string): Promise<AgentSession> {
  return invoke<AgentSession>("agent_create_session", { cwd });
}

export async function listAgentSessions(): Promise<AgentSessionSummary[]> {
  return invoke<AgentSessionSummary[]>("agent_list_sessions");
}

export async function openAgentSession(sessionPath: string): Promise<AgentSession> {
  return invoke<AgentSession>("agent_open_session", { sessionPath });
}

export async function listAgentModels(): Promise<AgentModel[]> {
  return invoke<AgentModel[]>("agent_list_models");
}

export async function configureAgentSession(
  sessionId: string,
  update: {
    model?: Pick<AgentModel, "provider" | "id">;
    thinkingLevel?: ThinkingLevel;
  },
): Promise<SessionConfiguration> {
  return invoke<SessionConfiguration>("agent_configure_session", { sessionId, update });
}

export async function promptAgent(sessionId: string, text: string): Promise<number> {
  return invoke<number>("agent_prompt", { sessionId, text });
}

export async function abortAgent(sessionId: string): Promise<void> {
  return invoke("agent_abort", { sessionId });
}

export async function listenToAgentEvents(
  handler: (event: AgentEvent) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("agent://event", (event) => {
    const agentEvent = parseAgentEvent(event.payload);
    if (agentEvent) {
      handler(agentEvent);
    }
  });
}

export function parseAgentEvent(payload: unknown): AgentEvent | null {
  if (
    !isRecord(payload) ||
    payload.v !== 1 ||
    payload.kind !== "event" ||
    !Number.isSafeInteger(payload.seq) ||
    Number(payload.seq) < 1 ||
    !isBoundedText(payload.sessionId, MAX_SESSION_ID_CHARS) ||
    typeof payload.name !== "string" ||
    !AGENT_EVENT_NAMES.has(payload.name as AgentEventName) ||
    !hasValidEventData(payload.name as AgentEventName, payload.data)
  ) {
    return null;
  }
  return payload as unknown as AgentEvent;
}

function hasValidEventData(name: AgentEventName, data: unknown): boolean {
  if (name === "message.delta") {
    return (
      isRecord(data) &&
      Object.keys(data).length === 1 &&
      typeof data.delta === "string" &&
      data.delta.length <= MAX_EVENT_TEXT_CHARS
    );
  }
  if (name.startsWith("tool.")) {
    return (
      isRecord(data) &&
      Object.keys(data).length === 2 &&
      isBoundedText(data.toolCallId, MAX_TOOL_CALL_ID_CHARS) &&
      isBoundedText(data.toolName, MAX_TOOL_NAME_CHARS)
    );
  }
  if (name === "session.configurationChanged") {
    return (
      isRecord(data) &&
      Object.keys(data).length === 3 &&
      "model" in data &&
      "thinkingLevel" in data &&
      "availableThinkingLevels" in data
    );
  }
  return data === undefined || data === null;
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
