import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  abortAgent,
  createAgentSession,
  listenToAgentEvents,
  promptAgent,
  type AgentEvent,
} from "../ipc/agent";
import { getRuntimeStatus } from "../ipc/system";
import { ChatWorkbenchView } from "./ChatWorkbenchView";

vi.mock("../ipc/agent", () => ({
  abortAgent: vi.fn(),
  createAgentSession: vi.fn(),
  listenToAgentEvents: vi.fn(),
  promptAgent: vi.fn(),
}));
vi.mock("../ipc/system", () => ({ getRuntimeStatus: vi.fn() }));

const readyRuntime = {
  status: "ready" as const,
  runtimeSource: "path-pi-command",
  piVersion: "0.84.2",
  nodeVersion: "22.23.2",
  error: null,
};

describe("ChatWorkbenchView", () => {
  let emitAgentEvent: ((event: AgentEvent) => void) | undefined;
  let unlisten: Mock<() => void>;

  beforeEach(() => {
    emitAgentEvent = undefined;
    unlisten = vi.fn<() => void>();
    vi.mocked(getRuntimeStatus).mockReset().mockResolvedValue(readyRuntime);
    vi.mocked(createAgentSession).mockReset().mockResolvedValue({
      sessionId: "s-1",
      modelFallbackMessage: null,
    });
    vi.mocked(promptAgent).mockReset().mockImplementation(() => new Promise(() => {}));
    vi.mocked(abortAgent).mockReset().mockResolvedValue(undefined);
    vi.mocked(listenToAgentEvents)
      .mockReset()
      .mockImplementation(async (handler) => {
        emitAgentEvent = handler;
        return unlisten;
      });
  });

  it("创建会话、发送提示并合并流式文本", async () => {
    render(<ChatWorkbenchView />);

    expect(await screen.findByText("Pi 0.84.2 · Node 22.23.2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("工作区"), {
      target: { value: "C:\\work" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建会话" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(await screen.findByText("会话已连接")).toBeInTheDocument();
    expect(createAgentSession).toHaveBeenCalledWith("C:\\work");

    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "检查项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("检查项目")).toBeInTheDocument();
    expect(promptAgent).toHaveBeenCalledWith("s-1", "检查项目");
    act(() => {
      emitAgentEvent?.(agentEvent("message.delta", { delta: "完成" }, 1));
      emitAgentEvent?.(agentEvent("message.delta", { delta: "检查" }, 2));
      emitAgentEvent?.(agentEvent("agent.settled", undefined, 3));
    });

    expect(screen.getByText("完成检查")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("流式响应期间可发送 abort", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByText("Pi 0.84.2 · Node 22.23.2");
    fireEvent.change(screen.getByLabelText("工作区"), { target: { value: "C:\\work" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建会话" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));
    await screen.findByText("会话已连接");
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "长任务" },
    });
    fireEvent.keyDown(screen.getByLabelText("发送给 Pi 的消息"), {
      key: "Enter",
      shiftKey: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: "停止" }));

    await waitFor(() => expect(abortAgent).toHaveBeenCalledWith("s-1"));
  });

  it("运行时不可用时禁用创建并展示稳定错误", async () => {
    vi.mocked(getRuntimeStatus).mockResolvedValue({
      status: "unavailable",
      runtimeSource: null,
      piVersion: null,
      nodeVersion: null,
      error: { code: "RUNTIME_NOT_FOUND", message: "未找到可用运行时" },
    });

    render(<ChatWorkbenchView />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "RUNTIME_NOT_FOUND: 未找到可用运行时",
    );
    expect(screen.getByRole("button", { name: "创建会话" })).toBeDisabled();
  });

  it("展示结构化会话错误并在卸载时解绑事件", async () => {
    vi.mocked(createAgentSession).mockRejectedValue({
      code: "WORKSPACE_PATH_INVALID",
      message: "工作区不存在",
    });
    const { unmount } = render(<ChatWorkbenchView />);
    await screen.findByText("Pi 0.84.2 · Node 22.23.2");
    fireEvent.change(screen.getByLabelText("工作区"), { target: { value: "C:\\missing" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建会话" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WORKSPACE_PATH_INVALID: 工作区不存在",
    );
    unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("Shift+Enter 保留草稿，不提前发送", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByText("Pi 0.84.2 · Node 22.23.2");
    fireEvent.change(screen.getByLabelText("工作区"), { target: { value: "C:\\work" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建会话" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));
    await screen.findByText("会话已连接");
    const composer = screen.getByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "第一行\n第二行" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });

    expect(promptAgent).not.toHaveBeenCalled();
    expect(composer).toHaveValue("第一行\n第二行");
  });

  it("事件监听失败时阻止创建，并允许重新连接", async () => {
    vi.mocked(listenToAgentEvents)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockImplementationOnce(async (handler) => {
        emitAgentEvent = handler;
        return unlisten;
      });
    render(<ChatWorkbenchView />);

    expect(await screen.findByRole("alert")).toHaveTextContent("AGENT_EVENT_LISTEN_FAILED");
    expect(screen.getByRole("button", { name: "创建会话" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));

    await waitFor(() => expect(listenToAgentEvents).toHaveBeenCalledTimes(2));
  });

  it("任务完成但没有文本时展示明确空结果", async () => {
    vi.mocked(promptAgent).mockResolvedValue(undefined);
    render(<ChatWorkbenchView />);
    await screen.findByText("Pi 0.84.2 · Node 22.23.2");
    fireEvent.change(screen.getByLabelText("工作区"), { target: { value: "C:\\work" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "创建会话" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "创建会话" }));
    await screen.findByText("会话已连接");
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "执行空结果任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("本次任务没有返回文本。")).toBeInTheDocument();
  });
});

function agentEvent(name: AgentEvent["name"], data: unknown, seq: number): AgentEvent {
  return {
    v: 1,
    kind: "event",
    seq,
    sessionId: "s-1",
    name,
    ...(data === undefined ? {} : { data }),
  };
}
