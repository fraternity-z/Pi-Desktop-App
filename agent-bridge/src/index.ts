import { createInterface } from "node:readline";

import {
  PROTOCOL_VERSION,
  ProtocolError,
  createHello,
  parseRequest,
  serializeFrame,
  type BridgeResponse,
} from "./protocol.js";

function writeFrame(frame: Parameters<typeof serializeFrame>[0]): void {
  process.stdout.write(serializeFrame(frame));
}

function failureResponse(id: string, error: unknown): BridgeResponse {
  if (error instanceof ProtocolError) {
    return {
      v: PROTOCOL_VERSION,
      kind: "response",
      id,
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }

  return {
    v: PROTOCOL_VERSION,
    kind: "response",
    id,
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Bridge 处理请求失败" },
  };
}

writeFrame(createHello());

const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

lines.on("line", (line) => {
  let requestId = "unknown";

  try {
    const request = parseRequest(line);
    requestId = request.id;

    const data =
      request.op === "health"
        ? { status: "ok", protocolVersion: PROTOCOL_VERSION }
        : request.op === "ping"
          ? { pong: true }
          : undefined;

    writeFrame({
      v: PROTOCOL_VERSION,
      kind: "response",
      id: request.id,
      ok: true,
      ...(data === undefined ? {} : { data }),
    });

    if (request.op === "shutdown") {
      lines.close();
    }
  } catch (error) {
    writeFrame(failureResponse(requestId, error));
  }
});

