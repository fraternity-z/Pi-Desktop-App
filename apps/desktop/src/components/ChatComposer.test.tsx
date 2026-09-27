import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { ThinkingLevel } from "../ipc/agent";

import { ChatComposer, isImeCompositionEvent } from "./ChatComposer";

const availableTools = [
  { name: "read", description: "Read files" },
  { name: "bash", description: "Run commands" },
  { name: "edit", description: "Edit files" },
  { name: "write", description: "Write files" },
  { name: "grep", description: "Search contents" },
  { name: "find", description: "Find files" },
  { name: "ls", description: "List directories" },
];
const defaultToolNames = ["read", "bash", "edit", "write"];
const toolConfiguration = {
  availableTools,
  activeToolNames: defaultToolNames,
  defaultToolNames,
};
const permissionProps = {
  permissionMode: "default" as const,
  availableTools,
  selectedToolNames: defaultToolNames,
  defaultToolNames,
  onUseDefaultTools: vi.fn(),
  onToolSelectionChange: vi.fn(),
};

function openModelMenu() {
  fireEvent.click(screen.getByRole("button", { name: "模型与思考强度" }));
  fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
}

function modelPickerProps() {
  const models = [
    { provider: "test", id: "first", name: "First", reasoning: true },
    { provider: "test", id: "second", name: "Second", reasoning: true },
  ];
  return {
    workspaceName: "workspace", draft: "", phase: "ready" as const, eventConnection: "ready" as const,
    models, configuration: { model: models[0], thinkingLevel: "medium" as const, availableThinkingLevels: ["off", "medium", "high"] as ThinkingLevel[], ...toolConfiguration },
    configuring: false, canSend: false, queuedMessages: { steering: [], followUp: [] }, queuePaused: false,
    ...permissionProps, onDraftChange: vi.fn(), onModelChange: vi.fn(), onThinkingLevelChange: vi.fn(),
    onSend: vi.fn(), onClearQueue: vi.fn(), onAbort: vi.fn(),
  };
}

