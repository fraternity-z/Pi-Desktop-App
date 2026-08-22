import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentSessionSummary } from "../ipc/agent";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import { AppSidebar } from "./AppSidebar";

const readyRuntime: RuntimeStatusController = {
  phase: "ready",
  status: {
    status: "ready",
    runtimeSource: "path-pi-command",
    piVersion: "0.84.2",
    nodeVersion: "22.23.2",
    error: null,
  },
  refresh: vi.fn(),
};

const savedSession: AgentSessionSummary = {
  id: "saved",
  path: "C:\\agent\\sessions\\saved.jsonl",
  cwd: "C:\\projects\\alpha",
  name: null,
  created: "2026-08-20T08:00:00.000Z",
  modified: "2026-08-20T09:00:00.000Z",
  messageCount: 2,
  firstMessage: "检查类型错误",
};

describe("AppSidebar", () => {
  it("按项目展示 SDK 会话并支持折叠、选择和刷新", async () => {
    const onSelectSession = vi.fn();
    const onRefresh = vi.fn();
    render(
      <AppSidebar
        open
        activeCwd={"C:\\projects\\alpha"}
        activeSessionPath={savedSession.path}
        sessions={[savedSession]}
        catalogPhase="ready"
        phase="ready"
        runtime={readyRuntime}
        onAddProject={vi.fn()}
        onNewSession={vi.fn()}
        onSelectSession={onSelectSession}
        onRefresh={onRefresh}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("检查类型错误")).toBeInTheDocument();
    expect(screen.getByTitle("C:\\projects\\alpha")).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "折叠alpha" }));
    expect(screen.queryByText("检查类型错误")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开alpha" }));
    fireEvent.click(await screen.findByTitle("检查类型错误"));
    expect(onSelectSession).toHaveBeenCalledWith(savedSession);

    fireEvent.click(screen.getByRole("button", { name: "刷新项目与会话" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("为没有历史会话的当前项目提供创建动作", async () => {
    const onNewSession = vi.fn();
    render(
      <AppSidebar
        open={false}
        activeCwd={"C:\\projects\\empty"}
        activeSessionPath={null}
        sessions={[]}
        catalogPhase="ready"
        phase="ready"
        runtime={readyRuntime}
        onAddProject={vi.fn()}
        onNewSession={onNewSession}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "创建首个会话" }));
    expect(onNewSession).toHaveBeenCalledWith("C:\\projects\\empty");
  });

  it("无项目时展示加载状态并禁用不可用操作", () => {
    render(
      <AppSidebar
        open={false}
        activeCwd=""
        activeSessionPath={null}
        sessions={[]}
        catalogPhase="loading"
        phase="creating"
        runtime={{ phase: "loading", refresh: vi.fn() }}
        onAddProject={vi.fn()}
        onNewSession={vi.fn()}
        onSelectSession={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("正在读取 Pi 会话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新项目与会话" })).toBeDisabled();
    expect(screen.queryByText("Pi 运行时未就绪")).not.toBeInTheDocument();
  });
});
