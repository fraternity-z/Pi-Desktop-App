import { extname, isAbsolute, win32 } from "node:path";

import {
  REQUEST_HEADER_CLIENTS,
  type RequestHeaderClient,
  type RequestHeaderSettings,
} from "./request-headers.js";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_PROMPT_CHARS = 200_000;
export const MAX_ACTIVE_TOOLS = 256;
export const MAX_TOOL_NAME_CHARS = 128;
export const MAX_SESSION_IDS = 1024;
export const MAX_SESSION_ID_CHARS = 128;
export const MAX_PROMPT_IMAGES = 12;
export const MAX_COMMANDS = 512;
export const MAX_COMMAND_NAME_CHARS = 128;
export const MAX_COMMAND_DESCRIPTION_CHARS = 1_024;

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const BRIDGE_OPERATIONS = [
  "ping",
  "health",
  "model.list",
  "package.list",
  "package.install",
  "package.set-enabled",
  "package.remove",
  "package.update",
  "package.check-updates",
  "resource.list",
  "command.list",
  "request-headers.configure",
  "session.create",
  "session.list",
  "session.delete",
  "session.open",
  "session.configure",
  "prompt",
  "queue.clear",
  "abort",
  "shutdown",
] as const;

export const BRIDGE_CAPABILITIES = [
  "sessions",
  "streaming",
  "abort",
  "extensions",
  "models",
  "session-history",
  "session-configuration",
  "tool-status",
  "tool-permissions",
  "background-sessions",
  "thinking-stream",
  "queue",
  "request-header-profiles",
  "packages",
  "resources",
  "context-usage",
  "images",
  "commands",
] as const;

export type BridgeOperation = (typeof BRIDGE_OPERATIONS)[number];
export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type PromptStreamingBehavior = "steer" | "followUp";
export type PackageScope = "global" | "project";
export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface ModelSelection {
  provider: string;
  id: string;
}

export interface SlashCommandSummary {
  name: string;
  description: string;
  source: SlashCommandSource;
  argumentHint?: string;
}

interface RequestBase {
  v: typeof PROTOCOL_VERSION;
  id: string;
}

export type BridgeRequest =
  | (RequestBase & { op: "ping" | "health" | "model.list" | "session.list" | "shutdown" })
  | (RequestBase & { op: "package.list" | "package.check-updates" | "resource.list"; cwd: string })
  | (RequestBase & { op: "command.list"; sessionId: string })
  | (RequestBase & {
      op: "package.install" | "package.remove";
      cwd: string;
      source: string;
      scope: PackageScope;
    })
  | (RequestBase & {
      op: "package.set-enabled";
      cwd: string;
      source: string;
      scope: PackageScope;
      enabled: boolean;
    })
  | (RequestBase & { op: "package.update"; cwd: string; source?: string })
  | (RequestBase & { op: "request-headers.configure" } & RequestHeaderSettings)
  | (RequestBase & { op: "session.create"; cwd: string })
  | (RequestBase & { op: "session.delete"; sessionIds: string[] })
  | (RequestBase & { op: "session.open"; sessionPath: string })
  | (RequestBase & {
      op: "session.configure";
      sessionId: string;
      model?: ModelSelection;
      thinkingLevel?: ThinkingLevel;
    })
  | (RequestBase & {
      op: "prompt";
      sessionId: string;
      text: string;
      streamingBehavior?: PromptStreamingBehavior;
      activeTools?: string[];
      imagePaths?: string[];
    })
  | (RequestBase & { op: "queue.clear"; sessionId: string })
  | (RequestBase & { op: "abort"; sessionId: string });

export interface BridgeHello {
  type: "hello";
  protocolVersion: typeof PROTOCOL_VERSION;
  piVersion: string;
  nodeVersion: string;
  capabilities: readonly BridgeCapability[];
}

export interface BridgeResponse {
  v: typeof PROTOCOL_VERSION;
  kind: "response";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: BridgeError;
}

export interface BridgeEvent {
  v: typeof PROTOCOL_VERSION;
  kind: "event";
  seq: number;
  sessionId: string;
  name: string;
  data?: unknown;
}

export interface BridgeError {
  code: string;
  message: string;
}

export interface BridgeStartupError {
  type: "startup.error";
  error: BridgeError;
}

export type OutboundFrame = BridgeHello | BridgeResponse | BridgeEvent | BridgeStartupError;

export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  maximumLength = 128,
): string {
  const fieldValue = value[field];
  if (
    typeof fieldValue !== "string" ||
    fieldValue.length === 0 ||
    fieldValue.length > maximumLength
  ) {
    throw new ProtocolError(
      "INVALID_REQUEST",
      `${field} 必须为 1-${maximumLength} 个字符`,
    );
  }
  return fieldValue;
}

function requireSessionId(value: Record<string, unknown>): string {
  const sessionId = requireString(value, "sessionId", MAX_SESSION_ID_CHARS);
  if (sessionId.trim().length === 0 || /[\r\n\0]/.test(sessionId)) {
    throw new ProtocolError("INVALID_REQUEST", "sessionId 包含无效字符");
  }
  return sessionId;
}

