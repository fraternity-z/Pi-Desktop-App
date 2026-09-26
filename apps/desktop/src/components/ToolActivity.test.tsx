import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../stores/useChatSession";
import { ConversationTimeline } from "./ConversationTimeline";

function edited(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: "edit", role: "tool", toolName: "edit", status: "completed", content: "编辑完成",
    toolInput: { text: JSON.stringify({ path: "src/SettingsView.tsx", oldText: "const old = 1;\nkeep();", newText: "const current = 2;\nkeep();\nadded();" }), format: "json", truncated: false },
    ...overrides };
}

function openEdit(container: HTMLElement) {
  const row = container.querySelector<HTMLDetailsElement>(".timeline-tool")!;
  fireEvent.click(row.querySelector("summary")!);
  return row;
}

describe("tool activity rows", () => {
  it("文件行显示动作图标、文件名和统计，点击展开真实片段差异", () => {
    const { container } = render(<ConversationTimeline messages={[edited()]} streaming={false} />);
    expect(screen.getByText("编辑了")).toBeVisible();
    expect(screen.getByTitle("src/SettingsView.tsx")).toHaveTextContent("SettingsView.tsx");
    expect(screen.getByText("+2 -1")).toBeVisible();
    expect(container.querySelector(".timeline-tool-icon .lucide-pencil")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "差异代码" })).not.toBeInTheDocument();
    const row = openEdit(container);
    expect(row.querySelector("summary")).toHaveAttribute("aria-expanded", "true");
    const diff = screen.getByRole("region", { name: "差异代码" });
    expect(diff.querySelectorAll('[data-kind="add"]')).toHaveLength(2);
    expect(diff.querySelectorAll('[data-kind="delete"]')).toHaveLength(1);
    expect(diff.querySelectorAll('[data-kind="context"]')).toHaveLength(1);
    expect(screen.getByText(/行号相对于编辑片段/)).toBeVisible();
    expect(screen.getByText("调用参数")).not.toBeVisible();
    fireEvent.click(screen.getByText("查看调用参数与结果"));
    expect(screen.getByText("调用参数")).toBeVisible();
    expect(screen.getByText("执行结果")).toBeVisible();
    fireEvent.click(row.querySelector("summary")!);
    expect(screen.queryByRole("region", { name: "差异代码" })).not.toBeInTheDocument();
  });

  it("多工具默认折叠，摘要归纳动作，重复折叠不丢失内部展开状态", () => {
    const messages: ChatMessage[] = [edited(), { id: "bash", role: "tool", toolName: "bash", content: "ok", status: "completed" }];
    const { container } = render(<ConversationTimeline messages={messages} streaming={false} />);
    const summary = screen.getByText("编辑了文件、运行了命令").closest("summary")!;
    expect(summary).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(summary);
    openEdit(container);
    expect(screen.getByRole("region", { name: "差异代码" })).toBeVisible();
    fireEvent.click(summary);
    expect(screen.queryByRole("region", { name: "差异代码" })).not.toBeInTheDocument();
    fireEvent.click(summary);
    expect(screen.getByRole("region", { name: "差异代码" })).toBeVisible();
    expect(container.querySelector(".lucide-square-terminal")).toBeInTheDocument();
  });

  it.each([
    ["completed", "completed", "运行了命令、读取了文件"],
    ["failed", "completed", "运行了命令、读取了文件"],
    ["running", "running", "正在运行命令、正在读取文件"],
    ["pending", "pending", "等待运行命令、等待读取文件"],
  ] as const)("单项失败不扩散到汇总，保留其他工具的 %s 状态", (status, groupStatus, label) => {
    const messages: ChatMessage[] = [
      { id: "bash", role: "tool", toolName: "bash", content: "exit code 1", status: "failed" },
      { id: "read", role: "tool", toolName: "read", content: "", status },
    ];
    render(<ConversationTimeline messages={messages} streaming={status === "running"} />);
    const summary = screen.getByText(label).closest("summary")!;
    expect(summary).not.toHaveTextContent("失败");
    expect(summary.parentElement).toHaveAttribute("data-status", groupStatus);
    expect(summary.parentElement).toHaveAttribute("aria-busy", String(status === "running" || status === "pending"));
    expect(screen.queryByText("运行失败")).not.toBeInTheDocument();
    fireEvent.click(summary);
    const failedRow = screen.getByText("运行失败").closest(".timeline-tool")!;
    expect(failedRow).toHaveAttribute("data-status", "failed");
    fireEvent.click(failedRow.querySelector("summary")!);
    expect(screen.getByText("exit code 1")).toBeVisible();
    expect(summary).not.toHaveTextContent("失败");
  });

  it("复制差异并对剪贴板错误给出可重试提示", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = render(<ConversationTimeline messages={[edited()]} streaming={false} />);
    openEdit(container);
    fireEvent.click(screen.getByRole("button", { name: "复制差异" }));
    expect(await screen.findByText("复制失败，请重试")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "复制差异" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "差异已复制" })).toBeVisible());
    expect(writeText).toHaveBeenLastCalledWith("-const old = 1;\n+const current = 2;\n keep();\n+added();");
  });

  it("失败的编辑只展示拟议变更，不声称文件已编辑", () => {
    const { container } = render(<ConversationTimeline messages={[edited({ status: "failed", content: "文件不存在" })]} streaming={false} />);
    expect(screen.getByText("编辑失败")).toBeVisible();
    expect(screen.queryByText("+2 -1")).not.toBeInTheDocument();
    openEdit(container);
    expect(screen.getByText(/尚未确认写入/)).toBeVisible();
  });

  it("缺失旧新片段时展示原始详情而非虚构 diff", () => {
    const message = edited({ toolInput: { text: '{"path":"a.ts"}', format: "json", truncated: false } });
    const { container } = render(<ConversationTimeline messages={[message]} streaming={false} />);
    openEdit(container);
    expect(screen.getByText(/未提供完整变更片段/)).toBeVisible();
    expect(screen.getByText("调用参数")).toBeVisible();
    expect(screen.queryByRole("button", { name: "复制差异" })).not.toBeInTheDocument();
  });

  it("截断输入显示警告；写入空文件不伪造新增行", () => {
    const message = edited({ toolName: "write", toolInput: { text: '{"path":"empty.ts","content":""}', format: "json", truncated: true } });
    const { container } = render(<ConversationTimeline messages={[message]} streaming={false} />);
    openEdit(container);
    expect(screen.getByText("预览已截断")).toBeVisible();
    expect(screen.getByText("没有可预览的文本变更。")).toBeVisible();
    expect(screen.getByText(/无法计算实际增删/)).toBeVisible();
  });

  it("HTML 片段只显示为代码而不注入元素", () => {
    const message = edited({ toolInput: { text: JSON.stringify({ path: "a.html", oldText: "", newText: '<img src=x onerror=alert(1)>' }), format: "json", truncated: false } });
    const { container } = render(<ConversationTimeline messages={[message]} streaming={false} />);
    openEdit(container);
    const code = screen.getByRole("region", { name: "差异代码" });
    expect(code).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(code.querySelector("img")).toBeNull();
  });

  it("运行中保持动作图标，完成后更新标题及统计并保留展开", () => {
    const { container, rerender } = render(<ConversationTimeline messages={[edited({ status: "running" })]} streaming />);
    const row = openEdit(container);
    expect(row.querySelector(".timeline-tool-icon .lucide-pencil")).toBeInTheDocument();
    expect(row.querySelector(".timeline-tool-progress")).toBeInTheDocument();
    rerender(<ConversationTimeline messages={[edited()]} streaming={false} />);
    expect(container.querySelector(".timeline-tool")).toBe(row);
    expect(row).toHaveAttribute("open");
    expect(within(row).getByText("编辑了")).toBeVisible();
    expect(row.querySelector(".timeline-tool-progress")).not.toBeInTheDocument();
    expect(screen.getByText("+2 -1")).toBeVisible();
  });
});
