import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderLogin, ProviderSnapshot } from "../ipc/providers";
import {
  useProviderSettings,
  type ProviderSettingsController,
} from "../stores/useProviderSettings";
import { ModelProviderSettings } from "./ModelProviderSettings";

vi.mock("../stores/useProviderSettings", () => ({
  useProviderSettings: vi.fn(),
}));
const catalog: ProviderSnapshot = {
  revision: "original-revision",
  warning: null,
  defaultModel: { provider: "alpha", id: "first" },
  providers: [
    {
      id: "alpha",
      name: "Alpha",
      connected: true,
      oauth: true,
      authType: "oauth",
      storedCredential: true,
      custom: false,
      models: [
        {
          provider: "alpha",
          id: "first",
          name: "Alpha First",
          reasoning: true,
          available: true,
        },
        {
          provider: "alpha",
          id: "second",
          name: "Alpha Second",
          reasoning: false,
          available: true,
        },
      ],
    },
    {
      id: "beta",
      name: "Beta",
      connected: false,
      oauth: true,
      authType: null,
      storedCredential: false,
      custom: false,
      models: [
        {
          provider: "beta",
          id: "third",
          name: "Beta Model",
          reasoning: false,
          available: false,
        },
      ],
    },
    {
      id: "local",
      name: "Local",
      connected: false,
      oauth: false,
      authType: null,
      storedCredential: false,
      custom: true,
      models: [],
    },
  ],
};
const pending: ProviderLogin = {
  id: "login",
  provider: "beta",
  status: "pending",
  message: "请完成官方授权",
  url: "https://example.com/oauth",
  userCode: "DEMO-CODE",
  prompt: { id: "p1", type: "manual_code", message: "粘贴授权码" },
  errorCode: null,
};
let controller: ProviderSettingsController;
function editor() {
  return screen.getByRole("region", { name: "配置自定义模型" });
}
function fillModel() {
  fireEvent.change(within(editor()).getByLabelText("提供商 ID"), {
    target: { value: "custom" },
  });
  fireEvent.change(within(editor()).getByLabelText("API 端点"), {
    target: { value: "https://example.com/v1" },
  });
  fireEvent.change(within(editor()).getByLabelText("模型 ID"), {
    target: { value: "sample" },
  });
}

