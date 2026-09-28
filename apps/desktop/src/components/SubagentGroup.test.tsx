import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SubagentSnapshot } from "../ipc/agent";
import { ConversationTimeline } from "./ConversationTimeline";
import { SubagentGroup } from "./SubagentGroup";
import { SubagentTranscriptPanel } from "./SubagentTranscriptPanel";
import { readSubagentTranscript } from "../ipc/subagentTranscript";
vi.mock("../ipc/subagentTranscript", () => ({ readSubagentTranscript: vi.fn() }));

const agent: SubagentSnapshot = { id: "tool:0", agent: "reviewer", task: "检查页面布局", model: "test-model", status: "running", turns: 2, messages: [], truncated: false };

describe("子代理显示", () => {
  it("显示真实任务与模型，支持选择和折叠", () => {
    const onOpen = vi.fn();
    render(<SubagentGroup subagents={[agent]} onOpen={onOpen} selectedId={agent.id} />);
    expect(screen.getByText("主 Agent")).toBeInTheDocument();
    expect(screen.getByText("test-model")).toBeInTheDocument();
    const card = screen.getByRole("button", { name: /reviewer.*检查页面布局/ });
    expect(card).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(agent.id);
    const toggle = screen.getAllByRole("button").find((button) => button.hasAttribute("aria-expanded"))!;
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("时间线保留独立工具组并刷新选中状态", () => {
    const messages = [{ id: "tool", role: "tool" as const, content: "", toolName: "subagent", subagents: [agent] }];
    const onOpen = vi.fn();
    const { rerender } = render(<ConversationTimeline messages={messages} streaming={false} onOpenSubagent={onOpen} />);
    rerender(<ConversationTimeline messages={messages} streaming={false} onOpenSubagent={onOpen} selectedSubagentId={agent.id} />);
    expect(screen.getByRole("button", { name: /reviewer.*检查页面布局/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("只读会话显示空态、实时结果和截断提示", () => {
    const { rerender } = render(<SubagentTranscriptPanel subagent={agent} />);
    expect(screen.getByText("检查页面布局")).toBeInTheDocument();
    expect(screen.getByText("正在执行，等待子代理返回会话内容。")).toBeInTheDocument();
    rerender(<SubagentTranscriptPanel subagent={{ ...agent, status: "completed", messages: [{ role: "assistant", content: "布局检查完成" }], truncated: true }} />);
    expect(screen.getByText("布局检查完成")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("此旧版记录未保存完整内容");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("子代理启动失败时仍可展开父工具的错误原因", () => {
    render(<ConversationTimeline messages={[{ id: "tool", role: "tool", toolName: "subagent", content: "无法启动子代理进程", status: "failed", subagents: [{ ...agent, status: "failed" }] }]} streaming={false} onOpenSubagent={vi.fn()} />);
    fireEvent.click(screen.getByText("调用失败 subagent"));
    expect(screen.getByText("无法启动子代理进程")).toBeVisible();
  });

  it.each(["json", "text"] as const)("%s 工具参数显示命令，单条截断不误报整个会话", (format) => {
    render(<SubagentTranscriptPanel subagent={{ ...agent, status: "completed", messages: [
      { role: "tool", content: "", toolCallId: "b", toolName: "bash", toolInput: { text: JSON.stringify({ command: "git status" }, null, 2), format, truncated: false }, toolOutput: { text: "partial output", format: "text", truncated: true }, isError: false },
      { role: "assistant", content: "最终检查结果" },
    ] }} />);
    const summary = screen.getByText("git status").closest("summary")!;
    expect(summary).toHaveTextContent("运行了git status");
    expect(screen.queryByText("运行了 {")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("旧版记录未保存完整内容");
    fireEvent.click(summary);
    expect(screen.getByText("已截断")).toBeVisible();
    expect(screen.getByText("最终检查结果")).toBeInTheDocument();
  });

  it("不完整 JSON 参数使用工具名称摘要而非单独花括号", () => {
    render(<SubagentTranscriptPanel subagent={{ ...agent, status: "completed", messages: [{ role: "tool", content: "", toolName: "bash", isError: false, toolInput: { text: '{\n  "command": "partial', format: "text", truncated: true } }] }} />);
    expect(screen.queryByText("运行了 {")).not.toBeInTheDocument();
    expect(screen.getByText("运行了", { selector: "span.timeline-tool-name" })).toBeInTheDocument();
  });

  it("滚离底部时保留位置并允许跳回最新消息", () => {
    const { rerender } = render(<SubagentTranscriptPanel subagent={agent} />);
    const scroller = screen.getByLabelText("子代理会话消息");
    Object.defineProperties(scroller, { scrollHeight: { value: 1000, configurable: true }, clientHeight: { value: 200, configurable: true } });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    rerender(<SubagentTranscriptPanel subagent={{ ...agent, messages: [{ role: "assistant", content: "新进度" }] }} />);
    expect(scroller.scrollTop).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: "跳到子代理最新消息" }));
    expect(scroller.scrollTop).toBe(1000);
  });

  it("尚未返回结果的工具显示运行中，停止后不误报完成", () => {
    const child: SubagentSnapshot = { ...agent, messages: [{ role: "tool", content: "", toolCallId: "read:1", toolName: "read" }] };
    const { container, rerender } = render(<SubagentTranscriptPanel subagent={child} />);
    expect(container.querySelector(".timeline-tool-group > details")).toHaveAttribute("data-status", "running");
    rerender(<SubagentTranscriptPanel subagent={{ ...child, status: "cancelled" }} />);
    expect(container.querySelector(".timeline-tool-group > details")).toHaveAttribute("data-status", "cancelled");
    rerender(<SubagentTranscriptPanel subagent={{ ...child, status: "completed", messages: [{ ...child.messages[0]!, isError: false }] }} />);
    expect(container.querySelector(".timeline-tool-group > details")).toHaveAttribute("data-status", "completed");
  });

  it("完整会话替代预览并展示长工具输出和最终结果", async () => {
    const output = `BEGIN ${"long output ".repeat(1000)} END`;
    vi.mocked(readSubagentTranscript).mockResolvedValueOnce({ revision: 7, messages: [
      { role: "user", content: agent.task },
      { role: "assistant", content: "最初的完整回复" },
      { role: "tool", content: "", toolName: "bash", toolInput: { text: '{"command":"git status"}', format: "json", truncated: false }, toolOutput: { text: output, format: "text", truncated: false }, isError: false },
      { role: "assistant", content: "完整最终回复" },
    ] });
    render(<SubagentTranscriptPanel sessionId="parent" subagent={{ ...agent, status: "completed", truncated: true, transcriptAvailable: true, transcriptRevision: 7, messages: [{ role: "assistant", content: "不完整预览" }] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("读取完整");
    expect(screen.queryByText("不完整预览")).not.toBeInTheDocument();
    expect(await screen.findByText("完整最终回复")).toBeInTheDocument();
    expect(screen.getByText("最初的完整回复")).toBeInTheDocument();
    fireEvent.click(screen.getByText("git status").closest("summary")!);
    expect(screen.getByText(output, { normalizer: (value) => value })).toBeVisible();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText("已截断")).not.toBeInTheDocument();
  });

  it("完整记录读取失败可以重试，不用预览伪装完整记录", async () => {
    vi.mocked(readSubagentTranscript).mockRejectedValueOnce({ message: "记录读取失败" }).mockResolvedValueOnce({ revision: 1, messages: [{ role: "assistant", content: "恢复成功" }] });
    render(<SubagentTranscriptPanel sessionId="parent" subagent={{ ...agent, status: "completed", transcriptAvailable: true }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("记录读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("恢复成功")).toBeInTheDocument();
  });
});
