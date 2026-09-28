import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  STARTUP_EXIT_DURATION_MS,
  STARTUP_MINIMUM_DURATION_MS,
} from "../components/StartupOverlay";
import {
  abortAgent,
  checkAgentPackageUpdates,
  clearAgentQueue,
  configureAgentSession,
  createAgentSession,
  deleteAgentSessions,
  installAgentPackage,
  listAgentCommands,
  listAgentModels,
  listAgentPermissionRequests,
  listAgentPackages,
  listAgentResources,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  promptAgent,
  replyAgentPermission,
  removeAgentPackage,
  setAgentPackageEnabled,
  type AgentEvent,
  type AgentSession,
  type SubagentSnapshot,
  updateAgentPackage,
} from "../ipc/agent";
import { selectAttachmentFiles, selectProjectDirectory } from "../ipc/project";
import {
  gitCommit,
  gitCreateBranch,
  gitDiff,
  gitDiscard,
  gitInit,
  gitPush,
  gitStage,
  gitStatus,
  gitSwitchBranch,
  gitUnstage,
} from "../ipc/git";
import { getRequestHeaderSettings, updateRequestHeaderSettings } from "../ipc/settings";
import { DEFAULT_PROXY_SETTINGS, getProxySettings } from "../ipc/proxy";
import { APP_PREFERENCES_STORAGE_KEY } from "../stores/useAppPreferences";
import {
  exitApp,
  getRuntimeSettings,
  getRuntimeStatus,
  listenToRuntimeStatus,
  restartRuntime,
  setRuntimeMode,
  type RuntimeStatus,
} from "../ipc/system";
import {
  createWorkspaceWorktree,
  ensureConversationWorkspace,
  getWorkspaceState,
  getWorktreeOptions,
  listWorkspaceEntries,
  openWorkspaceFile,
  readWorkspaceFile,
  rememberWorkspace,
  removeRecentWorkspace,
  revealWorkspace,
  revealWorkspaceFile,
  saveClipboardImage,
  searchWorkspacePaths,
} from "../ipc/workspace";
import { ChatWorkbenchView } from "./ChatWorkbenchView";
import { listSessionReviews } from "../ipc/sessionReview";

function finishStartupWriting() {
  const target = document.querySelector('[data-final="true"]')!;
  // jsdom does not run CSS animations and React may use its WebKit event fallback.
  for (const type of ["animationend", "webkitAnimationEnd"]) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "animationName", { value: "startup-mask-finish" });
    fireEvent(target, event);
  }
}

