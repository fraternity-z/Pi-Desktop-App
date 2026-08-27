import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  exportAppearanceTheme,
  importAppearanceTheme,
  selectAppearanceBackground,
} from "../ipc/appearance";
import { DEFAULT_APP_PREFERENCES } from "../stores/useAppPreferences";
import type { DesktopNotificationController } from "../stores/useDesktopNotifications";
import type { RequestHeaderSettingsController } from "../stores/useRequestHeaderSettings";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import { SettingsView } from "./SettingsView";

vi.mock("../ipc/appearance", () => ({
  appearanceBackgroundUrl: vi.fn((path: string) => `asset://${path}`),
  exportAppearanceTheme: vi.fn(),
  importAppearanceTheme: vi.fn(),
  selectAppearanceBackground: vi.fn(),
}));

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

function readyRequestHeaders(
  overrides: Partial<RequestHeaderSettingsController> = {},
): RequestHeaderSettingsController {
  return {
    phase: "ready",
    settings: { enabled: false, client: "claude-code" },
    saving: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function readyNotifications(
  overrides: Partial<DesktopNotificationController> = {},
): DesktopNotificationController {
  return {
    permission: "granted",
    phase: "idle",
    error: null,
    status: null,
    setEnabled: vi.fn().mockResolvedValue(true),
    sendTestNotification: vi.fn().mockResolvedValue(true),
    openSystemSettings: vi.fn().mockResolvedValue(true),
    clearFeedback: vi.fn(),
    ...overrides,
  };
}

describe("SettingsView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(exportAppearanceTheme).mockReset();
    vi.mocked(importAppearanceTheme).mockReset();
    vi.mocked(selectAppearanceBackground).mockReset();
  });

  it("常规设置通过可访问开关即时提交", () => {
    const onPreferencesChange = vi.fn();
    const onBack = vi.fn();
    render(
      <SettingsView
        section="general"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={onBack}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={onPreferencesChange}
      />,
    );

    const suggestions = screen.getByRole("switch", { name: "建议提示" });
    expect(suggestions).toHaveAttribute("aria-checked", "true");
    fireEvent.click(suggestions);
    expect(onPreferencesChange).toHaveBeenCalledWith({ showSuggestions: false });
    expect(screen.getByTestId("settings-general")).toBeInTheDocument();
  });

  it("外观设置支持主题预览应用、缩放、字体、透明效果和侧边栏宽度", () => {
    const onPreferencesChange = vi.fn();
    const onSidebarWidthChange = vi.fn();
    render(
      <SettingsView
        section="appearance"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={onSidebarWidthChange}
        onPreferencesChange={onPreferencesChange}
      />,
    );

    expect(screen.getByRole("main")).toHaveClass("settings-main-appearance");

    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), {
      target: { value: "dark" },
    });
    expect(onPreferencesChange).toHaveBeenCalledWith({ theme: "dark" });

    fireEvent.click(screen.getByRole("button", { name: "预览主题：魔女伊雷娜 · 月夜旅途" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ backgroundPreset: "cyan-stage" });

    fireEvent.change(screen.getByRole("combobox", { name: "缩放比例" }), {
      target: { value: "110" },
    });
    expect(onPreferencesChange).toHaveBeenCalledWith({ uiScale: 110 });

    fireEvent.change(screen.getByRole("combobox", { name: "UI 字体" }), {
      target: { value: "microsoft-yahei" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "UI 字号" }), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "代码字体" }), {
      target: { value: "consolas" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "代码字号" }), {
      target: { value: "13" },
    });
    expect(onPreferencesChange).toHaveBeenCalledWith({ uiFont: "microsoft-yahei" });
    expect(onPreferencesChange).toHaveBeenCalledWith({ uiFontSize: 15 });
    expect(onPreferencesChange).toHaveBeenCalledWith({ codeFont: "consolas" });
    expect(onPreferencesChange).toHaveBeenCalledWith({ codeFontSize: 13 });

    fireEvent.click(screen.getByRole("switch", { name: "侧边栏半透明" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ sidebarTranslucent: true });

    fireEvent.change(screen.getByRole("slider", { name: "侧边栏宽度" }), {
      target: { value: "320" },
    });
    expect(onSidebarWidthChange).toHaveBeenCalledWith(320);
  });

  it("新建主题支持选择、预览和保存自定义背景", async () => {
    const onPreferencesChange = vi.fn();
    vi.mocked(selectAppearanceBackground).mockResolvedValue({
      path: "C:\\AppData\\Pi Desktop\\appearance\\backgrounds\\custom.png",
    });
    render(
      <SettingsView
        section="appearance"
        sidebarOpen
        sidebarWidth={300}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={onPreferencesChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建主题" }));
    fireEvent.change(screen.getByLabelText("主题名称"), { target: { value: "夜航" } });
    fireEvent.click(screen.getByRole("button", { name: "选择图片" }));
    await waitFor(() => expect(selectAppearanceBackground).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByAltText("自定义主题背景预览")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "保存主题" }));

    expect(onPreferencesChange).toHaveBeenCalledWith({
      customThemeName: "夜航",
      customBackgroundPath: "C:\\AppData\\Pi Desktop\\appearance\\backgrounds\\custom.png",
    });
    expect(screen.getByRole("status")).toHaveTextContent("主题已保存，可预览后应用");
  });

  it("主题导入后完整应用并可导出当前预览", async () => {
    const onPreferencesChange = vi.fn();
    const onSidebarWidthChange = vi.fn();
    vi.mocked(importAppearanceTheme).mockResolvedValue({
      name: "导入主题",
      theme: "dark",
      backgroundPreset: "custom",
      uiScale: 110,
      uiFont: "microsoft-yahei",
      uiFontSize: 15,
      codeFont: "consolas",
      codeFontSize: 13,
      sidebarTranslucent: true,
      sidebarWidth: 320,
      customBackgroundPath: "C:\\AppData\\background.png",
    });
    vi.mocked(exportAppearanceTheme).mockResolvedValue(true);
    render(
      <SettingsView
        section="appearance"
        sidebarOpen
        sidebarWidth={300}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={onSidebarWidthChange}
        onPreferencesChange={onPreferencesChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() =>
      expect(onPreferencesChange).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: "dark",
          backgroundPreset: "custom",
          customThemeName: "导入主题",
          uiScale: 110,
        }),
      ),
    );
    expect(onSidebarWidthChange).toHaveBeenCalledWith(320);

    fireEvent.click(screen.getByRole("button", { name: "预览主题：魔女伊雷娜 · 花海日记" }));
    fireEvent.click(screen.getByRole("button", { name: "导出" }));
    await waitFor(() =>
      expect(exportAppearanceTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "魔女伊雷娜 · 花海日记",
          backgroundPreset: "rose-cinema",
          customBackgroundPath: null,
        }),
      ),
    );
  });

  it("运行时页面展示版本并允许重新检测", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsView
        section="runtime"
        sidebarOpen={false}
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={readyRequestHeaders()}
        runtime={{ ...readyRuntime, refresh }}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={vi.fn()}
      />,
    );

    expect(screen.getByText("0.84.2")).toBeInTheDocument();
    expect(screen.getByText("22.23.2")).toBeInTheDocument();
    expect(screen.getByText("path-pi-command")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新检测运行时" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "打开设置导航" })).toBeInTheDocument();
  });

  it("运行时页面可启停请求头伪装并选择客户端", () => {
    const update = vi.fn().mockResolvedValue(true);
    render(
      <SettingsView
        section="runtime"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={
          readyRequestHeaders({
            settings: { enabled: true, client: "claude-code" },
            update,
          })
        }
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "客户端请求头伪装" }));
    fireEvent.change(screen.getByRole("combobox", { name: "客户端类型" }), {
      target: { value: "codex" },
    });

    expect(update).toHaveBeenNthCalledWith(1, { enabled: false });
    expect(update).toHaveBeenNthCalledWith(2, { client: "codex" });
  });

  it("请求头设置读取失败时禁用控件并允许重试", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsView
        section="runtime"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={
          readyRequestHeaders({
            phase: "error",
            error: "REQUEST_HEADER_SETTINGS_READ_FAILED: 无法读取请求头设置",
            refresh,
          })
        }
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("switch", { name: "客户端请求头伪装" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("REQUEST_HEADER_SETTINGS_READ_FAILED");
    fireEvent.click(screen.getByRole("button", { name: "重新加载请求头设置" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("行为设置提交确认、导航与界面辅助偏好", () => {
    const onPreferencesChange = vi.fn();
    render(
      <SettingsView
        section="behavior"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={onPreferencesChange}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "移除项目时确认" }));
    fireEvent.click(screen.getByRole("switch", { name: "窄屏导航后关闭侧边栏" }));
    fireEvent.change(screen.getByRole("combobox", { name: "界面密度" }), {
      target: { value: "compact" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "减少动态效果" }));

    expect(onPreferencesChange).toHaveBeenNthCalledWith(1, { confirmRemoveWorkspace: false });
    expect(onPreferencesChange).toHaveBeenNthCalledWith(2, { closeSidebarOnNavigation: false });
    expect(onPreferencesChange).toHaveBeenNthCalledWith(3, { interfaceDensity: "compact" });
    expect(onPreferencesChange).toHaveBeenNthCalledWith(4, { reduceMotion: true });
  });

  it("已归档页面支持搜索、恢复和确认删除会话", async () => {
    window.localStorage.setItem("pix.threads.archived", JSON.stringify(["saved", "remove"]));
    window.localStorage.setItem(
      "pix.threads.archivedMeta",
      JSON.stringify({
        saved: {
          title: "等待恢复",
          cwd: "C:\\projects\\alpha",
          archivedAt: "2026-08-23T08:30:00.000Z",
        },
        remove: {
          title: "等待删除",
          cwd: "C:\\projects\\beta",
          archivedAt: "2026-08-22T08:30:00.000Z",
        },
      }),
    );
    render(
      <SettingsView
        section="archived"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={readyNotifications()}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={vi.fn()}
      />,
    );

    expect(screen.getByText("等待恢复")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索已归档会话" }), {
      target: { value: "等待恢复" },
    });
    expect(screen.queryByText("等待删除")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复等待恢复" }));
    await waitFor(() => expect(screen.queryByText("等待恢复")).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem("pix.threads.archived")!)).toEqual(["remove"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索已归档会话" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "删除等待删除" }));
    expect(screen.getByRole("dialog", { name: "删除已归档会话" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(screen.queryByText("等待删除")).not.toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem("pix.threads.deleted")!)).toContain("remove");
  });

  it("通知设置支持主开关、分类开关和系统操作", () => {
    const onPreferencesChange = vi.fn();
    const notifications = readyNotifications();
    render(
      <SettingsView
        section="notifications"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={notifications}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={onPreferencesChange}
      />,
    );

    expect(screen.getAllByRole("switch")).toHaveLength(6);
    expect(screen.getByText("系统已允许")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "桌面通知" }));
    fireEvent.click(screen.getByRole("switch", { name: "任务完成时通知" }));
    fireEvent.click(screen.getByRole("button", { name: "发送测试通知" }));
    fireEvent.click(screen.getByRole("button", { name: "打开系统通知设置" }));

    expect(notifications.setEnabled).toHaveBeenCalledWith(false);
    expect(onPreferencesChange).toHaveBeenCalledWith({ taskCompletedNotifications: false });
    expect(notifications.sendTestNotification).toHaveBeenCalledOnce();
    expect(notifications.openSystemSettings).toHaveBeenCalledOnce();
  });

  it("系统拒绝权限时主开关显示关闭并可重新请求权限", () => {
    const notifications = readyNotifications({
      permission: "denied",
      error: "系统未授予通知权限",
    });
    render(
      <SettingsView
        section="notifications"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        notifications={notifications}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={vi.fn()}
        onPreferencesChange={vi.fn()}
      />,
    );

    expect(screen.getByText("系统未允许")).toBeInTheDocument();
    const masterSwitch = screen.getByRole("switch", { name: "桌面通知" });
    expect(masterSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "任务完成时通知" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("系统未授予通知权限");
    fireEvent.click(masterSwitch);
    expect(notifications.setEnabled).toHaveBeenCalledWith(true);
  });
});
