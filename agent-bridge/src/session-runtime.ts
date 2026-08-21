import { join } from "node:path";

import { THINKING_LEVELS, type ModelSelection, type ThinkingLevel } from "./protocol.js";

export interface PiModelLike {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
}

export interface PiModelRuntimeLike {
  getAvailable(): Promise<PiModelLike[]>;
  getModel(provider: string, id: string): PiModelLike | undefined;
}

interface PiSessionManagerInstanceLike {
  getCwd?(): string;
}

interface PiSessionInfoLike {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: Date | string;
  modified: Date | string;
  messageCount: number;
  firstMessage: string;
}

export interface PiSessionLike {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly isStreaming: boolean;
  readonly model?: PiModelLike;
  readonly thinkingLevel: ThinkingLevel;
  readonly messages: unknown[];
  prompt(text: string, options?: { streamingBehavior?: "followUp" }): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  setModel(model: PiModelLike): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  getAvailableThinkingLevels(): ThinkingLevel[];
  dispose(): void;
}

export interface PiSdkLike {
  ModelRuntime: {
    create(options?: { authPath?: string; modelsPath?: string }): Promise<PiModelRuntimeLike>;
  };
  SessionManager: {
    create(cwd: string): PiSessionManagerInstanceLike;
    open(sessionPath: string): PiSessionManagerInstanceLike;
    listAll(sessionDir?: string): Promise<PiSessionInfoLike[]>;
  };
  createAgentSession(options: {
    cwd?: string;
    agentDir: string;
    modelRuntime: PiModelRuntimeLike;
    sessionManager: PiSessionManagerInstanceLike;
  }): Promise<{
    session: PiSessionLike;
    modelFallbackMessage?: string;
  }>;
}

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