vi.mock("../ipc/agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("../ipc/agent")>(),
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
  listAgentCommands: vi.fn(),
  listAgentModels: vi.fn(),
  listAgentPermissionRequests: vi.fn(),
  replyAgentPermission: vi.fn(),
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
vi.mock("../ipc/project", () => ({ selectProjectDirectory: vi.fn(), selectAttachmentFiles: vi.fn(), selectAttachmentDirectory: vi.fn() }));
vi.mock("../ipc/sessionReview", () => ({ listSessionReviews: vi.fn(), getSessionReview: vi.fn(), rollbackSessionReview: vi.fn() }));
vi.mock("../ipc/proxy", async (original) => ({ ...await original<typeof import("../ipc/proxy")>(), getProxySettings: vi.fn() }));
vi.mock("../ipc/git", () => ({
  gitSwitchBranch: vi.fn(),
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
vi.mock("../ipc/system", () => ({
  exitApp: vi.fn(),
  getRuntimeSettings: vi.fn(),
  getRuntimeStatus: vi.fn(),
  listenToRuntimeStatus: vi.fn(),
  restartRuntime: vi.fn(),
  setRuntimeMode: vi.fn(),
}));
vi.mock("../ipc/workspace", () => ({
  createWorkspaceWorktree: vi.fn(),
  ensureConversationWorkspace: vi.fn(),
  getWorkspaceState: vi.fn(),
  getWorktreeOptions: vi.fn(),
  listWorkspaceEntries: vi.fn(),
  openWorkspaceFile: vi.fn(),
  readWorkspaceFile: vi.fn(),
  rememberWorkspace: vi.fn(),
  removeRecentWorkspace: vi.fn(),
  revealWorkspace: vi.fn(),
  revealWorkspaceFile: vi.fn(),
  saveClipboardImage: vi.fn(),
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
  let emitRuntimeStatus: ((status: RuntimeStatus) => void) | undefined;
  let runtimeUnlisten: Mock<() => void>;
  let unlisten: Mock<() => void>;

  beforeEach(() => {
    vi.mocked(listAgentPermissionRequests).mockReset().mockResolvedValue([]);
    vi.mocked(replyAgentPermission).mockReset().mockResolvedValue(undefined);
    window.localStorage.clear();
    vi.mocked(selectAttachmentFiles).mockReset().mockResolvedValue([]);
    vi.mocked(getProxySettings).mockReset().mockResolvedValue(DEFAULT_PROXY_SETTINGS);
    emitAgentEvent = undefined;
    emitRuntimeStatus = undefined;
    runtimeUnlisten = vi.fn<() => void>();
    unlisten = vi.fn<() => void>();
    vi.mocked(getRuntimeStatus).mockReset().mockResolvedValue(readyRuntime);
    vi.mocked(exitApp).mockReset().mockResolvedValue(undefined);
    vi.mocked(restartRuntime).mockReset().mockResolvedValue(readyRuntime);
    vi.mocked(getRuntimeSettings).mockReset().mockResolvedValue({
      schemaVersion: 1,
      runtimeMode: "builtin",
      nodePath: null,
      sdkPath: null,
      piCommand: null,
      agentDir: "~/.pi/agent",
      supportedSdkRange: ">=0.83 <0.86",
      telemetry: false,
    });
    vi.mocked(setRuntimeMode).mockReset().mockResolvedValue({
      schemaVersion: 1,
      runtimeMode: "builtin",
      nodePath: null,
      sdkPath: null,
      piCommand: null,
      agentDir: "~/.pi/agent",
      supportedSdkRange: ">=0.83 <0.86",
      telemetry: false,
    });
    vi.mocked(listenToRuntimeStatus)
      .mockReset()
      .mockImplementation(async (handler) => {
        emitRuntimeStatus = handler;
        return runtimeUnlisten;
      });
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
    vi.mocked(gitSwitchBranch).mockReset().mockResolvedValue(undefined);
    vi.mocked(listWorkspaceEntries).mockReset().mockResolvedValue({ entries: [], nextCursor: null });
    vi.mocked(listSessionReviews).mockReset().mockResolvedValue({ entries: [], nextCursor: null, truncated: false });
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
    vi.mocked(listAgentCommands).mockReset().mockResolvedValue([]);
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
    vi.mocked(saveClipboardImage)
      .mockReset()
      .mockResolvedValue("C:\\cache\\composer-attachments\\paste.png");
    vi.mocked(searchWorkspacePaths).mockReset().mockResolvedValue([]);
    vi.mocked(getWorktreeOptions).mockReset().mockResolvedValue({
      branches: [{ name: "main", current: true, remote: false }],
      suggestedName: "work-1",
    });
    vi.mocked(createWorkspaceWorktree)
      .mockReset()
      .mockResolvedValue({ path: "C:\\worktrees\\work-1" });
    const agentHandlers = new Set<(event: AgentEvent) => void>();
    emitAgentEvent = (event) => { for (const handler of agentHandlers) handler(event); };
    vi.mocked(listenToAgentEvents)
      .mockReset()
      .mockImplementation(async (handler) => {
        agentHandlers.add(handler);
        return () => { agentHandlers.delete(handler); unlisten(); };
      });
  });

  it("浮空草稿切换工作区保留文字附件，首次发送才固定最终工作区", async () => {
    vi.mocked(selectAttachmentFiles).mockResolvedValue(["C:/notes.txt"]);
    vi.mocked(createAgentSession).mockImplementation(async (cwd) => ({ ...defaultSession, cwd }));
    vi.mocked(rememberWorkspace).mockImplementation(async (cwd) => ({
      recentWorkspaces: ["C:/alpha", "C:/beta"],
      lastWorkspace: cwd,
      conversationHome: "C:/conversations",
    }));
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:/alpha");
    fireEvent.change(await screen.findByLabelText("发送给 Pi 的消息"), { target: { value: "尚未发送的内容" } });
    fireEvent.click(screen.getByRole("button", { name: "添加文件或文件夹" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加文件本地" }));
    await screen.findByTitle("C:/notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /beta/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "选择项目" })).toHaveTextContent("beta"));
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /alpha/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "选择项目" })).toHaveTextContent("alpha"));
    expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue("尚未发送的内容");
    expect(screen.getByTitle("C:/notes.txt")).toBeInTheDocument();
    expect(createAgentSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalled());
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(createAgentSession).toHaveBeenCalledWith("C:/alpha");
    expect(vi.mocked(promptAgent).mock.calls[0]?.[1]).toContain("尚未发送的内容");
    expect(vi.mocked(promptAgent).mock.calls[0]?.[1]).toContain("C:/notes.txt");
    expect(screen.queryByRole("button", { name: "选择项目" })).not.toBeInTheDocument();
  });

  it.each([false, true])("草稿离开再返回保留输入，迟到图片仅归还来源（先返回：%s）", async (returnBeforeSave) => {
    vi.mocked(listAgentSessions).mockResolvedValue([{
      id: "saved", path: "C:/sessions/saved.jsonl", cwd: defaultSession.cwd, name: "历史会话",
      created: "2026-09-27T08:00:00.000Z", modified: "2026-09-27T08:00:00.000Z", messageCount: 1, firstMessage: "saved prompt",
    }]);
    let finishImage!: (path: string) => void;
    vi.mocked(saveClipboardImage).mockReturnValueOnce(new Promise((resolve) => { finishImage = resolve; }));
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "保留我的草稿" } });
    const image = new File([new Uint8Array([1])], "paste.png", { type: "image/png" });
    fireEvent.paste(composer, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image }] } });
    await waitFor(() => expect(saveClipboardImage).toHaveBeenCalledWith(image));
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    fireEvent.click(await screen.findByTitle("历史会话"));
    await screen.findByText("saved prompt");
    expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), { target: { value: "历史输入" } });
    if (returnBeforeSave) fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    await act(async () => finishImage("C:/cache/draft.png"));
    if (!returnBeforeSave) {
      expect(screen.queryByTitle("C:/cache/draft.png")).not.toBeInTheDocument();
      expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue("历史输入");
      fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    }
    await waitFor(() => expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue("保留我的草稿"));
    expect(screen.getByRole("button", { name: "选择项目" })).toHaveTextContent("未绑定项目");
    expect(screen.getByTitle("C:/cache/draft.png")).toBeInTheDocument();
    expect(createAgentSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalledWith("s-1", "保留我的草稿", undefined, defaultToolNames, ["C:/cache/draft.png"]));
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    await waitFor(() => expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue(""));
    expect(screen.queryByTitle("C:/cache/draft.png")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("历史会话"));
    await waitFor(() => expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue("历史输入"));
  });

  it("草稿选择模型和思考强度仅保存意图，发送时才创建并应用配置", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    fireEvent.click(screen.getByRole("button", { name: "模型与思考强度" }));
    fireEvent.change(screen.getByRole("combobox", { name: "草稿思考强度" }), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "GPT" }));
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(configureAgentSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "模型与思考强度" })).toHaveTextContent("GPT高");
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), { target: { value: "按草稿配置发送" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalled());
    expect(createAgentSession).toHaveBeenCalledOnce();
    expect(configureAgentSession).toHaveBeenCalledWith("s-1", { model: { provider: "openai", id: "gpt" }, thinkingLevel: "high" });
  });

  it.each(["create", "prompt"])("首次 %s 失败保留文字图片，重试不会丢失输入", async (failure) => {
    vi.mocked(promptAgent).mockResolvedValue(1);
    if (failure === "create") vi.mocked(createAgentSession).mockRejectedValueOnce({ code: "CREATE_FAILED", message: "创建失败" });
    else vi.mocked(promptAgent).mockRejectedValueOnce({ code: "PROMPT_FAILED", message: "发送失败" });
    vi.mocked(saveClipboardImage).mockResolvedValue("C:/cache/retry.png");
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:/work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "失败后重试" } });
    const image = new File([new Uint8Array([1])], "retry.png", { type: "image/png" });
    fireEvent.paste(composer, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image }] } });
    await screen.findByTitle("C:/cache/retry.png");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findAllByText(failure === "create" ? "CREATE_FAILED: 创建失败" : "PROMPT_FAILED: 发送失败");
    await waitFor(() => expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue("失败后重试"));
    expect(screen.getByTitle("C:/cache/retry.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalledTimes(failure === "create" ? 1 : 2));
    expect(promptAgent).toHaveBeenLastCalledWith("s-1", "失败后重试", undefined, defaultToolNames, ["C:/cache/retry.png"]);
    expect(createAgentSession).toHaveBeenCalledTimes(failure === "create" ? 2 : 1);
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    await waitFor(() => expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveValue(""));
    expect(screen.queryByTitle("C:/cache/retry.png")).not.toBeInTheDocument();
  });

  it("会话快捷键聚焦输入并打开文件，弹窗期间不触发导航", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    finishStartupWriting();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "PI Desktop 启动界面" })).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    await waitFor(() => expect(screen.getByLabelText("发送给 Pi 的消息")).toHaveFocus());
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(await screen.findByRole("searchbox", { name: "输入内容搜索文件" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(screen.queryByRole("heading", { name: "插件" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "输入内容搜索文件" }), { key: "Escape" });
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(screen.queryByRole("tab", { name: "浏览器" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(await screen.findByLabelText("发送给 Pi 的消息")).toHaveValue("");
  });

  it("代理错误时可从启动页进入设置修复", async () => {
    vi.mocked(getRuntimeStatus).mockResolvedValue({ status: "unavailable", runtimeSource: null, piVersion: null, nodeVersion: null, error: { code: "PROXY_READ_FAILED", message: "请检查配置" } });
    render(<ChatWorkbenchView />);
    fireEvent.click(await screen.findByRole("button", { name: "检查代理设置" }));
    expect(await screen.findByTestId("settings-proxy")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "PI Desktop 启动界面" })).not.toBeInTheDocument();
  });

  it("自定义快捷键立即生效并与命令面板和现有动作联动", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    finishStartupWriting();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "PI Desktop 启动界面" })).not.toBeInTheDocument(), { timeout: 3000 });
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await screen.findByTestId("settings-general");
    fireEvent.click(screen.getByRole("button", { name: "快捷键" }));
    const binding = await screen.findByRole("button", { name: "修改打开设置快捷键" });
    fireEvent.click(binding);
    fireEvent.keyDown(binding, { key: "u", ctrlKey: true });
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    await waitFor(() => expect(screen.queryByTestId("settings-shortcuts")).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(screen.queryByTestId("settings-general")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "u", ctrlKey: true });
    await screen.findByTestId("settings-general");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "命令面板" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /运行时面板/ }));
    await screen.findByTestId("settings-runtime");
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(await screen.findByRole("heading", { name: "插件" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole("heading", { name: "资源" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "t", ctrlKey: true, shiftKey: true });
    expect(document.documentElement.dataset.themePreference).not.toBe("system");
  });

  it("Bridge 启动期间展示真实启动状态并在就绪后退出", async () => {
    vi.useFakeTimers();
    let resolveRuntime:
      | ((value: Awaited<ReturnType<typeof getRuntimeStatus>>) => void)
      | undefined;
    vi.mocked(getRuntimeStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRuntime = resolve;
        }),
    );

    try {
      const { container } = render(<ChatWorkbenchView />);

      expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toBeInTheDocument();
      expect(screen.getByRole("status", { name: "正在连接本机 Pi 运行时" })).toHaveTextContent(
        "正在连接本机 Pi 运行时",
      );
      expect(screen.getByRole("heading", { name: "PI Desktop" })).toBeInTheDocument();
      expect(container.querySelector(".startup-brand-icon img")).not.toBeNull();
      expect(container.querySelector(".desktop-shell")).toHaveAttribute("inert");
      expect(getRuntimeStatus).toHaveBeenCalledOnce();
      expect(getRuntimeSettings).toHaveBeenCalledOnce();
      expect(listenToAgentEvents).toHaveBeenCalledOnce();

      await act(async () => {
        resolveRuntime?.(readyRuntime);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(listAgentSessions).toHaveBeenCalledOnce());
      expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toBeInTheDocument();

      await act(async () => vi.advanceTimersToNextFrame());
      await act(async () => vi.advanceTimersToNextFrame());
      finishStartupWriting();
      await act(async () =>
        vi.advanceTimersByTimeAsync(
          STARTUP_MINIMUM_DURATION_MS + STARTUP_EXIT_DURATION_MS,
        ),
      );
      expect(screen.getByRole("status", { name: "状态正常" })).toBeInTheDocument();
      expect(container.querySelector(".desktop-shell")).not.toHaveAttribute("inert");
      expect(
        screen.queryByRole("dialog", { name: "PI Desktop 启动界面" }),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("项目栏可搜索切换分支、创建分支并刷新当前分支，菜单支持关闭", async () => {
    let current = "main";
    vi.mocked(gitStatus).mockImplementation(async () => ({
      isRepository: true, repoRoot: "C:\\work",
      branch: { head: current, upstream: null, ahead: 0, behind: 0, detached: false },
      staged: [], unstaged: [], untracked: [], conflicted: [], isClean: true,
    }));
    vi.mocked(getWorktreeOptions).mockImplementation(async () => ({
      branches: ["main", "feature/local", ...(current === "feature/new" ? [current] : [])]
        .map((name) => ({ name, current: name === current, remote: false })),
      suggestedName: "unused",
    }));
    vi.mocked(gitSwitchBranch).mockImplementation(async (_cwd, name) => { current = name; });
    vi.mocked(gitCreateBranch).mockImplementation(async (_cwd, name) => { current = name; });
    render(<ChatWorkbenchView />);
    expect(await screen.findByRole("status", { name: "状态正常" })).toBeInTheDocument();
    await addProject("C:\\work");
    const trigger = await screen.findByRole("button", { name: "选择 Git 分支" });
    await waitFor(() => expect(trigger).toHaveTextContent("main"));
    fireEvent.click(trigger);
    const target = await screen.findByRole("menuitemradio", { name: "feature/local" });
    await waitFor(() => expect(target).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "搜索分支" }), { target: { value: "LOCAL" } });
    expect(screen.queryByRole("menuitemradio", { name: /main/ })).not.toBeInTheDocument();
    fireEvent.click(target);
    await waitFor(() => expect(trigger).toHaveTextContent("feature/local"));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Git 分支" })).not.toBeInTheDocument());
    expect(gitSwitchBranch).toHaveBeenCalledWith("C:\\work", "feature/local", false);
    fireEvent.click(trigger);
    const create = await screen.findByRole("menuitem", { name: "新建分支…" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    fireEvent.change(screen.getByRole("textbox", { name: "分支名称" }), { target: { value: "feature/new" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并切换" }));
    await waitFor(() => expect(trigger).toHaveTextContent("feature/new"));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Git 分支" })).not.toBeInTheDocument());
    expect(gitCreateBranch).toHaveBeenCalledWith("C:\\work", "feature/new");
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Git 分支" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Git 分支" })).not.toBeInTheDocument();
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it("通过项目弹窗创建会话、发送提示并合并流式文本", async () => {
    const { container } = render(<ChatWorkbenchView />);
    expect(await screen.findByRole("status", { name: "状态正常" })).toBeInTheDocument();
    await addProject("C:\\work");

    expect(await screen.findByLabelText("发送给 Pi 的消息")).toBeInTheDocument();
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "选择项目" })).toBeEnabled();
    expect(screen.getByTitle("本机 Pi Runtime")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "检查项目" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(createAgentSession).toHaveBeenCalledWith("C:\\work"));
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "检查项目", undefined, defaultToolNames),
    );
    expect(await screen.findAllByText("检查项目")).not.toHaveLength(0);
    expect(container.querySelector(".composer-project-bar")).not.toBeInTheDocument();
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
    expect(container.querySelector(".timeline-tool-icon .lucide-file-text")).not.toBeNull();
    expect(container.querySelector(".timeline-tool .timeline-tool-progress.spin")).not.toBeNull();
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
    expect(screen.getByText("分析项目")).toBeVisible();
    expect(screen.getByText("读取了")).toBeVisible();
    expect(screen.getByText("运行失败")).toBeVisible();
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("失败").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("发送内置 slash 命令执行桌面动作，运行时命令仍交给 Pi", async () => {
    vi.mocked(listAgentCommands).mockResolvedValueOnce([
      { name: "review", description: "审查变更", source: "extension" },
    ]);
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");

    fireEvent.change(composer, { target: { value: "/settings" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(promptAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "返回会话工作台" }));
    const chatComposer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(chatComposer, { target: { value: "/review" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalledWith("s-1", "/review", undefined, defaultToolNames));
  });

  it("运行时命令优先于旧版内置别名", async () => {
    vi.mocked(listAgentCommands).mockResolvedValueOnce([
      { name: "models", description: "运行时模型命令", source: "extension" },
    ]);
    vi.mocked(promptAgent).mockResolvedValueOnce(1);
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");

    fireEvent.change(composer, { target: { value: "建立会话" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalledWith("s-1", "建立会话", undefined, defaultToolNames));
    act(() => emitAgentEvent?.(agentEvent("agent.settled", undefined, 1)));
    await waitFor(() => expect(listAgentCommands).toHaveBeenCalledWith("s-1"));

    const liveComposer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(liveComposer, { target: { value: "/models" } });
    expect(await screen.findByTestId("composer-slash-item")).toHaveTextContent("/models");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(promptAgent).toHaveBeenCalledWith("s-1", "/models", undefined, defaultToolNames));
  });

  it("保存粘贴图片并通过 SDK images 参数发送", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "paste.png", {
      type: "image/png",
    });

    fireEvent.paste(composer, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
      },
    });

    await waitFor(() => expect(saveClipboardImage).toHaveBeenCalledWith(image));
    expect(await screen.findByTitle("C:\\cache\\composer-attachments\\paste.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith(
        "s-1",
        "请查看附加的图片。",
        undefined,
        defaultToolNames,
        ["C:\\cache\\composer-attachments\\paste.png"],
      ),
    );
  });

  it("图片批量保存部分失败时保留已保存项并展示稳定错误", async () => {
    vi.mocked(saveClipboardImage)
      .mockResolvedValueOnce("C:\\cache\\composer-attachments\\first.png")
      .mockRejectedValueOnce({ code: "PROMPT_IMAGE_TOO_LARGE", message: "单张图片不能超过 10 MiB" });
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    const first = new File([new Uint8Array([1])], "first.png", { type: "image/png" });
    const second = new File([new Uint8Array([2])], "second.png", { type: "image/png" });

    fireEvent.paste(composer, {
      clipboardData: {
        items: [
          { kind: "file", type: "image/png", getAsFile: () => first },
          { kind: "file", type: "image/png", getAsFile: () => second },
        ],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PROMPT_IMAGE_TOO_LARGE: 单张图片不能超过 10 MiB",
    );
    expect(screen.getByTitle("C:\\cache\\composer-attachments\\first.png")).toBeInTheDocument();
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

  it("内容高度变化时跟随底部，待执行滚动不能抢回用户上滑位置", async () => {
    const observers: { callback: ResizeObserverCallback; observe: Mock; disconnect: Mock }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, observe: this.observe, disconnect: this.disconnect });
      }
    });
    const view = render(<ChatWorkbenchView />);
    try {
      await screen.findByRole("status", { name: "状态正常" });
      await addProject("C:\\work");
      await screen.findByLabelText("发送给 Pi 的消息");
      await act(async () => new Promise((resolve) => window.setTimeout(resolve, 32)));
      const body = view.container.querySelector(".thread-body")!;
      const observer = observers.filter((item) => item.observe.mock.calls.some(([target]) => target === body)).at(-1)!;
      expect(observer).toBeDefined();
      const scroll = view.container.querySelector(".conversation-scroll") as HTMLDivElement;
      const scrollTo = vi.fn();
      Object.defineProperties(scroll, {
        scrollHeight: { configurable: true, value: 1_200 },
        clientHeight: { configurable: true, value: 400 },
        scrollTop: { configurable: true, writable: true, value: 800 },
        scrollTo: { configurable: true, value: scrollTo },
      });
      const frames: FrameRequestCallback[] = [];
      const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
      const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
      try {
        fireEvent.scroll(scroll);
        act(() => observer.callback([], {} as ResizeObserver));
        expect(frames).toHaveLength(1);
        scroll.scrollTop = 200;
        fireEvent.scroll(scroll);
        act(() => frames.shift()!(0));
        expect(scrollTo).not.toHaveBeenCalled();
        act(() => observer.callback([], {} as ResizeObserver));
        expect(frames).toHaveLength(0);

        scroll.scrollTop = 800;
        fireEvent.scroll(scroll);
        act(() => observer.callback([], {} as ResizeObserver));
        act(() => frames.shift()!(0));
        expect(scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: "auto" });

        act(() => observer.callback([], {} as ResizeObserver));
        view.unmount();
        expect(observer.disconnect).toHaveBeenCalledOnce();
        expect(cancelFrame).toHaveBeenCalled();
        act(() => observer.callback([], {} as ResizeObserver));
        expect(scrollTo).toHaveBeenCalledOnce();
      } finally {
        requestFrame.mockRestore();
        cancelFrame.mockRestore();
      }
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
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
    fireEvent.click(screen.getByRole("button", { name: "退出应用" }));
    await waitFor(() => expect(exitApp).toHaveBeenCalledOnce());
  });

  it("退出启动失败时保留遮罩并给出可执行的降级提示", async () => {
    vi.mocked(getRuntimeStatus).mockResolvedValue({
      status: "unavailable",
      runtimeSource: null,
      piVersion: null,
      nodeVersion: null,
      error: { code: "RUNTIME_NOT_FOUND", message: "未找到可用运行时" },
    });
    vi.mocked(exitApp).mockRejectedValueOnce(new Error("close denied"));
    render(<ChatWorkbenchView />);

    fireEvent.click(await screen.findByRole("button", { name: "退出应用" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "APP_EXIT_FAILED: 无法退出应用，请使用托盘菜单中的“退出应用”",
    );
    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toHaveAttribute(
      "data-state",
      "error",
    );
  });

  it("运行时恢复后自动重新加载目录和模型，不需要刷新页面", async () => {
    const unavailableRuntime: RuntimeStatus = {
      status: "unavailable",
      runtimeSource: null,
      piVersion: null,
      nodeVersion: null,
      error: { code: "RUNTIME_NOT_FOUND", message: "Pi 尚未启动" },
    };
    vi.mocked(getRuntimeStatus).mockImplementation(() => new Promise(() => undefined));
    render(<ChatWorkbenchView />);

    await waitFor(() => expect(emitRuntimeStatus).toBeDefined());
    act(() => emitRuntimeStatus?.(unavailableRuntime));
    await waitFor(() => expect(screen.getByText("RUNTIME_NOT_FOUND: Pi 尚未启动")).toBeInTheDocument());
    expect(listAgentSessions).not.toHaveBeenCalled();

    act(() => emitRuntimeStatus?.(readyRuntime));

    await waitFor(() => {
      expect(listAgentSessions).toHaveBeenCalled();
      expect(listAgentModels).toHaveBeenCalled();
    });
  });

  it("目录同步暂时失败时自动退避重试，不需要刷新页面", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(listAgentSessions)
        .mockRejectedValueOnce({
          code: "SESSION_LIST_TEMPORARY",
          message: "Pi 会话目录暂时不可用",
        })
        .mockResolvedValueOnce([]);

      render(<ChatWorkbenchView />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(listAgentSessions).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(screen.getByText("SESSION_LIST_TEMPORARY: Pi 会话目录暂时不可用")).toBeInTheDocument(),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      await vi.waitFor(() => expect(listAgentSessions).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect(
          screen.queryByText("SESSION_LIST_TEMPORARY: Pi 会话目录暂时不可用"),
        ).not.toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("首条消息正在创建会话时隐藏项目栏，避免切换工作区", async () => {
    let completeCreation!: (session: typeof defaultSession) => void;
    vi.mocked(createAgentSession).mockReturnValueOnce(
      new Promise((resolve) => {
        completeCreation = resolve;
      }),
    );
    const { container } = render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    expect(screen.getByRole("button", { name: "选择项目" })).toBeEnabled();

    fireEvent.change(composer, { target: { value: "开始任务" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(createAgentSession).toHaveBeenCalledWith("C:\\work"));
    expect(promptAgent).not.toHaveBeenCalled();
    expect(container.querySelector(".composer-project-bar")).not.toBeInTheDocument();

    await act(async () => completeCreation(defaultSession));

    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "开始任务", undefined, defaultToolNames),
    );
    expect(container.querySelector(".composer-project-bar")).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "选择项目" })).toBeEnabled();
    expect(screen.getByTitle("本机 Pi Runtime")).toBeInTheDocument();
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(vi.mocked(listenToAgentEvents).mock.calls.length);
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
    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toHaveAttribute(
      "data-state",
      "error",
    );
    expect(selectProjectDirectory).not.toHaveBeenCalled();
    expect(createAgentSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试启动" }));
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
    expect(screen.queryByRole("button", { name: "选择项目" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("本机 Pi Runtime")).not.toBeInTheDocument();

    vi.mocked(configureAgentSession).mockResolvedValueOnce({
      ...defaultSession.configuration,
      model: { provider: "anthropic", id: "claude", name: "Claude", reasoning: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "模型与思考强度" }));
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
    const slider = screen.getByRole("slider", { name: "思考强度" });
    await waitFor(() => expect(slider).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.change(slider, { target: { value: "2" } });
    fireEvent.pointerUp(slider);
    await waitFor(() =>
      expect(configureAgentSession).toHaveBeenCalledWith("saved", { thinkingLevel: "high" }),
    );
  });

  it("通过会话配置确认权限模式，并保持工具白名单独立", async () => {
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
    vi.mocked(configureAgentSession).mockResolvedValueOnce({
      ...defaultSession.configuration, permissionMode: "ask",
    });
    fireEvent.click(screen.getByRole("menuitemradio", { name: /每次询问/ }));
    await waitFor(() => expect(configureAgentSession).toHaveBeenCalledWith("saved", { permissionMode: "ask" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "选择工具权限" })).toHaveTextContent("每次询问"));
    fireEvent.change(screen.getByLabelText("发送给 Pi 的消息"), {
      target: { value: "只读检查" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("saved", "只读检查", undefined, defaultToolNames),
    );
    expect(window.localStorage.getItem("pi-desktop.tool-permissions.v1")).not.toContain('"mode":"custom"');
  });

  it("将真实授权事件展示为弹窗并按会话回复", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    fireEvent.change(await screen.findByLabelText("发送给 Pi 的消息"), { target: { value: "run tests" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(listAgentPermissionRequests).toHaveBeenCalledWith("s-1"));
    act(() => emitAgentEvent?.(agentEvent("permission.requested", { requestId: "r-1", toolCallId: "t-1", toolName: "bash",
      summary: "pnpm test", expiresAt: new Date(Date.now() + 120_000).toISOString() }, 1)));
    const dialog = await screen.findByRole("dialog", { name: "工具执行需要授权" });
    expect(dialog).toHaveTextContent("pnpm test");
    fireEvent.click(within(dialog).getByRole("button", { name: "仅允许一次" }));
    await waitFor(() => expect(replyAgentPermission).toHaveBeenCalledExactlyOnceWith("s-1", "r-1", "allow-once"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "工具执行需要授权" })).not.toBeInTheDocument());
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
    expect(screen.getByRole("button", { name: "选择项目" })).toBeEnabled();
    fireEvent.change(composer, { target: { value: "开始纯对话" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(ensureConversationWorkspace).toHaveBeenCalledOnce());
    expect(createAgentSession).toHaveBeenCalledWith(
      "C:\\Users\\me\\Documents\\Pix\\conversations",
    );
    expect(screen.queryByRole("button", { name: "显示工作区侧栏" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "选择项目" })).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));

    expect(await screen.findByRole("heading", { name: "开始对话" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择项目" })).toBeEnabled();
    expect(screen.getByTitle("本机 Pi Runtime")).toBeInTheDocument();
  });

  it("从侧栏新建会话时沿用当前项目路径", async () => {
    vi.mocked(createAgentSession).mockResolvedValueOnce({
      ...defaultSession,
      cwd: "C:\\projects\\alpha",
      sessionPath: "C:\\agent\\sessions\\alpha.jsonl",
    });
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\projects\\alpha");

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "切换后的项目会话" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(createAgentSession).toHaveBeenCalledWith("C:\\projects\\alpha"));
    expect(ensureConversationWorkspace).not.toHaveBeenCalled();
  });

  it("未选择项目时顶部新建会话保留纯对话默认行为", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    const composer = await screen.findByLabelText("发送给 Pi 的消息");
    fireEvent.change(composer, { target: { value: "默认对话" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(createAgentSession).toHaveBeenCalledWith(
        "C:\\Users\\me\\Documents\\Pix\\conversations",
      ),
    );
  });

  it.each(["C:/work", "C:/Users/me/Documents/Pix/conversations"])("%s 的子代理卡片打开只读侧栏并跟随实时结果", async (cwd) => {
    vi.mocked(createAgentSession).mockResolvedValue({ ...defaultSession, cwd });
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject(cwd);
    fireEvent.change(await screen.findByLabelText("发送给 Pi 的消息"), { target: { value: "委派检查" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(promptAgent).toHaveBeenCalled());
    const child: SubagentSnapshot = { id: "delegate:0", agent: "reviewer", task: "检查侧栏布局", status: "running", model: "test-model", messages: [], truncated: false };
    act(() => emitAgentEvent?.(agentEvent("tool.started", { toolCallId: "delegate", toolName: "subagent", subagents: [child] }, 1)));
    fireEvent.click(await screen.findByRole("button", { name: /查看 reviewer 子代理会话/ }));
    const panel = await screen.findByRole("complementary", { name: "工作区侧边栏" });
    expect(within(panel).getByRole("tab", { name: "reviewer" })).toHaveAttribute("aria-selected", "true");
    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看 reviewer 子代理会话/ }));
    expect(within(panel).getAllByRole("tab", { name: "reviewer" })).toHaveLength(1);
    act(() => emitAgentEvent?.(agentEvent("tool.updated", { toolCallId: "delegate", toolName: "subagent", subagents: [{ ...child, messages: [{ role: "assistant", content: "侧栏验证进度" }] }] }, 2)));
    expect(await within(panel).findByText("侧栏验证进度")).toBeInTheDocument();
    act(() => emitAgentEvent?.(agentEvent("tool.completed", { toolCallId: "delegate", toolName: "subagent", subagents: [{ ...child, status: "completed", turns: 2, messages: [{ role: "assistant", content: "侧栏验证通过" }] }] }, 3)));
    expect(await within(panel).findByText("侧栏验证通过")).toBeInTheDocument();
    expect(within(panel).getByText("已完成")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "关闭子代理标签页" }));
    expect(within(panel).queryByRole("tab", { name: "reviewer" })).not.toBeInTheDocument();
    expect(within(panel).queryByText("侧栏验证通过")).not.toBeInTheDocument();
  });

  it("同工作区恢复历史时隔离子代理标签与相同调用 ID 的内容", async () => {
    vi.mocked(listAgentSessions).mockResolvedValue(["first", "second"].map((id) => ({
      id, path: `C:/sessions/${id}.jsonl`, cwd: "C:/alpha", name: `${id} task`,
      created: "2026-09-27T08:00:00.000Z", modified: "2026-09-27T09:00:00.000Z", messageCount: 1, firstMessage: id,
    })));
    vi.mocked(openAgentSession).mockImplementation(async (path) => {
      const id = path.includes("first") ? "first" : "second";
      return { ...defaultSession, sessionId: id, cwd: "C:/alpha", sessionPath: path, messages: [{
        role: "tool", content: "", toolCallId: "delegate", toolName: "subagent",
        subagents: [{ id: "delegate:0", agent: "reviewer", task: `${id} 的任务`, status: "completed", messages: [{ role: "assistant", content: `${id} 的独立结果` }], truncated: false }],
      }] };
    });
    render(<ChatWorkbenchView />);
    fireEvent.click(await screen.findByTitle("first task"));
    fireEvent.click(await screen.findByRole("button", { name: /查看 reviewer 子代理会话/ }));
    expect(await screen.findByText("first 的独立结果")).toBeVisible();
    fireEvent.click(screen.getByTitle("second task"));
    await screen.findByText("second 的任务");
    expect(screen.queryByText("first 的独立结果")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "reviewer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看 reviewer 子代理会话/ }));
    expect(await screen.findByText("second 的独立结果")).toBeVisible();
    fireEvent.click(screen.getByTitle("first task"));
    expect(await screen.findByText("first 的独立结果")).toBeVisible();
    expect(screen.queryByText("second 的独立结果")).not.toBeInTheDocument();
  });

  it("仅在项目会话中打开、展开并关闭右侧面板", async () => {
    const { container } = render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    expect(screen.queryByRole("button", { name: "显示工作区侧栏" })).not.toBeInTheDocument();

    await addProject("C:\\work");
    const toggle = await screen.findByRole("button", { name: "显示工作区侧栏" });
    await waitFor(() => expect(screen.getByRole("button", { name: "选择 Git 分支" })).toHaveTextContent("main"));
    const initialGitRequests = vi.mocked(gitStatus).mock.calls.length;
    fireEvent.click(toggle);
    expect(await screen.findByRole("complementary", { name: "工作区侧边栏" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新标签页" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "审查" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "文件" })).not.toBeInTheDocument();
    expect(gitStatus).toHaveBeenCalledTimes(initialGitRequests);
    expect(listWorkspaceEntries).not.toHaveBeenCalled();
    expect(readWorkspaceFile).not.toHaveBeenCalled();
    expect(listSessionReviews).not.toHaveBeenCalled();
    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith("C:\\work"));

    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("button", { name: "文件列表" }));
    expect(screen.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tree", { name: "文件树" })).toBeInTheDocument();
    await waitFor(() => expect(listWorkspaceEntries).toHaveBeenCalledWith("C:\\work", "", null));
    fireEvent.click(screen.getByRole("button", { name: "展开工作区侧边栏" }));
    expect(container.querySelector(".right-panel")).toHaveClass("right-panel-expanded");
    fireEvent.click(screen.getByRole("button", { name: "收起工作区侧边栏" }));
    expect(screen.queryByRole("tab", { name: "浏览器" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭差异侧栏" }));
    expect(screen.getByRole("button", { name: "显示工作区侧栏" })).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelector(".right-panel")).toHaveAttribute("aria-hidden", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "显示工作区侧栏" })).toHaveFocus());
    await waitFor(() => expect(container.querySelector(".right-panel")).not.toBeVisible());
    expect(container.querySelector(".right-panel")).toBeInTheDocument();
    const filesTree = container.querySelector('[role="tree"][aria-label="文件树"]');
    const directoryRequests = vi.mocked(listWorkspaceEntries).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "显示工作区侧栏" }));
    expect(screen.getByRole("tree", { name: "文件树" })).toBe(filesTree);
    expect(screen.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(directoryRequests);
    fireEvent.click(screen.getByRole("button", { name: "关闭文件列表标签页" }));
    expect(screen.getByRole("tab", { name: "新标签页" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "文件" })).not.toBeInTheDocument();
  });

  it.each(["文件列表", "Git 审查"])("%s 保持打开并自动跟随工作区 A→B→A", async (tool) => {
    vi.mocked(listWorkspaceEntries).mockImplementation(async (cwd) => ({
      entries: [{ name: cwd.endsWith("alpha") ? "alpha.ts" : "beta.ts", relativePath: cwd.endsWith("alpha") ? "alpha.ts" : "beta.ts", kind: "file" }], nextCursor: null,
    }));
    vi.mocked(gitStatus).mockImplementation(async (cwd) => ({
      isRepository: true, repoRoot: cwd, branch: { head: cwd.endsWith("alpha") ? "alpha-branch" : "beta-branch", upstream: null, ahead: 0, behind: 0, detached: false },
      staged: [], unstaged: [], untracked: [], conflicted: [], isClean: true,
    }));
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:/alpha");
    fireEvent.click(await screen.findByRole("button", { name: "显示工作区侧栏" }));
    fireEvent.click(screen.getByRole("button", { name: tool }));
    const expectWorkspace = async (name: "alpha" | "beta") => {
      const panel = screen.getByRole("complementary", { name: "工作区侧边栏" });
      expect(screen.getByRole("button", { name: "隐藏工作区侧栏" })).toHaveAttribute("aria-pressed", "true");
      expect(within(panel).getByRole("tab", { name: tool === "文件列表" ? "文件" : "审查" })).toHaveAttribute("aria-selected", "true");
      if (tool === "文件列表") {
        expect(await within(panel).findByRole("treeitem", { name: `${name}.ts` })).toBeInTheDocument();
        expect(within(panel).queryByRole("treeitem", { name: `${name === "alpha" ? "beta" : "alpha"}.ts` })).not.toBeInTheDocument();
      } else {
        expect(await within(panel).findByText(`${name}-branch`)).toBeInTheDocument();
        expect(within(panel).queryByText(`${name === "alpha" ? "beta" : "alpha"}-branch`)).not.toBeInTheDocument();
      }
    };
    await expectWorkspace("alpha");
    await addProject("C:/beta");
    await waitFor(() => expect(rememberWorkspace).toHaveBeenCalledWith("C:/beta"));
    await expectWorkspace("beta");
    await addProject("C:/alpha");
    await waitFor(() => expect(screen.getByRole("button", { name: "选择 Git 分支" })).toHaveTextContent("alpha-branch"));
    await expectWorkspace("alpha");
  });

  it("从右侧面板搜索文件、读取源码、添加评论并调用受限文件操作", async () => {
    vi.mocked(searchWorkspacePaths).mockResolvedValueOnce([
      { path: "C:\\work\\src\\main.ts", relativePath: "src/main.ts", kind: "file" },
      { path: "C:\\work\\src", relativePath: "src", kind: "folder" },
    ]);
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    fireEvent.click(await screen.findByRole("button", { name: "显示工作区侧栏" }));

    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("button", { name: /打开文件/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "输入内容搜索文件" }), {
      target: { value: "main" },
    });
    const result = await screen.findByRole("button", { name: /main\.ts/ });
    fireEvent.click(result);

    await waitFor(() =>
      expect(readWorkspaceFile).toHaveBeenCalledWith("C:\\work", "C:\\work\\src\\main.ts"),
    );
    expect(screen.getByRole("tab", { name: "main.ts" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tree", { name: "文件树" })).toBeVisible();
    expect(document.querySelectorAll('[role="tree"][aria-label="文件树"]')).toHaveLength(1);
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

  it("同工作区切换会话保留审查工具，并读取当前会话修改", async () => {
    const sessions = ["first", "second"].map((id) => ({
      id, path: `C:/sessions/${id}.jsonl`, cwd: "C:/alpha", name: `${id} task`,
      created: "2026-09-27T08:00:00.000Z", modified: "2026-09-27T09:00:00.000Z", messageCount: 1, firstMessage: id,
    }));
    vi.mocked(listAgentSessions).mockResolvedValue(sessions);
    vi.mocked(getWorkspaceState).mockResolvedValue({ recentWorkspaces: ["C:/alpha"], lastWorkspace: null, conversationHome: "C:/conversations" });
    vi.mocked(openAgentSession).mockImplementation(async (path) => ({
      ...defaultSession, sessionId: path.includes("first") ? "first" : "second", cwd: "C:/alpha", sessionPath: path,
    }));
    render(<ChatWorkbenchView />);
    fireEvent.click(await screen.findByTitle("first task"));
    fireEvent.click(await screen.findByRole("button", { name: "显示工作区侧栏" }));
    fireEvent.click(screen.getByRole("button", { name: "Git 审查" }));
    fireEvent.click(screen.getByRole("button", { name: "会话修改" }));
    await waitFor(() => expect(listSessionReviews).toHaveBeenCalledWith("first", "C:/alpha", undefined));
    fireEvent.click(screen.getByTitle("second task"));
    await waitFor(() => expect(listSessionReviews).toHaveBeenCalledWith("second", "C:/alpha", undefined));
    expect(screen.getByRole("button", { name: "隐藏工作区侧栏" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: "审查" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "会话修改" })).toHaveAttribute("aria-pressed", "true");
  });

  it("将图片搜索结果打开到快速预览标签，并按工作区隔离预览", async () => {
    vi.mocked(searchWorkspacePaths).mockResolvedValueOnce([
      { path: "C:\\work\\assets\\logo.png", relativePath: "assets/logo.png", kind: "file" },
    ]);
    vi.mocked(readWorkspaceFile).mockResolvedValueOnce({ dataBase64: "AA==", size: 1 });
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    await addProject("C:\\work");
    fireEvent.click(await screen.findByRole("button", { name: "显示工作区侧栏" }));
    fireEvent.click(screen.getByRole("button", { name: "打开右侧面板标签页" }));
    fireEvent.click(screen.getByRole("button", { name: /打开文件/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "输入内容搜索文件" }), {
      target: { value: "logo" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /logo\.png/ }));

    expect(await screen.findByRole("tab", { name: "logo.png" })).toHaveAttribute("aria-selected", "true");
    const image = await screen.findByRole("img", { name: "logo.png" });
    expect(image).toHaveAttribute("src", "data:image/png;base64,AA==");
    expect(screen.getByRole("tree", { name: "文件树" })).toBeVisible();
    const reads = vi.mocked(readWorkspaceFile).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(screen.getByRole("tab", { name: "logo.png" })).toHaveAttribute("aria-selected", "true");
    expect(readWorkspaceFile).toHaveBeenCalledTimes(reads);
    await addProject("C:/other");
    await waitFor(() => expect(screen.queryByRole("tab", { name: "logo.png" })).not.toBeInTheDocument());
    expect(screen.queryByRole("img", { name: "logo.png" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新标签页" })).toHaveAttribute("aria-selected", "true");
    expect(readWorkspaceFile).toHaveBeenCalledTimes(reads);
  });

  it("后台加载尚未完成时进入插件页面不会丢失资源计数", async () => {
    let releaseResources!: (value: Awaited<ReturnType<typeof listAgentResources>>) => void;
    vi.mocked(listAgentResources).mockReturnValueOnce(new Promise((resolve) => { releaseResources = resolve; }));
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    finishStartupWriting();
    await waitFor(() => expect(listAgentResources).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "PI Desktop 启动界面" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("…");
    fireEvent.click(screen.getByRole("button", { name: "插件" }));
    expect(await screen.findByRole("heading", { name: "插件" })).toBeInTheDocument();
    expect(listAgentPackages).toHaveBeenCalledOnce();
    await act(async () => {
      releaseResources([{ kind: "skill", name: "review", path: "C:/agent/skills/review/SKILL.md" }]);
    });
    await waitFor(() => expect(listAgentPackages).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("1");
    expect(listAgentResources).toHaveBeenCalledOnce();
  });

  it("后台目录失败不会遮挡首页，进入管理页可以重试", async () => {
    vi.mocked(listAgentResources).mockRejectedValueOnce(new Error("unavailable"));
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    finishStartupWriting();
    await waitFor(() => expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("—"));
    expect(screen.queryByRole("dialog", { name: "PI Desktop 启动界面" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建会话" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "资源" }));
    await waitFor(() => expect(listAgentResources).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("0");
  });

  it("进入不同工作区会重新预加载当前工作区的目录", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });
    finishStartupWriting();
    await waitFor(() => expect(listAgentResources).toHaveBeenCalledOnce());
    expect(listAgentResources).toHaveBeenCalledWith(String.raw`C:\Users\me\Documents\Pix\conversations`);
    await addProject("C:/work");
    await waitFor(() => expect(listAgentResources).toHaveBeenCalledWith("C:/work"));
    expect(listAgentPackages).toHaveBeenCalledWith("C:/work");
    expect(listAgentResources).toHaveBeenCalledTimes(2);
    expect(checkAgentPackageUpdates).not.toHaveBeenCalled();
  });

  it("进入首页即后台加载计数，打开插件与资源视图仍可刷新", async () => {
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
    expect(listAgentPackages).not.toHaveBeenCalled();
    expect(listAgentResources).not.toHaveBeenCalled();
    finishStartupWriting();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "PI Desktop 启动界面" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("1"));
    expect(screen.getByRole("button", { name: "插件" })).toHaveTextContent("1");
    expect(screen.getByRole("heading", { name: "会话工作台" })).toBeInTheDocument();
    expect(listAgentPackages).toHaveBeenCalledOnce();
    expect(listAgentResources).toHaveBeenCalledOnce();
    expect(checkAgentPackageUpdates).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "插件" }));
    expect(await screen.findByRole("heading", { name: "插件" })).toBeInTheDocument();
    expect(await screen.findByText("@example/pi-extension")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插件" })).toHaveTextContent("1");
    expect(listAgentPackages).toHaveBeenCalledTimes(2);
    expect(listAgentResources).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "资源" }));
    expect(await screen.findByRole("heading", { name: "资源" })).toBeInTheDocument();
    expect(await screen.findByText("项目检查")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("1");
    expect(listAgentResources).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(screen.getByRole("heading", { name: "会话工作台" })).toBeInTheDocument();
    expect(listAgentPackages).toHaveBeenCalledTimes(2);
    expect(listAgentResources).toHaveBeenCalledTimes(2);
  });

  it("从侧栏进入设置、切换分类、保存偏好并返回工作台", async () => {
    render(<ChatWorkbenchView />);
    await screen.findByRole("status", { name: "状态正常" });

    expect(screen.queryByRole("button", { name: "帮助" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关于" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "系统设置" }));
    expect(await screen.findByTestId("settings-general")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByTestId("settings-about")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "关于" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "反馈" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /帮助与支持|关于 Pi Desktop/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(screen.getByTestId("settings-notifications")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(6);

    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    expect(screen.getByTestId("settings-appearance")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), { target: { value: "manage" } });
    fireEvent.click(screen.getByRole("button", { name: "预览主题：魔女伊雷娜 · 月夜旅途" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await waitFor(() => expect(document.documentElement.dataset.backgroundActive).toBe("true"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "管理主题与背景" })).getByRole("button", { name: "关闭" }));

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
    expect(window.localStorage.getItem(APP_PREFERENCES_STORAGE_KEY)).toContain(
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
  const addButtons = await screen.findAllByRole("button", { name: /^添加项目(?:文件夹)?$/ });
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
