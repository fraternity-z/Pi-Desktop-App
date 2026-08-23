import { isAbsolute } from "node:path";

import {
  REQUEST_HEADER_CLIENTS,
  type RequestHeaderClient,
  type RequestHeaderSettings,
} from "./request-headers.js";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_PROMPT_CHARS = 200_000;

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
  "request-headers.configure",
  "session.create",
  "session.list",
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
  "background-sessions",
  "thinking-stream",
  "queue",
  "request-header-profiles",
] as const;

export type BridgeOperation = (typeof BRIDGE_OPERATIONS)[number];
export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[number];
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type PromptStreamingBehavior = "steer" | "followUp";

export interface ModelSelection {
  provider: string;
  id: string;
}

interface RequestBase {
  v: typeof PROTOCOL_VERSION;
  id: string;
}

export type BridgeRequest =
  | (RequestBase & { op: "ping" | "health" | "model.list" | "session.list" | "shutdown" })
  | (RequestBase & { op: "request-headers.configure" } & RequestHeaderSettings)
  | (RequestBase & { op: "session.create"; cwd: string })
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
    case "session.create": {
      const cwd = requireString(value, "cwd", 4096);
      if (!isAbsolute(cwd)) {
        throw new ProtocolError("INVALID_REQUEST", "cwd 必须为绝对路径");
      }
      return { v: PROTOCOL_VERSION, id, op: "session.create", cwd };
    }
    case "session.open": {
      const sessionPath = requireString(value, "sessionPath", 4096);
      if (!isAbsolute(sessionPath)) {
        throw new ProtocolError("INVALID_REQUEST", "sessionPath 必须为绝对路径");
      }
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
        sessionId: requireString(value, "sessionId"),
        ...(model === undefined ? {} : { model }),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      };
    }
    case "prompt": {
      const streamingBehavior = readStreamingBehavior(value);
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "prompt",
        sessionId: requireString(value, "sessionId"),
        text: requireString(value, "text", MAX_PROMPT_CHARS),
        ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
      };
    }
    case "queue.clear":
    case "abort":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: value.op as "queue.clear" | "abort",
        sessionId: requireString(value, "sessionId"),
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
