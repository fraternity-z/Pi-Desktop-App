import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionDialog } from "./PermissionDialog";

const request = { requestId: "r-1", toolCallId: "t-1", toolName: "bash",
  summary: "<script>unsafe()</script>\npnpm test", expiresAt: "2026-09-28T12:02:00.000Z" };
const props = { request, workspace: "C:/work", pendingCount: 2, busy: false, error: null };

describe("PermissionDialog", () => {
  it.each([["拒绝", "deny"], ["本会话允许", "allow-session"], ["仅允许一次", "allow-once"]] as const)("returns %s decision", (label, decision) => {
    const onReply = vi.fn(); render(<PermissionDialog {...props} onReply={onReply} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onReply).toHaveBeenCalledExactlyOnceWith(decision);
    expect(screen.getByRole("dialog")).toHaveTextContent("还有 1 项操作等待授权");
    expect(screen.getByRole("dialog").querySelector("script")).toBeNull();
  });
  it.each(["escape", "close", "backdrop"])("denies when dismissed by %s", (method) => {
    const onReply = vi.fn(); render(<PermissionDialog {...props} onReply={onReply} />);
    if (method === "escape") fireEvent.keyDown(document, { key: "Escape" });
    else if (method === "close") fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    else fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onReply).toHaveBeenCalledExactlyOnceWith("deny");
  });
  it("blocks all replies and dismissals while busy and displays safe errors", () => {
    const onReply = vi.fn(); render(<PermissionDialog {...props} busy error="请重试" onReply={onReply} />);
    for (const button of screen.getAllByRole("button")) { expect(button).toBeDisabled(); fireEvent.click(button); }
    fireEvent.keyDown(document, { key: "Escape" }); fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onReply).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("请重试");
  });
});
