import { randomBytes, randomUUID } from "node:crypto";

export const REQUEST_HEADER_CLIENTS = ["claude-code", "codex"] as const;

export type RequestHeaderClient = (typeof REQUEST_HEADER_CLIENTS)[number];

export interface RequestHeaderSettings {
  enabled: boolean;
  client: RequestHeaderClient;
}

export const DEFAULT_REQUEST_HEADER_SETTINGS: Readonly<RequestHeaderSettings> = {
  enabled: false,
  client: "claude-code",
};

export interface RequestHeaderExtensionContextLike {
  sessionManager: {
    getSessionId(): string;
  };
}

export interface RequestHeaderExtensionApiLike {
  on(
    event: "before_provider_headers",
    handler: (
      event: { headers: Record<string, string | null> },
      context: RequestHeaderExtensionContextLike,
    ) => void,
  ): void;
}

export type RequestHeaderExtensionFactory = (pi: RequestHeaderExtensionApiLike) => void;

interface DynamicValueSources {
  installationId: string;
  now: number;
  turnId: string;
}

const INSTALLATION_ID = randomUUID();
const FORBIDDEN_HEADERS = new Set([
  "accept-encoding",
  "authorization",
  "connection",
  "content-encoding",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "transfer-encoding",
  "x-api-key",
]);

const CLAUDE_CODE_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["Accept", "application/json"],
  ["Content-Type", "application/json"],
  ["User-Agent", "claude-cli/2.1.224 (external, cli)"],
  ["X-Stainless-Arch", "x64"],
  ["X-Stainless-Lang", "js"],
  ["X-Stainless-OS", "Windows"],
  ["X-Stainless-Package-Version", "0.94.0"],
  ["X-Stainless-Retry-Count", "0"],
  ["X-Stainless-Runtime", "node"],
  ["X-Stainless-Runtime-Version", "v26.3.0"],
  ["X-Stainless-Timeout", "600"],
  [
    "anthropic-beta",
    "claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advanced-tool-use-2025-11-20,effort-2025-11-24",
  ],
  ["anthropic-dangerous-direct-browser-access", "true"],
  ["anthropic-version", "2023-06-01"],
  ["x-app", "cli"],
];

const CODEX_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["x-codex-beta-features", "remote_compaction_v2"],
  ["accept", "text/event-stream"],
  ["content-type", "application/json"],
  ["originator", "codex-tui"],
  [
    "user-agent",
    "codex-tui/0.147.0 (Windows 10.0.26200; x86_64) WindowsTerminal (codex-tui; 0.147.0)",
  ],
];

export function createRequestHeaderExtension(
  readSettings: () => Readonly<RequestHeaderSettings>,
): RequestHeaderExtensionFactory {
  return (pi) => {
    pi.on("before_provider_headers", (event, context) => {
      try {
        applyRequestHeaders(event.headers, readSettings(), context);
      } catch {
        // Header spoofing is optional and must never block a provider request.
      }
    });
  };
}

export function applyRequestHeaders(
  headers: Record<string, string | null>,
  settings: Readonly<RequestHeaderSettings>,
  context: RequestHeaderExtensionContextLike,
  sources: Partial<DynamicValueSources> = {},
): void {
  if (!settings.enabled) {
    return;
  }

  const sessionId = context.sessionManager.getSessionId();
  if (!sessionId) {
    throw new Error("Pi SDK did not provide a session id");
  }

  if (settings.client === "claude-code") {
    applyTemplate(headers, [
      ...CLAUDE_CODE_HEADERS,
      ["X-Claude-Code-Session-Id", sessionId] as const,
    ]);
    return;
  }
  if (settings.client !== "codex") {
    throw new Error("Unknown request header client");
  }

  const now = sources.now ?? Date.now();
  const installationId = sources.installationId ?? INSTALLATION_ID;
  const turnId = sources.turnId ?? createUuidV7(now);
  const windowId = `${sessionId}:0`;
  const turnMetadata = JSON.stringify({
    installation_id: installationId,
    session_id: sessionId,
    thread_id: sessionId,
    turn_id: turnId,
    window_id: windowId,
    request_kind: "turn",
    thread_source: "user",
    sandbox: "windows_sandbox",
    turn_started_at_unix_ms: now,
  });
  applyTemplate(headers, [
    ...CODEX_HEADERS,
    ["x-codex-window-id", windowId],
    ["x-codex-turn-metadata", turnMetadata],
    ["x-client-request-id", sessionId],
    ["session-id", sessionId],
    ["thread-id", sessionId],
  ]);
}

function applyTemplate(
  headers: Record<string, string | null>,
  template: ReadonlyArray<readonly [string, string]>,
): void {
  for (const [key, value] of template) {
    if (!FORBIDDEN_HEADERS.has(key.toLowerCase())) {
      setHeaderCaseInsensitive(headers, key, value);
    }
  }
}

function setHeaderCaseInsensitive(
  headers: Record<string, string | null>,
  key: string,
  value: string,
): void {
  const normalizedKey = key.toLowerCase();
  const aliases = normalizedKey === "session-id" ? new Set(["session-id", "session_id"]) : null;
  for (const existingKey of Object.keys(headers)) {
    const normalized = existingKey.toLowerCase();
    if (normalized === normalizedKey || aliases?.has(normalized)) {
      delete headers[existingKey];
    }
  }
  headers[key] = value;
}

function createUuidV7(timestamp: number): string {
  const bytes = randomBytes(16);
  const milliseconds = BigInt(Math.max(0, Math.trunc(timestamp)));
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((milliseconds >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
