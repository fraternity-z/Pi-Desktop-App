export interface PiSessionLike {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  prompt(text: string, options?: { streamingBehavior?: "followUp" }): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}

export interface PiSdkLike {
  createAgentSession(options: {
    cwd: string;
    agentDir: string;
  }): Promise<{
    session: PiSessionLike;
    modelFallbackMessage?: string;
  }>;
}

export interface RuntimeEvent {
  sessionId: string;
  name: "agent.started" | "message.delta" | "agent.settled";
  data?: unknown;
}

export interface SessionRuntime {
  createSession(cwd: string): Promise<{ sessionId: string; modelFallbackMessage?: string }>;
  prompt(sessionId: string, text: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  shutdown(): Promise<void>;
}

export class RuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

interface ManagedSession {
  session: PiSessionLike;
  unsubscribe: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PiSessionRuntime implements SessionRuntime {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private closed = false;

  constructor(
    private readonly sdk: PiSdkLike,
    private readonly agentDir: string,
  ) {}

  async createSession(cwd: string): Promise<{
    sessionId: string;
    modelFallbackMessage?: string;
  }> {
    this.ensureOpen();
    const result = await this.sdk.createAgentSession({ cwd, agentDir: this.agentDir });
    const { session } = result;
    if (!session.sessionId || this.sessions.has(session.sessionId)) {
      session.dispose();
      throw new RuntimeError("INVALID_SESSION", "Pi SDK 返回了无效或重复的会话 id");
    }

    let unsubscribe: () => void;
    try {
      unsubscribe = session.subscribe((event) => this.forwardSdkEvent(session.sessionId, event));
    } catch {
      try {
        session.dispose();
      } catch {
        // The session never became managed; retain the stable subscription error.
      }
      throw new RuntimeError("SESSION_SUBSCRIBE_FAILED", "无法订阅 Pi SDK 会话事件");
    }
    this.sessions.set(session.sessionId, { session, unsubscribe });

    return {
      sessionId: session.sessionId,
      ...(result.modelFallbackMessage === undefined
        ? {}
        : { modelFallbackMessage: result.modelFallbackMessage }),
    };
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    this.ensureOpen();
    await this.requireSession(sessionId).session.prompt(text, { streamingBehavior: "followUp" });
  }

  async abort(sessionId: string): Promise<void> {
    this.ensureOpen();
    await this.requireSession(sessionId).session.abort();
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(
      sessions.map(async ({ session, unsubscribe }) => {
        try {
          if (session.isStreaming) {
            await session.abort();
          }
        } finally {
          try {
            unsubscribe();
          } finally {
            session.dispose();
          }
        }
      }),
    );
    this.listeners.clear();
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new RuntimeError("RUNTIME_CLOSED", "Bridge 会话运行时已关闭");
    }
  }

  private requireSession(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new RuntimeError("SESSION_NOT_FOUND", `找不到会话 ${sessionId}`);
    }
    return managed;
  }

  private forwardSdkEvent(sessionId: string, event: unknown): void {
    if (!isRecord(event) || typeof event.type !== "string") {
      return;
    }

    let runtimeEvent: RuntimeEvent | undefined;
    if (event.type === "agent_start") {
      runtimeEvent = { sessionId, name: "agent.started" };
    } else if (event.type === "agent_settled") {
      runtimeEvent = { sessionId, name: "agent.settled" };
    } else if (
      event.type === "message_update" &&
      isRecord(event.assistantMessageEvent) &&
      event.assistantMessageEvent.type === "text_delta" &&
      typeof event.assistantMessageEvent.delta === "string"
    ) {
      runtimeEvent = {
        sessionId,
        name: "message.delta",
        data: { delta: event.assistantMessageEvent.delta },
      };
    }

    if (runtimeEvent) {
      for (const listener of this.listeners) {
        listener(runtimeEvent);
      }
    }
  }
}
