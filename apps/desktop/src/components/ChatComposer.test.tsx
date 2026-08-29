import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer, isImeCompositionEvent } from "./ChatComposer";

const availableTools = [
  { name: "read", description: "Read files" },
  { name: "bash", description: "Run commands" },
  { name: "edit", description: "Edit files" },
  { name: "write", description: "Write files" },
  { name: "grep", description: "Search contents" },
  { name: "find", description: "Find files" },
  { name: "ls", description: "List directories" },
];
const defaultToolNames = ["read", "bash", "edit", "write"];
const toolConfiguration = {
  availableTools,
  activeToolNames: defaultToolNames,
  defaultToolNames,
};
const permissionProps = {
  permissionMode: "default" as const,
  availableTools,
  selectedToolNames: defaultToolNames,
  defaultToolNames,
  onUseDefaultTools: vi.fn(),
  onToolSelectionChange: vi.fn(),
};

describe("ChatComposer", () => {
  it("无 SDK 配置时保留模型错误入口并禁用依赖会话的操作", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        availableTools={[]}
        selectedToolNames={[]}
        defaultToolNames={[]}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={onSend}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    const modelTrigger = screen.getByRole("button", { name: "选择模型" });
    expect(modelTrigger).toBeEnabled();
    fireEvent.click(modelTrigger);
    expect(screen.getByText("当前 Pi 配置中没有可用模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择思考强度" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择工具权限" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    const emptyMeter = screen.getByRole("meter", { name: "上下文占用量" });
    expect(emptyMeter).not.toHaveAttribute("aria-valuenow");
    expect(emptyMeter.querySelector(".composer-context-ring-track")).toBeInTheDocument();
    expect(emptyMeter.querySelector(".composer-context-ring-progress")).not.toBeInTheDocument();
  });

  it("会话配置尚未生成时仍展示并允许选择真实模型目录", () => {
    const onModelChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={onModelChange}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    expect(screen.getByText("GPT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "GPT" }));
    expect(onModelChange).toHaveBeenCalledWith("openai", "gpt");
  });

  it("新草稿可复用最近一次 SDK 工具清单调整权限", () => {
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "选择工具权限" });
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "工具权限" })).toBeInTheDocument();
  });

  it("按需准备草稿的权限和思考配置，并即时展示加载反馈", () => {
    const onPrepareConfiguration = vi.fn(async () => true);
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        availableTools={[]}
        selectedToolNames={[]}
        defaultToolNames={[]}
        onPrepareConfiguration={onPrepareConfiguration}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    expect(onPrepareConfiguration).toHaveBeenCalledOnce();
    expect(screen.getByText("正在读取权限")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.click(screen.getByRole("button", { name: "选择思考强度" }));
    expect(onPrepareConfiguration).toHaveBeenCalledTimes(2);
    expect(screen.getByText("正在读取思考强度")).toBeInTheDocument();
  });

  it("模型目录异常时显示真实错误并允许重试", () => {
    const onRetryModels = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        catalogPhase="error"
        catalogError="MODEL_LIST_FAILED: 无法读取模型"
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onRetryModels={onRetryModels}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(screen.getByText("MODEL_LIST_FAILED: 无法读取模型")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(onRetryModels).toHaveBeenCalledOnce();
  });

  it("项目、上下文与扩展资源入口使用真实状态并回传操作", async () => {
    const onProjectChange = vi.fn();
    const onAddProject = vi.fn();
    const onAddFiles = vi.fn();
    const onAddFolder = vi.fn();
    const onAttachPath = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onSearchWorkspacePaths = vi.fn(async () => [
      {
        path: "C:\\work\\src\\main.ts",
        relativePath: "src/main.ts",
        kind: "file" as const,
      },
    ]);
    render(
      <ChatComposer
        workspaceName="work"
        workspacePath="C:\\work"
        recentWorkspaces={["C:\\work", "C:\\other"]}
        branchName="main"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium"],
          ...toolConfiguration,
        }}
        configuring={false}
        contextUsage={{ tokens: 2_048, contextWindow: 8_192, percent: 25 }}
        attachments={["C:\\work\\README.md"]}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onProjectChange={onProjectChange}
        onAddProject={onAddProject}
        onAddFiles={onAddFiles}
        onAddFolder={onAddFolder}
        onSearchWorkspacePaths={onSearchWorkspacePaths}
        onAttachPath={onAttachPath}
        onRemoveAttachment={onRemoveAttachment}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    const contextMeter = screen.getByRole("meter", { name: "上下文占用量" });
    expect(contextMeter).toHaveAttribute("aria-valuenow", "25");
    expect(contextMeter).toHaveAttribute("data-context-percent", "25");
    expect(contextMeter.querySelector(".composer-context-ring-progress")).toHaveAttribute(
      "stroke-dashoffset",
      "75",
    );
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /other/ }));
    expect(onProjectChange).toHaveBeenCalledWith("C:\\other");

    fireEvent.click(screen.getByRole("button", { name: "添加文件或文件夹" }));
    await waitFor(() => expect(onSearchWorkspacePaths).toHaveBeenCalledWith(""));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /main\.ts/ }));
    expect(onAttachPath).toHaveBeenCalledWith("C:\\work\\src\\main.ts");
    fireEvent.click(screen.getByRole("menuitem", { name: "添加文件本地" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加文件夹本地" }));
    expect(onAddFiles).toHaveBeenCalledOnce();
    expect(onAddFolder).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "移除 README.md" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("C:\\work\\README.md");

    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加项目" }));
    expect(onAddProject).toHaveBeenCalledOnce();
  });

  it("同步有效模型和思考强度，并保护组合输入与换行快捷键", () => {
    const onSend = vi.fn();
    const onModelChange = vi.fn();
    const onThinkingLevelChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="执行检查"
        phase="ready"
        eventConnection="ready"
        models={[
          { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          { provider: "anthropic", id: "claude", name: "Claude", reasoning: true },
        ]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium", "high"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={onModelChange}
        onThinkingLevelChange={onThinkingLevelChange}
        onSend={onSend}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Claude" }));
    expect(onModelChange).toHaveBeenCalledWith("anthropic", "claude");
    fireEvent.click(screen.getByRole("button", { name: "选择思考强度" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "High" }));
    expect(onThinkingLevelChange).toHaveBeenCalledWith("high");

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("按 Escape 关闭已打开的配置菜单", () => {
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="执行检查"
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium", "high"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(screen.getByRole("menu", { name: "模型列表" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "模型列表" })).not.toBeInTheDocument();
  });

  it("将模型和思考强度菜单渲染到顶层，避免被输入框裁切", () => {
    const onThinkingLevelChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[
          { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          { provider: "openai", id: "gpt-next", name: "GPT Next", reasoning: true },
        ]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "high",
          availableThinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={onThinkingLevelChange}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    const modelMenu = screen.getByRole("menu", { name: "模型列表" });
    expect(modelMenu.parentElement).toBe(document.body);
    expect(modelMenu).toHaveAttribute("data-floating-menu");

    fireEvent.click(screen.getByRole("button", { name: "选择思考强度" }));
    const thinkingMenu = screen.getByRole("menu", { name: "思考强度列表" });
    expect(thinkingMenu.parentElement).toBe(document.body);
    expect(thinkingMenu).toHaveAttribute("data-floating-menu");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(7);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Max" }));
    expect(onThinkingLevelChange).toHaveBeenCalledWith("max");
  });

  it("流式阶段允许追加输入并提供停止操作", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="追加检查"
        phase="streaming"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium", "high"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: ["已有引导"], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={onSend}
        onClearQueue={vi.fn()}
        onAbort={onAbort}
      />,
    );

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    expect(textarea).toBeEnabled();
    expect(textarea).toHaveAttribute("placeholder", "继续输入可加入后续队列");
    expect(screen.queryByText("Pi 正在处理")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择模型" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择思考强度" })).toBeDisabled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    expect(onSend).toHaveBeenNthCalledWith(1, undefined, "steer");
    expect(onSend).toHaveBeenNthCalledWith(2, undefined, "followUp");
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("兼容 keyCode 229 的输入法组合事件", () => {
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeCompositionEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("展示 Pix 三档 SDK 工具权限并支持切换与取消菜单", () => {
    const onUseDefaultTools = vi.fn();
    const onToolSelectionChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="执行检查"
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onUseDefaultTools={onUseDefaultTools}
        onToolSelectionChange={onToolSelectionChange}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    expect(screen.getByRole("menu", { name: "工具权限" }).parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /自动审核/ }));
    expect(onToolSelectionChange).toHaveBeenLastCalledWith(["read", "grep", "find", "ls"]);
    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问/ }));
    expect(onToolSelectionChange).toHaveBeenLastCalledWith(availableTools.map((tool) => tool.name));

    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "工具权限" })).not.toBeInTheDocument();
    expect(onUseDefaultTools).not.toHaveBeenCalled();
  });
});
