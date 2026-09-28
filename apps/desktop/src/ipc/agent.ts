import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isSessionReviewSummary, type SessionReviewSummary } from "./sessionReview";

/** Pi SDK 的标准思考强度顺序；模型能力只负责从中筛选可用项。 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type PromptStreamingBehavior = "steer" | "followUp";
export type PackageScope = "global" | "project";
export type PermissionMode = "ask" | "accept-edits" | "auto";
export type PermissionDecision = "deny" | "allow-once" | "allow-session";

export interface PermissionRequest {
  requestId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  expiresAt: string;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "ask" || value === "accept-edits" || value === "auto";
}

export function isPermissionRequest(value: unknown): value is PermissionRequest {
  if (!isRecord(value) || Object.keys(value).length !== 5) return false;
  return [value.requestId, value.toolCallId, value.toolName].every(
    (id) => isBoundedText(id, 128) && !/[\x00-\x1f\x7f]/.test(id),
  ) && isBoundedText(value.summary, 4096) &&
    typeof value.expiresAt === "string" && value.expiresAt.length <= 32 &&
    Number.isFinite(Date.parse(value.expiresAt));
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

/**
 * Keep SDK capability data in the canonical Pi order and discard malformed
 * or provider-specific values before they reach UI state.
 */
export function normalizeThinkingLevels(value: unknown): ThinkingLevel[] {
  if (!Array.isArray(value)) return [];
  const supplied = new Set(value);
  return THINKING_LEVELS.filter((level) => supplied.has(level));
}

/** 与 Pi SDK 一致：请求值无效时先向上，再向下寻找最近可用档位。 */
export function clampThinkingLevel(
  requested: unknown,
  available: readonly ThinkingLevel[],
): ThinkingLevel {
  const levels = normalizeThinkingLevels(available);
  if (typeof requested === "string" && levels.includes(requested as ThinkingLevel)) {
    return requested as ThinkingLevel;
  }

  const requestedIndex =
    typeof requested === "string"
      ? THINKING_LEVELS.indexOf(requested as ThinkingLevel)
      : -1;
  if (requestedIndex < 0) return levels[0] ?? "off";

  for (let index = requestedIndex; index < THINKING_LEVELS.length; index += 1) {
    const candidate = THINKING_LEVELS[index];
    if (levels.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVELS[index];
    if (levels.includes(candidate)) return candidate;
  }
  return levels[0] ?? "off";
}

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

export interface AgentModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
}

export interface ContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

export interface ToolDisplayPayload {
  text: string;
  format: "text" | "json";
  truncated: boolean;
}

export interface AgentMessageSummary {
  role: "user" | "assistant" | "thinking" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: ToolDisplayPayload;
  toolOutput?: ToolDisplayPayload;
  isError?: boolean;
  timestamp?: string;
  review?: SessionReviewSummary;
  subagents?: SubagentSnapshot[];
}

export interface SubagentMessage {
  role: "user" | "assistant" | "thinking" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: ToolDisplayPayload;
  toolOutput?: ToolDisplayPayload;
  isError?: boolean;
}

export interface SubagentSnapshot {
  id: string;
  agent: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  messages: SubagentMessage[];
  truncated: boolean;
  model?: string;
  turns?: number;
  transcriptAvailable?: boolean;
  transcriptRevision?: number;
}

export interface SessionConfiguration {
  model: AgentModel | null;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  availableTools: AgentTool[];
  activeToolNames: string[];
  defaultToolNames: string[];
  permissionMode?: PermissionMode;
}

