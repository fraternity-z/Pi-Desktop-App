import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  abortAgent,
  configureAgentSession,
  createAgentSession,
  listAgentModels,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  promptAgent,
  type AgentEvent,
  type AgentSession,
} from "../ipc/agent";
import { selectProjectDirectory } from "../ipc/project";
import { getRuntimeStatus } from "../ipc/system";
import { ChatWorkbenchView } from "./ChatWorkbenchView";

vi.mock("../ipc/agent", () => ({
  abortAgent: vi.fn(),
  configureAgentSession: vi.fn(),
  createAgentSession: vi.fn(),
  listAgentModels: vi.fn(),
  listAgentSessions: vi.fn(),
  listenToAgentEvents: vi.fn(),
  openAgentSession: vi.fn(),
  promptAgent: vi.fn(),
}));
vi.mock("../ipc/project", () => ({ selectProjectDirectory: vi.fn() }));
vi.mock("../ipc/system", () => ({ getRuntimeStatus: vi.fn() }));

const readyRuntime = {
  status: "ready" as const,
  runtimeSource: "path-pi-command",
  piVersion: "0.84.2",
  nodeVersion: "22.23.2",
  error: null,
};

const defaultSession: AgentSession = {
  sessionId: "s-1",
  cwd: "C:\\work",
  sessionPath: "C:\\agent\\sessions\\s-1.jsonl",
  modelFallbackMessage: null,
  configuration: {
    model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
    thinkingLevel: "medium",
    availableThinkingLevels: ["off", "medium", "high"],
  },
  messages: [],
};