export interface CreatedAgentSession {
  sessionId: string;
  cwd: string;
  sessionPath: string | null;
  modelFallbackMessage?: string;
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

export interface RuntimeEvent {
  sessionId: string;
  name:
    | "agent.started"
    | "message.delta"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "agent.settled"
    | "session.configurationChanged";
  data?: unknown;
}

export interface SessionRuntime {
  createSession(cwd: string): Promise<CreatedAgentSession>;
  listSessions(): Promise<AgentSessionSummary[]>;
  openSession(sessionPath: string): Promise<CreatedAgentSession>;
  listModels(): Promise<AgentModel[]>;
  configureSession(
    sessionId: string,
    update: { model?: ModelSelection; thinkingLevel?: ThinkingLevel },
  ): Promise<SessionConfiguration>;
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
  cwd: string;
  session: PiSessionLike;
  unsubscribe: () => void;
}

const MAX_HISTORY_MESSAGES = 200;
const MAX_HISTORY_CHARS = 400_000;
const MAX_SUMMARY_CHARS = 240;
const MAX_TOOL_CALL_ID_CHARS = 256;
const MAX_TOOL_NAME_CHARS = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class PiSessionRuntime implements SessionRuntime {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private modelRuntimePromise: Promise<PiModelRuntimeLike> | undefined;
  private activeSession: ManagedSession | undefined;
  private closed = false;

  constructor(
    private readonly sdk: PiSdkLike,
    private readonly agentDir: string,
  ) {}

  async createSession(cwd: string): Promise<CreatedAgentSession> {
    this.ensureOpen();
    this.ensureReplaceable();
    try {
      const modelRuntime = await this.getModelRuntime();
      const result = await this.sdk.createAgentSession({
        cwd,
        agentDir: this.agentDir,
        modelRuntime,
        sessionManager: this.sdk.SessionManager.create(cwd),
      });
      return this.activateSession(result, cwd);
    } catch (error) {
      throw mapRuntimeError(error, "SESSION_CREATE_FAILED", "无法创建 Pi 会话");
    }
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    this.ensureOpen();
    try {
      const sessions = await this.sdk.SessionManager.listAll(join(this.agentDir, "sessions"));
      return sessions.flatMap((session) => toSessionSummary(session));
    } catch (error) {
      throw mapRuntimeError(error, "SESSION_LIST_FAILED", "无法读取 Pi 会话列表");
    }
  }

  async openSession(sessionPath: string): Promise<CreatedAgentSession> {
    this.ensureOpen();
    this.ensureReplaceable();
    try {
      const sessionManager = this.sdk.SessionManager.open(sessionPath);
      const cwd = sessionManager.getCwd?.() ?? "";
      const modelRuntime = await this.getModelRuntime();
      const result = await this.sdk.createAgentSession({
        ...(cwd ? { cwd } : {}),
        agentDir: this.agentDir,
        modelRuntime,
        sessionManager,
      });
      return this.activateSession(result, cwd);
    } catch (error) {
      throw mapRuntimeError(error, "SESSION_OPEN_FAILED", "无法打开所选 Pi 会话");
    }
  }

  async listModels(): Promise<AgentModel[]> {
    this.ensureOpen();
    try {
      const models = await (await this.getModelRuntime()).getAvailable();
      return models.flatMap((model) => toAgentModel(model));
    } catch (error) {
      throw mapRuntimeError(error, "MODEL_LIST_FAILED", "无法读取已配置的 Pi 模型");
    }
  }

  async configureSession(
    sessionId: string,
    update: { model?: ModelSelection; thinkingLevel?: ThinkingLevel },
  ): Promise<SessionConfiguration> {
    this.ensureOpen();
    const managed = this.requireSession(sessionId);
    if (managed.session.isStreaming) {
      throw new RuntimeError("SESSION_BUSY", "Pi 正在处理任务，暂时无法更改会话配置");
    }

    if (update.model) {
      const model = (await this.getModelRuntime()).getModel(update.model.provider, update.model.id);
      if (!model) {
        throw new RuntimeError("MODEL_NOT_FOUND", "所选模型不在当前 Pi 配置中");
      }
      try {
        await managed.session.setModel(model);
      } catch {
        throw new RuntimeError("MODEL_UPDATE_FAILED", "无法切换到所选模型");
      }
    }

    if (update.thinkingLevel) {
      try {
        managed.session.setThinkingLevel(update.thinkingLevel);
      } catch {
        throw new RuntimeError("THINKING_LEVEL_UPDATE_FAILED", "无法更新思考强度");
      }
    }
    return describeConfiguration(managed.session);
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    this.ensureOpen();
    try {
      await this.requireSession(sessionId).session.prompt(text, { streamingBehavior: "followUp" });
    } catch (error) {
      throw mapRuntimeError(error, "PROMPT_FAILED", "Pi 无法完成当前提示");
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.ensureOpen();
    try {
      await this.requireSession(sessionId).session.abort();
    } catch (error) {
      throw mapRuntimeError(error, "ABORT_FAILED", "无法停止当前 Pi 任务");
    }
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
    const managed = this.activeSession;
    this.activeSession = undefined;
    if (managed) {
      try {
        if (managed.session.isStreaming) {
          await managed.session.abort().catch(() => undefined);
        }
      } finally {
        releaseSession(managed);
      }
    }
    this.listeners.clear();
  }

  private async getModelRuntime(): Promise<PiModelRuntimeLike> {
    this.modelRuntimePromise ??= this.sdk.ModelRuntime.create({
      authPath: join(this.agentDir, "auth.json"),
      modelsPath: join(this.agentDir, "models.json"),
    });
    return this.modelRuntimePromise;
  }

  private activateSession(
    result: { session: PiSessionLike; modelFallbackMessage?: string },
    cwd: string,
  ): CreatedAgentSession {
    const { session } = result;
    if (!session.sessionId || session.sessionId === this.activeSession?.session.sessionId) {
      session.dispose();
      throw new RuntimeError("INVALID_SESSION", "Pi SDK 返回了无效或重复的会话 id");
    }

    let unsubscribe: () => void;
    try {
      unsubscribe = session.subscribe((event) => this.forwardSdkEvent(session, event));
    } catch {
      session.dispose();
      throw new RuntimeError("SESSION_SUBSCRIBE_FAILED", "无法订阅 Pi SDK 会话事件");
    }

    const previous = this.activeSession;
    const managed = { cwd, session, unsubscribe };
    this.activeSession = managed;
    if (previous) {
      releaseSession(previous);
    }

    return {
      sessionId: session.sessionId,
      cwd,
      sessionPath: session.sessionFile ?? null,
      ...(result.modelFallbackMessage === undefined
        ? {}
        : { modelFallbackMessage: result.modelFallbackMessage }),
      configuration: describeConfiguration(session),
      messages: summarizeMessages(session.messages),
    };
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new RuntimeError("RUNTIME_CLOSED", "Bridge 会话运行时已关闭");
    }
  }

  private ensureReplaceable(): void {
    if (this.activeSession?.session.isStreaming) {
      throw new RuntimeError("SESSION_BUSY", "Pi 正在处理任务，暂时无法切换会话");
    }
  }

  private requireSession(sessionId: string): ManagedSession {
    const managed = this.activeSession;
    if (!managed || managed.session.sessionId !== sessionId) {
      throw new RuntimeError("SESSION_NOT_FOUND", `找不到会话 ${sessionId}`);
    }
    return managed;
  }

  private forwardSdkEvent(session: PiSessionLike, event: unknown): void {
    if (!isRecord(event) || typeof event.type !== "string") {
      return;
    }

    let runtimeEvent: RuntimeEvent | undefined;
    if (event.type === "agent_start") {
      runtimeEvent = { sessionId: session.sessionId, name: "agent.started" };
    } else if (event.type === "agent_settled") {
      runtimeEvent = { sessionId: session.sessionId, name: "agent.settled" };
    } else if (event.type === "model_select" || event.type === "thinking_level_changed") {
      runtimeEvent = {
        sessionId: session.sessionId,
        name: "session.configurationChanged",
        data: describeConfiguration(session),
      };
    } else if (
      event.type === "message_update" &&
      isRecord(event.assistantMessageEvent) &&
      event.assistantMessageEvent.type === "text_delta" &&
      typeof event.assistantMessageEvent.delta === "string"
    ) {
      runtimeEvent = {
        sessionId: session.sessionId,
        name: "message.delta",
        data: { delta: event.assistantMessageEvent.delta },
      };
    } else if (event.type === "tool_execution_start") {
      const tool = readToolEvent(event);
      if (tool) {
        runtimeEvent = {
          sessionId: session.sessionId,
          name: "tool.started",
          data: tool,
        };
      }
    } else if (event.type === "tool_execution_end") {
      const tool = readToolEvent(event);
      if (tool) {
        runtimeEvent = {
          sessionId: session.sessionId,
          name: event.isError === true ? "tool.failed" : "tool.completed",
          data: tool,
        };
      }
    }

    if (runtimeEvent) {
      for (const listener of this.listeners) {
        listener(runtimeEvent);
      }
    }
  }
}

function readToolEvent(event: Record<string, unknown>): {
  toolCallId: string;
  toolName: string;
} | null {
  const toolCallId = readBoundedText(event.toolCallId, MAX_TOOL_CALL_ID_CHARS);
  const toolName = readBoundedText(event.toolName, MAX_TOOL_NAME_CHARS);
  return toolCallId && toolName ? { toolCallId, toolName } : null;
}

function readBoundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : null;
}