describe("ModelProviderSettings", () => {
  beforeEach(() => {
    controller = {
      snapshot: structuredClone(catalog),
      login: null,
      busy: false,
      error: null,
      status: null,
      refresh: vi.fn().mockResolvedValue(true),
      startLogin: vi.fn().mockResolvedValue(true),
      reply: vi.fn().mockResolvedValue(true),
      cancelLogin: vi.fn().mockResolvedValue(true),
      openLogin: vi.fn().mockResolvedValue(true),
      logout: vi.fn().mockResolvedValue(true),
      saveModel: vi.fn().mockResolvedValue(true),
      setDefault: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(useProviderSettings).mockImplementation(() => controller);
  });

  it("shows connected providers, switches cards and sets only available models", () => {
    render(<ModelProviderSettings />);
    expect(screen.getAllByText("Alpha First")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Alpha First 已是默认模型" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "将 Alpha Second 设为默认模型" }),
    );
    expect(controller.setDefault).toHaveBeenCalledWith("alpha", "second");
    fireEvent.click(screen.getByRole("button", { name: "选择提供商 Beta" }));
    expect(
      screen.getByRole("button", { name: "将 Beta Model 设为默认模型" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "登录账户" }));
    expect(controller.startLogin).toHaveBeenCalledWith("beta");
    fireEvent.click(screen.getByRole("button", { name: "选择提供商 Local" }));
    expect(
      screen.queryByRole("button", { name: "登录账户" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/暂无模型/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新提供商" }));
    expect(controller.refresh).toHaveBeenCalledOnce();
  });

  it("filters providers and model names without changing the saved default", () => {
    render(<ModelProviderSettings />);
    fireEvent.click(screen.getByRole("button", { name: "已连接" }));
    expect(
      screen.queryByRole("button", { name: "选择提供商 Beta" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "账户登录" }));
    expect(
      screen.getByRole("button", { name: "选择提供商 Beta" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "选择提供商 Local" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索提供商"), {
      target: { value: " missing " },
    });
    expect(screen.getByText("没有匹配的提供商")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索 Alpha 模型"), {
      target: { value: "SECOND" },
    });
    expect(
      screen.queryByRole("button", { name: "Alpha First 已是默认模型" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索 Alpha 模型"), {
      target: { value: "missing" },
    });
    expect(screen.getByText("没有匹配的模型")).toBeInTheDocument();
    expect(controller.setDefault).not.toHaveBeenCalled();
  });

  it("shows loading, unavailable, warnings and empty provider filters", () => {
    controller.snapshot = null;
    controller.busy = true;
    const { rerender } = render(<ModelProviderSettings />);
    expect(screen.getByText("正在读取 Pi 模型目录")).toBeInTheDocument();
    controller.busy = false;
    controller.error = "运行时不可用";
    rerender(<ModelProviderSettings />);
    expect(screen.getByRole("alert")).toHaveTextContent("运行时不可用");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(controller.refresh).toHaveBeenCalledOnce();
    controller.snapshot = {
      providers: [],
      defaultModel: null,
      revision: "r",
      warning: "配置警告",
    };
    controller.status = "刷新成功";
    rerender(<ModelProviderSettings />);
    expect(screen.getByText("尚未设置默认模型")).toBeInTheDocument();
    expect(screen.getByText("配置警告")).toBeInTheDocument();
    expect(screen.getByText("刷新成功")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "已连接" }));
    expect(screen.getByText("还没有连接的提供商")).toBeInTheDocument();
  });

  it("requires confirmation before removing a stored credential", async () => {
    render(<ModelProviderSettings />);
    fireEvent.click(screen.getByRole("button", { name: "断开 Alpha" }));
    expect(controller.logout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "断开连接" }));
    await waitFor(() =>
      expect(controller.logout).toHaveBeenCalledWith("alpha"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "断开 Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(controller.logout).toHaveBeenCalledOnce();
  });

  it("saves environment references and preserves the revision captured on opening", async () => {
    const { rerender } = render(<ModelProviderSettings />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型服务" }));
    fillModel();
    fireEvent.change(within(editor()).getByLabelText(/API Key 环境变量/), {
      target: { value: "EXAMPLE_API_KEY" },
    });
    fireEvent.change(within(editor()).getByLabelText(/显示名称/), {
      target: { value: "Custom model" },
    });
    fireEvent.change(within(editor()).getByLabelText("API 协议"), {
      target: { value: "openai-responses" },
    });
    fireEvent.click(within(editor()).getByLabelText("支持思考模式"));
    controller.snapshot = {
      ...controller.snapshot!,
      revision: "external-change",
    };
    rerender(<ModelProviderSettings />);
    fireEvent.click(screen.getByRole("button", { name: "保存模型" }));
    await waitFor(() =>
      expect(controller.saveModel).toHaveBeenCalledWith({
        provider: "custom",
        baseUrl: "https://example.com/v1",
        api: "openai-responses",
        apiKeyEnv: "EXAMPLE_API_KEY",
        modelId: "sample",
        modelName: "Custom model",
        reasoning: true,
        contextWindow: 128000,
        maxTokens: 8192,
        expectedRevision: "original-revision",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "配置自定义模型" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("validates token limits and keeps failed drafts open without a key field", async () => {
    vi.mocked(controller.saveModel).mockResolvedValue(false);
    render(<ModelProviderSettings />);
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(within(editor()).getByLabelText("提供商 ID")).toHaveValue("alpha");
    fillModel();
    fireEvent.change(within(editor()).getByLabelText("上下文窗口"), {
      target: { value: "1000" },
    });
    expect(screen.getByRole("button", { name: "保存模型" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "最大输出不能超过上下文窗口",
    );
    fireEvent.submit(editor().querySelector("form")!);
    expect(controller.saveModel).not.toHaveBeenCalled();
    fireEvent.change(within(editor()).getByLabelText("最大输出 Token"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模型" }));
    await waitFor(() => expect(controller.saveModel).toHaveBeenCalled());
    expect(vi.mocked(controller.saveModel).mock.calls[0]?.[0]).toMatchObject({
      modelName: "sample",
      contextWindow: 1000,
      maxTokens: 500,
    });
    expect(
      vi.mocked(controller.saveModel).mock.calls[0]?.[0],
    ).not.toHaveProperty("apiKeyEnv");
    expect(editor().querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭模型配置" }));
    expect(
      screen.queryByRole("region", { name: "配置自定义模型" }),
    ).not.toBeInTheDocument();
  });

  it("opens official authorization only on click and clears one-time input", () => {
    controller.login = pending;
    const { rerender } = render(<ModelProviderSettings />);
    expect(screen.getByText("DEMO-CODE")).toBeInTheDocument();
    expect(controller.openLogin).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "刷新提供商" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "打开官方授权页面" }));
    expect(controller.openLogin).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("官方登录输入"), {
      target: { value: "one-time-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(controller.reply).toHaveBeenCalledWith("p1", "one-time-code");
    expect(screen.getByLabelText("官方登录输入")).toHaveValue("");
    controller.login = {
      ...pending,
      prompt: {
        id: "p2",
        type: "select",
        message: "选择组织",
        options: [{ id: "org", label: "Example organization" }],
      },
    };
    rerender(<ModelProviderSettings />);
    fireEvent.change(screen.getByLabelText("官方登录选项"), {
      target: { value: "org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(controller.reply).toHaveBeenLastCalledWith("p2", "org");
    fireEvent.click(screen.getByRole("button", { name: "取消登录" }));
    expect(controller.cancelLogin).toHaveBeenCalledOnce();
  });

  it("shows a retry after login errors and removes controls on success", () => {
    controller.login = {
      ...pending,
      status: "error",
      prompt: null,
      url: null,
      userCode: null,
      message: "登录失败",
    };
    const { rerender } = render(<ModelProviderSettings />);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Beta 账户登录" })).getByRole(
        "button",
        { name: "重新登录" },
      ),
    );
    expect(controller.startLogin).toHaveBeenCalledWith("beta");
    controller.login = {
      ...controller.login,
      status: "success",
      message: "登录成功",
    };
    rerender(<ModelProviderSettings />);
    expect(screen.getByText("登录成功")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取消登录" }),
    ).not.toBeInTheDocument();
  });
});
