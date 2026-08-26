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
      { id: "pending", role: "tool", content: "", toolName: "list" },
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
    expect(screen.getByText("等待执行")).toBeInTheDocument();
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("会话已恢复");
    expect(screen.getByRole("alert")).toHaveTextContent("请求失败");
  });

  it("流式思考跨工具调用保持展开，并在流式结束后收起", () => {
    const { rerender } = render(
      <ConversationTimeline
        messages={[
          { id: "thinking", role: "thinking", content: "逐步推理" },
          {
            id: "tool",
            role: "tool",
            content: "",
            toolName: "read",
            toolCallId: "tool-1",
            status: "running",
          },
        ]}
        streaming
      />,
    );

    expect(screen.getByText("思考中").closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("status")).toHaveTextContent("Pi 正在处理");

    rerender(
      <ConversationTimeline
        messages={[
          { id: "thinking", role: "thinking", content: "逐步推理" },
          {
            id: "tool",
            role: "tool",
            content: "",
            toolName: "read",
            toolCallId: "tool-1",
            status: "completed",
          },
        ]}
        streaming={false}
      />,
    );
    expect(screen.getByText("思考过程").closest("details")).not.toHaveAttribute("open");
  });

  it("工具状态更新复用同一节点并保留展开状态", () => {
    const { container, rerender } = render(
      <ConversationTimeline
        messages={[
          {
            id: "tool",
            role: "tool",
            content: "",
            toolName: "read",
            toolCallId: "tool-1",
            status: "running",
          },
        ]}
        streaming
      />,
    );
    const tool = container.querySelector(".timeline-tool") as HTMLDetailsElement;
    fireEvent.click(tool.querySelector("summary")!);
    expect(tool).toHaveAttribute("open");

    rerender(
      <ConversationTimeline
        messages={[
          {
            id: "tool",
            role: "tool",
            content: "读取完成",
            toolName: "read",
            toolCallId: "tool-1",
            status: "completed",
          },
        ]}
        streaming={false}
      />,
    );

    const updatedTool = container.querySelector(".timeline-tool");
    expect(updatedTool).toBe(tool);
    expect(updatedTool).toHaveAttribute("open");
    expect(screen.getByText("读取完成")).toBeInTheDocument();
    expect(screen.getByText("tool-1")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
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
