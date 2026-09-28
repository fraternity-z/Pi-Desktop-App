import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRequest, type PermissionMode } from "./protocol.js";
import { isWorkspacePath, PERMISSION_ENTRY, PERMISSION_TIMEOUT_MS, ToolPermissions, type PermissionExtensionApi, type PermissionSessionManager } from "./tool-permissions.js";

function fixture(mode: PermissionMode = "accept-edits", checkPath = vi.fn(async () => true), id = "s-1") {
  const emit = vi.fn();
  const manager: PermissionSessionManager = { getSessionId: () => id, getBranch: () => [], appendCustomEntry: vi.fn() };
  const permissions = new ToolPermissions(process.cwd(), emit, checkPath);
  let hook!: Parameters<PermissionExtensionApi["on"]>[1];
  permissions.extension({ on: (_event, handler) => { hook = handler; } });
  permissions.initialize(id, manager);
  permissions.setMode(mode); permissions.resume();
  const call = (toolName: string, toolCallId = "call-1", input: Record<string, unknown> = { path: "file.txt" }) => hook({ toolName, toolCallId, input }, { sessionManager: manager });
  return { permissions, call, hook, emit, manager, checkPath };
}
afterEach(() => vi.useRealTimers());

describe("tool permission policy", () => {
  it.each(["read", "grep", "find", "ls"])("ask permits local built-in %s", async (name) => {
    const f = fixture("ask");
    await expect(f.call(name)).resolves.toBeUndefined();
    expect(f.permissions.list()).toEqual([]);
  });
  it.each(["write", "edit"])("default permits local %s but ask waits", async (name) => {
    const f = fixture(); await expect(f.call(name)).resolves.toBeUndefined();
    f.permissions.setMode("ask"); f.permissions.resume();
    const result = f.call(name);
    const request = f.permissions.list()[0]!;
    f.permissions.reply(request.requestId, "deny");
    await expect(result).resolves.toMatchObject({ block: true });
  });
  it("bash and custom names wait, raw arguments are never exposed", async () => {
    const f = fixture();
    const result = f.call("bash", "call-1", { command: "echo secret-value", token: "private-token" });
    expect(f.permissions.list()).toHaveLength(1);
    expect(JSON.stringify(f.emit.mock.calls)).not.toMatch(/secret-value|private-token|command/);
    let settled = false; void result.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
    f.permissions.reply(f.permissions.list()[0]!.requestId, "allow-once");
    await expect(result).resolves.toBeUndefined();
    const second = f.call("bash", "call-2"); expect(f.permissions.list()).toHaveLength(1); f.permissions.cancel(); await expect(second).resolves.toMatchObject({ block: true });
    f.permissions.resume(); const custom = f.call("read_custom"); expect(f.permissions.list()).toHaveLength(1); f.permissions.close(); await custom;
  });
  it("session grants apply only to the selected tool and reset on policy change", async () => {
    const f = fixture(); const result = f.call("bash");
    f.permissions.reply(f.permissions.list()[0]!.requestId, "allow-session"); await result;
    await expect(f.call("bash", "next")).resolves.toBeUndefined();
    f.permissions.setMode("ask"); f.permissions.resume();
    const later = f.call("bash", "later"); expect(f.permissions.list()).toHaveLength(1); f.permissions.cancel(); await later;
  });
  it("auto bypasses policy without filesystem checks; overridden built-ins still ask", async () => {
    const f = fixture("auto"); await expect(f.call("unknown")).resolves.toBeUndefined(); expect(f.checkPath).not.toHaveBeenCalled();
    f.permissions.setMode("ask"); f.permissions.resume(); f.permissions.setOverriddenTools(["read"]);
    const result = f.call("read"); expect(f.permissions.list()).toHaveLength(1); f.permissions.close(); await result;
  });
  it("outside and invalid paths ask instead of silently authorizing", async () => {
    const f = fixture("accept-edits", vi.fn(async () => false)); const result = f.call("write");
    await Promise.resolve(); expect(f.permissions.list()).toHaveLength(1); f.permissions.close(); await expect(result).resolves.toMatchObject({ block: true });
  });
  it("isolates sessions and rejects duplicate, stale and cross-session replies", async () => {
    const f = fixture(); const other = fixture("ask", vi.fn(async () => true), "s-2"); const result = f.call("bash");
    const id = f.permissions.list()[0]!.requestId;
    expect(() => other.permissions.reply(id, "allow-session")).toThrowError(expect.objectContaining({ code: "PERMISSION_REQUEST_EXPIRED" }));
    await expect(f.call("bash")).resolves.toMatchObject({ block: true });
    await expect(f.hook({ toolName: "bash", toolCallId: "other", input: {} }, { sessionManager: other.manager })).resolves.toMatchObject({ block: true });
    f.permissions.reply(id, "deny"); await result; expect(() => f.permissions.reply(id, "allow-once")).toThrow();
  });
  it("times out pending approvals and rejects stale replies", async () => {
    vi.useFakeTimers(); const f = fixture(); const result = f.call("bash"); const id = f.permissions.list()[0]!.requestId;
    await vi.advanceTimersByTimeAsync(PERMISSION_TIMEOUT_MS); await expect(result).resolves.toMatchObject({ block: true });
    expect(f.permissions.list()).toEqual([]); expect(() => f.permissions.reply(id, "allow-once")).toThrow();
  });
  it("cancellation fences a path check already awaiting and subsequent hooks", async () => {
    let complete!: (value: boolean) => void; const f = fixture("ask", vi.fn(() => new Promise<boolean>((resolve) => { complete = resolve; })));
    const result = f.call("read"); f.permissions.cancel(); complete(true);
    await expect(result).resolves.toMatchObject({ block: true }); expect(f.permissions.list()).toEqual([]);
    await expect(f.call("bash")).resolves.toMatchObject({ block: true });
  });
  it("persists only mode and restores native entries; missing registration fails closed", () => {
    const f = fixture("ask"); expect(f.manager.appendCustomEntry).toHaveBeenCalledWith(PERMISSION_ENTRY, { permissionMode: "ask" });
    const service = new ToolPermissions(process.cwd(), vi.fn()); expect(() => service.assertRegistered()).toThrowError(expect.objectContaining({ code: "TOOL_PERMISSIONS_UNSUPPORTED" }));
    service.extension({ on: () => undefined }); service.initialize("s", { getSessionId: () => "s", getBranch: () => [{ type: "custom", customType: PERMISSION_ENTRY, data: { permissionMode: "auto" } }] });
    expect(service.mode).toBe("auto"); service.beginReload(); expect(() => service.resume()).toThrow();
    service.extension({ on: () => undefined }); service.resume(); service.close();
  });
  it("rejects invalid hook IDs and bounded concurrent approval overflow", async () => {
    const f = fixture(); await expect(f.call("bash", "x".repeat(129))).resolves.toMatchObject({ block: true });
    const pending = Array.from({ length: 64 }, (_, index) => f.call("bash", `call-${index}`));
    await expect(f.call("bash", "overflow")).resolves.toMatchObject({ block: true });
    f.permissions.close(); await Promise.all(pending);
  });
  it.each(["missing", "throws"])("does not elevate or clear pending approvals when persistence %s", async (failure) => {
    const f = fixture();
    if (failure === "missing") delete f.manager.appendCustomEntry;
    else f.manager.appendCustomEntry = () => { throw new Error("private storage detail"); };
    const pending = f.call("bash");
    expect(() => f.permissions.setMode("auto")).toThrowError(expect.objectContaining({ code: "PERMISSION_SAVE_FAILED", message: "无法保存会话权限模式" }));
    expect(f.permissions.mode).toBe("accept-edits");
    expect(f.permissions.list()).toHaveLength(1);
    f.permissions.close();
    await expect(pending).resolves.toMatchObject({ block: true });
  });
  it("rolls back a failed elevation cached before disk persistence", () => {
    const f = fixture("ask");
    const branch: unknown[] = [];
    f.manager.getBranch = () => branch;
    f.manager.appendCustomEntry = (customType, data) => {
      branch.push({ type: "custom", customType, data });
      throw new Error("private storage detail");
    };
    expect(() => f.permissions.setMode("auto")).toThrowError(expect.objectContaining({ code: "PERMISSION_SAVE_FAILED" }));
    expect(f.permissions.mode).toBe("ask");
    expect(branch).toEqual([{ type: "custom", customType: PERMISSION_ENTRY, data: { permissionMode: "ask" } }]);
    const restored = new ToolPermissions(process.cwd(), vi.fn());
    restored.extension({ on: () => undefined });
    restored.initialize("s-1", f.manager);
    expect(restored.mode).toBe("ask");
    f.permissions.close();
    restored.close();
  });
});

