import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_APP_PREFERENCES } from "../stores/useAppPreferences";
import type { RequestHeaderSettingsController } from "../stores/useRequestHeaderSettings";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import { SettingsView } from "./SettingsView";

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

describe("SettingsView", () => {
  beforeEach(() => window.localStorage.clear());

  it("常规设置通过可访问开关即时提交", () => {
    const onPreferencesChange = vi.fn();
    const onBack = vi.fn();
    render(
      <SettingsView
        section="general"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
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

  it("外观设置支持主题、密度、透明效果和侧边栏宽度", () => {
    const onPreferencesChange = vi.fn();
    const onSidebarWidthChange = vi.fn();
    render(
      <SettingsView
        section="appearance"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
        requestHeaders={readyRequestHeaders()}
        runtime={readyRuntime}
        eventConnection="ready"
        onOpenSidebar={vi.fn()}
        onBack={vi.fn()}
        onSidebarWidthChange={onSidebarWidthChange}
        onPreferencesChange={onPreferencesChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "颜色主题" }), {
      target: { value: "dark" },
    });
    expect(onPreferencesChange).toHaveBeenCalledWith({ theme: "dark" });

    fireEvent.change(screen.getByRole("combobox", { name: "界面密度" }), {
      target: { value: "compact" },
    });
    expect(onPreferencesChange).toHaveBeenCalledWith({ interfaceDensity: "compact" });

    fireEvent.click(screen.getByRole("switch", { name: "侧边栏透明效果" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ sidebarTranslucent: true });

    fireEvent.change(screen.getByRole("slider", { name: "侧边栏宽度" }), {
      target: { value: "320" },
    });
    expect(onSidebarWidthChange).toHaveBeenCalledWith(320);
  });

  it("运行时页面展示版本并允许重新检测", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsView
        section="runtime"
        sidebarOpen={false}
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
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

  it("行为设置提交确认与窄屏导航偏好", () => {
    const onPreferencesChange = vi.fn();
    render(
      <SettingsView
        section="behavior"
        sidebarOpen
        sidebarWidth={272}
        preferences={DEFAULT_APP_PREFERENCES}
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

    expect(onPreferencesChange).toHaveBeenNthCalledWith(1, { confirmRemoveWorkspace: false });
    expect(onPreferencesChange).toHaveBeenNthCalledWith(2, { closeSidebarOnNavigation: false });
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
});
