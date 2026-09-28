import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PermissionDecision, PermissionMode } from "./protocol.js";

export const PERMISSION_ENTRY = "pi-desktop-tool-permissions-v1";
export const PERMISSION_TIMEOUT_MS = 120_000;
export interface PermissionRequest {
  requestId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  expiresAt: string;
}
export interface PermissionSessionManager {
  getSessionId?(): string;
  getBranch?(): unknown[];
  appendCustomEntry?(customType: string, data: unknown): unknown;
}
export interface PermissionToolEvent { toolName: string; toolCallId: string; input: Record<string, unknown> }
type Block = { block: true; reason: string };
export interface PermissionExtensionApi {
  on(event: "tool_call", handler: (event: PermissionToolEvent, context: { sessionManager: PermissionSessionManager }) => Promise<Block | undefined>): void;
}
export type PermissionExtensionFactory = (pi: PermissionExtensionApi) => void;
interface Pending { request: PermissionRequest; timer: ReturnType<typeof setTimeout>; resolve(value: Block | undefined): void }
export class PermissionError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "PermissionError"; }
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isPermissionMode = (value: unknown): value is PermissionMode => value === "ask" || value === "accept-edits" || value === "auto";
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value);
const denied = (): Block => ({ block: true, reason: "工具操作未获授权、已取消或审批已过期" });

