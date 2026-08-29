import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  abortAgent,
  checkAgentPackageUpdates,
  clearAgentQueue,
  configureAgentSession,
  createAgentSession,
  deleteAgentSessions,
  installAgentPackage,
  listAgentModels,
  listAgentPackages,
  listAgentResources,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  promptAgent,
  removeAgentPackage,
  setAgentPackageEnabled,
  type AgentEvent,
  type AgentSession,
  updateAgentPackage,
} from "../ipc/agent";
import { selectProjectDirectory } from "../ipc/project";
import {
  hideBrowserSidebar,
  openBrowserSidebar,
  updateBrowserSidebarBounds,
} from "../ipc/browser";
import {
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitInit,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
} from "../ipc/git";
import { getRequestHeaderSettings, updateRequestHeaderSettings } from "../ipc/settings";
import { getRuntimeStatus } from "../ipc/system";
import {
  createWorkspaceWorktree,
  ensureConversationWorkspace,
  getWorkspaceState,
  getWorktreeOptions,
  openWorkspaceFile,
  readWorkspaceFile,
  rememberWorkspace,
  removeRecentWorkspace,
  revealWorkspace,
  revealWorkspaceFile,
  searchWorkspacePaths,
} from "../ipc/workspace";
import { ChatWorkbenchView } from "./ChatWorkbenchView";

vi.mock("../ipc/agent", () => ({
  abortAgent: vi.fn(),
  clampThinkingLevel: (requested: unknown, available: string[]) => {
    const ordered = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    const normalized = ordered.filter((level) => available.includes(level));
    if (normalized.includes(String(requested))) return String(requested);
    const requestedIndex = ordered.indexOf(String(requested));
    if (requestedIndex >= 0) {
      for (let index = requestedIndex; index < ordered.length; index += 1) {
        if (normalized.includes(ordered[index]!)) return ordered[index];
      }
      for (let index = requestedIndex - 1; index >= 0; index -= 1) {
        if (normalized.includes(ordered[index]!)) return ordered[index];
      }
    }
    return normalized[0] ?? "off";
  },
  checkAgentPackageUpdates: vi.fn(),
  clearAgentQueue: vi.fn(),
  configureAgentSession: vi.fn(),
  createAgentSession: vi.fn(),
  deleteAgentSessions: vi.fn(),
  installAgentPackage: vi.fn(),
  listAgentModels: vi.fn(),
  listAgentPackages: vi.fn(),
  listAgentResources: vi.fn(),
  listAgentSessions: vi.fn(),
  listenToAgentEvents: vi.fn(),
  normalizeThinkingLevels: (value: unknown) =>
    Array.isArray(value)
      ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"].filter((level) =>
          value.includes(level),
        )
      : [],
  openAgentSession: vi.fn(),
  promptAgent: vi.fn(),
  removeAgentPackage: vi.fn(),
  setAgentPackageEnabled: vi.fn(),
  THINKING_LEVELS: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  isThinkingLevel: (value: unknown) =>
    typeof value === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value),
  updateAgentPackage: vi.fn(),
}));
vi.mock("../ipc/project", () => ({ selectProjectDirectory: vi.fn() }));
vi.mock("../ipc/browser", () => ({
  hideBrowserSidebar: vi.fn(),
  openBrowserSidebar: vi.fn(),
  updateBrowserSidebarBounds: vi.fn(),
}));
vi.mock("../ipc/git", () => ({
  gitStatus: vi.fn(),
  gitDiff: vi.fn(),
  gitStage: vi.fn(),
  gitUnstage: vi.fn(),
  gitDiscard: vi.fn(),
  gitInit: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitCreateBranch: vi.fn(),
}));
vi.mock("../ipc/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ipc/settings")>()),
  getRequestHeaderSettings: vi.fn(),
  updateRequestHeaderSettings: vi.fn(),
}));
vi.mock("../ipc/system", () => ({ getRuntimeStatus: vi.fn() }));
vi.mock("../ipc/workspace", () => ({
  createWorkspaceWorktree: vi.fn(),
  ensureConversationWorkspace: vi.fn(),
  getWorkspaceState: vi.fn(),
  getWorktreeOptions: vi.fn(),
  openWorkspaceFile: vi.fn(),
  readWorkspaceFile: vi.fn(),
  rememberWorkspace: vi.fn(),
  removeRecentWorkspace: vi.fn(),
  revealWorkspace: vi.fn(),
  revealWorkspaceFile: vi.fn(),
  searchWorkspacePaths: vi.fn(),
}));
vi.mock("../stores/useDesktopNotifications", () => ({
  useDesktopNotifications: () => ({
    permission: "granted",
    phase: "idle",
    error: null,
    status: null,
    setEnabled: vi.fn().mockResolvedValue(true),
    sendTestNotification: vi.fn().mockResolvedValue(true),
    openSystemSettings: vi.fn().mockResolvedValue(true),
    clearFeedback: vi.fn(),
  }),
}));

