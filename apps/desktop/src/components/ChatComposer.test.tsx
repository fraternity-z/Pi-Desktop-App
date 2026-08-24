import { fireEvent, render, screen } from "@testing-library/react";
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
  it("无 SDK 配置时禁用选择器和空内容发送", () => {
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

    expect(screen.getByRole("button", { name: "选择模型" })).toBeDisabled();
    expect(screen.getByText("无可用模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择思考强度" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "选择工具权限" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("menuitemradio", { name: "深度思考" }));
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
        onThinkingLevelChange={vi.fn()}
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

  it("展示 SDK 工具权限并支持预设、逐项切换与取消菜单", () => {
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
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /浏览目录/ }));
    expect(onToolSelectionChange).toHaveBeenLastCalledWith([...defaultToolNames, "ls"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问/ }));
    expect(onToolSelectionChange).toHaveBeenLastCalledWith(availableTools.map((tool) => tool.name));

    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "工具权限" })).not.toBeInTheDocument();
    expect(onUseDefaultTools).not.toHaveBeenCalled();
  });
});