describe("渐进式模型选择器", () => {
  it("点击摘要只展示滑杆，选中模型可使用方向键导航，选择后返回上层", () => {
    const options = modelPickerProps();
    render(<ChatComposer {...options} />);
    const summary = screen.getByRole("button", { name: "模型与思考强度" });
    expect(summary).toHaveTextContent("First中");
    fireEvent.click(summary);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    const first = screen.getByRole("menuitemradio", { name: "First" });
    const second = screen.getByRole("menuitemradio", { name: "Second" });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "End" });
    expect(second).toHaveFocus();
    fireEvent.click(first);
    expect(options.onModelChange).not.toHaveBeenCalled();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    fireEvent.click(summary);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openModelMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("配置保存期间保持面板、焦点和布局，仅锁定重复操作", () => {
    const options = modelPickerProps();
    const { rerender } = render(<ChatComposer {...options} />);
    const summary = screen.getByRole("button", { name: "模型与思考强度" });
    fireEvent.click(summary);
    const dialog = screen.getByRole("dialog");
    const slider = screen.getByRole("slider");
    expect(slider).toHaveFocus();
    rerender(<ChatComposer {...options} configuring />);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByRole("slider")).toBe(slider);
    expect(slider).toBeEnabled();
    expect(slider).toHaveFocus();
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(slider.parentElement).toHaveAttribute("data-disabled", "false");
    expect(summary).toBeEnabled();
    expect(summary).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("正在应用配置")).toHaveClass("sr-only");
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    rerender(<ChatComposer {...options} configuration={{ ...options.configuration, thinkingLevel: "high" }} />);
    expect(slider).not.toHaveAttribute("aria-disabled");
    expect(slider).toHaveFocus();
    expect(slider).toHaveAttribute("aria-valuetext", "高");
    expect(screen.queryByText("正在应用配置")).not.toBeInTheDocument();
    rerender(<ChatComposer {...options} eventConnection="connecting" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([false, "reject"])("草稿能力读取失败（%s）不永久加载，可重新打开重试", async (result) => {
    const options = modelPickerProps();
    const prepare = vi.fn(() => result === "reject" ? Promise.reject(new Error("internal details")) : Promise.resolve(false));
    render(<ChatComposer {...options} configuration={null} onPrepareConfiguration={prepare} />);
    const summary = screen.getByRole("button", { name: "模型与思考强度" });
    fireEvent.click(summary);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取思考强度，请关闭后重试");
    expect(screen.queryByText("internal details")).not.toBeInTheDocument();
    expect(screen.queryByText("正在读取思考强度")).not.toBeInTheDocument();
    fireEvent.click(summary);
    fireEvent.click(summary);
    await screen.findByRole("alert");
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("空目录加载时保留反馈，并在目录到达后展示选项", () => {
    const options = modelPickerProps();
    const { rerender } = render(<ChatComposer {...options} models={[]} catalogPhase="loading" />);
    openModelMenu();
    expect(screen.getByText("正在加载模型")).toBeInTheDocument();
    rerender(<ChatComposer {...options} catalogPhase="ready" />);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
  });
});

describe("ChatComposer", () => {
  it("隐藏项目栏时移除整行及已打开菜单，恢复显示时仍可选择项目", () => {
    const onProjectChange = vi.fn();
    const baseProps = {
      workspaceName: "work",
      workspacePath: "C:\\work",
      recentWorkspaces: ["C:\\other"],
      branchName: "main",
      branchControl: {
        branchName: "main", isRepository: true, branches: [],
        loading: false, busy: false, error: null,
        refresh: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(true),
        switchTo: vi.fn().mockResolvedValue(true),
      },
      draft: "",
      phase: "ready" as const,
      eventConnection: "ready" as const,
      models: [],
      configuration: null,
      configuring: false,
      canSend: false,
      queuedMessages: { steering: [], followUp: [] },
      queuePaused: false,
      ...permissionProps,
      onProjectChange,
      onDraftChange: vi.fn(),
      onModelChange: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      onSend: vi.fn(),
      onClearQueue: vi.fn(),
      onAbort: vi.fn(),
    };
    const { container, rerender } = render(<ChatComposer {...baseProps} showProjectBar />);

    expect(screen.getByRole("button", { name: "选择项目" })).toBeEnabled();
    expect(screen.getByTitle("本机 Pi Runtime")).toBeInTheDocument();
    expect(screen.getByTitle("Git 分支：main")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    expect(screen.getByRole("menu", { name: "项目列表" })).toBeInTheDocument();

    rerender(<ChatComposer {...baseProps} showProjectBar={false} />);

    expect(container.querySelector(".composer-project-bar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "项目列表" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("本机 Pi Runtime")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Git 分支：main")).not.toBeInTheDocument();
    expect(screen.getByLabelText("发送给 Pi 的消息")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模型与思考强度" })).toBeInTheDocument();

    rerender(<ChatComposer {...baseProps} showProjectBar />);

    expect(screen.getByRole("button", { name: "选择项目" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /other/ }));
    expect(onProjectChange).toHaveBeenCalledWith("C:\\other");
    fireEvent.click(screen.getByRole("button", { name: "选择 Git 分支" }));
    expect(screen.getByRole("menu", { name: "Git 分支" })).toBeInTheDocument();
    expect(baseProps.branchControl.refresh).toHaveBeenCalledOnce();
    rerender(<ChatComposer {...baseProps} showProjectBar={false} />);
    expect(screen.queryByRole("menu", { name: "Git 分支" })).not.toBeInTheDocument();
    rerender(<ChatComposer {...baseProps} phase="streaming" showProjectBar />);
    expect(screen.getByRole("button", { name: "选择 Git 分支" })).toBeDisabled();
  });

  it("无 SDK 配置时保留模型错误入口并禁用依赖会话的操作", () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        availableTools={[]}
        selectedToolNames={[]}
        defaultToolNames={[]}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={onSend}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    const modelTrigger = screen.getByRole("button", { name: "模型与思考强度" });
    expect(modelTrigger).toBeEnabled();
    fireEvent.click(modelTrigger);
    expect(screen.getByText("此模型未提供思考强度")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(screen.getByText("当前 Pi 配置中没有可用模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择工具权限" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    const emptyMeter = screen.getByRole("meter", { name: "上下文占用量" });
    expect(emptyMeter).not.toHaveAttribute("aria-valuenow");
    expect(emptyMeter.querySelector(".composer-context-ring-track")).toBeInTheDocument();
    expect(emptyMeter.querySelector(".composer-context-ring-progress")).not.toBeInTheDocument();
  });

  it("会话配置尚未生成时仍展示并允许选择真实模型目录", () => {
    const onModelChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={onModelChange}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    expect(screen.getByText("GPT")).toBeInTheDocument();
    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "GPT" }));
    expect(onModelChange).toHaveBeenCalledWith("openai", "gpt");
  });

  it("新草稿可复用最近一次 SDK 工具清单调整权限", () => {
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "选择工具权限" });
    expect(trigger).toBeEnabled();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "工具权限" })).toBeInTheDocument();
  });

  it("按需准备草稿的权限和思考配置，并即时展示加载反馈", () => {
    const onPrepareConfiguration = vi.fn(async () => true);
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        availableTools={[]}
        selectedToolNames={[]}
        defaultToolNames={[]}
        onPrepareConfiguration={onPrepareConfiguration}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    expect(onPrepareConfiguration).toHaveBeenCalledOnce();
    expect(screen.getByText("正在读取权限")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.click(screen.getByRole("button", { name: "模型与思考强度" }));
    expect(onPrepareConfiguration).toHaveBeenCalledTimes(2);
    expect(screen.getByText("正在读取思考强度")).toBeInTheDocument();
  });

  it("新草稿无需点击即可显示最近确认的思考强度", () => {
    const onPrepareConfiguration = vi.fn(async () => true);
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        displayThinkingLevel="max"
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onPrepareConfiguration={onPrepareConfiguration}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "模型与思考强度" })).toHaveTextContent("最高");
    expect(onPrepareConfiguration).not.toHaveBeenCalled();
  });

  it("模型目录异常时显示真实错误并允许重试", () => {
    const onRetryModels = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[]}
        configuration={null}
        configuring={false}
        catalogPhase="error"
        catalogError="MODEL_LIST_FAILED: 无法读取模型"
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onRetryModels={onRetryModels}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    openModelMenu();
    expect(screen.getByText("MODEL_LIST_FAILED: 无法读取模型")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(onRetryModels).toHaveBeenCalledOnce();
  });

  it("项目、上下文与扩展资源入口使用真实状态并回传操作", async () => {
    const onProjectChange = vi.fn();
    const onAddProject = vi.fn();
    const onAddFiles = vi.fn();
    const onAddFolder = vi.fn();
    const onAttachPath = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onSearchWorkspacePaths = vi.fn(async () => [
      {
        path: "C:\\work\\src\\main.ts",
        relativePath: "src/main.ts",
        kind: "file" as const,
      },
    ]);
    render(
      <ChatComposer
        workspaceName="work"
        workspacePath="C:\\work"
        recentWorkspaces={["C:\\work", "C:\\other"]}
        branchName="main"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium"],
          ...toolConfiguration,
        }}
        configuring={false}
        contextUsage={{ tokens: 2_048, contextWindow: 8_192, percent: 25 }}
        attachments={["C:\\work\\README.md", "C:\\cache\\paste.png"]}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onProjectChange={onProjectChange}
        onAddProject={onAddProject}
        onAddFiles={onAddFiles}
        onAddFolder={onAddFolder}
        onSearchWorkspacePaths={onSearchWorkspacePaths}
        onAttachPath={onAttachPath}
        onRemoveAttachment={onRemoveAttachment}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    const composerFrame = textarea.closest("form");
    expect(composerFrame).not.toBeNull();
    const attachmentRegion = composerFrame?.querySelector(".composer-attachment-region");
    expect(attachmentRegion).not.toBeNull();
    const frameChildren = Array.from(composerFrame!.children);
    expect(frameChildren.indexOf(attachmentRegion!)).toBeLessThan(frameChildren.indexOf(textarea));

    expect(screen.getByText("main")).toBeInTheDocument();
    const contextMeter = screen.getByRole("meter", { name: "上下文占用量" });
    expect(contextMeter).toHaveAttribute("aria-valuenow", "25");
    expect(contextMeter).toHaveAttribute("data-context-percent", "25");
    expect(contextMeter.querySelector(".composer-context-ring-progress")).toHaveAttribute(
      "stroke-dashoffset",
      "75",
    );
    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /other/ }));
    expect(onProjectChange).toHaveBeenCalledWith("C:\\other");

    fireEvent.click(screen.getByRole("button", { name: "添加文件或文件夹" }));
    await waitFor(() => expect(onSearchWorkspacePaths).toHaveBeenCalledWith(""));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /main\.ts/ }));
    expect(onAttachPath).toHaveBeenCalledWith("C:\\work\\src\\main.ts");
    fireEvent.click(screen.getByRole("menuitem", { name: "添加文件本地" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加文件夹本地" }));
    expect(onAddFiles).toHaveBeenCalledOnce();
    expect(onAddFolder).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "移除 README.md" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("C:\\work\\README.md");

    fireEvent.click(screen.getByRole("button", { name: "选择项目" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加项目" }));
    expect(onAddProject).toHaveBeenCalledOnce();
  });

  it("同步有效模型和思考强度，并保护组合输入与换行快捷键", () => {
    const onSend = vi.fn();
    const onModelChange = vi.fn();
    const onThinkingLevelChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="执行检查"
        phase="ready"
        eventConnection="ready"
        models={[
          { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          { provider: "anthropic", id: "claude", name: "Claude", reasoning: true },
        ]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium", "high"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={onModelChange}
        onThinkingLevelChange={onThinkingLevelChange}
        onSend={onSend}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    openModelMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Claude" }));
    expect(onModelChange).toHaveBeenCalledWith("anthropic", "claude");
    const slider = screen.getByRole("slider", { name: "思考强度" });
    fireEvent.change(slider, { target: { value: "2" } });
    fireEvent.pointerUp(slider);
    expect(onThinkingLevelChange).toHaveBeenCalledWith("high");

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("输入 slash 时在编辑框上方展示命令栏，并支持键盘选中插入", () => {
    const onDraftChange = vi.fn();
    const baseProps = {
      workspaceName: "workspace",
      phase: "ready" as const,
      eventConnection: "ready" as const,
      models: [],
      configuration: null,
      configuring: false,
      slashCommands: [
        { name: "review", description: "审查当前变更", source: "extension" as const },
        { name: "docs", description: "文档技能", source: "skill" as const },
      ],
      canSend: true,
      queuedMessages: { steering: [], followUp: [] },
      queuePaused: false,
      ...permissionProps,
      onModelChange: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      onSend: vi.fn(),
      onClearQueue: vi.fn(),
      onAbort: vi.fn(),
    };
    function SlashHarness() {
      const [draft, setDraft] = useState("");
      return (
        <ChatComposer
          {...baseProps}
          draft={draft}
          onDraftChange={(value) => {
            setDraft(value);
            onDraftChange(value);
          }}
        />
      );
    }
    render(<SlashHarness />);

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    fireEvent.change(textarea, { target: { value: "/rev" } });
    const menu = screen.getByRole("menu", { name: "命令" });
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByText("/review")).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onDraftChange).toHaveBeenLastCalledWith("/review ");
  });

  it("首次按上键选中命令末项，并兼容程序化逐字输入", () => {
    const onDraftChange = vi.fn();
    const baseProps = {
      workspaceName: "workspace",
      phase: "ready" as const,
      eventConnection: "ready" as const,
      models: [],
      configuration: null,
      configuring: false,
      slashCommands: [
        { name: "alpha", description: "第一个", source: "extension" as const },
        { name: "beta", description: "第二个", source: "extension" as const },
      ],
      canSend: true,
      queuedMessages: { steering: [], followUp: [] },
      queuePaused: false,
      ...permissionProps,
      onModelChange: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      onSend: vi.fn(),
      onClearQueue: vi.fn(),
      onAbort: vi.fn(),
    };
    function SlashHarness() {
      const [draft, setDraft] = useState("");
      return (
        <ChatComposer
          {...baseProps}
          draft={draft}
          onDraftChange={(value) => {
            setDraft(value);
            onDraftChange(value);
          }}
        />
      );
    }
    render(<SlashHarness />);

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    fireEvent.change(textarea, { target: { value: "/" } });
    fireEvent.change(textarea, { target: { value: "/b" } });
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onDraftChange).toHaveBeenLastCalledWith("/beta ");
  });

  it("展示命令加载、错误和空结果状态", () => {
    const baseProps = {
      workspaceName: "workspace",
      phase: "ready" as const,
      eventConnection: "ready" as const,
      models: [],
      configuration: null,
      configuring: false,
      canSend: true,
      queuedMessages: { steering: [], followUp: [] },
      queuePaused: false,
      ...permissionProps,
      onDraftChange: vi.fn(),
      onModelChange: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      onSend: vi.fn(),
      onClearQueue: vi.fn(),
      onAbort: vi.fn(),
    };
    const { rerender } = render(
      <ChatComposer
        {...baseProps}
        draft="/unknown"
        slashCommandsPhase="loading"
      />,
    );
    expect(screen.getByRole("menu", { name: "命令" })).toHaveTextContent("正在读取命令");
    expect(screen.queryByText("没有匹配的命令")).not.toBeInTheDocument();

    rerender(
      <ChatComposer
        {...baseProps}
        draft="/unknown"
        slashCommandsPhase="error"
        slashCommandsError="COMMAND_LIST_FAILED: 暂时不可用"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("COMMAND_LIST_FAILED: 暂时不可用");

    rerender(
      <ChatComposer
        {...baseProps}
        draft="/unknown"
        slashCommandsPhase="ready"
      />,
    );
    expect(screen.getByText("没有匹配的命令")).toBeInTheDocument();
  });

  it("支持 Tab、鼠标高亮、Escape 关闭和重新触发命令栏", () => {
    const onDraftChange = vi.fn();
    const onSend = vi.fn();
    const baseProps = {
      workspaceName: "workspace",
      phase: "ready" as const,
      eventConnection: "ready" as const,
      models: [],
      configuration: null,
      configuring: false,
      slashCommands: [
        { name: "review", description: "审查变更", source: "extension" as const },
        { name: "docs", description: "文档技能", source: "skill" as const },
      ],
      canSend: true,
      queuedMessages: { steering: [], followUp: [] },
      queuePaused: false,
      ...permissionProps,
      onModelChange: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      onSend,
      onClearQueue: vi.fn(),
      onAbort: vi.fn(),
    };
    const { rerender } = render(
      <ChatComposer
        {...baseProps}
        draft="/rev"
        onDraftChange={onDraftChange}
      />,
    );
    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    const review = screen.getByRole("menuitem", { name: /\/review/ });
    fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
    expect(onDraftChange).not.toHaveBeenCalled();
    fireEvent.mouseMove(review);
    expect(review).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(onDraftChange).toHaveBeenLastCalledWith("/review ");

    rerender(
      <ChatComposer
        {...baseProps}
        draft="/rev"
        onDraftChange={onDraftChange}
      />,
    );
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "命令" })).not.toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();

    fireEvent.change(textarea, { target: { value: "/d" } });
    expect(screen.getByRole("menu", { name: "命令" })).toBeInTheDocument();
  });

  it("连接未就绪时不展示命令栏", () => {
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="/"
        phase="ready"
        eventConnection="connecting"
        models={[]}
        configuration={null}
        configuring={false}
        slashCommands={[{ name: "review", description: "审查变更", source: "extension" }]}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );
    expect(screen.queryByRole("menu", { name: "命令" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("发送给 Pi 的消息")).toBeDisabled();
  });

  it("按 Escape 逐层返回，再关闭配置菜单并恢复入口焦点", () => {
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="执行检查"
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium", "high"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    openModelMenu();
    expect(screen.getByRole("menu", { name: "模型列表" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "模型列表" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "模型与思考强度设置" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模型与思考强度" })).toHaveFocus();
  });

  it("将模型和思考强度菜单渲染到顶层，避免被输入框裁切", () => {
    const onThinkingLevelChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[
          { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          { provider: "openai", id: "gpt-next", name: "GPT Next", reasoning: true },
        ]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "high",
          availableThinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={onThinkingLevelChange}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "模型与思考强度" }));
    expect(screen.queryByRole("menu", { name: "模型列表" })).not.toBeInTheDocument();
    const thinkingMenu = screen.getByRole("dialog", { name: "模型与思考强度设置" });
    expect(thinkingMenu.parentElement).toBe(document.body);
    expect(thinkingMenu).toHaveAttribute("data-floating-menu");
    expect(thinkingMenu.querySelectorAll(".composer-thinking-stops span")).toHaveLength(7);
    const slider = screen.getByRole("slider", { name: "思考强度" });
    fireEvent.change(slider, { target: { value: "6" } });
    fireEvent.pointerUp(slider);
    expect(onThinkingLevelChange).toHaveBeenCalledWith("max");
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    const modelMenu = screen.getByRole("menu", { name: "模型列表" });
    expect(modelMenu.parentElement).toBe(document.body);
    expect(modelMenu).toHaveAttribute("data-floating-menu");

    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
  });

  it("流式阶段允许追加输入并提供停止操作", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="追加检查"
        phase="streaming"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium", "high"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: ["已有引导"], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={onSend}
        onClearQueue={vi.fn()}
        onAbort={onAbort}
      />,
    );

    const textarea = screen.getByLabelText("发送给 Pi 的消息");
    expect(textarea).toBeEnabled();
    expect(textarea).toHaveAttribute("placeholder", "继续输入可加入后续队列");
    expect(screen.queryByText("Pi 正在处理")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "模型与思考强度" })).toBeDisabled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });
    expect(onSend).toHaveBeenNthCalledWith(1, undefined, "steer");
    expect(onSend).toHaveBeenNthCalledWith(2, undefined, "followUp");
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("从剪贴板提取图片文件并阻止浏览器插入二进制内容", () => {
    const onPasteImages = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft=""
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend={false}
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onPasteImages={onPasteImages}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "paste.png", {
      type: "image/png",
    });
    const textarea = screen.getByLabelText("发送给 Pi 的消息");

    expect(
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [
            { kind: "string", type: "text/plain", getAsFile: () => null },
            { kind: "file", type: "text/plain", getAsFile: () => null },
            { kind: "file", type: "image/png", getAsFile: () => null },
          ],
        },
      }),
    ).toBe(true);
    expect(onPasteImages).not.toHaveBeenCalled();

    expect(
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [
            { kind: "string", type: "text/plain", getAsFile: () => null },
            { kind: "file", type: "image/png", getAsFile: () => image },
          ],
        },
      }),
    ).toBe(false);
    expect(onPasteImages).toHaveBeenCalledWith([image]);
  });

  it("兼容 keyCode 229 的输入法组合事件", () => {
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeCompositionEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("展示 Pix 三档 SDK 工具权限并支持切换与取消菜单", () => {
    const onUseDefaultTools = vi.fn();
    const onToolSelectionChange = vi.fn();
    render(
      <ChatComposer
        workspaceName="workspace"
        draft="执行检查"
        phase="ready"
        eventConnection="ready"
        models={[{ provider: "openai", id: "gpt", name: "GPT", reasoning: true }]}
        configuration={{
          model: { provider: "openai", id: "gpt", name: "GPT", reasoning: true },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium"],
          ...toolConfiguration,
        }}
        configuring={false}
        canSend
        queuedMessages={{ steering: [], followUp: [] }}
        queuePaused={false}
        {...permissionProps}
        onUseDefaultTools={onUseDefaultTools}
        onToolSelectionChange={onToolSelectionChange}
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        onThinkingLevelChange={vi.fn()}
        onSend={vi.fn()}
        onClearQueue={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    expect(screen.getByRole("menu", { name: "工具权限" }).parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /自动审核/ }));
    expect(onToolSelectionChange).toHaveBeenLastCalledWith(["read", "grep", "find", "ls"]);
    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问/ }));
    expect(onToolSelectionChange).toHaveBeenLastCalledWith(availableTools.map((tool) => tool.name));

    fireEvent.click(screen.getByRole("button", { name: "选择工具权限" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "工具权限" })).not.toBeInTheDocument();
    expect(onUseDefaultTools).not.toHaveBeenCalled();
  });
});