describe("workspace path authorization", () => {
  it("canonicalizes paths and validates existing ancestors, links and missing leaves", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-permissions-"));
    try {
      const cwd = join(root, "project"); const outside = join(root, "project-other"); await mkdir(cwd); await mkdir(outside);
      await writeFile(join(cwd, "ok.txt"), "fixture");
      expect(await isWorkspacePath(cwd, "ok.txt", false)).toBe(true);
      expect(await isWorkspacePath(cwd, "missing/deep.txt", true)).toBe(true);
      expect(await isWorkspacePath(cwd, "missing.txt", false)).toBe(false);
      expect(await isWorkspacePath(cwd, outside, true)).toBe(false);
      expect(await isWorkspacePath(cwd, "../project-other/file", true)).toBe(false);
      expect(await isWorkspacePath(cwd, "~/.pi/auth.json", false)).toBe(false);
      expect(await isWorkspacePath(cwd, "bad\0path", true)).toBe(false);
      await symlink(outside, join(cwd, "linked"), process.platform === "win32" ? "junction" : "dir");
      expect(await isWorkspacePath(cwd, "linked/new.txt", true)).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("permission protocol boundary", () => {
  const parse = (fields: Record<string, unknown>) => parseRequest(JSON.stringify({ v: 1, id: "req", sessionId: "session", ...fields }));
  it.each(["ask", "accept-edits", "auto"])("accepts %s configure and prompt mode", (permissionMode) => {
    expect(parse({ op: "session.configure", permissionMode })).toMatchObject({ permissionMode });
    expect(parse({ op: "prompt", text: "hello", permissionMode })).toMatchObject({ permissionMode });
  });
  it("accepts reply/list, validates decisions, mode and ID bounds", () => {
    expect(parse({ op: "permission.list" })).toMatchObject({ op: "permission.list" });
    for (const decision of ["deny", "allow-once", "allow-session"]) expect(parse({ op: "permission.reply", requestId: "approval", decision })).toMatchObject({ decision });
    for (const fields of [{ op: "session.configure", permissionMode: "all" }, { op: "prompt", text: "hello", permissionMode: null }, { op: "permission.reply", requestId: "x".repeat(129), decision: "deny" }, { op: "permission.reply", requestId: "ok", decision: "yes" }]) expect(() => parse(fields)).toThrow();
  });
});