function readModelSelection(value: Record<string, unknown>): ModelSelection | undefined {
  if (value.model === undefined) {
    return undefined;
  }
  if (!isRecord(value.model)) {
    throw new ProtocolError("INVALID_REQUEST", "model 必须为对象");
  }
  return {
    provider: requireString(value.model, "provider", 128),
    id: requireString(value.model, "id", 256),
  };
}

function readThinkingLevel(value: Record<string, unknown>): ThinkingLevel | undefined {
  if (value.thinkingLevel === undefined) {
    return undefined;
  }
  if (
    typeof value.thinkingLevel !== "string" ||
    !THINKING_LEVELS.includes(value.thinkingLevel as ThinkingLevel)
  ) {
    throw new ProtocolError("INVALID_REQUEST", "thinkingLevel 不是受支持的思考强度");
  }
  return value.thinkingLevel as ThinkingLevel;
}

function readStreamingBehavior(
  value: Record<string, unknown>,
): PromptStreamingBehavior | undefined {
  if (value.streamingBehavior === undefined) return undefined;
  if (value.streamingBehavior !== "steer" && value.streamingBehavior !== "followUp") {
    throw new ProtocolError("INVALID_REQUEST", "streamingBehavior 必须为 steer 或 followUp");
  }
  return value.streamingBehavior;
}

function readActiveTools(value: Record<string, unknown>): string[] | undefined {
  if (value.activeTools === undefined) return undefined;
  if (!Array.isArray(value.activeTools) || value.activeTools.length > MAX_ACTIVE_TOOLS) {
    throw new ProtocolError(
      "INVALID_REQUEST",
      `activeTools 必须为不超过 ${MAX_ACTIVE_TOOLS} 项的数组`,
    );
  }

  const names = new Set<string>();
  for (const item of value.activeTools) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > MAX_TOOL_NAME_CHARS ||
      /[\r\n\0]/.test(item) ||
      names.has(item)
    ) {
      throw new ProtocolError("INVALID_REQUEST", "activeTools 包含无效或重复的工具名称");
    }
    names.add(item);
  }
  return [...names];
}

function readImagePaths(value: Record<string, unknown>): string[] | undefined {
  if (value.imagePaths === undefined) return undefined;
  if (
    !Array.isArray(value.imagePaths) ||
    value.imagePaths.length === 0 ||
    value.imagePaths.length > MAX_PROMPT_IMAGES
  ) {
    throw new ProtocolError(
      "INVALID_REQUEST",
      `imagePaths 必须为 1-${MAX_PROMPT_IMAGES} 项的数组`,
    );
  }

  const paths: string[] = [];
  const unique = new Set<string>();
  for (const item of value.imagePaths) {
    const path = typeof item === "string" ? item.trim() : "";
    const windowsPath = win32.isAbsolute(path);
    const extension = (windowsPath ? win32.extname(path) : extname(path)).toLocaleLowerCase();
    const duplicateKey = windowsPath
      ? path.replace(/\\/g, "/").toLocaleLowerCase("en-US")
      : path;
    if (
      typeof item !== "string" ||
      path.length === 0 ||
      path.length > 4_096 ||
      /[\r\n\0]/.test(item) ||
      (!isAbsolute(path) && !windowsPath) ||
      ![".gif", ".jpeg", ".jpg", ".png", ".webp"].includes(extension) ||
      unique.has(duplicateKey)
    ) {
      throw new ProtocolError("INVALID_REQUEST", "imagePaths 包含无效、重复或不支持的图片路径");
    }
    unique.add(duplicateKey);
    paths.push(path);
  }
  return paths;
}

function readSessionIds(value: Record<string, unknown>): string[] {
  if (!Array.isArray(value.sessionIds) || value.sessionIds.length === 0 || value.sessionIds.length > MAX_SESSION_IDS) {
    throw new ProtocolError(
      "INVALID_REQUEST",
      `sessionIds 必须为 1-${MAX_SESSION_IDS} 项的数组`,
    );
  }
  const ids = new Set<string>();
  for (const item of value.sessionIds) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (
      typeof item !== "string" ||
      normalized.length === 0 ||
      item.length > MAX_SESSION_ID_CHARS ||
      /[\r\n\0]/.test(item) ||
      ids.has(normalized)
    ) {
      throw new ProtocolError("INVALID_REQUEST", "sessionIds 包含无效或重复的会话 id");
    }
    ids.add(normalized);
  }
  return [...ids];
}

function readRequestHeaderSettings(value: Record<string, unknown>): RequestHeaderSettings {
  if (typeof value.enabled !== "boolean") {
    throw new ProtocolError("INVALID_REQUEST", "enabled 必须为布尔值");
  }
  if (
    typeof value.client !== "string" ||
    !REQUEST_HEADER_CLIENTS.includes(value.client as RequestHeaderClient)
  ) {
    throw new ProtocolError("INVALID_REQUEST", "client 必须为 claude-code 或 codex");
  }
  return { enabled: value.enabled, client: value.client as RequestHeaderClient };
}

