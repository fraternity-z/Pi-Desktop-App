import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubagentMessage, SubagentSnapshot } from "../ipc/agent";
import { readSubagentTranscript } from "../ipc/subagentTranscript";
import { useSubagentTranscript } from "./useSubagentTranscript";

vi.mock("../ipc/subagentTranscript", () => ({ readSubagentTranscript: vi.fn() }));

type Transcript = Awaited<ReturnType<typeof readSubagentTranscript>>;

function transcript(content: string, revision = 1): Transcript {
  return { revision, messages: [{ role: "assistant", content }] };
}

function child(overrides: Partial<SubagentSnapshot> = {}): SubagentSnapshot {
  return {
    id: "tool:0", agent: "reviewer", task: "检查会话", status: "completed",
    messages: [{ role: "assistant", content: "不完整预览" }], truncated: true,
    transcriptAvailable: true, transcriptRevision: 1, ...overrides,
  };
}

function deferred() {
  let resolve!: (value: Transcript) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Transcript>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("useSubagentTranscript 生命周期", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(readSubagentTranscript).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each(["parent", "child"] as const)("切换 %s 后取消旧请求，不展示旧消息或旧错误", async (scope) => {
    const old = deferred();
    const current = deferred();
    vi.mocked(readSubagentTranscript).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(
      ({ sessionId, subagent }) => useSubagentTranscript(sessionId, subagent),
      { initialProps: { sessionId: "parent-a", subagent: child() } },
    );
    const oldSignal = vi.mocked(readSubagentTranscript).mock.calls[0]![2]!;
    const next = { sessionId: scope === "parent" ? "parent-b" : "parent-a", subagent: child({ id: scope === "child" ? "tool:1" : "tool:0" }) };
    rerender(next);
    expect(oldSignal.aborted).toBe(true);
    expect(result.current).toMatchObject({ messages: undefined, loading: true, error: undefined });
    expect(readSubagentTranscript).toHaveBeenLastCalledWith(next.sessionId, next.subagent.id, expect.any(AbortSignal));
    const latest = transcript("当前完整记录");
    await act(async () => { current.resolve(latest); });
    await act(async () => { old.resolve(transcript("旧请求迟到结果")); });
    expect(result.current).toMatchObject({ messages: latest.messages, loading: false, error: undefined });
  });

  it("A→B→A 时旧 A 请求失败不会覆盖重新读取的 A", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    vi.mocked(readSubagentTranscript).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const { result, rerender } = renderHook(({ sessionId }) => useSubagentTranscript(sessionId, child()), { initialProps: { sessionId: "a" } });
    rerender({ sessionId: "b" });
    rerender({ sessionId: "a" });
    const latest = transcript("重新读取 A");
    await act(async () => { third.resolve(latest); });
    await act(async () => { first.reject(new Error("过期 A 错误")); second.resolve(transcript("过期 B")); });
    expect(result.current).toMatchObject({ messages: latest.messages, loading: false, error: undefined });
    expect(vi.mocked(readSubagentTranscript).mock.calls.slice(0, 2).every((call) => call[2]?.aborted)).toBe(true);
  });

  it("切换后立即清除已加载的其他会话内容", async () => {
    const first = transcript("父会话 A 的内容");
    const next = deferred();
    vi.mocked(readSubagentTranscript).mockResolvedValueOnce(first).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ sessionId }) => useSubagentTranscript(sessionId, child()), { initialProps: { sessionId: "a" } });
    await act(async () => {});
    expect(result.current.messages).toBe(first.messages);
    rerender({ sessionId: "b" });
    expect(result.current).toMatchObject({ messages: undefined, loading: true, error: undefined });
    await act(async () => { next.resolve(transcript("父会话 B 的内容")); });
    expect(result.current.messages?.[0]?.content).toBe("父会话 B 的内容");
  });

  it.each([false, true])("卸载取消未完成请求，迟到结果不启动轮询（失败：%s）", async (fails) => {
    const request = deferred();
    vi.mocked(readSubagentTranscript).mockReturnValueOnce(request.promise);
    const { unmount } = renderHook(() => useSubagentTranscript("parent", child({ status: "running" })));
    const signal = vi.mocked(readSubagentTranscript).mock.calls[0]![2]!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      if (fails) request.reject(new Error("迟到错误"));
      else request.resolve(transcript("迟到内容"));
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(readSubagentTranscript).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["pending", "running"] as const)("%s 每次读取完成后才轮询，刷新时保留完整内容并在卸载时清理", async (status) => {
    const first = transcript("第一次完整内容");
    const refresh = deferred();
    vi.mocked(readSubagentTranscript).mockResolvedValueOnce(first).mockReturnValueOnce(refresh.promise);
    const { result, unmount } = renderHook(() => useSubagentTranscript("parent", child({ status })));
    await act(async () => {});
    expect(result.current).toMatchObject({ messages: first.messages, loading: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(readSubagentTranscript).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(readSubagentTranscript).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ messages: first.messages, loading: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(readSubagentTranscript).toHaveBeenCalledTimes(2);
    const updated = transcript("最新完整内容", 2);
    await act(async () => { refresh.resolve(updated); });
    expect(result.current).toMatchObject({ messages: updated.messages, loading: false });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(readSubagentTranscript).toHaveBeenCalledTimes(2);
  });

  it("版本更新立即重新读取，取消旧版本并保留最后成功内容", async () => {
    const first = transcript("已加载内容");
    const older = deferred();
    const newest = deferred();
    vi.mocked(readSubagentTranscript).mockResolvedValueOnce(first).mockReturnValueOnce(older.promise).mockReturnValueOnce(newest.promise);
    const { result, rerender } = renderHook(({ revision }) => useSubagentTranscript("parent", child({ transcriptRevision: revision })), { initialProps: { revision: 1 } });
    await act(async () => {});
    rerender({ revision: 2 });
    expect(result.current).toMatchObject({ messages: first.messages, loading: true });
    const staleSignal = vi.mocked(readSubagentTranscript).mock.calls[1]![2]!;
    rerender({ revision: 3 });
    expect(staleSignal.aborted).toBe(true);
    const latest = transcript("最新版本", 3);
    await act(async () => { newest.resolve(latest); older.resolve(transcript("旧版本", 2)); });
    expect(result.current).toMatchObject({ messages: latest.messages, loading: false, error: undefined });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(readSubagentTranscript).toHaveBeenCalledTimes(3);
  });

  it.each(["completed", "failed", "cancelled"] as const)("进入 %s 后再读最终记录并停止轮询", async (status) => {
    vi.mocked(readSubagentTranscript).mockResolvedValueOnce(transcript("执行中")).mockResolvedValueOnce(transcript("最终记录", 2));
    const { result, rerender } = renderHook(({ subagent }) => useSubagentTranscript("parent", subagent), { initialProps: { subagent: child({ status: "running" }) } });
    await act(async () => {});
    rerender({ subagent: child({ status }) });
    await act(async () => {});
    expect(result.current.messages?.[0]?.content).toBe("最终记录");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(readSubagentTranscript).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { error: new Error("完整记录暂时不可读"), message: "完整记录暂时不可读" },
    { error: { code: "SUBAGENT_TRANSCRIPT_UNAVAILABLE", message: "归档不可用" }, message: "归档不可用" },
    { error: null, message: "完整子代理记录读取失败，请重试" },
  ])("读取失败显示可重试错误：$message", async ({ error, message }) => {
    const recovery = deferred();
    vi.mocked(readSubagentTranscript).mockRejectedValueOnce(error).mockReturnValueOnce(recovery.promise);
    const { result } = renderHook(() => useSubagentTranscript("parent", child()));
    await act(async () => {});
    expect(result.current).toMatchObject({ messages: undefined, loading: false, error: message });
    act(() => result.current.retry());
    expect(result.current).toMatchObject({ messages: undefined, loading: true, error: undefined });
    const recovered = transcript("重试成功");
    await act(async () => { recovery.resolve(recovered); });
    expect(result.current).toMatchObject({ messages: recovered.messages, loading: false, error: undefined });
  });

  it("刷新失败保留成功记录，运行中的自动重试能恢复", async () => {
    const first = transcript("已有完整内容");
    const recovered = transcript("恢复后的完整内容", 2);
    vi.mocked(readSubagentTranscript).mockResolvedValueOnce(first).mockRejectedValueOnce(new Error("临时读取失败")).mockResolvedValueOnce(recovered);
    const { result } = renderHook(() => useSubagentTranscript("parent", child({ status: "running" })));
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current).toMatchObject({ messages: first.messages, loading: false, error: "临时读取失败" });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current).toMatchObject({ messages: recovered.messages, loading: false, error: undefined });
  });

  it("缺少所属父会话时提供明确错误，不调用 IPC", () => {
    const { result } = renderHook(() => useSubagentTranscript(undefined, child()));
    expect(result.current).toMatchObject({ messages: undefined, loading: false, error: "请先打开所属主会话，再读取完整子代理记录" });
    expect(readSubagentTranscript).not.toHaveBeenCalled();
  });

  it.each([undefined, false])("旧版记录仅展示已有预览且不读取归档：%s", (available) => {
    const legacy = child({ transcriptAvailable: available });
    const { result, rerender } = renderHook(({ subagent }) => useSubagentTranscript(undefined, subagent), { initialProps: { subagent: legacy } });
    expect(result.current).toMatchObject({ messages: legacy.messages, loading: false, error: undefined });
    const messages: SubagentMessage[] = [{ role: "assistant", content: "更新的旧版预览" }];
    rerender({ subagent: { ...legacy, messages } });
    act(() => result.current.retry());
    expect(result.current).toMatchObject({ messages, loading: false, error: undefined });
    expect(readSubagentTranscript).not.toHaveBeenCalled();
  });

  it("切换为旧版记录时取消归档请求并忽略迟到内容", async () => {
    const request = deferred();
    vi.mocked(readSubagentTranscript).mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(({ subagent }) => useSubagentTranscript("parent", subagent), { initialProps: { subagent: child({ status: "running" }) } });
    const signal = vi.mocked(readSubagentTranscript).mock.calls[0]![2]!;
    const legacy = child({ transcriptAvailable: undefined });
    rerender({ subagent: legacy });
    expect(signal.aborted).toBe(true);
    await act(async () => { request.resolve(transcript("过期归档内容")); });
    expect(result.current).toMatchObject({ messages: legacy.messages, loading: false, error: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });
});
