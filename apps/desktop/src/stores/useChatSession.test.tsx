import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  abortAgent,
  clearAgentQueue,
  configureAgentSession,
  createAgentSession,
  deleteAgentSessions,
  listAgentModels,
  listAgentSessions,
  listenToAgentEvents,
  openAgentSession,
  promptAgent,
  type AgentEvent,
  type AgentSession,
  type AgentSessionSummary,
} from "../ipc/agent";
import {
  ensureConversationWorkspace,
  getWorkspaceState,
  rememberWorkspace,
  removeRecentWorkspace,
} from "../ipc/workspace";
import { useChatSession } from "./useChatSession";

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
  clearAgentQueue: vi.fn(),
  configureAgentSession: vi.fn(),
  createAgentSession: vi.fn(),
  deleteAgentSessions: vi.fn(),
  listAgentModels: vi.fn(),
  listAgentSessions: vi.fn(),
  listenToAgentEvents: vi.fn(),
  normalizeThinkingLevels: (value: unknown) =>
    Array.isArray(value)
      ? ["off", "minimal", "low", "medium", "high", "xhigh", "max"].filter((level) =>
          value.includes(level),
        )
      : [],
  THINKING_LEVELS: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  openAgentSession: vi.fn(),
  promptAgent: vi.fn(),
  isThinkingLevel: (value: unknown) =>
    typeof value === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value),
}));
vi.mock("../ipc/workspace", () => ({
  ensureConversationWorkspace: vi.fn(),
  getWorkspaceState: vi.fn(),
  rememberWorkspace: vi.fn(),
  removeRecentWorkspace: vi.fn(),
}));

let nextSequence = 1;
const defaultToolNames = ["read", "bash", "edit", "write"];
const availableTools = defaultToolNames.map((name) => ({ name, description: `${name} tool` }));

const savedSummary: AgentSessionSummary = {
  id: "saved",
  path: "C:\\agent\\sessions\\saved.jsonl",
  cwd: "C:\\work",
  name: null,
  created: "2026-08-20T08:00:00.000Z",
  modified: "2026-08-20T09:00:00.000Z",
  messageCount: 1,
  firstMessage: "saved prompt",
};

function agentSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "s-1",
    cwd: "C:\\work",
    sessionPath: "C:\\agent\\sessions\\s-1.jsonl",
    modelFallbackMessage: "已切换到可用模型",
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
    ...overrides,
  };
}

