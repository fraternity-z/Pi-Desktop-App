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

    expect(screen.getByLabelText("模型")).toBeDisabled();
    expect(screen.getByRole("option", { name: "无可用模型" })).toBeInTheDocument();
    expect(screen.getByLabelText("思考强度")).toBeDisabled();
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

    fireEvent.change(screen.getByLabelText("模型"), {
      target: { value: "anthropic\u0000claude" },
    });
    expect(onModelChange).toHaveBeenCalledWith("anthropic", "claude");
    fireEvent.change(screen.getByLabelText("思考强度"), { target: { value: "high" } });
    expect(onThinkingLevelChange).toHaveBeenCalledWith("high");

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });
});
