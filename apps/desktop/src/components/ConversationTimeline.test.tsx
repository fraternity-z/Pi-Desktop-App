import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../stores/useChatSession";
import { ConversationTimeline } from "./ConversationTimeline";

describe("ConversationTimeline", () => {
  it("展示用户、回复、思考、工具与系统状态", () => {
    const messages: ChatMessage[] = [
      { id: "user", role: "user", content: "检查项目" },
      { id: "assistant", role: "assistant", content: "检查完成" },
      { id: "empty", role: "assistant", content: "" },
      { id: "thinking", role: "thinking", content: "正在分析依赖" },
      { id: "running", role: "tool", content: "", toolName: "read", status: "running" },
      { id: "completed", role: "tool", content: "", toolName: "search", status: "completed" },
      { id: "failed", role: "tool", content: "", toolName: "build", status: "failed" },
      { id: "cancelled", role: "tool", content: "", toolName: "test", status: "cancelled" },
      { id: "system", role: "system", content: "会话已恢复", status: "completed" },
      { id: "error", role: "system", content: "请求失败", status: "failed" },
    ];

    render(<ConversationTimeline messages={messages} streaming={false} />);

    expect(screen.getByText("检查项目")).toBeInTheDocument();
    expect(screen.getByText("检查完成")).toBeInTheDocument();
    expect(screen.getByText("本次任务没有返回文本。")).toBeInTheDocument();
    expect(screen.getByText("思考过程")).toBeInTheDocument();
    expect(screen.getByText("正在分析依赖")).toBeInTheDocument();
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("会话已恢复");
    expect(screen.getByRole("alert")).toHaveTextContent("请求失败");
  });

  it("流式思考默认展开并展示处理状态", () => {
    render(
      <ConversationTimeline
        messages={[{ id: "thinking", role: "thinking", content: "逐步推理" }]}
        streaming
      />,
    );

    expect(screen.getByText("思考中").closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("status")).toHaveTextContent("Pi 正在处理");
  });

  it("复制回复成功后显示确认状态，失败时恢复复制按钮", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("clipboard unavailable"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <ConversationTimeline
        messages={[{ id: "assistant", role: "assistant", content: "可复制内容" }]}
        streaming={false}
      />,
    );

    const copyButton = screen.getByRole("button", { name: "复制回复" });
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("可复制内容"));
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(copyButton).toBeInTheDocument();
  });
});