export interface AgentSession {
  sessionId: string;
  cwd: string;
  sessionPath: string | null;
  modelFallbackMessage: string | null;
  configuration: SessionConfiguration;
  messages: AgentMessageSummary[];
  queuedMessages: QueuedMessages;
  streaming: boolean;
  contextUsage?: ContextUsage | null;
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

export interface DeleteAgentSessionsResult {
  deletedSessionIds: string[];
  missingSessionIds: string[];
}

export interface AgentPackageSummary {
  source: string;
  scope: PackageScope;
  kind: "npm" | "git" | "local" | "unknown";
  installedPath?: string;
  version?: string;
  filtered: boolean;
  enabled: boolean;
}

export interface AgentPackageUpdate {
  source: string;
  displayName: string;
  type: string;
  scope: PackageScope;
}

export interface AgentResourceSummary {
  kind: "extension" | "skill" | "prompt" | "theme" | "context" | "system";
  name: string;
  path: string;
  source?: string;
}

export type AgentSlashCommandSource = "extension" | "prompt" | "skill";

export interface AgentSlashCommand {
  name: string;
  description: string;
  source: AgentSlashCommandSource;
  argumentHint?: string;
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
  | "permission.requested"
  | "permission.resolved"
  | "agent.started"
  | "user.message"
  | "message.delta"
  | "thinking.delta"
  | "message.completed"
  | "message.failed"
  | "tool.started"
  | "tool.updated"
  | "tool.completed"
  | "tool.failed"
  | "queue.updated"
  | "agent.settled"
  | "session.configurationChanged"
  | "session.reviewChanged"
  | "session.usageChanged";

const AGENT_EVENT_NAMES = new Set<AgentEventName>([
  "permission.requested",
  "permission.resolved",
  "agent.started",
  "user.message",
  "message.delta",
  "thinking.delta",
  "message.completed",
  "message.failed",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "tool.failed",
  "queue.updated",
  "agent.settled",
  "session.configurationChanged",
  "session.reviewChanged",
  "session.usageChanged",
]);
const MAX_SESSION_ID_CHARS = 128;
export const MAX_SESSION_DELETE_BATCH = 1024;
const MAX_TOOL_CALL_ID_CHARS = 256;
const MAX_TOOL_NAME_CHARS = 128;
const MAX_TOOL_DISPLAY_CHARS = 120_000;
const MAX_EVENT_TEXT_CHARS = 1_048_576;

export async function createAgentSession(cwd: string): Promise<AgentSession> {
  return invoke<AgentSession>("agent_create_session", { cwd });
}

export async function listAgentSessions(): Promise<AgentSessionSummary[]> {
  return invoke<AgentSessionSummary[]>("agent_list_sessions");
}

export async function deleteAgentSessions(
  sessionIds: string[],
): Promise<DeleteAgentSessionsResult> {
  if (sessionIds.length <= MAX_SESSION_DELETE_BATCH) {
    return invoke<DeleteAgentSessionsResult>("agent_delete_sessions", { sessionIds });
  }

  const deletedSessionIds: string[] = [];
  const missingSessionIds: string[] = [];
  for (let offset = 0; offset < sessionIds.length; offset += MAX_SESSION_DELETE_BATCH) {
    const result = await invoke<DeleteAgentSessionsResult>("agent_delete_sessions", {
      sessionIds: sessionIds.slice(offset, offset + MAX_SESSION_DELETE_BATCH),
    });
    deletedSessionIds.push(...result.deletedSessionIds);
    missingSessionIds.push(...result.missingSessionIds);
  }
  return { deletedSessionIds, missingSessionIds };
}

export async function openAgentSession(sessionPath: string): Promise<AgentSession> {
  return invoke<AgentSession>("agent_open_session", { sessionPath });
}

export async function listAgentModels(): Promise<AgentModel[]> {
  return invoke<AgentModel[]>("agent_list_models");
}

export async function listAgentPackages(cwd: string): Promise<AgentPackageSummary[]> {
  return invoke<AgentPackageSummary[]>("agent_list_packages", { cwd });
}

export async function installAgentPackage(
  cwd: string,
  source: string,
  scope: PackageScope,
): Promise<AgentPackageSummary[]> {
  return invoke<AgentPackageSummary[]>("agent_install_package", { cwd, source, scope });
}

export async function setAgentPackageEnabled(
  cwd: string,
  source: string,
  scope: PackageScope,
  enabled: boolean,
): Promise<AgentPackageSummary[]> {
  return invoke<AgentPackageSummary[]>("agent_set_package_enabled", {
    cwd,
    source,
    scope,
    enabled,
  });
}

export async function removeAgentPackage(
  cwd: string,
  source: string,
  scope: PackageScope,
): Promise<AgentPackageSummary[]> {
  return invoke<AgentPackageSummary[]>("agent_remove_package", { cwd, source, scope });
}

export async function updateAgentPackage(
  cwd: string,
  source?: string,
): Promise<AgentPackageSummary[]> {
  return invoke<AgentPackageSummary[]>("agent_update_package", {
    cwd,
    ...(source === undefined ? {} : { source }),
  });
}

export async function checkAgentPackageUpdates(cwd: string): Promise<AgentPackageUpdate[]> {
  return invoke<AgentPackageUpdate[]>("agent_check_package_updates", { cwd });
}

export async function listAgentResources(cwd: string): Promise<AgentResourceSummary[]> {
  return invoke<AgentResourceSummary[]>("agent_list_resources", { cwd });
}

export async function listAgentCommands(sessionId: string): Promise<AgentSlashCommand[]> {
  return invoke<AgentSlashCommand[]>("agent_list_commands", { sessionId });
}

export async function configureAgentSession(
  sessionId: string,
  update: {
    model?: Pick<AgentModel, "provider" | "id">;
    thinkingLevel?: ThinkingLevel;
    permissionMode?: PermissionMode;
  },
): Promise<SessionConfiguration> {
  return invoke<SessionConfiguration>("agent_configure_session", { sessionId, update });
}

/** 返回响应时的事件高水位；流是否完成由 agent.settled 独立确认。 */
export async function promptAgent(
  sessionId: string,
  text: string,
  streamingBehavior?: PromptStreamingBehavior,
  activeTools?: string[],
  imagePaths?: string[],
  permissionMode?: PermissionMode,
): Promise<number> {
  return invoke<number>("agent_prompt", {
    sessionId,
    text,
    ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
    ...(activeTools === undefined ? {} : { activeTools }),
    ...(imagePaths === undefined ? {} : { imagePaths }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
  });
}

export async function clearAgentQueue(sessionId: string): Promise<void> {
  return invoke("agent_clear_queue", { sessionId });
}

export async function listAgentPermissionRequests(sessionId: string): Promise<PermissionRequest[]> {
  const requests = await invoke<unknown>("agent_list_permission_requests", { sessionId });
  if (!Array.isArray(requests) || requests.length > 64 || !requests.every(isPermissionRequest) ||
    new Set(requests.map((request) => request.requestId)).size !== requests.length) {
    throw new Error("待授权请求格式无效，请重新连接会话");
  }
  return requests;
}

export async function replyAgentPermission(
  sessionId: string, requestId: string, decision: PermissionDecision,
): Promise<void> {
  return invoke("agent_reply_permission", { sessionId, requestId, decision });
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
  if (name === "permission.requested") return isPermissionRequest(data);
  if (name === "permission.resolved") {
    return isRecord(data) && Object.keys(data).length === 2 &&
      isBoundedText(data.requestId, 128) && !/[\x00-\x1f\x7f]/.test(data.requestId) &&
      typeof data.decision === "string" && ["deny", "allow-once", "allow-session"].includes(data.decision);
  }
  if (name === "message.delta" || name === "thinking.delta") {
    return (
      isRecord(data) &&
      Object.keys(data).length === 1 &&
      typeof data.delta === "string" &&
      data.delta.length <= MAX_EVENT_TEXT_CHARS
    );
  }
  if (name === "user.message") {
    return (
      isRecord(data) &&
      Object.keys(data).length === 1 &&
      typeof data.content === "string" &&
      data.content.trim().length > 0 &&
      data.content.length <= 200_000
    );
  }
  if (name === "message.completed") {
    return (
      isRecord(data) &&
      Object.keys(data).length === 1 &&
      (data.reason === "stop" || data.reason === "length" || data.reason === "toolUse")
    );
  }
  if (name === "message.failed") {
    return (
      isRecord(data) &&
      Object.keys(data).length === 2 &&
      ["aborted", "error", "pending", "deferred"].includes(String(data.reason)) &&
      typeof data.message === "string" &&
      data.message.trim().length > 0 &&
      data.message.length <= 512
    );
  }
  if (name.startsWith("tool.")) {
    if (!isRecord(data)) return false;
    const detailKey = name === "tool.started" ? "input" : "output";
    const keys = Object.keys(data);
    return (
      keys.every((key) => key === "toolCallId" || key === "toolName" || key === "subagents" || key === detailKey || (name !== "tool.started" && key === "review")) &&
      (!("subagents" in data) || isSubagentSnapshots(data.subagents)) &&
      (!(detailKey in data) || isToolDisplayPayload(data[detailKey])) &&
      (!("review" in data) || isSessionReviewSummary(data.review)) &&
      isBoundedText(data.toolCallId, MAX_TOOL_CALL_ID_CHARS) &&
      isBoundedText(data.toolName, MAX_TOOL_NAME_CHARS)
    );
  }
  if (name === "queue.updated") {
    return (
      isRecord(data) &&
      Object.keys(data).length === 2 &&
      isQueuedMessageList(data.steering) &&
      isQueuedMessageList(data.followUp)
    );
  }
  if (name === "session.reviewChanged") return isSessionReviewSummary(data);
  if (name === "session.configurationChanged") {
    if (!isRecord(data)) return false;
    const keys = Object.keys(data).filter((key) => key !== "permissionMode");
    if (
      (keys.length !== 3 && keys.length !== 6) ||
      ("permissionMode" in data && !isPermissionMode(data.permissionMode)) ||
      !("model" in data) ||
      !("thinkingLevel" in data) ||
      !("availableThinkingLevels" in data) ||
      !isThinkingLevel(data.thinkingLevel) ||
      !isThinkingLevelList(data.availableThinkingLevels) ||
      !data.availableThinkingLevels.includes(data.thinkingLevel)
    ) {
      return false;
    }
    return (
      keys.length === 3 ||
      (isAgentToolList(data.availableTools) &&
        isToolNameList(data.activeToolNames) &&
        isToolNameList(data.defaultToolNames))
    );
  }
  if (name === "session.usageChanged") {
    if (data === null) return true;
    return (
      isRecord(data) &&
      Object.keys(data).length === 3 &&
      Number.isSafeInteger(data.tokens) &&
      Number(data.tokens) >= 0 &&
      Number.isSafeInteger(data.contextWindow) &&
      Number(data.contextWindow) > 0 &&
      typeof data.percent === "number" &&
      Number.isFinite(data.percent) &&
      data.percent >= 0 &&
      data.percent <= 100
    );
  }
  return data === undefined || data === null;
}

function isAgentToolList(value: unknown): value is AgentTool[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  const names = new Set<string>();
  for (const tool of value) {
    if (
      !isRecord(tool) ||
      Object.keys(tool).length !== 2 ||
      !isBoundedText(tool.name, MAX_TOOL_NAME_CHARS) ||
      /[\r\n\0]/.test(tool.name) ||
      names.has(tool.name) ||
      typeof tool.description !== "string" ||
      tool.description.length > 1_024
    ) {
      return false;
    }
    names.add(tool.name);
  }
  return true;
}

function isToolNameList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  const names = new Set<string>();
  for (const name of value) {
    if (
      !isBoundedText(name, MAX_TOOL_NAME_CHARS) ||
      /[\r\n\0]/.test(name) ||
      names.has(name)
    ) {
      return false;
    }
    names.add(name);
  }
  return true;
}

function isToolDisplayPayload(value: unknown): value is ToolDisplayPayload {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    isBoundedText(value.text, MAX_TOOL_DISPLAY_CHARS) &&
    (value.format === "text" || value.format === "json") &&
    typeof value.truncated === "boolean"
  );
}

export function isSubagentSnapshots(value: unknown): value is SubagentSnapshot[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return false;
  const ids = new Set<string>();
  for (const snapshot of value) {
    if (!isRecord(snapshot) || !Object.keys(snapshot).every((key) => ["id", "agent", "task", "status", "messages", "truncated", "model", "turns", "transcriptAvailable", "transcriptRevision"].includes(key)) ||
      !isBoundedText(snapshot.id, 260) || ids.has(snapshot.id) || !isBoundedText(snapshot.agent, 128) ||
      typeof snapshot.task !== "string" || snapshot.task.length > 4096 ||
      !["pending", "running", "completed", "failed", "cancelled"].includes(String(snapshot.status)) ||
      typeof snapshot.truncated !== "boolean" || !Array.isArray(snapshot.messages) || snapshot.messages.length > 100 ||
      ("model" in snapshot && !isBoundedText(snapshot.model, 256)) ||
      ("transcriptAvailable" in snapshot && typeof snapshot.transcriptAvailable !== "boolean") ||
      ("transcriptRevision" in snapshot && (!Number.isSafeInteger(snapshot.transcriptRevision) || Number(snapshot.transcriptRevision) < 1)) ||
      ("turns" in snapshot && (!Number.isSafeInteger(snapshot.turns) || Number(snapshot.turns) < 0))) return false;
    ids.add(snapshot.id);
    for (const message of snapshot.messages) {
      if (!isRecord(message) || !Object.keys(message).every((key) => ["role", "content", "toolCallId", "toolName", "toolInput", "toolOutput", "isError"].includes(key)) ||
        !["user", "assistant", "thinking", "tool", "system"].includes(String(message.role)) ||
        typeof message.content !== "string" || message.content.length > 8192 ||
        ("toolCallId" in message && !isBoundedText(message.toolCallId, 256)) ||
        ("toolName" in message && !isBoundedText(message.toolName, 128)) ||
        ("isError" in message && typeof message.isError !== "boolean") ||
        ["toolInput", "toolOutput"].some((key) => key in message && (!isToolDisplayPayload(message[key]) || message[key].text.length > 4096))) return false;
    }
  }
  return new TextEncoder().encode(JSON.stringify(value)).length <= 100_000;
}

function isQueuedMessageList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  let total = 0;
  for (const message of value) {
    if (typeof message !== "string" || !message.trim() || message.length > 200_000) return false;
    total += message.length;
    if (total > 400_000) return false;
  }
  return true;
}

function isThinkingLevelList(value: unknown): value is ThinkingLevel[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= THINKING_LEVELS.length &&
    value.every(isThinkingLevel) &&
    new Set(value).size === value.length
  );
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
