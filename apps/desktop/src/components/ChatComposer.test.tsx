import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer } from "./ChatComposer";

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
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={onSend}
        onAbort={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "选择模型" })).toBeDisabled();
    expect(screen.getByText("无可用模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择思考强度" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
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
        }}
        configuring={false}
        canSend
        onDraftChange={vi.fn()}
        onModelChange={onModelChange}
        onThinkingLevelChange={onThinkingLevelChange}
        onSend={onSend}
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
        }}
        configuring={false}
        canSend
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(screen.getByRole("menu", { name: "模型列表" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "模型列表" })).not.toBeInTheDocument();
  });
});
