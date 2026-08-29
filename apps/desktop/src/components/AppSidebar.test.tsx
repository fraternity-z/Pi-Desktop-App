import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import type { SessionListItem } from "../stores/useChatSession";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import { AppSidebar, clampSidebarWidth, threadTitle } from "./AppSidebar";

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

const savedSession: SessionListItem = {
  id: "saved",
  path: "C:\\agent\\sessions\\saved.jsonl",
  cwd: "C:\\projects\\alpha",
  name: null,
  created: "2026-08-20T08:00:00.000Z",
  modified: "2026-08-20T09:00:00.000Z",
  messageCount: 2,
  firstMessage: "检查类型错误",
  lifecycle: "persisted",
};

type SidebarProps = ComponentProps<typeof AppSidebar>;

function sidebarProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    open: true,
    width: 300,
    activeCwd: "C:\\projects\\alpha",
    activeSessionId: savedSession.id,
    activeView: "chat",
    sessions: [savedSession],
    recentWorkspaces: ["C:\\projects\\alpha"],
    conversationHome: "C:\\Users\\me\\Documents\\Pix\\conversations",
    runningSessionIds: [savedSession.id],
    catalogPhase: "ready",
    ecosystemPhase: "ready",
    packageCount: 2,
    resourceCount: 3,
    phase: "ready",
    runtime: readyRuntime,
    onAddProject: vi.fn(),
    onNewConversation: vi.fn(),
    onNewSession: vi.fn(),
    onRemoveWorkspace: vi.fn(),
    onDeleteSession: vi.fn().mockResolvedValue({
      deletedSessionIds: [savedSession.id],
      missingSessionIds: [],
    }),
    onRevealWorkspace: vi.fn(),
    onLoadWorktreeOptions: vi.fn().mockResolvedValue({
      branches: [{ name: "main", current: true, remote: false }],
      suggestedName: "alpha-1",
    }),
    onCreateWorktree: vi.fn().mockResolvedValue({
      path: "C:\\Documents\\Pix\\worktrees\\alpha\\alpha-1",
    }),
    onOpenCreatedWorktree: vi.fn(),
    onSelectSession: vi.fn(),
    onRefresh: vi.fn(),
    onOpenPackages: vi.fn(),
    onOpenResources: vi.fn(),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    onWidthChange: vi.fn(),
    ...overrides,
  };
}