describe("ChatWorkbenchView", () => {
  let emitAgentEvent: ((event: AgentEvent) => void) | undefined;
  let unlisten: Mock<() => void>;

  beforeEach(() => {
    emitAgentEvent = undefined;
    unlisten = vi.fn<() => void>();
    vi.mocked(getRuntimeStatus).mockReset().mockResolvedValue(readyRuntime);
    vi.mocked(selectProjectDirectory).mockReset().mockResolvedValue("C:\\work");
    vi.mocked(createAgentSession).mockReset().mockResolvedValue(defaultSession);
    vi.mocked(openAgentSession).mockReset().mockResolvedValue({
      ...defaultSession,
      sessionId: "saved",
      sessionPath: "C:\\agent\\sessions\\saved.jsonl",
      messages: [{ role: "user", content: "saved prompt" }],
    });
    vi.mocked(listAgentSessions).mockReset().mockResolvedValue([]);
    vi.mocked(listAgentModels).mockReset().mockResolvedValue([
      { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
      { provider: "anthropic", id: "claude", name: "Claude", reasoning: true },
    ]);
    vi.mocked(configureAgentSession).mockReset().mockResolvedValue(defaultSession.configuration);
    vi.mocked(promptAgent).mockReset().mockImplementation(() => new Promise<number>(() => {}));
    vi.mocked(abortAgent).mockReset().mockResolvedValue(undefined);
    vi.mocked(listenToAgentEvents)
      .mockReset()
      .mockImplementation(async (handler) => {
        emitAgentEvent = handler;
        return unlisten;
      });
  });

  it("通过项目弹窗创建会话、发送提示并合并流式文本", async () => {
    render(<ChatWorkbenchView />);
    expect(await screen.findByRole("status", { name: "状态正常" })).toBeInTheDocument();
    await addProject("C:\\work");

    expect(await screen.findByLabelText("发送给 Pi 的消息")).toBeInTheDocument();
    expect(createAgentSession).toHaveBeenCalledWith("C:\\work");
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "检查项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("检查项目")).toBeInTheDocument();
    expect(promptAgent).toHaveBeenCalledWith("s-1", "检查项目");
    act(() => {
      emitAgentEvent?.(
        agentEvent("tool.started", { toolCallId: "tool-1", toolName: "read_file" }, 1),
      );
    });
    expect(screen.getByText("执行中")).toBeInTheDocument();
    act(() => {
      emitAgentEvent?.(agentEvent("message.delta", { delta: "完成" }, 2));
      emitAgentEvent?.(agentEvent("message.delta", { delta: "检查" }, 3));
      emitAgentEvent?.(
        agentEvent("tool.completed", { toolCallId: "tool-1", toolName: "read_file" }, 4),
      );
      emitAgentEvent?.(
        agentEvent("tool.failed", { toolCallId: "tool-2", toolName: "bash" }, 5),
      );
      emitAgentEvent?.(agentEvent("agent.settled", undefined, 6));
    });

    expect(screen.getByText("完成检查")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("流式响应期间可停止任务", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "长任务" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: false });
    act(() => {
      emitAgentEvent?.(
        agentEvent("tool.started", { toolCallId: "tool-1", toolName: "bash" }, 1),
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    await waitFor(() => expect(abortAgent).toHaveBeenCalledWith("s-1"));
    expect(screen.getByText("已停止")).toBeInTheDocument();
  });

  it("运行时不可用时禁用添加项目并展示稳定错误", async () => {
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
    expect(screen.getByRole("status", { name: "状态异常" })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: "添加项目" })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("展示结构化会话错误并在卸载时解绑事件", async () => {
    vi.mocked(createAgentSession).mockRejectedValue({
      code: "WORKSPACE_PATH_INVALID",
      message: "工作区不存在",
    });
    const { unmount } = render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\missing");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WORKSPACE_PATH_INVALID: 工作区不存在",
    );
    unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("取消资源管理器选择时保留弹窗且不创建会话", async () => {
    vi.mocked(selectProjectDirectory).mockResolvedValueOnce(null);
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await openAddProjectDialog();

    fireEvent.click(screen.getByRole("button", { name: "选择项目文件夹" }));

    await waitFor(() => expect(selectProjectDirectory).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog", { name: "添加项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加并创建会话" })).toBeDisabled();
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it("资源管理器选择失败时在弹窗内展示稳定错误", async () => {
    vi.mocked(selectProjectDirectory).mockRejectedValueOnce({
      code: "PROJECT_DIRECTORY_SELECTION_FAILED",
      message: "无法打开资源管理器，请重试",
    });
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await openAddProjectDialog();

    fireEvent.click(screen.getByRole("button", { name: "选择项目文件夹" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PROJECT_DIRECTORY_SELECTION_FAILED: 无法打开资源管理器，请重试",
    );
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it("Shift+Enter 保留草稿，不提前发送", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "第一行\n第二行" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });

    expect(promptAgent).not.toHaveBeenCalled();
    expect(composer).toHaveValue("第一行\n第二行");
  });

  it("事件监听失败时阻止添加项目，并允许重新连接", async () => {
    vi.mocked(listenToAgentEvents)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockImplementationOnce(async (handler) => {
        emitAgentEvent = handler;
        return unlisten;
      });
    render(<ChatWorkbenchView />);

    expect(await screen.findByRole("alert")).toHaveTextContent("AGENT_EVENT_LISTEN_FAILED");
    const addButtons = screen.getAllByRole("button", { name: "添加项目" });
    const availableAddButton = addButtons.find((button) => !button.hasAttribute("disabled"));
    expect(availableAddButton).toBeDefined();
    fireEvent.click(availableAddButton!);
    expect(screen.getByRole("button", { name: "选择项目文件夹" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加并创建会话" })).toBeDisabled();
    expect(selectProjectDirectory).not.toHaveBeenCalled();
    expect(createAgentSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await waitFor(() => expect(listenToAgentEvents).toHaveBeenCalledTimes(2));
  });

  it("从 SDK 目录恢复会话，并同步模型与思考强度", async () => {
    vi.mocked(listAgentSessions).mockResolvedValueOnce([
      {
        id: "saved",
        path: "C:\\agent\\sessions\\saved.jsonl",
        cwd: "C:\\work",
        name: "既有任务",
        created: "2026-08-20T08:00:00.000Z",
        modified: "2026-08-20T09:00:00.000Z",
        messageCount: 1,
        firstMessage: "saved prompt",
      },
    ]);
    render(<ChatWorkbenchView />);

    fireEvent.click(await screen.findByTitle("既有任务"));
    expect(openAgentSession).toHaveBeenCalledWith("C:\\agent\\sessions\\saved.jsonl");
    expect(await screen.findByText("saved prompt")).toBeInTheDocument();

    vi.mocked(configureAgentSession).mockResolvedValueOnce({
      ...defaultSession.configuration,
      model: { provider: "anthropic", id: "claude", name: "Claude", reasoning: true },
    });
    fireEvent.change(screen.getByLabelText("模型"), {
      target: { value: "anthropic\u0000claude" },
    });
    await waitFor(() =>
      expect(configureAgentSession).toHaveBeenCalledWith("saved", {
        model: { provider: "anthropic", id: "claude" },
      }),
    );

    vi.mocked(configureAgentSession).mockResolvedValueOnce({
      ...defaultSession.configuration,
      thinkingLevel: "high",
    });
    fireEvent.change(screen.getByLabelText("思考强度"), { target: { value: "high" } });
    await waitFor(() =>
      expect(configureAgentSession).toHaveBeenCalledWith("saved", { thinkingLevel: "high" }),
    );
  });

  it("任务完成但没有文本时展示明确空结果", async () => {
    vi.mocked(promptAgent).mockResolvedValue(0);
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    fireEvent.change(await screen.findByLabelText("发送给 Pi 的消息"), {
      target: { value: "执行空结果任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("正在响应")).toBeInTheDocument();
    act(() => {
      emitAgentEvent?.(agentEvent("agent.settled", undefined, 1));
    });
    expect(await screen.findByText("本次任务没有返回文本。")).toBeInTheDocument();
  });
});

async function addProject(path: string) {
  vi.mocked(selectProjectDirectory).mockResolvedValueOnce(path);
  await openAddProjectDialog();
  fireEvent.click(screen.getByRole("button", { name: "选择项目文件夹" }));
  expect(await screen.findByText(path)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "添加并创建会话" }));
}

async function openAddProjectDialog() {
  const addButtons = await screen.findAllByRole("button", { name: "添加项目" });
  const addButton = addButtons.at(-1);
  expect(addButton).toBeDefined();
  await waitFor(() => expect(addButton).toBeEnabled());
  fireEvent.click(addButton!);
  expect(screen.getByRole("dialog", { name: "添加项目" })).toBeInTheDocument();
}

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
