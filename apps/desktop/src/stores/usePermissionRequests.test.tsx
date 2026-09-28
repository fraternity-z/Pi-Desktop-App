import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAgentPermissionRequests, listenToAgentEvents, replyAgentPermission, type AgentEvent, type PermissionRequest } from "../ipc/agent";
import { usePermissionRequests } from "./usePermissionRequests";

vi.mock("../ipc/agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("../ipc/agent")>(),
  listAgentPermissionRequests: vi.fn(), listenToAgentEvents: vi.fn(), replyAgentPermission: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function request(requestId = "r-1"): PermissionRequest {
  return { requestId, toolCallId: `tool-${requestId}`, toolName: "bash", summary: "Run tests",
    expiresAt: new Date(Date.now() + 120_000).toISOString() };
}

describe("usePermissionRequests", () => {
  let handlers: Set<(event: AgentEvent) => void>;
  let sequence: number;
  const stop = vi.fn();
  function emit(name: AgentEvent["name"], data?: unknown, sessionId = "s-1") {
    act(() => { for (const handler of handlers) handler({ v: 1, kind: "event", seq: sequence++, sessionId, name, data }); });
  }
  beforeEach(() => {
    handlers = new Set(); sequence = 1; stop.mockReset();
    vi.mocked(listenToAgentEvents).mockReset().mockImplementation(async (handler) => {
      handlers.add(handler);
      return () => { handlers.delete(handler); stop(); };
    });
    vi.mocked(listAgentPermissionRequests).mockReset().mockResolvedValue([]);
    vi.mocked(replyAgentPermission).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("subscribes before listing and overlays resolved and requested events", async () => {
    const listing = deferred<PermissionRequest[]>();
    vi.mocked(listAgentPermissionRequests).mockReturnValueOnce(listing.promise);
    const first = request(); const second = request("r-2");
    const { result } = renderHook(() => usePermissionRequests("s-1", "ready"));
    await waitFor(() => expect(listAgentPermissionRequests).toHaveBeenCalledOnce());
    expect(vi.mocked(listenToAgentEvents).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(listAgentPermissionRequests).mock.invocationCallOrder[0]!);
    emit("permission.resolved", { requestId: first.requestId, decision: "deny" });
    emit("permission.requested", second);
    emit("permission.requested", request("foreign"), "s-2");
    await act(async () => listing.resolve([first]));
    expect(result.current.request).toEqual(second);
    expect(result.current.pendingCount).toBe(1);
  });

  it("tombstones successful replies while the initial list is in flight", async () => {
    const listing = deferred<PermissionRequest[]>();
    vi.mocked(listAgentPermissionRequests).mockReturnValueOnce(listing.promise);
    const pending = request();
    const { result } = renderHook(() => usePermissionRequests("s-1", "ready"));
    await waitFor(() => expect(listAgentPermissionRequests).toHaveBeenCalled());
    emit("permission.requested", pending);
    await act(() => result.current.reply("allow-once"));
    await act(async () => listing.resolve([pending]));
    expect(result.current.request).toBeNull();
    expect(replyAgentPermission).toHaveBeenCalledExactlyOnceWith("s-1", "r-1", "allow-once");
  });

  it("ignores old snapshots, callbacks and replies after a session switch", async () => {
    const oldListing = deferred<PermissionRequest[]>();
    const oldReply = deferred<void>();
    vi.mocked(listAgentPermissionRequests).mockReturnValueOnce(oldListing.promise).mockResolvedValueOnce([request("new")]);
    vi.mocked(replyAgentPermission).mockReturnValueOnce(oldReply.promise);
    const { result, rerender } = renderHook(({ session }) => usePermissionRequests(session, "ready"), { initialProps: { session: "s-1" } });
    await waitFor(() => expect(listAgentPermissionRequests).toHaveBeenCalledOnce());
    emit("permission.requested", request());
    const staleReply = result.current.reply;
    let inFlight!: Promise<void>;
    act(() => { inFlight = staleReply("allow-once"); });
    rerender({ session: "s-2" });
    await waitFor(() => expect(result.current.request?.requestId).toBe("new"));
    await act(async () => { oldListing.resolve([request()]); oldReply.reject(new Error("secret")); await inFlight; await staleReply("allow-session"); });
    expect(result.current.request?.requestId).toBe("new");
    expect(result.current.error).toBeNull();
    expect(replyAgentPermission).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("blocks duplicate replies and retains failed requests for retry without exposing errors", async () => {
    const response = deferred<void>();
    vi.mocked(listAgentPermissionRequests).mockResolvedValue([request()]);
    vi.mocked(replyAgentPermission).mockReturnValueOnce(response.promise);
    const { result } = renderHook(() => usePermissionRequests("s-1", "ready"));
    await waitFor(() => expect(result.current.request).not.toBeNull());
    let first!: Promise<void>;
    act(() => { first = result.current.reply("allow-session"); void result.current.reply("deny"); });
    expect(result.current.busy).toBe(true);
    expect(replyAgentPermission).toHaveBeenCalledOnce();
    await act(async () => { response.reject(new Error("Authorization: hidden-secret")); await first; });
    expect(result.current.error).toBe("授权回复未能确认，请重试或停止任务。");
    expect(result.current.request).not.toBeNull();
    await act(() => result.current.reply("deny"));
    expect(result.current.request).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it.each(["PERMISSION_REQUEST_EXPIRED", "SESSION_NOT_FOUND"])("removes stale requests on %s", async (code) => {
    vi.mocked(listAgentPermissionRequests).mockResolvedValue([request()]);
    vi.mocked(replyAgentPermission).mockRejectedValueOnce({ code, message: "private" });
    const { result } = renderHook(() => usePermissionRequests("s-1", "ready"));
    await waitFor(() => expect(result.current.request).not.toBeNull());
    await act(() => result.current.reply("allow-once"));
    expect(result.current.request).toBeNull(); expect(result.current.error).toBeNull();
  });

  it("clears settled requests without resurrecting the snapshot and preserves later requests", async () => {
    const listing = deferred<PermissionRequest[]>();
    vi.mocked(listAgentPermissionRequests).mockReturnValueOnce(listing.promise);
    const { result } = renderHook(() => usePermissionRequests("s-1", "ready"));
    await waitFor(() => expect(listAgentPermissionRequests).toHaveBeenCalledOnce());
    emit("permission.requested", request()); emit("agent.settled");
    expect(result.current.request).toBeNull();
    emit("permission.requested", request("next"));
    await act(async () => listing.resolve([request()]));
    expect(result.current.request?.requestId).toBe("next");
    expect(result.current.pendingCount).toBe(1);
  });

  it("expires requests and never sends a late approval", async () => {
    vi.mocked(listAgentPermissionRequests).mockResolvedValue([request()]);
    const { result } = renderHook(() => usePermissionRequests("s-1", "ready"));
    await waitFor(() => expect(result.current.request).not.toBeNull());
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 120_001);
    await act(() => result.current.reply("allow-once"));
    expect(replyAgentPermission).not.toHaveBeenCalled(); expect(result.current.request).toBeNull();
    vi.restoreAllMocks();
  });

  it("prunes expired requests on the timer", async () => {
    vi.useFakeTimers();
    vi.mocked(listAgentPermissionRequests).mockResolvedValue([request()]);
    const { result } = renderHook(() => usePermissionRequests("s-1", "ready"));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.pendingCount).toBe(1);
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(result.current.request).toBeNull(); expect(replyAgentPermission).not.toHaveBeenCalled();
  });

  it("retries failed synchronization and disconnects safely", async () => {
    vi.mocked(listAgentPermissionRequests).mockRejectedValueOnce(new Error("secret")).mockResolvedValueOnce([request()]);
    const { result, rerender } = renderHook(({ connection }) => usePermissionRequests("s-1", connection),
      { initialProps: { connection: "ready" as "ready" | "error" } });
    await waitFor(() => expect(result.current.error).toContain("无法同步"));
    expect(result.current.error).not.toContain("secret");
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.request).not.toBeNull());
    expect(result.current.error).toBeNull();
    rerender({ connection: "error" });
    expect(result.current.request).toBeNull(); expect(stop).toHaveBeenCalledTimes(2);
  });

  it("does not subscribe to drafts and cleans up a listener registered after unmount", async () => {
    const { unmount: unmountDraft } = renderHook(() => usePermissionRequests(null, "ready"));
    expect(listenToAgentEvents).not.toHaveBeenCalled(); unmountDraft();
    const subscription = deferred<() => void>();
    vi.mocked(listenToAgentEvents).mockReturnValueOnce(subscription.promise);
    const { unmount } = renderHook(() => usePermissionRequests("s-1", "ready"));
    unmount();
    await act(async () => subscription.resolve(stop));
    expect(stop).toHaveBeenCalledOnce(); expect(listAgentPermissionRequests).not.toHaveBeenCalled();
  });
});