describe("useChatSession", () => {
  let emit: ((event: AgentEvent) => void) | undefined;
  const unlisten = vi.fn<() => void>();

  beforeEach(() => {
    emit = undefined;
    nextSequence = 1;
    unlisten.mockReset();
    vi.mocked(createAgentSession).mockReset().mockResolvedValue(agentSession());
    vi.mocked(openAgentSession).mockReset().mockResolvedValue(
      agentSession({
        sessionId: "saved",
        sessionPath: savedSummary.path,
        modelFallbackMessage: null,
        configuration: {
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "high",
          availableThinkingLevels: ["off", "medium", "high"],
          availableTools,
          activeToolNames: defaultToolNames,
          defaultToolNames,
        },
        messages: [{ role: "user", content: "saved prompt" }],
      }),
    );
    vi.mocked(listAgentSessions).mockReset().mockResolvedValue([]);
    vi.mocked(listAgentModels).mockReset().mockResolvedValue([
      { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
    ]);
    vi.mocked(configureAgentSession).mockReset().mockResolvedValue({
      model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
      thinkingLevel: "high",
      availableThinkingLevels: ["off", "medium", "high"],
      availableTools,
      activeToolNames: defaultToolNames,
      defaultToolNames,
    });
    vi.mocked(promptAgent).mockReset().mockResolvedValue(0);
    vi.mocked(abortAgent).mockReset().mockResolvedValue(undefined);
    vi.mocked(clearAgentQueue).mockReset().mockResolvedValue(undefined);
    vi.mocked(deleteAgentSessions)
      .mockReset()
      .mockResolvedValue({ deletedSessionIds: [], missingSessionIds: [] });
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
    vi.mocked(listenToAgentEvents)
      .mockReset()
      .mockImplementation(async (handler) => {
        emit = handler;
        return unlisten;
      });
  });

  it("创建项目草稿时先登记工作区，并在首次发送时实体化", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.sendPrompt("ignored"));
    await act(() => result.current.abort());
    await act(() => result.current.createSession("   "));
    expect(result.current.error).toContain("WORKSPACE_PATH_INVALID");

    await act(() => result.current.createSession(" C:\\work "));
    expect(result.current.phase).toBe("ready");
    expect(result.current.cwd).toBe("C:\\work");
    expect(result.current.sessionPath).toBeNull();
    expect(result.current.configuration).toBeNull();
    expect(result.current.sessions).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^draft:/), lifecycle: "draft", path: null }),
    ]);
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(rememberWorkspace).toHaveBeenCalledOnce();
    expect(rememberWorkspace).toHaveBeenCalledWith("C:\\work");
    expect(result.current.recentWorkspaces).toEqual(["C:\\work"]);

    await act(() => result.current.sendPrompt("   "));
    expect(createAgentSession).not.toHaveBeenCalled();
    await act(() => result.current.sendPrompt(" hello "));
    expect(createAgentSession).toHaveBeenCalledWith("C:\\work");
    expect(promptAgent).toHaveBeenCalledWith("s-1", "hello", undefined, defaultToolNames);
    expect(result.current.sessionId).toBe("s-1");
    expect(result.current.sessionPath).toBe("C:\\agent\\sessions\\s-1.jsonl");
    expect(result.current.modelFallbackMessage).toBe("已切换到可用模型");
    expect(result.current.configuration?.thinkingLevel).toBe("medium");
    expect(result.current.messages).toHaveLength(1);
    await waitFor(() => expect(rememberWorkspace).toHaveBeenCalledWith("C:\\work"));

    await act(() => result.current.abort());
    expect(abortAgent).toHaveBeenCalledWith("s-1");
  });

  it("工作区登记失败时不创建项目草稿", async () => {
    vi.mocked(rememberWorkspace).mockRejectedValueOnce({
      code: "WORKSPACE_PATH_INVALID",
      message: "工作区路径不存在或无法访问",
    });
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    let created = true;
    await act(async () => {
      created = await result.current.createSession("C:\\missing");
    });

    expect(created).toBe(false);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.error).toBe(
      "WORKSPACE_PATH_INVALID: 工作区路径不存在或无法访问",
    );
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it("在切换项目后分别使用各自的工作区创建会话", async () => {
    vi.mocked(createAgentSession).mockImplementation(async (cwd) =>
      agentSession({
        sessionId: cwd.includes("alpha") ? "alpha-session" : "beta-session",
        cwd,
        sessionPath: `C:\\agent\\sessions\\${cwd.includes("alpha") ? "alpha" : "beta"}.jsonl`,
      }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.createSession("C:\\projects\\alpha"));
    await act(() => result.current.prepareConfiguration());
    await act(() => result.current.createSession("D:\\projects\\beta"));
    await act(() => result.current.prepareConfiguration());

    expect(createAgentSession).toHaveBeenNthCalledWith(1, "C:\\projects\\alpha");
    expect(createAgentSession).toHaveBeenNthCalledWith(2, "D:\\projects\\beta");
    expect(result.current.cwd).toBe("D:\\projects\\beta");
  });

  it("可在发送前实体化草稿，使模型和思考配置立即可交互", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    let prepared = false;
    await act(async () => {
      prepared = await result.current.prepareConfiguration();
    });

    expect(prepared).toBe(true);
    expect(createAgentSession).toHaveBeenCalledWith("C:\\work");
    expect(promptAgent).not.toHaveBeenCalled();
    expect(result.current.configuration?.model?.name).toBe("GPT");
    await act(() => result.current.updateModel("openai", "gpt"));
    expect(configureAgentSession).toHaveBeenCalledWith("s-1", {
      model: { provider: "openai", id: "gpt" },
    });
  });

  it("新草稿立即沿用最近确认的思考强度且保持按需实体化", async () => {
    vi.mocked(createAgentSession).mockResolvedValueOnce(
      agentSession({
        configuration: {
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "max",
          availableThinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
          availableTools,
          activeToolNames: defaultToolNames,
          defaultToolNames,
        },
      }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    await act(() => result.current.prepareConfiguration());
    expect(result.current.displayThinkingLevel).toBe("max");

    await act(() => result.current.createConversation());

    expect(result.current.configuration).toBeNull();
    expect(result.current.displayThinkingLevel).toBe("max");
    expect(createAgentSession).toHaveBeenCalledTimes(1);
  });

  it("将附加路径写入真实提示载荷，但时间线只展示用户正文", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    await act(() =>
      result.current.sendPrompt("检查文件", undefined, defaultToolNames, [
        "C:\\work\\a&b.ts",
        "C:\\work\\logo.png",
        "C:\\work\\src",
      ]),
    );
    const wireContent =
      "检查文件\n\n<attached-paths>\n  <path>C:\\work\\a&amp;b.ts</path>\n  <path>C:\\work\\logo.png</path>\n  <path>C:\\work\\src</path>\n</attached-paths>";
    expect(promptAgent).toHaveBeenCalledWith("s-1", wireContent, undefined, defaultToolNames);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "检查文件", optimistic: true }),
    ]);

    act(() => emit?.(event("user.message", { content: wireContent })));
    await waitFor(() =>
      expect(result.current.messages.filter((item) => item.role === "user")).toEqual([
        expect.objectContaining({ content: "检查文件", optimistic: false }),
      ]),
    );
  });

  it("将图片路径从文本附件中分离并通过 SDK images 参数发送", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    await act(() =>
      result.current.sendPrompt("分析截图", undefined, defaultToolNames, [
        "C:\\work\\notes.txt",
      ], ["C:\\cache\\composer-attachments\\paste.png"]),
    );
    const wireContent =
      "分析截图\n\n<attached-paths>\n  <path>C:\\work\\notes.txt</path>\n</attached-paths>";
    expect(promptAgent).toHaveBeenCalledWith(
      "s-1",
      wireContent,
      undefined,
      defaultToolNames,
      ["C:\\cache\\composer-attachments\\paste.png"],
    );
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "分析截图", optimistic: true }),
    ]);
  });

  it("允许仅附加图片发送，并为 SDK 提供非空提示词", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    await act(() =>
      result.current.sendPrompt("   ", undefined, defaultToolNames, [], [
        "C:\\cache\\composer-attachments\\paste.webp",
      ]),
    );

    expect(promptAgent).toHaveBeenCalledWith(
      "s-1",
      "请查看附加的图片。",
      undefined,
      defaultToolNames,
      ["C:\\cache\\composer-attachments\\paste.webp"],
    );
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "请查看附加的图片。", optimistic: true }),
    ]);
  });

  it("允许仅附加普通文件发送，并继续使用文本附件协议", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    await act(() =>
      result.current.sendPrompt("   ", undefined, defaultToolNames, ["C:\\work\\notes.txt"]),
    );

    expect(promptAgent).toHaveBeenCalledWith(
      "s-1",
      "请查看附加的文件。\n\n<attached-paths>\n  <path>C:\\work\\notes.txt</path>\n</attached-paths>",
      undefined,
      defaultToolNames,
    );
  });

  it("从会话快照和增量事件同步上下文占用量", async () => {
    vi.mocked(createAgentSession).mockResolvedValueOnce(
      agentSession({ contextUsage: { tokens: 1_024, contextWindow: 8_192, percent: 12.5 } }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    await act(() => result.current.prepareConfiguration());
    expect(result.current.contextUsage).toEqual({
      tokens: 1_024,
      contextWindow: 8_192,
      percent: 12.5,
    });

    act(() =>
      emit?.(
        event("session.usageChanged", {
          tokens: 4_096,
          contextWindow: 8_192,
          percent: 50,
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.contextUsage).toEqual({
        tokens: 4_096,
        contextWindow: 8_192,
        percent: 50,
      }),
    );
  });

  it("SDK 工具清单不可用时仍显式提交自定义禁止工具选择", async () => {
    vi.mocked(createAgentSession).mockResolvedValueOnce(
      agentSession({
        configuration: {
          model: null,
          thinkingLevel: "off",
          availableThinkingLevels: ["off"],
          availableTools: [],
          activeToolNames: [],
          defaultToolNames: [],
        },
      }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    await act(() => result.current.sendPrompt("locked", undefined, []));

    expect(promptAgent).toHaveBeenCalledWith("s-1", "locked", undefined, []);
  });

  it("草稿首次实体化期间拒绝重复发送且只创建一个后端会话", async () => {
    let resolveCreate: ((session: AgentSession) => void) | undefined;
    vi.mocked(createAgentSession).mockImplementationOnce(
      () =>
        new Promise<AgentSession>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    let firstSend: Promise<boolean> | undefined;
    act(() => {
      firstSend = result.current.sendPrompt("first");
    });
    await waitFor(() => expect(result.current.phase).toBe("creating"));

    let secondSent = true;
    await act(async () => {
      secondSent = await result.current.sendPrompt("second");
    });
    expect(secondSent).toBe(false);
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(promptAgent).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate?.(agentSession());
      await firstSend;
    });
    expect(promptAgent).toHaveBeenCalledOnce();
    expect(promptAgent).toHaveBeenCalledWith("s-1", "first", undefined, defaultToolNames);
  });

  it("目录确认落盘后将活动会话升级为单一正式条目并复用投影", async () => {
    const persisted: AgentSessionSummary = {
      ...savedSummary,
      id: "s-1",
      path: "C:\\agent\\sessions\\s-1.jsonl",
      firstMessage: "hello",
    };
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    vi.mocked(listAgentSessions).mockResolvedValueOnce([persisted]);

    await act(() => result.current.sendPrompt("hello"));
    await waitFor(() =>
      expect(result.current.sessions).toEqual([
        expect.objectContaining({ id: "s-1", path: persisted.path, lifecycle: "persisted" }),
      ]),
    );

    await act(() => result.current.openSession(result.current.sessions[0]!));
    expect(openAgentSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBe("s-1");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
    ]);
  });

  it("加载 SDK 目录、恢复会话并同步模型与思考强度", async () => {
    vi.mocked(listAgentSessions).mockResolvedValueOnce([savedSummary]);
    vi.mocked(openAgentSession).mockResolvedValueOnce(
      agentSession({
        sessionId: "saved",
        sessionPath: savedSummary.path,
        modelFallbackMessage: null,
        messages: [
          { role: "user", content: "saved prompt" },
          {
            role: "tool",
            content: "",
            toolCallId: "tool-1",
            toolName: "read",
            toolInput: {
              text: '{\n  "path": "C:\\\\work\\\\README.md"\n}',
              format: "json",
              truncated: false,
            },
            toolOutput: { text: "读取完成", format: "text", truncated: false },
          },
        ],
      }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.loadCatalogs());
    expect(result.current.catalogPhase).toBe("ready");
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.models[0]?.name).toBe("GPT");

    await act(() => result.current.openSession(result.current.sessions[0]!));
    expect(result.current.sessionId).toBe("saved");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "saved prompt" }),
      expect.objectContaining({
        role: "tool",
        toolCallId: "tool-1",
        toolInput: expect.objectContaining({ format: "json" }),
        toolOutput: expect.objectContaining({ text: "读取完成" }),
        status: "completed",
      }),
    ]);

    await act(() => result.current.updateThinkingLevel("high"));
    expect(configureAgentSession).toHaveBeenCalledWith("saved", { thinkingLevel: "high" });
    expect(result.current.configuration?.thinkingLevel).toBe("high");
    await act(() => result.current.updateModel("openai", "gpt"));
    expect(configureAgentSession).toHaveBeenCalledWith("saved", {
      model: { provider: "openai", id: "gpt" },
    });
  });

  it("目录部分失败时保留可用数据并暴露可重试错误", async () => {
    vi.mocked(listAgentSessions).mockRejectedValueOnce({
      code: "SESSION_LIST_FAILED",
      message: "无法读取会话",
    });
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.loadCatalogs());

    expect(result.current.catalogPhase).toBe("error");
    expect(result.current.catalogError).toContain("SESSION_LIST_FAILED");
    expect(result.current.models).toHaveLength(1);
  });

  it("清理归档会话后移除目录、活动投影和当前会话", async () => {
    vi.mocked(listAgentSessions).mockResolvedValue([savedSummary]);
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.loadCatalogs());
    await act(() => result.current.openSession(result.current.sessions[0]!));
    expect(result.current.sessionId).toBe("saved");

    vi.mocked(deleteAgentSessions).mockResolvedValueOnce({
      deletedSessionIds: ["saved"],
      missingSessionIds: [],
    });
    await act(() => result.current.deleteSessions(["saved"]));

    expect(deleteAgentSessions).toHaveBeenCalledWith(["saved"]);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.catalogPhase).toBe("ready");
  });

  it("忽略其他会话和无效增量并处理完整事件生命周期", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    act(() => {
      emit?.(event("agent.started", undefined, "other"));
      emit?.(event("message.delta", null));
      emit?.(event("message.delta", { delta: 1 }));
      emit?.(event("message.delta", { delta: "orphan" }));
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.messages).toHaveLength(0);

    let resolvePrompt: ((finalSequence: number) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    act(() => {
      void result.current.sendPrompt("stream");
    });
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "stream", undefined, defaultToolNames),
    );
    act(() => {
      emit?.(event("agent.started"));
      emit?.(event("user.message", { content: "stream" }));
      emit?.(
        event("tool.started", {
          toolCallId: "tool-1",
          toolName: "read",
          input: {
            text: '{\n  "path": "C:\\\\work\\\\README.md"\n}',
            format: "json",
            truncated: false,
          },
        }),
      );
      emit?.(event("message.delta", { delta: "A" }));
      emit?.(
        event("tool.completed", {
          toolCallId: "tool-1",
          toolName: "read",
          output: { text: "读取完成", format: "text", truncated: false },
        }),
      );
      emit?.(
        event("tool.failed", {
          toolCallId: "tool-2",
          toolName: "bash",
          output: { text: "命令失败", format: "text", truncated: true },
        }),
      );
      emit?.(event("agent.settled"));
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
      expect(result.current.messages.filter((item) => item.role === "user")).toHaveLength(1);
      expect(result.current.messages.find((item) => item.role === "assistant")?.content).toBe("A");
      expect(result.current.messages.filter((item) => item.role === "tool")).toEqual([
        expect.objectContaining({
          toolCallId: "tool-1",
          toolName: "read",
          toolInput: expect.objectContaining({ format: "json" }),
          toolOutput: expect.objectContaining({ text: "读取完成" }),
          status: "completed",
        }),
        expect.objectContaining({
          toolCallId: "tool-2",
          toolName: "bash",
          toolOutput: expect.objectContaining({ text: "命令失败", truncated: true }),
          status: "failed",
        }),
      ]);
    });

    await act(async () => resolvePrompt?.(10));
    expect(result.current.phase).toBe("ready");
  });

  it("将同一帧内的高频文本增量合并为一次渲染发布", async () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    try {
      const { result } = renderHook(() => useChatSession());
      await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
      await act(() => result.current.createSession("C:\\work"));
      await act(() => result.current.sendPrompt("batch"));

      act(() => {
        emit?.(event("agent.started"));
        for (let index = 0; index < 24; index += 1) {
          emit?.(event("message.delta", { delta: String(index % 10) }));
        }
      });

      expect(requestFrame).toHaveBeenCalledOnce();
      expect(result.current.messages.find((item) => item.role === "assistant")).toBeUndefined();
      act(() => frameCallback?.(16));
      expect(result.current.messages.find((item) => item.role === "assistant")?.content).toBe(
        "012345678901234567890123",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("保留已有流式文本并展示 prompt 与 abort 错误", async () => {
    let rejectPrompt: ((reason: unknown) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((_, reject) => {
          rejectPrompt = reject;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));

    act(() => {
      void result.current.sendPrompt("fail");
    });
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "fail", undefined, defaultToolNames),
    );
    act(() => emit?.(event("tool.started", { toolCallId: "tool-1", toolName: "bash" })));
    act(() => emit?.(event("message.delta", { delta: "partial" })));
    await act(async () => rejectPrompt?.(new Error("model failed")));

    expect(result.current.messages.find((item) => item.role === "assistant")?.content).toBe("partial");
    expect(result.current.messages.find((item) => item.role === "tool")?.status).toBe("failed");
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({ role: "system", content: "model failed", status: "failed" }),
    );
    expect(result.current.error).toBe("model failed");
    vi.mocked(abortAgent).mockRejectedValue("abort failed");
    await act(() => result.current.abort());
    expect(result.current.error).toBe("abort failed");
  });

  it("从发送开始计时，并在 agent 正常结束时冻结时长", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const { result } = renderHook(() => useChatSession());
      await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
      await act(() => result.current.createSession("C:\\work"));
      await act(() => result.current.sendPrompt("计时任务"));

      expect(result.current.timer).toEqual({
        startedAt: 1_000,
        endedAt: null,
        durationMs: null,
      });
      now.mockReturnValue(4_250);
      act(() => emit?.(event("agent.settled")));

      await waitFor(() => expect(result.current.phase).toBe("ready"));
      expect(result.current.timer).toEqual({
        startedAt: 1_000,
        endedAt: 4_250,
        durationMs: 3_250,
      });
    } finally {
      now.mockRestore();
    }
  });

  it("为连续的 AI 回合分别计时并冻结各自时长", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const { result } = renderHook(() => useChatSession());
      await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
      await act(() => result.current.createSession("C:\\work"));

      await act(() => result.current.sendPrompt("第一问"));
      now.mockReturnValue(4_000);
      act(() => emit?.(event("agent.settled")));
      await waitFor(() => expect(result.current.phase).toBe("ready"));

      now.mockReturnValue(5_000);
      await act(() => result.current.sendPrompt("第二问"));
      now.mockReturnValue(9_000);
      act(() => emit?.(event("agent.settled")));
      await waitFor(() => expect(result.current.phase).toBe("ready"));

      expect(result.current.messages.filter((item) => item.role === "user")).toEqual([
        expect.objectContaining({
          content: "第一问",
          timer: { startedAt: 1_000, endedAt: 4_000, durationMs: 3_000 },
        }),
        expect.objectContaining({
          content: "第二问",
          timer: { startedAt: 5_000, endedAt: 9_000, durationMs: 4_000 },
        }),
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("排队的后续用户回合开始时结束上一回合计时", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const { result } = renderHook(() => useChatSession());
      await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
      await act(() => result.current.createSession("C:\\work"));
      await act(() => result.current.sendPrompt("第一问"));
      await act(() => result.current.sendPrompt("第二问", "followUp"));

      now.mockReturnValue(3_000);
      act(() => emit?.(event("agent.settled")));
      now.mockReturnValue(4_000);
      act(() => emit?.(event("agent.started")));
      now.mockReturnValue(4_500);
      act(() => emit?.(event("user.message", { content: "第二问" })));
      now.mockReturnValue(7_000);
      act(() => emit?.(event("agent.settled")));

      await waitFor(() => expect(result.current.phase).toBe("ready"));
      expect(result.current.messages.filter((item) => item.role === "user")).toEqual([
        expect.objectContaining({
          content: "第一问",
          timer: { startedAt: 1_000, endedAt: 3_000, durationMs: 2_000 },
        }),
        expect.objectContaining({
          content: "第二问",
          timer: { startedAt: 4_500, endedAt: 7_000, durationMs: 2_500 },
        }),
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("用户中断时停止计时，并保持已经经过的时长", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(2_000);
    try {
      const { result } = renderHook(() => useChatSession());
      await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
      await act(() => result.current.createSession("C:\\work"));
      await act(() => result.current.sendPrompt("中断任务"));

      now.mockReturnValue(7_500);
      await act(() => result.current.abort());

      expect(result.current.phase).toBe("ready");
      expect(result.current.timer).toEqual({
        startedAt: 2_000,
        endedAt: 7_500,
        durationMs: 5_500,
      });
      act(() => emit?.(event("agent.started")));
      act(() => emit?.(event("user.message", { content: "迟到消息" })));
      expect(result.current.phase).toBe("ready");
      expect(result.current.messages.filter((item) => item.role === "user")).toHaveLength(1);
      expect(result.current.timer).toEqual({
        startedAt: 2_000,
        endedAt: 7_500,
        durationMs: 5_500,
      });
    } finally {
      now.mockRestore();
    }
  });

  it("prompt 响应先返回时继续接收事件直到 agent.settled", async () => {
    let resolvePrompt: ((finalSequence: number) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolvePrompt = resolve;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    act(() => {
      void result.current.sendPrompt("race");
    });
    await waitFor(() =>
      expect(promptAgent).toHaveBeenCalledWith("s-1", "race", undefined, defaultToolNames),
    );

    await act(async () => resolvePrompt?.(0));
    expect(result.current.phase).toBe("streaming");
    act(() => {
      emit?.(event("agent.started"));
      emit?.(event("message.delta", { delta: "late answer" }));
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("streaming");
      expect(result.current.messages.at(-1)?.content).toBe("late answer");
    });

    act(() => {
      emit?.(event("agent.settled"));
    });

    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });

  it("只应用完整有效的会话配置事件", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    await act(() => result.current.sendPrompt("materialize"));
    act(() => emit?.(event("agent.settled")));

    act(() => {
      emit?.(
        event("session.configurationChanged", {
          model: null,
          thinkingLevel: "off",
          availableThinkingLevels: ["off"],
        }),
      );
    });
    await waitFor(() =>
      expect(result.current.configuration).toEqual({
        model: null,
        thinkingLevel: "off",
        availableThinkingLevels: ["off"],
        availableTools: [],
        activeToolNames: [],
        defaultToolNames: [],
      }),
    );

    act(() => {
      emit?.(
        event("session.configurationChanged", {
          model: null,
          // A provider may report a current value that disappeared after a
          // model switch. The store must apply Pi's nearest-level fallback.
          thinkingLevel: "max",
          availableThinkingLevels: ["off", "high"],
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.configuration?.thinkingLevel).toBe("high");
      expect(result.current.configuration?.availableThinkingLevels).toEqual(["off", "high"]);
    });

    act(() => {
      emit?.(
        event("session.configurationChanged", {
          model: null,
          thinkingLevel: "ultra",
          availableThinkingLevels: [],
        }),
      );
    });
    expect(result.current.configuration?.thinkingLevel).toBe("high");
  });

  it("报告监听失败，并处理异步订阅晚于卸载的情况", async () => {
    vi.mocked(listenToAgentEvents).mockRejectedValueOnce(new Error("listen failed"));
    const failed = renderHook(() => useChatSession());
    await waitFor(() =>
      expect(failed.result.current.error).toBe("AGENT_EVENT_LISTEN_FAILED: listen failed"),
    );
    failed.unmount();

    let resolveListener: ((value: () => void) => void) | undefined;
    vi.mocked(listenToAgentEvents).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveListener = resolve;
        }),
    );
    const late = renderHook(() => useChatSession());
    late.unmount();
    await act(async () => resolveListener?.(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("可重连事件通道，并在中止后忽略迟到增量", async () => {
    vi.mocked(listenToAgentEvents)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockImplementationOnce(async (handler) => {
        emit = handler;
        return unlisten;
      });
    let resolveAbortedPrompt: ((finalSequence: number) => void) | undefined;
    vi.mocked(promptAgent).mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveAbortedPrompt = resolve;
        }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("error"));

    act(() => result.current.retryEventListener());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    act(() => {
      void result.current.sendPrompt("long task");
    });
    await waitFor(() => expect(result.current.phase).toBe("streaming"));
    act(() => emit?.(event("tool.started", { toolCallId: "tool-1", toolName: "bash" })));
    await act(() => result.current.abort());
    act(() => emit?.(event("message.delta", { delta: "late" })));
    await act(async () => resolveAbortedPrompt?.(nextSequence - 1));

    expect(result.current.phase).toBe("ready");
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "tool-1",
        toolName: "bash",
        status: "cancelled",
      }),
    );
  });

  it("切换会话后继续接收后台流式事件并保留独立投影", async () => {
    vi.mocked(promptAgent).mockImplementation(() => new Promise<number>(() => {}));
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    act(() => {
      void result.current.sendPrompt("后台任务");
    });
    await waitFor(() => expect(result.current.phase).toBe("streaming"));
    const running = result.current.sessions.find((session) => session.id === "s-1")!;

    await act(() => result.current.createSession("C:\\other"));
    const draft = result.current.sessions.find((session) => session.lifecycle === "draft")!;
    expect(result.current.sessionId).toBe(draft.id);
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(result.current.runningSessionIds).toContain("s-1");

    act(() => {
      emit?.(event("agent.started", undefined, "s-1"));
      emit?.(event("thinking.delta", { delta: "分析中" }, "s-1"));
      emit?.(event("message.delta", { delta: "后台完成" }, "s-1"));
      emit?.(event("agent.settled", undefined, "s-1"));
    });
    expect(result.current.sessionId).toBe(draft.id);

    await act(() => result.current.openSession(running));
    expect(openAgentSession).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "thinking", content: "分析中" }),
        expect.objectContaining({ role: "assistant", content: "后台完成" }),
      ]),
    );

    await act(() => result.current.openSession(draft));
    expect(result.current.sessionId).toBe(draft.id);
    expect(result.current.messages).toEqual([]);
    expect(openAgentSession).not.toHaveBeenCalled();
  });

  it("流式期间区分引导与后续队列，并以 SDK 队列事件为准", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    await act(() => result.current.sendPrompt("开始任务"));

    await act(() => result.current.sendPrompt("调整方向", "steer"));
    await act(() => result.current.sendPrompt("完成后总结", "followUp"));

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
    expect(result.current.messages.filter((item) => item.role === "user")).toHaveLength(1);
    expect(result.current.queuedMessages).toEqual({
      steering: ["调整方向"],
      followUp: ["完成后总结"],
    });

    act(() => {
      emit?.(
        event("queue.updated", {
          steering: ["SDK 引导"],
          followUp: ["SDK 后续"],
        }),
      );
    });
    await waitFor(() =>
      expect(result.current.queuedMessages).toEqual({
        steering: ["SDK 引导"],
        followUp: ["SDK 后续"],
      }),
    );

    await act(() => result.current.clearQueue());
    expect(clearAgentQueue).toHaveBeenCalledWith("s-1");
    expect(result.current.queuedMessages).toEqual({ steering: [], followUp: [] });
  });

  it("排队和清空失败时回滚队列，中止后保留暂停状态", async () => {
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.createSession("C:\\work"));
    await act(() => result.current.sendPrompt("开始任务"));

    vi.mocked(promptAgent).mockRejectedValueOnce(new Error("queue failed"));
    await act(() => result.current.sendPrompt("失败引导", "steer"));
    expect(result.current.phase).toBe("streaming");
    expect(result.current.queuedMessages).toEqual({ steering: [], followUp: [] });
    expect(result.current.messages.filter((item) => item.role === "user")).toHaveLength(1);

    act(() => {
      emit?.(event("queue.updated", { steering: ["保留消息"], followUp: [] }));
    });
    vi.mocked(clearAgentQueue).mockRejectedValueOnce(new Error("clear failed"));
    await act(() => result.current.clearQueue());
    expect(result.current.queuedMessages.steering).toEqual(["保留消息"]);
    expect(result.current.error).toBe("clear failed");

    await act(() => result.current.abort());
    expect(result.current.phase).toBe("ready");
    expect(result.current.queuePaused).toBe(true);

    act(() => {
      emit?.(event("queue.updated", { steering: [], followUp: [] }));
    });
    await waitFor(() => expect(result.current.queuePaused).toBe(false));
  });

  it("恢复带队列的非流式会话时展示暂停状态，并忽略畸形队列事件", async () => {
    vi.mocked(listAgentSessions).mockResolvedValueOnce([
      { ...savedSummary, id: "queued", path: "C:\\agent\\sessions\\queued.jsonl" },
    ]);
    vi.mocked(openAgentSession).mockResolvedValueOnce({
      sessionId: "queued",
      cwd: "C:\\work",
      sessionPath: "C:\\agent\\sessions\\queued.jsonl",
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
      queuedMessages: { steering: ["待继续"], followUp: [] },
      streaming: false,
    });
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.loadCatalogs());
    await act(() => result.current.openSession(result.current.sessions[0]!));

    expect(result.current.queuePaused).toBe(true);
    act(() => emit?.(event("queue.updated", { steering: [1], followUp: [] }, "queued")));
    expect(result.current.queuedMessages.steering).toEqual(["待继续"]);
    act(() => emit?.(event("agent.started", undefined, "queued")));
    await waitFor(() => expect(result.current.queuePaused).toBe(false));
  });

  it("切换到正式会话后可直接恢复未绑定草稿且不读取会话文件", async () => {
    vi.mocked(listAgentSessions).mockResolvedValueOnce([savedSummary]);
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.loadCatalogs());

    await act(() => result.current.createConversation());
    const draft = result.current.sessions.find((session) => session.lifecycle === "draft")!;
    expect(draft).toEqual(expect.objectContaining({ path: null, cwd: "" }));
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(ensureConversationWorkspace).not.toHaveBeenCalled();

    const persisted = result.current.sessions.find((session) => session.lifecycle === "persisted")!;
    await act(() => result.current.openSession(persisted));
    expect(openAgentSession).toHaveBeenCalledWith(savedSummary.path);
    await act(() => result.current.openSession(draft));

    expect(result.current.sessionId).toBe(draft.id);
    expect(result.current.sessionPath).toBeNull();
    expect(result.current.configuration).toBeNull();
    expect(result.current.error).toBeNull();
    expect(openAgentSession).toHaveBeenCalledTimes(1);
  });

  it("正式会话文件缺失时保留稳定异常处理", async () => {
    vi.mocked(listAgentSessions).mockResolvedValueOnce([savedSummary]);
    vi.mocked(openAgentSession).mockRejectedValueOnce({
      code: "SESSION_PATH_INVALID",
      message: "会话文件不存在或无法访问",
    });
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.loadCatalogs());

    let opened = true;
    await act(async () => {
      opened = await result.current.openSession(result.current.sessions[0]!);
    });

    expect(opened).toBe(false);
    expect(result.current.error).toBe("SESSION_PATH_INVALID: 会话文件不存在或无法访问");
  });

  it("保持已有正式会话之间的正常切换和加载", async () => {
    const secondSummary: AgentSessionSummary = {
      ...savedSummary,
      id: "second",
      path: "C:\\agent\\sessions\\second.jsonl",
      firstMessage: "second prompt",
      modified: "2026-08-21T09:00:00.000Z",
    };
    vi.mocked(listAgentSessions).mockResolvedValueOnce([savedSummary, secondSummary]);
    vi.mocked(openAgentSession)
      .mockResolvedValueOnce(
        agentSession({
          sessionId: "saved",
          sessionPath: savedSummary.path,
          messages: [{ role: "user", content: savedSummary.firstMessage }],
        }),
      )
      .mockResolvedValueOnce(
        agentSession({
          sessionId: "second",
          sessionPath: secondSummary.path,
          messages: [{ role: "user", content: secondSummary.firstMessage }],
        }),
      );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));
    await act(() => result.current.loadCatalogs());

    await act(() =>
      result.current.openSession(result.current.sessions.find((session) => session.id === "saved")!),
    );
    await act(() =>
      result.current.openSession(result.current.sessions.find((session) => session.id === "second")!),
    );

    expect(openAgentSession).toHaveBeenNthCalledWith(1, savedSummary.path);
    expect(openAgentSession).toHaveBeenNthCalledWith(2, secondSummary.path);
    expect(result.current.sessionId).toBe("second");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: "second prompt" }),
    ]);

    await act(() =>
      result.current.openSession(result.current.sessions.find((session) => session.id === "saved")!),
    );

    expect(openAgentSession).toHaveBeenCalledTimes(2);
    expect(result.current.sessionId).toBe("saved");
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: "user", content: savedSummary.firstMessage }),
    ]);
  });

  it("未绑定项目的草稿在首次发送后创建纯对话工作区并持久化", async () => {
    vi.mocked(createAgentSession).mockImplementationOnce(async (cwd) =>
      agentSession({
        cwd,
        sessionPath: "C:\\agent\\sessions\\conversation.jsonl",
      }),
    );
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    await act(() => result.current.createConversation());
    expect(result.current.cwd).toBe("");
    expect(result.current.sessionPath).toBeNull();
    expect(result.current.sessions[0]).toEqual(
      expect.objectContaining({ lifecycle: "draft", cwd: "", path: null }),
    );
    expect(ensureConversationWorkspace).not.toHaveBeenCalled();
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(rememberWorkspace).not.toHaveBeenCalled();

    await act(() => result.current.sendPrompt("开始"));
    expect(ensureConversationWorkspace).toHaveBeenCalledOnce();
    expect(createAgentSession).toHaveBeenCalledWith(
      "C:\\Users\\me\\Documents\\Pix\\conversations",
    );
    await waitFor(() =>
      expect(rememberWorkspace).toHaveBeenCalledWith(
        "C:\\Users\\me\\Documents\\Pix\\conversations",
      ),
    );

    await act(() => result.current.removeWorkspace("C:\\work"));
    expect(removeRecentWorkspace).toHaveBeenCalledWith("C:\\work");
  });

  it("移除最近项目失败时保留错误并向调用方抛出", async () => {
    vi.mocked(removeRecentWorkspace).mockRejectedValueOnce({
      code: "WORKSPACE_REMOVE_FAILED",
      message: "无法更新最近项目",
    });
    const { result } = renderHook(() => useChatSession());
    await waitFor(() => expect(result.current.eventConnection).toBe("ready"));

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.removeWorkspace("C:\\work");
      } catch (error) {
        rejection = error;
      }
    });
    expect(rejection).toEqual({
      code: "WORKSPACE_REMOVE_FAILED",
      message: "无法更新最近项目",
    });
    await waitFor(() =>
      expect(result.current.catalogError).toBe("WORKSPACE_REMOVE_FAILED: 无法更新最近项目"),
    );
  });
});

function event(
  name: AgentEvent["name"],
  data?: unknown,
  sessionId = "s-1",
): AgentEvent {
  return {
    v: 1,
    kind: "event",
    seq: nextSequence++,
    sessionId,
    name,
    ...(data === undefined ? {} : { data }),
  };
}