describe("AppSidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("按项目展示 SDK 会话并支持折叠、选择、刷新和确认移除", async () => {
    const props = sidebarProps();
    render(<AppSidebar {...props} />);

    expect(screen.getByText("Pi Desktop")).toBeInTheDocument();
    expect(screen.queryByText("Pix", { selector: ".sidebar-brand" })).not.toBeInTheDocument();
    expect(await screen.findByText("检查类型错误")).toBeInTheDocument();
    expect(screen.getByTitle("C:\\projects\\alpha")).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("正在运行")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "折叠alpha" }));
    expect(screen.queryByText("检查类型错误")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开alpha" }));
    fireEvent.click(await screen.findByTitle("检查类型错误"));
    expect(props.onSelectSession).toHaveBeenCalledWith(savedSession);

    fireEvent.click(screen.getByRole("button", { name: "整理侧边栏" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "刷新列表" }));
    expect(props.onRefresh).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(props.onNewConversation).toHaveBeenCalledWith("C:\\projects\\alpha");
    fireEvent.click(screen.getByRole("button", { name: "alpha更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从列表移除" }));
    expect(screen.getByRole("dialog", { name: "移除项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    await waitFor(() =>
      expect(props.onRemoveWorkspace).toHaveBeenCalledWith("C:\\projects\\alpha"),
    );

    fireEvent.click(screen.getByRole("button", { name: "系统设置" }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "帮助" }));
    expect(screen.getByRole("dialog", { name: "帮助与支持" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭帮助" }));
    expect(screen.queryByRole("dialog", { name: "帮助与支持" })).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("separator", { name: "调整侧边栏宽度" }), {
      key: "ArrowRight",
    });
    expect(props.onWidthChange).toHaveBeenCalledWith(308);
  });

  it("当前会话位于默认对话目录时不把默认目录当作项目", () => {
    const props = sidebarProps({
      activeCwd: "C:\\Users\\me\\Documents\\Pix\\conversations",
      sessions: [],
      recentWorkspaces: [],
    });
    render(<AppSidebar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(props.onNewConversation).toHaveBeenCalledWith(undefined);
  });

  it("移除最近项目后不会被活动草稿重新加入", async () => {
    const draft: SessionListItem = {
      id: "draft:administrator",
      path: null,
      cwd: "C:\\Users\\Administrator",
      name: null,
      created: "2026-08-29T08:00:00.000Z",
      modified: "2026-08-29T08:00:00.000Z",
      messageCount: 0,
      firstMessage: "",
      lifecycle: "draft",
    };
    const props = sidebarProps({
      activeCwd: draft.cwd,
      activeSessionId: draft.id,
      sessions: [draft],
      recentWorkspaces: [draft.cwd],
      runningSessionIds: [],
    });
    const { rerender } = render(<AppSidebar {...props} />);
    expect(screen.getByTitle(draft.cwd)).toBeInTheDocument();

    rerender(<AppSidebar {...props} recentWorkspaces={[]} />);

    expect(screen.queryByTitle(draft.cwd)).not.toBeInTheDocument();
    expect(await screen.findByTitle("未命名会话")).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(props.onNewConversation).toHaveBeenCalledWith(undefined);
  });

  it("完整暴露插件、资源、重命名与会话移动入口", async () => {
    const betaSession = {
      ...savedSession,
      id: "beta-session",
      path: "C:\\agent\\sessions\\beta.jsonl",
      cwd: "C:\\projects\\beta",
      firstMessage: "Beta 会话",
    };
    const props = sidebarProps({
      sessions: [savedSession, betaSession],
      recentWorkspaces: ["C:\\projects\\alpha", "C:\\projects\\beta"],
    });
    render(<AppSidebar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "插件" }));
    fireEvent.click(screen.getByRole("button", { name: "资源" }));
    expect(props.onOpenPackages).toHaveBeenCalledOnce();
    expect(props.onOpenResources).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "插件" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "资源" })).toHaveTextContent("3");

    fireEvent.click(screen.getByRole("button", { name: "alpha更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const nameInput = screen.getByRole("textbox", { name: "名称" });
    fireEvent.change(nameInput, { target: { value: "Alpha 项目" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(await screen.findByText("Alpha 项目")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查类型错误更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动到项目…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "beta" }));
    await waitFor(() => {
      const stored = window.localStorage.getItem("pix.threads.projectOverrides");
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual({ saved: "C:\\projects\\beta" });
    });
  });

  it("支持在文件夹中显示项目并创建、打开永久工作树", async () => {
    const props = sidebarProps();
    render(<AppSidebar {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "alpha更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "在文件夹中显示" }));
    await waitFor(() =>
      expect(props.onRevealWorkspace).toHaveBeenCalledWith("C:\\projects\\alpha"),
    );
    expect(await screen.findByText("已在文件夹中显示“alpha”")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "alpha更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "创建永久工作树" }));
    expect(screen.getByRole("dialog", { name: "创建 Git 工作树" })).toBeInTheDocument();
    await waitFor(() =>
      expect(props.onLoadWorktreeOptions).toHaveBeenCalledWith("C:\\projects\\alpha"),
    );
    const nameInput = await screen.findByRole("textbox", { name: /项目名称/ });
    expect(nameInput).toHaveValue("alpha-1");
    fireEvent.change(screen.getByRole("combobox", { name: /基于/ }), {
      target: { value: "main" },
    });
    fireEvent.change(nameInput, { target: { value: "alpha-feature" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并打开" }));

    await waitFor(() =>
      expect(props.onCreateWorktree).toHaveBeenCalledWith({
        cwd: "C:\\projects\\alpha",
        base: "main",
        name: "alpha-feature",
      }),
    );
    expect(props.onOpenCreatedWorktree).toHaveBeenCalledWith(
      "C:\\Documents\\Pix\\worktrees\\alpha\\alpha-1",
    );
    expect(await screen.findByText("工作树已创建并打开")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "创建 Git 工作树" })).not.toBeInTheDocument();
  });

  it("为空项目提供创建动作，并在加载期间禁用边界操作", async () => {
    const onNewSession = vi.fn();
    const { rerender } = render(
      <AppSidebar
        {...sidebarProps({
          activeCwd: "C:\\projects\\empty",
          activeSessionId: null,
          sessions: [],
          recentWorkspaces: ["C:\\projects\\empty"],
          runningSessionIds: [],
          onNewSession,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "创建首个会话" }));
    expect(onNewSession).toHaveBeenCalledWith("C:\\projects\\empty");

    rerender(
      <AppSidebar
        {...sidebarProps({
          activeCwd: "",
          activeSessionId: null,
          sessions: [],
          recentWorkspaces: [],
          runningSessionIds: [],
          catalogPhase: "loading",
          ecosystemPhase: "loading",
          phase: "creating",
          runtime: { phase: "loading", refresh: vi.fn() },
        })}
      />,
    );
    expect(screen.getByText("正在读取项目")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "插件" })).toBeDisabled();
  });

  it("支持搜索、分组、排序、分区折叠和添加项目", async () => {
    const sessions = Array.from({ length: 7 }, (_, index) => ({
      ...savedSession,
      id: `session-${index}`,
      path: `C:\\agent\\sessions\\session-${index}.jsonl`,
      firstMessage: `会话 ${index}`,
      modified: `2026-08-2${index}T09:00:00.000Z`,
    }));
    const props = sidebarProps({ sessions, activeSessionId: sessions[0].id });
    render(<AppSidebar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索项目和会话" }), {
      target: { value: "会话 6" },
    });
    expect(await screen.findByText("会话 6")).toBeInTheDocument();
    expect(screen.queryByText("会话 0")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "搜索项目和会话" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "搜索项目和会话" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "整理侧边栏" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "列表显示" }));
    expect(window.localStorage.getItem("pix.sidebar.groupMode")).toBe("list");
    expect(screen.queryByRole("button", { name: "alpha更多操作" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "整理侧边栏" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "手动排序" }));
    expect(window.localStorage.getItem("pix.sidebar.conversationSortMode")).toBe("manual");
    fireEvent.click(screen.getByRole("button", { name: "整理侧边栏" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加项目" }));
    expect(props.onAddProject).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "对话" }));
    expect(screen.queryByText("会话 6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "对话" }));
    expect(await screen.findByText("会话 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开显示" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开显示" }));
    expect(screen.getByText("会话 0")).toBeInTheDocument();
  });

  it("支持项目置顶、归档及会话未读、置顶、重命名、移动和删除", async () => {
    const betaSession = {
      ...savedSession,
      id: "beta-session",
      path: "C:\\agent\\sessions\\beta.jsonl",
      cwd: "C:\\projects\\beta",
      firstMessage: "Beta 会话",
    };
    const props = sidebarProps({
      sessions: [savedSession, betaSession],
      recentWorkspaces: ["C:\\projects\\alpha", "C:\\projects\\beta"],
    });
    render(<AppSidebar {...props} />);

    fireEvent.contextMenu(screen.getByTitle("C:\\projects\\alpha"), { clientX: 12, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶" }));
    expect(await screen.findByText("置顶")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查类型错误更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "标记为未读" }));
    expect(screen.getByLabelText("未读")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查类型错误更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶" }));
    expect(screen.getByLabelText("已置顶")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查类型错误更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), {
      target: { value: "Beta 会话" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("名称已存在");
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), {
      target: { value: "Alpha 会话" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(await screen.findByText("Alpha 会话")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alpha 会话更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动到项目…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "对话" }));
    expect(JSON.parse(window.localStorage.getItem("pix.threads.projectOverrides")!)).toEqual({
      saved: "__pix_conversation__",
    });
    fireEvent.click(screen.getByRole("button", { name: "Alpha 会话更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动到项目…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复原始归类" }));
    expect(JSON.parse(window.localStorage.getItem("pix.threads.projectOverrides")!)).toEqual({});

    fireEvent.click(screen.getByRole("button", { name: "Alpha 会话更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.queryByText("Alpha 会话")).not.toBeInTheDocument());
    await waitFor(() => expect(props.onDeleteSession).toHaveBeenCalledWith("saved"));

    fireEvent.click(screen.getByRole("button", { name: "alpha更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "归档项目" }));
    expect(screen.queryByRole("dialog", { name: "归档项目" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTitle("C:\\projects\\alpha")).not.toBeInTheDocument());
  });

  it("支持悬浮自动收起、固定与指针/键盘调整宽度", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("pix.sidebar.fixed", "0");
    const props = sidebarProps();
    render(<AppSidebar {...props} />);
    const sidebar = screen.getByRole("complementary", { name: "项目与会话导航" });
    const resizer = screen.getByRole("separator", { name: "调整侧边栏宽度" });

    fireEvent.pointerLeave(sidebar);
    vi.advanceTimersByTime(260);
    expect(props.onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "固定侧边栏" }));
    expect(window.localStorage.getItem("pix.sidebar.fixed")).toBe("1");

    fireEvent.pointerDown(resizer, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 500, pointerId: 1 });
    expect(props.onWidthChange).toHaveBeenCalledWith(360);
    fireEvent.pointerUp(resizer, { clientX: 500, pointerId: 1 });
    fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    expect(props.onWidthChange).toHaveBeenCalledWith(292);
    fireEvent.keyDown(resizer, { key: "Home" });
  });

  it("帮助面板打开时不会触发侧栏自动收起", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("pix.sidebar.fixed", "0");
    const props = sidebarProps();
    render(<AppSidebar {...props} />);
    const sidebar = screen.getByRole("complementary", { name: "项目与会话导航" });

    fireEvent.click(screen.getByRole("button", { name: "帮助" }));
    fireEvent.pointerLeave(sidebar);
    vi.advanceTimersByTime(260);

    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "帮助与支持" })).toBeInTheDocument();
  });

  it("移除项目失败时保留元数据并在确认框显示稳定错误", async () => {
    window.localStorage.setItem(
      "pix.projects.aliases",
      JSON.stringify({ "c:/projects/alpha": "Alpha 项目" }),
    );
    const onRemoveWorkspace = vi
      .fn()
      .mockRejectedValue({ code: "WORKSPACE_REMOVE_FAILED", message: "无法更新最近项目" });
    render(<AppSidebar {...sidebarProps({ onRemoveWorkspace })} />);

    fireEvent.click(await screen.findByRole("button", { name: "Alpha 项目更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从列表移除" }));
    fireEvent.click(screen.getByRole("button", { name: "移除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WORKSPACE_REMOVE_FAILED: 无法更新最近项目",
    );
    expect(screen.getByRole("dialog", { name: "移除项目" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("pix.projects.aliases")!)).toEqual({
      "c:/projects/alpha": "Alpha 项目",
    });
  });

  it("删除会话失败时保留确认框和会话索引", async () => {
    const onDeleteSession = vi.fn().mockRejectedValue({
      code: "SESSION_DELETE_FAILED",
      message: "原生会话文件删除失败",
    });
    render(<AppSidebar {...sidebarProps({ onDeleteSession })} />);

    fireEvent.click(await screen.findByRole("button", { name: "检查类型错误更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "删除会话" })).toHaveTextContent("Pi 原生 JSONL");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "SESSION_DELETE_FAILED: 原生会话文件删除失败",
    );
    expect(screen.getByRole("dialog", { name: "删除会话" })).toBeInTheDocument();
    expect(screen.getByText("检查类型错误")).toBeInTheDocument();
  });

  it("公开稳定的宽度和会话标题降级规则", () => {
    expect(clampSidebarWidth(100)).toBe(232);
    expect(clampSidebarWidth(299.6)).toBe(300);
    expect(clampSidebarWidth(900)).toBe(360);
    expect(threadTitle(savedSession, { saved: "别名" })).toBe("别名");
    expect(threadTitle({ ...savedSession, id: "named", name: "SDK 名称" }, {})).toBe("SDK 名称");
    expect(
      threadTitle({ ...savedSession, id: "empty", name: null, firstMessage: "" }, {}),
    ).toBe("未命名会话");
  });

  it("正常展示并选择未绑定项目和文件路径的草稿会话", async () => {
    const draft: SessionListItem = {
      id: "draft:1",
      path: null,
      cwd: "",
      name: null,
      created: "2026-08-24T08:00:00.000Z",
      modified: "2026-08-24T08:00:00.000Z",
      messageCount: 0,
      firstMessage: "",
      lifecycle: "draft",
    };
    const props = sidebarProps({
      activeCwd: "",
      activeSessionId: draft.id,
      sessions: [draft],
      recentWorkspaces: [],
      runningSessionIds: [],
    });

    render(<AppSidebar {...props} />);

    const row = await screen.findByTitle("未命名会话");
    expect(row).toHaveAttribute("aria-current", "page");
    fireEvent.click(row);
    expect(props.onSelectSession).toHaveBeenCalledWith(draft);
  });
});
