import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../stores/useChatSession";
import { ConversationTimeline, formatSessionDuration } from "./ConversationTimeline";

describe("ConversationTimeline", () => {
  it("展示用户、回复、合并后的工具组与系统状态，并隐藏已结束思考", () => {
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
    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();
    expect(screen.queryByText("正在分析依赖")).not.toBeInTheDocument();
    const toolGroup = screen.getByText("已运行5个工具").closest("details");
    expect(toolGroup).not.toBeNull();
    expect(toolGroup).not.toHaveAttribute("open");
    fireEvent.click(toolGroup!.querySelector("summary")!);
    expect(screen.getByText("等待执行")).toBeInTheDocument();
    expect(screen.getAllByText("执行中").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("会话已恢复");
    expect(screen.getByRole("alert")).toHaveTextContent("请求失败");
  });

  it("流式思考直接显示为扫光文本，并在结束后移除", () => {
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

    expect(screen.getByText("逐步推理").closest(".timeline-thinking-text")).not.toBeNull();
    expect(screen.queryByText("思考中")).not.toBeInTheDocument();
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
    expect(screen.queryByText("逐步推理")).not.toBeInTheDocument();
    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();
  });

  it("没有思考增量时展示单一流式思考状态", () => {
    render(
      <ConversationTimeline
        messages={[{ id: "assistant", role: "assistant", content: "正在生成回复" }]}
        streaming
      />,
    );

    expect(screen.getByText("正在思考").closest(".timeline-thinking-text")).not.toBeNull();
    expect(screen.queryByText("Pi 正在处理")).not.toBeInTheDocument();
    expect(screen.getByText("正在思考").closest("[role='status']")).toHaveAttribute(
      "aria-live",
      "polite",
    );
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
    const group = container.querySelector(".timeline-tool-group details") as HTMLDetailsElement;
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("已使用 read")).toHaveAttribute("title", "已使用 read");
    fireEvent.click(group.querySelector("summary")!);
    expect(group).toHaveAttribute("open");
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
    expect(container.querySelector(".timeline-tool-group details")).toBe(group);
    expect(container.querySelectorAll(".timeline-tool")).toHaveLength(2);
    expect(group).toHaveAttribute("open");
    expect(updatedTool).toHaveAttribute("open");
    expect(updatedTool).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("region", { name: "read 调用详情" })).toBeInTheDocument();
    expect(screen.getByText("读取完成")).toBeInTheDocument();
    expect(screen.getByText("tool-1")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("思考内容复用 Markdown 渲染并隐藏原始强调标记", () => {
    render(
      <ConversationTimeline
        messages={[{ id: "thinking", role: "thinking", content: "**重点**" }]}
        streaming
      />,
    );

    expect(screen.getByText("重点").tagName).toBe("STRONG");
    expect(screen.queryByText("**重点**")).not.toBeInTheDocument();
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

  it("实时更新会话计时，并在结束后冻结显示", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-28T08:00:00.000Z"));
      const startedAt = Date.now();
      const { rerender, container } = render(
        <ConversationTimeline
          messages={[{ id: "user", role: "user", content: "开始" }]}
          streaming
          timer={{ startedAt, endedAt: null, durationMs: null }}
        />,
      );

      expect(formatSessionDuration(0)).toBe("0s");
      expect(screen.getByText("用时 0s")).toBeInTheDocument();
      expect(container.querySelector(".conversation-run-timer")).toHaveAttribute(
        "data-active",
        "true",
      );

      act(() => vi.advanceTimersByTime(2_100));
      expect(screen.getByText("用时 2s")).toBeInTheDocument();

      rerender(
        <ConversationTimeline
          messages={[{ id: "user", role: "user", content: "开始" }]}
          streaming={false}
          timer={{ startedAt, endedAt: startedAt + 3_500, durationMs: 3_500 }}
        />,
      );
      expect(screen.getByText("用时 3s")).toBeInTheDocument();
      expect(container.querySelector(".conversation-run-timer")).not.toHaveAttribute(
        "data-active",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("为每个用户回合独立显示对应的计时", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(5_000);
      const firstTimer = { startedAt: 1_000, endedAt: 3_500, durationMs: 2_500 };
      const secondTimer = { startedAt: 5_000, endedAt: null, durationMs: null };
      const { container } = render(
        <ConversationTimeline
          messages={[
            { id: "user-1", role: "user", content: "第一问", timer: firstTimer },
            { id: "assistant-1", role: "assistant", content: "第一答" },
            { id: "user-2", role: "user", content: "第二问", timer: secondTimer },
            { id: "assistant-2", role: "assistant", content: "第二答" },
          ]}
          streaming
        />,
      );

      const turns = container.querySelectorAll(".timeline-turn");
      expect(turns).toHaveLength(2);
      expect(turns[0]?.querySelector(".conversation-run-timer")).toHaveTextContent("用时 2s");
      expect(turns[0]?.querySelector(".conversation-run-timer")).not.toHaveAttribute("data-active");
      expect(turns[1]?.querySelector(".conversation-run-timer")).toHaveTextContent("用时 0s");
      expect(turns[1]?.querySelector(".conversation-run-timer")).toHaveAttribute(
        "data-active",
        "true",
      );
      expect(turns[0]?.querySelector(".timeline-user")?.compareDocumentPosition(
        turns[0]?.querySelector(".conversation-run-timer")!,
      )).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    } finally {
      vi.useRealTimers();
    }
  });

  it("在下一回合尚未收到用户事件时使用新的活动计时", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(5_000);
      const { container } = render(
        <ConversationTimeline
          messages={[
            {
              id: "user-1",
              role: "user",
              content: "上一问",
              timer: { startedAt: 1_000, endedAt: 3_000, durationMs: 2_000 },
            },
            { id: "assistant-1", role: "assistant", content: "上一答" },
          ]}
          streaming
          timer={{ startedAt: 5_000, endedAt: null, durationMs: null }}
        />,
      );

      const timer = container.querySelector(".conversation-run-timer");
      expect(timer).toHaveTextContent("用时 0s");
      expect(timer).toHaveAttribute("data-active", "true");
    } finally {
      vi.useRealTimers();
    }
  });
});