const readyRuntime = {
  status: "ready" as const,
  runtimeSource: "path-pi-command",
  piVersion: "0.84.2",
  nodeVersion: "22.23.2",
  error: null,
};

const defaultToolNames = ["read", "bash", "edit", "write"];
const availableTools = defaultToolNames.map((name) => ({ name, description: `${name} tool` }));

const defaultSession: AgentSession = {
  sessionId: "s-1",
  cwd: "C:\\work",
  sessionPath: "C:\\agent\\sessions\\s-1.jsonl",
  modelFallbackMessage: null,
  configuration: {
    model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
    thinkingLevel: "medium",
    availableThinkingLevels: ["off", "medium", "high"],
    availableTools,
    activeToolNames: defaultToolNames,
    defaultToolNames,
  },
  messages: [],
  queuedMessages: { steering: [], followUp: [] },
  streaming: false,
};

describe("ChatWorkbenchView", () => {
  let emitAgentEvent: ((event: AgentEvent) => void) | undefined;
  let unlisten: Mock<() => void>;

  beforeEach(() => {
    window.localStorage.clear();
    emitAgentEvent = undefined;
    unlisten = vi.fn<() => void>();
    vi.mocked(getRuntimeStatus).mockReset().mockResolvedValue(readyRuntime);
    vi.mocked(getRequestHeaderSettings)
      .mockReset()
      .mockResolvedValue({ enabled: false, client: "claude-code" });
    vi.mocked(updateRequestHeaderSettings)
      .mockReset()
      .mockImplementation(async (settings) => settings);
    vi.mocked(selectProjectDirectory).mockReset().mockResolvedValue("C:\\work");
    vi.mocked(gitStatus).mockReset().mockResolvedValue({
      isRepository: true,
      repoRoot: "C:\\work",
      branch: {
        head: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        detached: false,
      },
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      isClean: true,
    });
    vi.mocked(gitDiff).mockReset().mockResolvedValue({ path: null, staged: false, diff: "" });
    vi.mocked(gitStage).mockReset().mockResolvedValue(undefined);
    vi.mocked(gitUnstage).mockReset().mockResolvedValue(undefined);
    vi.mocked(gitDiscard).mockReset().mockResolvedValue(undefined);
    vi.mocked(gitInit).mockReset().mockResolvedValue(undefined);
    vi.mocked(gitCommit).mockReset().mockResolvedValue(undefined);
    vi.mocked(gitPush).mockReset().mockResolvedValue(undefined);
    vi.mocked(gitCreateBranch).mockReset().mockResolvedValue(undefined);
    vi.mocked(hideBrowserSidebar).mockReset().mockResolvedValue(undefined);
    vi.mocked(openBrowserSidebar).mockReset().mockResolvedValue(undefined);
    vi.mocked(updateBrowserSidebarBounds).mockReset().mockResolvedValue(undefined);
    vi.mocked(createAgentSession).mockReset().mockResolvedValue(defaultSession);
    vi.mocked(deleteAgentSessions)
      .mockReset()
      .mockResolvedValue({ deletedSessionIds: [], missingSessionIds: [] });
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
    vi.mocked(clearAgentQueue).mockReset().mockResolvedValue(undefined);
    vi.mocked(listAgentPackages).mockReset().mockResolvedValue([]);
    vi.mocked(listAgentResources).mockReset().mockResolvedValue([]);
    vi.mocked(checkAgentPackageUpdates).mockReset().mockResolvedValue([]);
    vi.mocked(installAgentPackage).mockReset().mockResolvedValue([]);
    vi.mocked(setAgentPackageEnabled).mockReset().mockResolvedValue([]);
    vi.mocked(removeAgentPackage).mockReset().mockResolvedValue([]);
    vi.mocked(updateAgentPackage).mockReset().mockResolvedValue([]);
    vi.mocked(getWorkspaceState).mockReset().mockResolvedValue({
      recentWorkspaces: [],
      lastWorkspace: null,
      conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    });
    vi.mocked(rememberWorkspace).mockReset().mockImplementation(async (cwd) => ({
      recentWorkspaces: [cwd],
      lastWorkspace: cwd,
      conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    }));
    vi.mocked(removeRecentWorkspace).mockReset().mockResolvedValue({
      recentWorkspaces: [],
      lastWorkspace: null,
      conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    });
    vi.mocked(ensureConversationWorkspace)
      .mockReset()
      .mockResolvedValue("C:\\Users\\me\\Documents\\Pix\\conversations");
    vi.mocked(revealWorkspace).mockReset().mockResolvedValue(undefined);
    vi.mocked(readWorkspaceFile)
      .mockReset()
      .mockResolvedValue({ dataBase64: "Y29uc3QgdmFsdWUgPSB0cnVlOw==", size: 19 });
    vi.mocked(openWorkspaceFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(revealWorkspaceFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(searchWorkspacePaths).mockReset().mockResolvedValue([]);
    vi.mocked(getWorktreeOptions).mockReset().mockResolvedValue({
      branches: [{ name: "main", current: true, remote: false }],
      suggestedName: "work-1",
    });
    vi.mocked(createWorkspaceWorktree)
      .mockReset()
      .mockResolvedValue({ path: "C:\\worktrees\\work-1" });
    vi.mocked(listenToAgentEvents)
      .mockReset()
      .mockImplementation(async (handler) => {
        emitAgentEvent = handler;
        return unlisten;
      });
  });

  it("Bridge 启动期间展示真实启动状态并在就绪后退出", async () => {
    let resolveRuntime:
      | ((value: Awaited<ReturnType<typeof getRuntimeStatus>>) => void)
      | undefined;
    vi.mocked(getRuntimeStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRuntime = resolve;
        }),
    );

    const { container } = render(<ChatWorkbenchView />);

    expect(await screen.findByRole("status", { name: "正在启动 Pi" })).toBeInTheDocument();
    expect(screen.getByText("正在连接本机 Pi 运行时")).toBeInTheDocument();
    expect(container.querySelector(".startup-status-mark img")).not.toBeNull();
    expect(container.querySelector(".startup-status-spinner .spin")).not.toBeNull();

    await act(async () => {
      resolveRuntime?.(readyRuntime);
      await Promise.resolve();
    });

    expect(await screen.findByRole("status", { name: "状态正常" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "正在启动 Pi" })).not.toBeInTheDocument(),
    );
  });

  it("通过项目弹窗创建会话、发送提示并合并流式文本", async () => {
    const { container } = render(<ChatWorkbenchView />);
    expect(await screen.findByRole("status", { name: "状态正常" })).toBeInTheDocument();
    await addProject("C:\\work");

    expect(await screen.findByLabelText("发送给 Pi 的消息")).toBeInTheDocument();
    expect(createAgentSession).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "检查项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(createAgentSession).toHaveBeenCalledWith("C:\\work"));
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "检查项目", undefined, defaultToolNames),
    );
    expect(await screen.findAllByText("检查项目")).not.toHaveLength(0);
    act(() => {
      emitAgentEvent?.(
        agentEvent("tool.started", { toolCallId: "tool-1", toolName: "read_file" }, 1),
      );
    });
    await waitFor(() =>
      expect(container.querySelector(".timeline-tool-group > details")).toHaveAttribute(
        "data-status",
        "running",
      ),
    );
    expect(container.querySelector(".timeline-tool-group-icon .spin")).not.toBeNull();
    act(() => {
      emitAgentEvent?.(agentEvent("thinking.delta", { delta: "分析项目" }, 2));
      emitAgentEvent?.(agentEvent("message.delta", { delta: "完成" }, 3));
      emitAgentEvent?.(agentEvent("message.delta", { delta: "检查" }, 4));
      emitAgentEvent?.(
        agentEvent("tool.completed", { toolCallId: "tool-1", toolName: "read_file" }, 5),
      );
      emitAgentEvent?.(
        agentEvent("tool.failed", { toolCallId: "tool-2", toolName: "bash" }, 6),
      );
      emitAgentEvent?.(agentEvent("agent.settled", undefined, 7));
    });

    expect(await screen.findByText("完成检查")).toBeInTheDocument();
    expect(screen.queryByText("分析项目")).not.toBeInTheDocument();
    const readGroup = screen.getByText("已使用 read_file").closest("details");
    const bashGroup = screen.getByText("已使用 bash").closest("details");
    expect(readGroup).not.toBeNull();
    expect(bashGroup).not.toBeNull();
    fireEvent.click(readGroup!.querySelector("summary")!);
    fireEvent.click(bashGroup!.querySelector("summary")!);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("失败").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("用户上滑后停止自动跟随，并可主动跳回最新消息", async () => {
    const { container } = render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "长会话" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalled());
    await screen.findAllByText("长会话");
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 32)));

    const scroll = container.querySelector(".conversation-scroll") as HTMLDivElement;
    const scrollTo = vi.fn();
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    fireEvent.scroll(scroll);
    const jumpButton = await screen.findByRole("button", { name: "跳到最新消息" });

    act(() => {
      emitAgentEvent?.(agentEvent("message.delta", { delta: "新增内容" }, 1));
    });
    expect(await screen.findByText("新增内容")).toBeInTheDocument();
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 32)));
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(jumpButton);
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: "smooth" }),
    );
  });

  it("流式响应期间可停止任务", async () => {
    const { container } = render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "长任务" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: false });
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "长任务", undefined, defaultToolNames),
    );
    act(() => {
      emitAgentEvent?.(
        agentEvent("tool.started", { toolCallId: "tool-1", toolName: "bash" }, 1),
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    await waitFor(() => expect(abortAgent).toHaveBeenCalledWith("s-1"));
    await waitFor(() =>
      expect(container.querySelector(".timeline-tool-group > details")).toHaveAttribute(
        "data-status",
        "cancelled",
      ),
    );
  });

  it("流式期间将 Enter 与 Alt+Enter 分别加入引导和后续队列", async () => {
    const { container } = render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");

    fireEvent.change(composer, { target: { value: "开始任务" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "开始任务", undefined, defaultToolNames),
    );
    fireEvent.change(composer, { target: { value: "调整方向" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.change(composer, { target: { value: "完成后总结" } });
    fireEvent.keyDown(composer, { key: "Enter", altKey: true });

    expect(promptAgent).toHaveBeenNthCalledWith(
      1,
      "s-1",
      "开始任务",
      undefined,
      defaultToolNames,
    );
    expect(promptAgent).toHaveBeenNthCalledWith(2, "s-1", "调整方向", "steer", undefined);
    expect(promptAgent).toHaveBeenNthCalledWith(
      3,
      "s-1",
      "完成后总结",
      "followUp",
      undefined,
    );
    expect(screen.getByText("2 条排队")).toBeInTheDocument();
    expect(screen.getByText("调整方向")).toBeInTheDocument();
    expect(screen.getByText("完成后总结")).toBeInTheDocument();
    expect(
      [...container.querySelectorAll(".user-message-bubble")].map((item) => item.textContent),
    ).toEqual(["开始任务"]);

    fireEvent.click(screen.getByRole("button", { name: "清空排队消息" }));
    await waitFor(() => expect(clearAgentQueue).toHaveBeenCalledWith("s-1"));
    expect(screen.queryByText("2 条排队")).not.toBeInTheDocument();
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
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "触发创建" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

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

  it("按 Escape 取消添加项目", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await openAddProjectDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "添加项目" })).not.toBeInTheDocument();
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
    vi.mocked(getWorkspaceState).mockResolvedValueOnce({
      recentWorkspaces: ["C:\\work"],
      lastWorkspace: null,
      conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    });
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
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Claude" }));
    await waitFor(() =>
      expect(configureAgentSession).toHaveBeenCalledWith("saved", {
        model: { provider: "anthropic", id: "claude" },
      }),
    );

    vi.mocked(configureAgentSession).mockResolvedValueOnce({
      ...defaultSession.configuration,
      thinkingLevel: "high",
    });
    fireEvent.click(screen.getByRole("button", { name: "选择思考强度" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    await waitFor(() =>
      expect(configureAgentSession).toHaveBeenCalledWith("saved", { thinkingLevel: "high" }),
    );
  });

  it("将用户选择的 SDK 工具权限随提示提交并持久化", async () => {
    vi.mocked(getWorkspaceState).mockResolvedValueOnce({
      recentWorkspaces: ["C:\\work"],
      lastWorkspace: null,
      conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    });
    vi.mocked(listAgentSessions).mockResolvedValueOnce([
      {
        id: "saved",
        path: "C:\\agent\\sessions\\saved.jsonl",
        cwd: "C:\\work",
        name: "权限任务",
        created: "2026-08-20T08:00:00.000Z",
        modified: "2026-08-20T09:00:00.000Z",
        messageCount: 1,
        firstMessage: "saved prompt",
      },
    ]);
    render(<ChatWorkbenchView />);

    fireEvent.click(await screen.findByTitle("权限任务"));
    await screen.findByText("saved prompt");
    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /自动审核/ }));
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "只读检查" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("saved", "只读检查", undefined, ["read"]),
    );
    expect(window.localStorage.getItem("pi-desktop.tool-permissions.v1")).toContain(
      '"mode":"custom"',
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

    expect(await screen.findByText("正在思考")).toBeInTheDocument();
    act(() => {
      emitAgentEvent?.(agentEvent("message.completed", { reason: "stop" }, 1));
      emitAgentEvent?.(agentEvent("agent.settled", undefined, 2));
    });
    expect(await screen.findByText("本次任务没有返回文本。")).toBeInTheDocument();
  });

  it("可从空状态创建不绑定项目的纯对话", async () => {
    vi.mocked(createAgentSession).mockResolvedValueOnce({
      ...defaultSession,
      cwd: "C:\\Users\\me\\Documents\\Pix\\conversations",
    });
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });

    fireEvent.click(await screen.findByRole("button", { name: "新建对话" }));

    const emptyTitle = await screen.findByRole("heading", { name: "开始对话" });
    expect(emptyTitle.closest(".thread-body-empty")).not.toBeNull();
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    expect(ensureConversationWorkspace).not.toHaveBeenCalled();
    expect(createAgentSession).not.toHaveBeenCalled();
    fireEvent.change(composer, { target: { value: "开始纯对话" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(ensureConversationWorkspace).toHaveBeenCalledOnce());
    expect(createAgentSession).toHaveBeenCalledWith(
      "C:\\Users\\me\\Documents\\Pix\\conversations",
    );
    expect(screen.queryByRole("button", { name: "显示审查侧栏" })).not.toBeInTheDocument();
  });

  it("仅在项目会话中打开、展开并关闭右侧面板", async () => {
    const { container } = render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    expect(screen.queryByRole("button", { name: "显示审查侧栏" })).not.toBeInTheDocument();

    await addProject("C:\\work");
    const toggle = await screen.findByRole("button", { name: "显示审查侧栏" });
    fireEvent.click(toggle);
    expect(await screen.findByRole("complementary", { name: "工作区侧边栏" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "审查" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith("C:\\work"));

    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /浏览器/ }));
    expect(screen.getByRole("tab", { name: "浏览器" })).toHaveAttribute("aria-selected", "true");
    const browserSurface = screen.getByLabelText("浏览器内容区域");
    Object.defineProperty(browserSurface, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 600,
        y: 80,
        top: 80,
        left: 600,
        right: 1_160,
        bottom: 800,
        width: 560,
        height: 720,
        toJSON: () => ({}),
      } as DOMRect),
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      expect(openBrowserSidebar).toHaveBeenCalledWith({
        x: 600,
        y: 80,
        width: 560,
        height: 720,
        visible: true,
        url: "https://www.google.com",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "展开工作区侧边栏" }));
    expect(container.querySelector(".right-panel")).toHaveClass("right-panel-expanded");
    fireEvent.click(screen.getByRole("button", { name: "收起工作区侧边栏" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭浏览器标签页" }));
    expect(screen.queryByRole("tab", { name: "浏览器" })).not.toBeInTheDocument();
    await waitFor(() => expect(hideBrowserSidebar).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "关闭差异侧栏" }));
    expect(screen.getByRole("button", { name: "显示审查侧栏" })).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector(".right-panel")).toHaveAttribute("aria-hidden", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "显示审查侧栏" })).toHaveFocus());
    await waitFor(() => expect(container.querySelector(".right-panel")).toBeNull());
  });

  it("从右侧面板搜索文件、读取源码、添加评论并调用受限文件操作", async () => {
    vi.mocked(searchWorkspacePaths).mockResolvedValueOnce([
      { path: "C:\\work\\src\\main.ts", relativePath: "src/main.ts", kind: "file" },
      { path: "C:\\work\\src", relativePath: "src", kind: "folder" },
    ]);
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    fireEvent.click(await screen.findByRole("button", { name: "显示审查侧栏" }));

    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /打开文件/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "输入内容搜索文件" }), {
      target: { value: "main" },
    });
    const result = await screen.findByRole("button", { name: /main\.ts/ });
    fireEvent.click(result);

    await waitFor(() =>
      expect(readWorkspaceFile).toHaveBeenCalledWith("C:\\work", "C:\\work\\src\\main.ts"),
    );
    expect(screen.getByRole("tab", { name: "main.ts" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(document.querySelector(".right-panel-file-code")).toHaveTextContent("const value = true;"),
    );

    fireEvent.click(screen.getByRole("button", { name: "评论第 1 行" }));
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 行评论" }), {
      target: { value: "请补充边界测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "注释" }));
    expect(await screen.findByText("请补充边界测试")).toBeInTheDocument();
    expect(window.localStorage.getItem("pi-desktop.local-code-comments.v1")).toContain("请补充边界测试");

    fireEvent.click(screen.getByRole("button", { name: "在外部打开文件" }));
    await waitFor(() =>
      expect(openWorkspaceFile).toHaveBeenCalledWith("C:\\work", "C:\\work\\src\\main.ts"),
    );
    fireEvent.click(screen.getByRole("button", { name: "显示文件所在文件夹" }));
    await waitFor(() =>
      expect(revealWorkspaceFile).toHaveBeenCalledWith("C:\\work", "C:\\work\\src\\main.ts"),
    );
  });

  it("将图片搜索结果打开到快速预览标签", async () => {
    vi.mocked(searchWorkspacePaths).mockResolvedValueOnce([
      { path: "C:\\work\\assets\\logo.png", relativePath: "assets/logo.png", kind: "file" },
    ]);
    vi.mocked(readWorkspaceFile).mockResolvedValueOnce({ dataBase64: "AA==", size: 1 });
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    fireEvent.click(await screen.findByRole("button", { name: "显示审查侧栏" }));
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /打开文件/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "输入内容搜索文件" }), {
      target: { value: "logo" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /logo\.png/ }));

    expect(await screen.findByRole("tab", { name: "logo.png" })).toHaveAttribute("aria-selected", "true");
    const image = await screen.findByRole("img", { name: "logo.png" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,AA==");
  });

  it("从侧栏进入插件与资源视图并保持数据计数同步", async () => {
    vi.mocked(listAgentPackages).mockResolvedValue([
      {
        source: "npm:@example/pi-extension",
        scope: "global",
        kind: "npm",
        filtered: false,
        enabled: true,
      },
    ]);
    vi.mocked(listAgentResources).mockResolvedValue([
      {
        kind: "skill",
        name: "项目检查",
        path: "C:\\agent\\skills\\project-check\\SKILL.md",
        source: "npm:@example/pi-extension",
      },
    ]);
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await waitFor(() => expect(listAgentPackages).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "插件" }));
    expect(screen.getByRole("heading", { name: "插件" })).toBeInTheDocument();
    expect(screen.getByText("pi-extension")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插件" })).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "资源" }));
    expect(screen.getByRole("heading", { name: "资源" })).toBeInTheDocument();
    expect(screen.getByText("项目检查")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(screen.getByRole("heading", { name: "会话工作台" })).toBeInTheDocument();
  });

  it("从侧栏进入设置、切换分类、保存偏好并返回工作台", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });

    fireEvent.click(screen.getByRole("button", { name: "系统设置" }));
    expect(screen.getByTestId("settings-general")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(screen.getByTestId("settings-notifications")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    expect(screen.getByTestId("settings-appearance")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览主题：魔女伊雷娜 · 月夜旅途" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(document.documentElement.dataset.backgroundActive).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "行为" }));
    fireEvent.click(screen.getByRole("switch", { name: "减少动态效果" }));
    await waitFor(() => expect(document.documentElement.dataset.reduceMotion).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "运行时" }));
    const requestHeaderToggle = await screen.findByRole("switch", {
      name: "客户端请求头伪装",
    });
    fireEvent.click(requestHeaderToggle);
    await waitFor(() =>
      expect(updateRequestHeaderSettings).toHaveBeenCalledWith({
        enabled: true,
        client: "claude-code",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "常规" }));
    fireEvent.click(screen.getByRole("switch", { name: "运行状态" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.getByRole("heading", { name: "会话工作台" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "状态正常" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("pi-desktop.app-preferences.v2")).toContain(
      '"showRuntimeStatus":false',
    );
  });

  it("通过侧栏确认框保护最近项目移除操作", async () => {
    vi.mocked(getWorkspaceState).mockResolvedValueOnce({
      recentWorkspaces: ["C:\\work"],
      lastWorkspace: null,
      conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    });
    render(<ChatWorkbenchView />);

    fireEvent.click(await screen.findByRole("button", { name: "work更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从列表移除" }));
    expect(screen.getByRole("dialog", { name: "移除项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(removeRecentWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "work更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从列表移除" }));
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    await waitFor(() => expect(removeRecentWorkspace).toHaveBeenCalledWith("C:\\work"));
  });

  it("连接侧栏的文件夹显示与永久工作树命令，并打开创建结果", async () => {
    vi.mocked(getWorkspaceState).mockResolvedValueOnce({
      recentWorkspaces: ["C:\\work"],
      lastWorkspace: null,
      conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    });
    vi.mocked(createAgentSession).mockResolvedValueOnce({
      ...defaultSession,
      cwd: "C:\\worktrees\\work-1",
      sessionPath: "C:\\agent\\sessions\\worktree.jsonl",
    });
    render(<ChatWorkbenchView />);

    fireEvent.click(await screen.findByRole("button", { name: "work更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "在文件夹中显示" }));
    await waitFor(() => expect(revealWorkspace).toHaveBeenCalledWith("C:\\work"));

    fireEvent.click(screen.getByRole("button", { name: "work更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "创建永久工作树" }));
    await screen.findByDisplayValue("work-1");
    fireEvent.click(screen.getByRole("button", { name: "创建并打开" }));

    await waitFor(() =>
      expect(createWorkspaceWorktree).toHaveBeenCalledWith({
        cwd: "C:\\work",
        base: "HEAD",
        name: "work-1",
      }),
    );
    expect(createAgentSession).not.toHaveBeenCalled();
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "检查工作树" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(createAgentSession).toHaveBeenCalledWith("C:\\worktrees\\work-1"));
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
