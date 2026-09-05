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

  it("将多个思考消息和段落合并到单一区域并按顺序循环轮播", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ConversationTimeline
          messages={[
            { id: "thinking-1", role: "thinking", content: "第一段思考\n\n第二段思考" },
            {
              id: "tool",
              role: "tool",
              content: "",
              toolName: "read",
              toolCallId: "tool-1",
              status: "completed",
            },
            { id: "thinking-2", role: "thinking", content: "第三段思考" },
          ]}
          streaming
        />,
      );

      const thinkingRegion = container.querySelector(".timeline-thinking-inline");
      expect(container.querySelectorAll(".timeline-thinking-inline")).toHaveLength(1);
      expect(container.querySelectorAll(".timeline-thinking-text")).toHaveLength(1);
      expect(thinkingRegion).toHaveAttribute("data-thinking-count", "3");
      expect(screen.getByText("第一段思考")).toBeInTheDocument();
      expect(screen.queryByText("第二段思考")).not.toBeInTheDocument();
      expect(screen.queryByText("第三段思考")).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(3_000));
      expect(screen.queryByText("第一段思考")).not.toBeInTheDocument();
      expect(screen.getByText("第二段思考")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(3_000));
      expect(screen.getByText("第三段思考")).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(3_000));
      expect(screen.getByText("第一段思考")).toBeInTheDocument();
      expect(container.querySelectorAll(".timeline-thinking-text")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
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

  it("工具状态更新复用同一节点、保留展开状态并展示可复制的参数与结果", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { container, rerender } = render(
      <ConversationTimeline
        messages={[
          {
            id: "tool",
            role: "tool",
            content: "",
            toolName: "read",
            toolCallId: "tool-1",
            toolInput: {
              text: '{\n  "path": "C:\\\\work\\\\README.md"\n}',
              format: "json",
              truncated: false,
            },
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
            content: "",
            toolName: "read",
            toolCallId: "tool-1",
            toolInput: {
              text: '{\n  "path": "C:\\\\work\\\\README.md"\n}',
              format: "json",
              truncated: false,
            },
            toolOutput: {
              text: "读取完成",
              format: "text",
              truncated: true,
            },
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
    expect(screen.getByText("调用参数")).toBeInTheDocument();
    expect(screen.getByText("执行结果")).toBeInTheDocument();
    expect(screen.getByText("C:\\work\\README.md")).toBeInTheDocument();
    expect(screen.getByText("读取完成")).toBeInTheDocument();
    expect(screen.getByText("已截断")).toBeInTheDocument();
    expect(screen.queryByText("tool-1")).not.toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制执行结果" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("读取完成"));
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

  it("流式增量不重新读取未变化历史回合的正文", () => {
    const readHistory = vi.fn(() => "已经完成的历史回复");
    const historyAssistant: ChatMessage = {
      id: "assistant-1",
      role: "assistant",
      get content() {
        return readHistory();
      },
    };
    const messages: ChatMessage[] = [
      { id: "user-1", role: "user", content: "第一问" },
      historyAssistant,
      { id: "user-2", role: "user", content: "第二问" },
      { id: "assistant-2", role: "assistant", content: "正在输出" },
    ];
    const { rerender } = render(<ConversationTimeline messages={messages} streaming />);
    expect(readHistory).toHaveBeenCalled();
    readHistory.mockClear();

    rerender(
      <ConversationTimeline
        messages={[
          ...messages.slice(0, -1),
          { id: "assistant-2", role: "assistant", content: "正在输出新的内容" },
        ]}
        streaming
      />,
    );

    expect(screen.getByText("正在输出新的内容")).toBeVisible();
    expect(screen.getByText("已经完成的历史回复")).toBeVisible();
    expect(readHistory).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "复制本轮回复" })).toHaveLength(1);
  });

  it("替换同一历史消息时更新正文和本轮复制内容", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const messages: ChatMessage[] = [
      { id: "user-1", role: "user", content: "第一问" },
      { id: "assistant-1", role: "assistant", content: "原始回复" },
      { id: "user-2", role: "user", content: "第二问" },
      { id: "assistant-2", role: "assistant", content: "正在输出" },
    ];
    const { rerender } = render(<ConversationTimeline messages={messages} streaming />);

    rerender(
      <ConversationTimeline
        messages={messages.map((message) =>
          message.id === "assistant-1" ? { ...message, content: "更新后的回复" } : message,
        )}
        streaming
      />,
    );

    expect(screen.queryByText("原始回复")).not.toBeInTheDocument();
    expect(screen.getByText("更新后的回复")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "复制本轮回复" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("更新后的回复"));
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
      expect(screen.getByText("已处理 0s")).toBeInTheDocument();
      expect(
        container.querySelector(".conversation-run-timer")?.closest("details"),
      ).toHaveAttribute(
        "data-active",
        "true",
      );

      act(() => vi.advanceTimersByTime(2_100));
      expect(screen.getByText("已处理 2s")).toBeInTheDocument();

      rerender(
        <ConversationTimeline
          messages={[{ id: "user", role: "user", content: "开始" }]}
          streaming={false}
          timer={{ startedAt, endedAt: startedAt + 3_500, durationMs: 3_500 }}
        />,
      );
      expect(screen.getByText("已处理 3s")).toBeInTheDocument();
      expect(container.querySelector(".conversation-run-timer")).not.toHaveAttribute(
        "data-active",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("完成回合默认折叠过程，仅保留最终结论并可展开查看过程", () => {
    const { container } = render(
      <ConversationTimeline
        messages={[
          {
            id: "user",
            role: "user",
            content: "检查实现",
            timer: { startedAt: 1_000, endedAt: 3_500, durationMs: 2_500 },
          },
          { id: "progress", role: "assistant", content: "正在检查相关模块" },
          {
            id: "tool",
            role: "tool",
            content: "中间工具结果",
            toolName: "read",
            status: "completed",
          },
          { id: "system", role: "system", content: "中间系统状态", status: "completed" },
          { id: "final", role: "assistant", content: "最终结论" },
        ]}
        streaming={false}
      />,
    );

    const process = container.querySelector("details.conversation-process") as HTMLDetailsElement;
    expect(process).toBeInTheDocument();
    expect(process).not.toHaveAttribute("open");
    const summary = process.querySelector("summary")!;
    expect(summary).toHaveTextContent("已处理 2s");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(summary).toHaveAccessibleName("已处理 2s，展开处理过程");
    expect(screen.getByText("最终结论")).toBeVisible();
    expect(screen.queryByText("正在检查相关模块")).not.toBeInTheDocument();
    expect(screen.queryByText("已使用 read")).not.toBeInTheDocument();
    expect(screen.queryByText("中间系统状态")).not.toBeInTheDocument();
    expect(process.querySelector(".markdown-content")).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(process).toHaveAttribute("open");
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(summary).toHaveAccessibleName("已处理 2s，折叠处理过程");
    expect(screen.getByText("正在检查相关模块")).toBeVisible();
    expect(screen.getByText("已使用 read")).toBeVisible();
    expect(screen.getByText("中间系统状态")).toBeVisible();

    const tools = screen.getByText("已使用 read").closest("details")!;
    fireEvent.click(tools.querySelector("summary")!);
    const tool = container.querySelector("details.timeline-tool")!;
    fireEvent.click(tool.querySelector("summary")!);
    expect(screen.getByText("中间工具结果")).toBeVisible();

    fireEvent.click(summary);
    expect(screen.getByText("中间工具结果")).not.toBeVisible();
    fireEvent.click(summary);
    expect(screen.getByText("中间工具结果")).toBeVisible();
    expect(container.querySelector("details.timeline-tool")).toBe(tool);
  });

  it("各完成回合的过程展开状态相互独立", () => {
    const { container } = render(
      <ConversationTimeline
        messages={[
          {
            id: "user-1",
            role: "user",
            content: "第一问",
            timer: { startedAt: 1_000, endedAt: 3_000, durationMs: 2_000 },
          },
          { id: "progress-1", role: "assistant", content: "第一轮过程" },
          { id: "final-1", role: "assistant", content: "第一轮结论" },
          {
            id: "user-2",
            role: "user",
            content: "第二问",
            timer: { startedAt: 4_000, endedAt: 7_000, durationMs: 3_000 },
          },
          { id: "progress-2", role: "assistant", content: "第二轮过程" },
          { id: "final-2", role: "assistant", content: "第二轮结论" },
        ]}
        streaming={false}
      />,
    );

    const processes = container.querySelectorAll("details.conversation-process");
    expect(processes).toHaveLength(2);
    expect(processes[0]).not.toHaveAttribute("open");
    expect(processes[1]).not.toHaveAttribute("open");

    fireEvent.click(processes[0]!.querySelector("summary")!);
    expect(processes[0]).toHaveAttribute("open");
    expect(processes[1]).not.toHaveAttribute("open");
    expect(screen.getByText("第一轮过程")).toBeVisible();
    expect(screen.queryByText("第二轮过程")).not.toBeInTheDocument();
  });

  it("活动回合默认展开，并在结束后自动折叠过程", () => {
    const activeTimer = { startedAt: 1_000, endedAt: null, durationMs: null };
    const { container, rerender } = render(
      <ConversationTimeline
        messages={[
          { id: "user", role: "user", content: "进行中的问题", timer: activeTimer },
          { id: "progress", role: "assistant", content: "进行中的过程" },
          { id: "final", role: "assistant", content: "进行中的结论" },
        ]}
        streaming
      />,
    );

    const process = container.querySelector("details.conversation-process") as HTMLDetailsElement;
    expect(process).toHaveAttribute("open");
    expect(screen.getByText("进行中的过程")).toBeVisible();

    rerender(
      <ConversationTimeline
        messages={[
          {
            id: "user",
            role: "user",
            content: "进行中的问题",
            timer: { startedAt: 1_000, endedAt: 3_000, durationMs: 2_000 },
          },
          { id: "progress", role: "assistant", content: "进行中的过程" },
          { id: "final", role: "assistant", content: "进行中的结论" },
        ]}
        streaming={false}
      />,
    );

    expect(process).not.toHaveAttribute("open");
    expect(screen.getByText("进行中的结论")).toBeVisible();
    expect(screen.getByText("进行中的过程")).not.toBeVisible();
  });

  it("错误回合没有最终结论时保留静态计时和错误信息", () => {
    const { container } = render(
      <ConversationTimeline
        messages={[
          {
            id: "user",
            role: "user",
            content: "会失败的问题",
            timer: { startedAt: 1_000, endedAt: 3_500, durationMs: 2_500 },
          },
          { id: "error", role: "system", content: "请求失败", status: "failed" },
        ]}
        streaming={false}
      />,
    );

    expect(container.querySelector("details.conversation-process")).not.toBeInTheDocument();
    expect(container.querySelector(".conversation-run-timer")).toHaveTextContent("已处理 2s");
    expect(screen.getByRole("alert")).toHaveTextContent("请求失败");
  });

  it("部分回复后失败时不折叠错误信息", () => {
    const { container } = render(
      <ConversationTimeline
        messages={[
          {
            id: "user",
            role: "user",
            content: "会在输出后失败的问题",
            timer: { startedAt: 1_000, endedAt: 3_500, durationMs: 2_500 },
          },
          { id: "partial", role: "assistant", content: "尚未完成的回复" },
          { id: "error", role: "system", content: "连接意外中断", status: "failed" },
        ]}
        streaming={false}
      />,
    );

    expect(container.querySelector("details.conversation-process")).not.toBeInTheDocument();
    expect(container.querySelector(".conversation-run-timer")).toHaveTextContent("已处理 2s");
    expect(screen.getByText("尚未完成的回复")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("连接意外中断");
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
      expect(turns[0]?.querySelector(".conversation-run-timer")).toHaveTextContent(
        "已处理 2s",
      );
      expect(turns[0]?.querySelector(".conversation-run-timer")).not.toHaveAttribute("data-active");
      expect(turns[1]?.querySelector(".conversation-run-timer")).toHaveTextContent("已处理 0s");
      expect(
        turns[1]?.querySelector(".conversation-run-timer")?.closest("details"),
      ).toHaveAttribute(
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
      expect(timer).toHaveTextContent("已处理 0s");
      expect(timer?.closest("details")).toHaveAttribute("data-active", "true");
    } finally {
      vi.useRealTimers();
    }
  });
});
