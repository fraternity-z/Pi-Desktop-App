export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 1024 * 1024;

export const BRIDGE_CAPABILITIES = [
  "ping",
  "health",
  "shutdown",
] as const;

type BridgeOperation = (typeof BRIDGE_CAPABILITIES)[number];

export interface BridgeRequest {
  v: typeof PROTOCOL_VERSION;
  id: string;
  op: BridgeOperation;
}

export interface BridgeHello {
  type: "hello";
  protocolVersion: typeof PROTOCOL_VERSION;
  nodeVersion: string;
  capabilities: readonly BridgeOperation[];
}

export interface BridgeResponse {
  v: typeof PROTOCOL_VERSION;
  kind: "response";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

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

  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) {
    throw new ProtocolError("INVALID_REQUEST_ID", "请求 id 必须为 1-128 个字符");
  }

  if (
    typeof value.op !== "string" ||
    !BRIDGE_CAPABILITIES.includes(value.op as BridgeOperation)
  ) {
    throw new ProtocolError("UNSUPPORTED_OPERATION", `不支持操作 ${String(value.op)}`);
  }

  return {
    v: PROTOCOL_VERSION,
    id: value.id,
    op: value.op as BridgeOperation,
  };
}

export function createHello(nodeVersion = process.versions.node): BridgeHello {
  return {
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    nodeVersion,
    capabilities: BRIDGE_CAPABILITIES,
  };
}

export function serializeFrame(frame: BridgeHello | BridgeResponse): string {
  return `${JSON.stringify(frame)}\n`;
}