/** Check every existing ancestor: a missing leaf must not hide a dangling link. */
export async function isWorkspacePath(cwd: string, input: unknown, writable: boolean): Promise<boolean> {
  if (!isAbsolute(cwd) || typeof input !== "string" || !input.trim() || input.length > 4096 || /[\x00-\x1f]/.test(input)) return false;
  // Pi expands tilde paths itself. Never mistake those for a local relative path.
  if (input.startsWith("~")) return false;
  try {
    const root = await realpath(cwd);
    const target = resolve(cwd, input);
    const local = relative(cwd, target);
    const inside = (path: string) => {
      const rel = relative(root, path);
      return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
    };
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`) || local.split(/[\\/]/).some((part) => part.includes(":"))) return false;
    let current = root;
    const parts = local ? local.split(sep) : [];
    for (let index = 0; index < parts.length; index++) {
      current = resolve(current, parts[index]!);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) return false;
        if (!inside(await realpath(current))) return false;
        if (writable && info.isFile() && info.nlink > 1) return false;
      } catch (error) {
        if (record(error) && error.code === "ENOENT") return writable;
        return false;
      }
    }
    return inside(current);
  } catch { return false; }
}

/** Authorization gates the SDK's public tool_call extension hook, never its runtime. */
export class ToolPermissions {
  private manager?: PermissionSessionManager;
  private sessionId = "";
  private currentMode: PermissionMode = "accept-edits";
  private registered = false;
  private closed = false;
  private suspended = false;
  private generation = 0;
  private readonly grants = new Set<string>();
  private readonly pending = new Map<string, Pending>();
  private readonly children = new Map<string, { active: boolean }>();
  private readonly overriddenTools = new Set<string>();
  constructor(
    readonly cwd: string,
    private readonly emit: (sessionId: string, name: "permission.requested" | "permission.resolved", data: unknown) => void,
    private readonly checkPath = isWorkspacePath,
    private readonly summarize?: (event: PermissionToolEvent) => string | undefined,
  ) {}

  readonly extension: PermissionExtensionFactory = (pi) => {
    if (typeof pi?.on !== "function") throw new PermissionError("TOOL_PERMISSIONS_UNSUPPORTED", "当前 Pi SDK 不支持工具审批扩展");
    pi.on("tool_call", (event, context) => this.authorize(event, context.sessionManager));
    this.registered = true;
  };

  /** Child tools share the parent's policy and approval channel, not its identity. */
  childExtension(childManager: PermissionSessionManager, prefix: string): PermissionExtensionFactory {
    const childId = childManager.getSessionId?.();
    const parentId = this.sessionId;
    if (!childId || this.children.has(prefix) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(prefix)) {
      throw new PermissionError("TOOL_PERMISSIONS_UNSUPPORTED", "子代理工具审批会话身份无效");
    }
    const child = { active: true };
    this.children.set(prefix, child);
    return (pi) => {
      if (typeof pi?.on !== "function") throw new PermissionError("TOOL_PERMISSIONS_UNSUPPORTED", "当前 Pi SDK 不支持工具审批扩展");
      pi.on("tool_call", async (event, context) => {
        if (!child.active || !this.manager || this.sessionId !== parentId || childManager.getSessionId?.() !== childId || context.sessionManager.getSessionId?.() !== childId ||
            typeof event.toolCallId !== "string" || !event.toolCallId.trim() || event.toolCallId.length > 4096 || /[\x00-\x1f]/.test(event.toolCallId)) return denied();
        const toolCallId = `${prefix}:${createHash("sha256").update(event.toolCallId, "utf8").digest("hex").slice(0, 32)}`;
        return this.authorize({ ...event, toolCallId }, this.manager, () => child.active);
      });
    };
  }

  finishChild(prefix: string): void {
    const child = this.children.get(prefix);
    if (!child) return;
    child.active = false; this.children.delete(prefix);
    for (const [id, item] of this.pending) if (item.request.toolCallId.startsWith(`${prefix}:`)) this.finish(id, "deny");
  }

  assertRegistered(): void {
    if (!this.registered) throw new PermissionError("TOOL_PERMISSIONS_UNSUPPORTED", "当前 Pi SDK 未注册工具审批钩子，请升级后重试");
  }
  beginReload(): void { this.cancel(); this.registered = false; }
  setOverriddenTools(names: string[]): void { this.overriddenTools.clear(); for (const name of names) this.overriddenTools.add(name); }
  initialize(sessionId: string, manager: PermissionSessionManager): void {
    this.assertRegistered();
    if (manager.getSessionId && manager.getSessionId() !== sessionId) throw new PermissionError("TOOL_PERMISSIONS_UNSUPPORTED", "工具审批会话身份不匹配");
    this.manager = manager; this.sessionId = sessionId;
    for (const entry of manager.getBranch?.() ?? []) {
      if (record(entry) && entry.type === "custom" && entry.customType === PERMISSION_ENTRY && record(entry.data) && isPermissionMode(entry.data.permissionMode)) this.currentMode = entry.data.permissionMode;
    }
  }
  get mode(): PermissionMode { return this.currentMode; }
  setMode(mode: PermissionMode): void {
    if (!isPermissionMode(mode)) throw new PermissionError("INVALID_REQUEST", "权限模式无效");
    if (mode === this.currentMode) return;
    const entry = { permissionMode: mode };
    try {
      if (typeof this.manager?.appendCustomEntry !== "function") throw new Error("Persistence unavailable");
      this.manager.appendCustomEntry(PERMISSION_ENTRY, entry);
    }
    catch {
      // SessionManager caches this data before disk I/O; a later flush must not save a failed elevation.
      entry.permissionMode = this.currentMode;
      throw new PermissionError("PERMISSION_SAVE_FAILED", "无法保存会话权限模式");
    }
    this.cancel(); this.grants.clear(); this.currentMode = mode;
  }
  resume(): void { this.assertRegistered(); if (!this.closed) this.suspended = false; }
  list(): PermissionRequest[] {
    this.expire();
    return [...this.pending.values()].map(({ request }) => ({ ...request }));
  }
  reply(requestId: string, decision: PermissionDecision): void {
    if (!["deny", "allow-once", "allow-session"].includes(decision)) throw new PermissionError("INVALID_REQUEST", "审批决定无效");
    this.expire();
    const pending = this.pending.get(requestId);
    if (!pending || this.closed || this.suspended) throw new PermissionError("PERMISSION_REQUEST_EXPIRED", "审批不存在、已处理或已过期");
    if (decision === "allow-session") this.grants.add(pending.request.toolName);
    this.finish(requestId, decision);
  }
  cancel(): void {
    this.generation++; this.suspended = true;
    for (const id of this.pending.keys()) this.finish(id, "deny");
  }
  close(): void { this.closed = true; this.cancel(); this.grants.clear(); for (const prefix of this.children.keys()) this.finishChild(prefix); }
  private expire(): void {
    for (const [id, item] of this.pending) if (Date.parse(item.request.expiresAt) <= Date.now()) this.finish(id, "deny");
  }
  private finish(requestId: string, decision: PermissionDecision): void {
    const item = this.pending.get(requestId); if (!item) return;
    this.pending.delete(requestId); clearTimeout(item.timer);
    item.resolve(decision === "deny" ? denied() : undefined);
    this.emit(this.sessionId, "permission.resolved", { requestId, decision });
  }
  private async authorize(event: PermissionToolEvent, manager: PermissionSessionManager, isActive = () => true): Promise<Block | undefined> {
    const generation = this.generation;
    if (!isActive() || this.closed || this.suspended || !this.sessionId || manager.getSessionId?.() !== this.sessionId || !validId(event.toolName) || !validId(event.toolCallId)) return denied();
    if (this.currentMode === "auto" || this.grants.has(event.toolName)) return undefined;
    const read = ["read", "grep", "find", "ls"].includes(event.toolName);
    const write = ["write", "edit"].includes(event.toolName);
    let allowed = false;
    if (!this.overriddenTools.has(event.toolName) && (read || (write && this.currentMode === "accept-edits")) && record(event.input)) {
      const path = event.input.path ?? (["grep", "find", "ls"].includes(event.toolName) ? "." : undefined);
      allowed = await this.checkPath(this.cwd, path, write);
    }
    if (!isActive() || this.closed || this.suspended || generation !== this.generation) return denied();
    if (allowed) return undefined;
    if (this.pending.size >= 64 || [...this.pending.values()].some((item) => item.request.toolCallId === event.toolCallId)) return denied();
    const fallback = event.toolName === "bash" ? "执行终端命令（可能访问项目外文件或网络）；允许本会话将授权此工具的后续调用" : "此工具操作需要审批；允许本会话将授权此工具的后续调用";
    let summary = fallback;
    try { summary = this.summarize?.(event)?.trim() || fallback; } catch { /* Never expose raw input on projection failure. */ }
    const request: PermissionRequest = { requestId: randomUUID(), toolCallId: event.toolCallId, toolName: event.toolName,
      summary: summary.length > 4096 ? `${summary.slice(0, 4095)}…` : summary,
      expiresAt: new Date(Date.now() + PERMISSION_TIMEOUT_MS).toISOString() };
    return new Promise((resolvePromise) => {
      const timer = setTimeout(() => this.finish(request.requestId, "deny"), PERMISSION_TIMEOUT_MS); timer.unref?.();
      this.pending.set(request.requestId, { request, timer, resolve: resolvePromise });
      this.emit(this.sessionId, "permission.requested", { ...request });
    });
  }
}