function releaseSession(managed: ManagedSession): void {
  try {
    managed.unsubscribe();
  } finally {
    managed.session.dispose();
  }
}

function describeConfiguration(session: PiSessionLike): SessionConfiguration {
  const available = session
    .getAvailableThinkingLevels()
    .filter((level): level is ThinkingLevel => THINKING_LEVELS.includes(level));
  return {
    model: session.model ? (toAgentModel(session.model)[0] ?? null) : null,
    thinkingLevel: THINKING_LEVELS.includes(session.thinkingLevel) ? session.thinkingLevel : "off",
    availableThinkingLevels: available.length > 0 ? available : ["off"],
  };
}

function toAgentModel(model: PiModelLike): AgentModel[] {
  if (!model.provider || !model.id) {
    return [];
  }
  return [
    {
      provider: model.provider,
      id: model.id,
      name: model.name?.trim() || model.id,
      reasoning: Boolean(model.reasoning),
    },
  ];
}

function toSessionSummary(session: PiSessionInfoLike): AgentSessionSummary[] {
  if (!session.id || !session.path || !session.cwd) {
    return [];
  }
  const created = toIsoString(session.created);
  const modified = toIsoString(session.modified);
  if (!created || !modified) {
    return [];
  }
  return [
    {
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name?.trim() || null,
      created,
      modified,
      messageCount: Number.isFinite(session.messageCount) ? Math.max(0, session.messageCount) : 0,
      firstMessage: clipText(session.firstMessage, MAX_SUMMARY_CHARS),
    },
  ];
}

function toIsoString(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeMessages(messages: unknown[]): AgentMessageSummary[] {
  const summaries = messages.flatMap((message) => {
    if (!isRecord(message) || (message.role !== "user" && message.role !== "assistant")) {
      return [];
    }
    const content = readMessageText(message.content);
    const summary: AgentMessageSummary = { role: message.role, content };
    return content ? [summary] : [];
  });

  const selected: AgentMessageSummary[] = [];
  let characters = 0;
  for (const message of summaries.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    if (characters + message.content.length > MAX_HISTORY_CHARS) {
      break;
    }
    characters += message.content.length;
    selected.push(message);
  }
  return selected.reverse();
}

function readMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("");
}

function clipText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength - 1)}…`;
}

function mapRuntimeError(error: unknown, code: string, message: string): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError(code, message);
}