function requireAbsolutePath(value: Record<string, unknown>, field: string): string {
  const path = requireString(value, field, 4096);
  if (!isAbsolute(path)) {
    throw new ProtocolError("INVALID_REQUEST", `${field} 必须为绝对路径`);
  }
  return path;
}

function readPackageScope(value: Record<string, unknown>): PackageScope {
  if (value.scope !== "global" && value.scope !== "project") {
    throw new ProtocolError("INVALID_REQUEST", "scope 必须为 global 或 project");
  }
  return value.scope;
}

export function parseRequest(line: string): BridgeRequest {
  if (Buffer.byteLength(line, "utf8") > MAX_FRAME_BYTES) {
    throw new ProtocolError("FRAME_TOO_LARGE", "协议帧超过 1 MiB 限制");
  }

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ProtocolError("INVALID_JSON", "协议帧不是有效 JSON");
  }

  if (!isRecord(value)) {
    throw new ProtocolError("INVALID_REQUEST", "协议请求必须是 JSON 对象");
  }

  if (value.v !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      "UNSUPPORTED_PROTOCOL",
      `不支持协议版本 ${String(value.v)}，当前版本为 ${PROTOCOL_VERSION}`,
    );
  }

  const id = requireString(value, "id");
  if (typeof value.op !== "string" || !BRIDGE_OPERATIONS.includes(value.op as BridgeOperation)) {
    throw new ProtocolError("UNSUPPORTED_OPERATION", `不支持操作 ${String(value.op)}`);
  }

  switch (value.op as BridgeOperation) {
    case "ping":
    case "health":
    case "model.list":
    case "session.list":
    case "shutdown":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: value.op as "ping" | "health" | "model.list" | "session.list" | "shutdown",
      };
    case "request-headers.configure":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "request-headers.configure",
        ...readRequestHeaderSettings(value),
      };
    case "package.list":
    case "package.check-updates":
    case "resource.list":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: value.op as "package.list" | "package.check-updates" | "resource.list",
        cwd: requireAbsolutePath(value, "cwd"),
      };
    case "command.list":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "command.list",
        sessionId: requireSessionId(value),
      };
    case "package.install":
    case "package.remove": {
      return {
        v: PROTOCOL_VERSION,
        id,
        op: value.op as "package.install" | "package.remove",
        cwd: requireAbsolutePath(value, "cwd"),
        source: requireString(value, "source", 4096),
        scope: readPackageScope(value),
      };
    }
    case "package.set-enabled": {
      if (typeof value.enabled !== "boolean") {
        throw new ProtocolError("INVALID_REQUEST", "enabled 必须为布尔值");
      }
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "package.set-enabled",
        cwd: requireAbsolutePath(value, "cwd"),
        source: requireString(value, "source", 4096),
        scope: readPackageScope(value),
        enabled: value.enabled,
      };
    }
    case "package.update": {
      const source =
        value.source === undefined ? undefined : requireString(value, "source", 4096);
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "package.update",
        cwd: requireAbsolutePath(value, "cwd"),
        ...(source === undefined ? {} : { source }),
      };
    }
    case "session.create": {
      const cwd = requireAbsolutePath(value, "cwd");
      return { v: PROTOCOL_VERSION, id, op: "session.create", cwd };
    }
    case "session.delete":
      return { v: PROTOCOL_VERSION, id, op: "session.delete", sessionIds: readSessionIds(value) };
    case "session.open": {
      const sessionPath = requireAbsolutePath(value, "sessionPath");
      return { v: PROTOCOL_VERSION, id, op: "session.open", sessionPath };
    }
    case "session.configure": {
      const model = readModelSelection(value);
      const thinkingLevel = readThinkingLevel(value);
      if (model === undefined && thinkingLevel === undefined) {
        throw new ProtocolError("INVALID_REQUEST", "会话配置至少需要一个变更项");
      }
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "session.configure",
        sessionId: requireSessionId(value),
        ...(model === undefined ? {} : { model }),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      };
    }
    case "prompt": {
      const streamingBehavior = readStreamingBehavior(value);
      const activeTools = readActiveTools(value);
      const imagePaths = readImagePaths(value);
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "prompt",
        sessionId: requireSessionId(value),
        text: requireString(value, "text", MAX_PROMPT_CHARS),
        ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
        ...(activeTools === undefined ? {} : { activeTools }),
        ...(imagePaths === undefined ? {} : { imagePaths }),
      };
    }
    case "queue.clear":
    case "abort":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: value.op as "queue.clear" | "abort",
        sessionId: requireSessionId(value),
      };
  }
}

export function createHello(
  piVersion: string,
  nodeVersion = process.versions.node,
): BridgeHello {
  return {
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    piVersion,
    nodeVersion,
    capabilities: BRIDGE_CAPABILITIES,
  };
}

export function serializeFrame(frame: OutboundFrame): string {
  return `${JSON.stringify(frame)}\n`;
}
