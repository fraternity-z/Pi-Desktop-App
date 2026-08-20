import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface AgentSession {
  sessionId: string;
  modelFallbackMessage: string | null;
}

export interface AgentEvent {
  v: number;
  kind: "event";
  seq: number;
  sessionId: string;
  name: "agent.started" | "message.delta" | "agent.settled";
  data?: unknown;
}

export async function createAgentSession(cwd: string): Promise<AgentSession> {
  return invoke<AgentSession>("agent_create_session", { cwd });
}

export async function promptAgent(sessionId: string, text: string): Promise<void> {
  return invoke("agent_prompt", { sessionId, text });
}

export async function abortAgent(sessionId: string): Promise<void> {
  return invoke("agent_abort", { sessionId });
}

export async function listenToAgentEvents(
  handler: (event: AgentEvent) => void,
): Promise<UnlistenFn> {
  return listen<AgentEvent>("agent://event", (event) => handler(event.payload));
}
