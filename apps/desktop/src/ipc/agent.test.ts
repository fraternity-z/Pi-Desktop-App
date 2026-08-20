import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  abortAgent,
  createAgentSession,
  listenToAgentEvents,
  promptAgent,
} from "./agent";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("agent IPC", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
  });

  it("只调用固定的会话命令", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ sessionId: "s-1", modelFallbackMessage: null })
      .mockResolvedValue(undefined);

    await expect(createAgentSession("C:\\work")).resolves.toEqual({
      sessionId: "s-1",
      modelFallbackMessage: null,
    });
    await promptAgent("s-1", "hello");
    await abortAgent("s-1");

    expect(invoke).toHaveBeenNthCalledWith(1, "agent_create_session", { cwd: "C:\\work" });
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_prompt", {
      sessionId: "s-1",
      text: "hello",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_abort", { sessionId: "s-1" });
  });

  it("订阅类型化事件并返回解绑函数", async () => {
    const unlisten = vi.fn<() => void>();
    let tauriHandler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (_name, handler) => {
      tauriHandler = handler as (event: { payload: unknown }) => void;
      return unlisten;
    });
    const handler = vi.fn();

    await expect(listenToAgentEvents(handler)).resolves.toBe(unlisten);
    tauriHandler?.({
      payload: {
        v: 1,
        kind: "event",
        seq: 1,
        sessionId: "s-1",
        name: "agent.started",
      },
    });

    expect(listen).toHaveBeenCalledWith("agent://event", expect.any(Function));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: "agent.started" }));
  });
});
