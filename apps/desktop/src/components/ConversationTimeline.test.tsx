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

  it("流式思考跨工具调用保持展开且不重复展示处理状态，并在结束后收起", () => {
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
    expect(screen.queryByText("Pi 正在处理")).not.toBeInTheDocument();

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

  it("没有活动思考块时展示单一流式处理状态", () => {
    render(
      <ConversationTimeline
        messages={[{ id: "assistant", role: "assistant", content: "正在生成回复" }]}
        streaming
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Pi 正在处理");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("button", { name: "复制本轮回复" })).not.toBeInTheDocument();
    expect(screen.getByText("正在生成回复").closest(".message-stream")).toHaveAttribute(
      "aria-busy",
      "true",
    );
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
    const activityGroup = container.querySelector(".timeline-activity-group");
    expect(tool).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("read")).toHaveAttribute("title", "read");
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
          {
            id: "tool-2",
            role: "tool",
            content: "",
            toolName: "search",
            status: "running",
          },
        ]}
        streaming={false}
      />,
    );

    const updatedTool = container.querySelector(".timeline-tool");
    expect(updatedTool).toBe(tool);
    expect(container.querySelector(".timeline-activity-group")).toBe(activityGroup);
    expect(container.querySelectorAll(".timeline-activity-group")).toHaveLength(1);
    expect(container.querySelectorAll(".timeline-tool")).toHaveLength(2);
    expect(updatedTool).toHaveAttribute("open");
    expect(updatedTool).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("region", { name: "read 调用详情" })).toBeInTheDocument();
    expect(screen.getByText("读取完成")).toBeInTheDocument();
    expect(screen.getByText("tool-1")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("仅在整轮输出完成后提供一个复制按钮，并排除工具、思考和系统内容", async () => {
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
        messages={[
          { id: "user", role: "user", content: "检查项目" },
          { id: "assistant-1", role: "assistant", content: "第一段回复" },
          {
            id: "tool",
            role: "tool",
            content: "不应复制的工具结果",
            toolName: "read",
            toolCallId: "tool-1",
            status: "completed",
          },
          { id: "thinking", role: "thinking", content: "不应复制的思考内容" },
          { id: "assistant-2", role: "assistant", content: "第二段回复" },
          { id: "system", role: "system", content: "不应复制的系统状态" },
        ]}
        streaming={false}
      />,
    );

    const copyButton = screen.getByRole("button", { name: "复制本轮回复" });
    expect(screen.getAllByRole("button", { name: "复制本轮回复" })).toHaveLength(1);
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("第一段回复\n\n第二段回复"));
    expect(copyButton).toHaveAccessibleName("回复已复制");
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(copyButton).toHaveAccessibleName("复制本轮回复"));
  });

  it("流式追加新一轮时只保留已完成历史轮次的复制按钮", () => {
    render(
      <ConversationTimeline
        messages={[
          { id: "user-1", role: "user", content: "第一问" },
          { id: "assistant-1", role: "assistant", content: "第一轮回复" },
          { id: "user-2", role: "user", content: "第二问" },
          { id: "assistant-2", role: "assistant", content: "正在输出第二轮" },
        ]}
        streaming
      />,
    );

    expect(screen.getAllByRole("button", { name: "复制本轮回复" })).toHaveLength(1);
  });
});
