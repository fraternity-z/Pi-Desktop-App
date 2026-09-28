import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPermissionRequest, listAgentPermissionRequests, listenToAgentEvents, replyAgentPermission,
  type PermissionDecision, type PermissionRequest,
} from "../ipc/agent";
import type { AgentEventConnection } from "./useChatSession";

interface PendingPermissions {
  sessionId: string;
  requests: Map<string, PermissionRequest>;
  busy: boolean;
  error: string | null;
  active: boolean;
  remove: (id: string) => void;
}

/** Subscribe before taking a snapshot; overlay events to avoid resurrecting resolved requests. */
export function usePermissionRequests(sessionId: string | null, connection: AgentEventConnection) {
  const current = useRef<PendingPermissions | null>(null);
  const identity = useRef(sessionId);
  identity.current = connection === "ready" ? sessionId : null;
  const [snapshot, setSnapshot] = useState<PendingPermissions | null>(null);
  const [attempt, setAttempt] = useState(0);
  const publish = useCallback((state: PendingPermissions) => {
    if (state.active && current.current === state) setSnapshot({ ...state, requests: new Map(state.requests) });
  }, []);

  useEffect(() => {
    if (!sessionId || connection !== "ready") { current.current = null; setSnapshot(null); return; }
    let syncing = true;
    const changes = new Map<string, PermissionRequest | null>();
    const state: PendingPermissions = { sessionId, requests: new Map(), busy: false, error: null, active: true,
      remove: (id) => {
        state.requests.delete(id);
        if (syncing) changes.set(id, null);
      } };
    current.current = state;
    publish(state);
    let unlisten: (() => void) | undefined;
    let settled = false;
    const remove = state.remove;
    const expire = () => {
      for (const request of state.requests.values()) {
        if (Date.parse(request.expiresAt) <= Date.now()) remove(request.requestId);
      }
    };
    void listenToAgentEvents((event) => {
      if (!state.active || event.sessionId !== sessionId) return;
      if (event.name === "permission.requested" && isPermissionRequest(event.data)) {
        state.requests.set(event.data.requestId, event.data);
        if (syncing) changes.set(event.data.requestId, event.data);
      } else if (event.name === "permission.resolved") {
        remove((event.data as { requestId: string }).requestId);
      } else if (event.name === "agent.settled") {
        state.requests.clear();
        changes.clear();
        settled = true;
      } else return;
      expire();
      publish(state);
    }).then(async (stop) => {
      if (!state.active) { stop(); return; }
      unlisten = stop;
      const requests = await listAgentPermissionRequests(sessionId);
      if (!state.active) return;
      state.requests = new Map((settled ? [] : requests).map((request) => [request.requestId, request]));
      for (const [id, request] of changes) {
        if (request) state.requests.set(id, request); else state.requests.delete(id);
      }
      syncing = false;
      changes.clear();
      expire();
      publish(state);
    }).catch(() => {
      if (!state.active) return;
      syncing = false;
      changes.clear();
      state.error = "无法同步待授权操作，请重新连接授权或停止当前任务。未获授权的操作不会执行。";
      publish(state);
    });
    const timer = window.setInterval(() => {
      const before = state.requests.size;
      expire();
      if (before !== state.requests.size) publish(state);
    }, 1000);
    return () => { state.active = false; unlisten?.(); window.clearInterval(timer); };
  }, [sessionId, connection, attempt, publish]);

  const visible = snapshot?.sessionId === sessionId && connection === "ready" ? snapshot : null;
  const request = visible ? [...visible.requests.values()][0] ?? null : null;
  const reply = useCallback(async (decision: PermissionDecision) => {
    const state = current.current;
    if (!request || !state?.active || state.busy || identity.current !== sessionId ||
      state.sessionId !== sessionId || !state.requests.has(request.requestId)) return;
    if (Date.parse(request.expiresAt) <= Date.now()) {
      state.remove(request.requestId); publish(state); return;
    }
    state.busy = true; state.error = null; publish(state);
    try {
      await replyAgentPermission(state.sessionId, request.requestId, decision);
      state.remove(request.requestId);
    } catch (cause) {
      const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : null;
      if (code === "PERMISSION_REQUEST_EXPIRED" || code === "SESSION_NOT_FOUND") {
        state.remove(request.requestId);
      } else {
        state.error = "授权回复未能确认，请重试或停止任务。";
      }
    } finally { state.busy = false; publish(state); }
  }, [request, sessionId, publish]);

  return { request, pendingCount: visible?.requests.size ?? 0, busy: visible?.busy ?? false,
    error: visible?.error ?? null, reply, retry: () => setAttempt((value) => value + 1) };
}
