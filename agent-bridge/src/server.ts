import {
  PROTOCOL_VERSION,
  ProtocolError,
  parseRequest,
  type BridgeHello,
  type BridgeResponse,
  type OutboundFrame,
} from "./protocol.js";
import { RuntimeError, type SessionRuntime } from "./session-runtime.js";

export class BridgeServer {
  private sequence = 0;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly runtime: SessionRuntime,
    private readonly hello: BridgeHello,
    private readonly write: (frame: OutboundFrame) => void,
  ) {
    this.unsubscribe = runtime.subscribe((event) => {
      this.sequence += 1;
      this.write({
        v: PROTOCOL_VERSION,
        kind: "event",
        seq: this.sequence,
        sessionId: event.sessionId,
        name: event.name,
        ...(event.data === undefined ? {} : { data: event.data }),
      });
    });
  }

  start(): void {
    this.write(this.hello);
  }

  async handleLine(line: string): Promise<boolean> {
    let requestId = "unknown";
    try {
      const request = parseRequest(line);
      requestId = request.id;
      let data: unknown;

      switch (request.op) {
        case "ping":
          data = { pong: true };
          break;
        case "health":
          data = { status: "ok", protocolVersion: PROTOCOL_VERSION };
          break;
        case "session.create":
          data = await this.runtime.createSession(request.cwd);
          break;
        case "prompt":
          await this.runtime.prompt(request.sessionId, request.text);
          break;
        case "abort":
          await this.runtime.abort(request.sessionId);
          break;
        case "shutdown":
          await this.close();
          break;
      }

      this.write({
        v: PROTOCOL_VERSION,
        kind: "response",
        id: request.id,
        ok: true,
        ...(data === undefined ? {} : { data }),
      });
      return request.op !== "shutdown";
    } catch (error) {
      this.write(this.failureResponse(requestId, error));
      return true;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unsubscribe();
    await this.runtime.shutdown();
  }

  private failureResponse(id: string, error: unknown): BridgeResponse {
    if (error instanceof ProtocolError || error instanceof RuntimeError) {
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
}
