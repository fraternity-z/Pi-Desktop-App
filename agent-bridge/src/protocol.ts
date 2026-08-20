import { isAbsolute } from "node:path";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_PROMPT_CHARS = 200_000;

export const BRIDGE_OPERATIONS = [
  "ping",
  "health",
  "session.create",
  "prompt",
  "abort",
  "shutdown",
] as const;

export const BRIDGE_CAPABILITIES = [
  "sessions",
  "streaming",
  "abort",
  "extensions",
] as const;

export type BridgeOperation = (typeof BRIDGE_OPERATIONS)[number];
export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[number];

interface RequestBase {
  v: typeof PROTOCOL_VERSION;
  id: string;
}

export type BridgeRequest =
  | (RequestBase & { op: "ping" | "health" | "shutdown" })
  | (RequestBase & { op: "session.create"; cwd: string })
  | (RequestBase & { op: "prompt"; sessionId: string; text: string })
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
    case "shutdown":
      return { v: PROTOCOL_VERSION, id, op: value.op as "ping" | "health" | "shutdown" };
    case "session.create": {
      const cwd = requireString(value, "cwd", 4096);
      if (!isAbsolute(cwd)) {
        throw new ProtocolError("INVALID_REQUEST", "cwd 必须为绝对路径");
      }
      return { v: PROTOCOL_VERSION, id, op: "session.create", cwd };
    }
    case "prompt":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "prompt",
        sessionId: requireString(value, "sessionId"),
        text: requireString(value, "text", MAX_PROMPT_CHARS),
      };
    case "abort":
      return {
        v: PROTOCOL_VERSION,
        id,
        op: "abort",
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
