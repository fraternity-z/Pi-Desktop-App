import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentPackageSummary, AgentResourceSummary } from "../ipc/agent";
import { PackageManagerView, ResourcesView } from "./EcosystemViews";

type EcosystemController = ComponentProps<typeof PackageManagerView>["ecosystem"];

const basePackage: AgentPackageSummary = {
  source: "npm:pi-test",
  scope: "global",
  kind: "npm",
  installedPath: "C:\\agent\\packages\\pi-test",
  filtered: false,
  enabled: true,
};

const resources: AgentResourceSummary[] = [
  {
    kind: "skill",
    name: "review",
    path: "C:\\agent\\skills\\review\\SKILL.md",
    source: "npm:pi-test",
  },
  {
    kind: "extension",
    name: "tools.ts",
    path: "C:\\work\\.pi\\extensions\\tools.ts",
  },
];

function controller(overrides: Partial<EcosystemController> = {}): EcosystemController {
  return {
    phase: "ready",
    packages: [basePackage],
    resources,
    updates: [],
    error: null,
    operation: null,
    refresh: vi.fn(async () => true),
    installPackage: vi.fn(async () => true),
    setPackageEnabled: vi.fn(async () => true),
    removePackage: vi.fn(async () => true),
    updatePackage: vi.fn(async () => true),
    checkUpdates: vi.fn(async () => true),
    ...overrides,
  };
}

function packageProps(ecosystem: EcosystemController) {
  return {
    cwd: "C:\\work",
    sidebarOpen: false,
    ecosystem,
    onOpenSidebar: vi.fn(),
    onBack: vi.fn(),
  };
}

describe("EcosystemViews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  it("管理插件列表、更新、启停、删除和分页", async () => {
    const packages = Array.from({ length: 12 }, (_, index) => ({
      ...basePackage,
      source: `npm:pi-test-${index}`,
      installedPath: `C:\\agent\\packages\\pi-test-${index}`,
    }));
    packages[1] = {
      ...packages[1],
      scope: "project",
      kind: "local",
      filtered: true,
    };
    const ecosystem = controller({
      packages,
      updates: [
        { source: packages[0].source, displayName: "Pi Test 0", type: "npm", scope: "global" },
      ],
    });
    const props = packageProps(ecosystem);
    render(<PackageManagerView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "打开侧边栏" }));
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    fireEvent.click(screen.getByRole("button", { name: "检查插件更新" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新插件" }));
    expect(props.onOpenSidebar).toHaveBeenCalledOnce();
    expect(props.onBack).toHaveBeenCalledOnce();
    expect(ecosystem.checkUpdates).toHaveBeenCalledWith("C:\\work");
    expect(ecosystem.refresh).toHaveBeenCalledWith("C:\\work");
    expect(screen.getByText("可更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新pi-test-1" })).toBeDisabled();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(ecosystem.setPackageEnabled).toHaveBeenCalledWith(
      "C:\\work",
      packages[0],
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "更新pi-test-0" }));
    expect(ecosystem.updatePackage).toHaveBeenCalledWith("C:\\work", "npm:pi-test-0");

    fireEvent.click(screen.getByRole("button", { name: "移除pi-test-0" }));
    expect(screen.getByRole("dialog", { name: "移除插件" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除" }));
    await waitFor(() => expect(ecosystem.removePackage).toHaveBeenCalledWith("C:\\work", packages[0]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "移除插件" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("pi-test-11")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索插件" }), {
      target: { value: "pi-test-0" },
    });
    expect(await screen.findByText("pi-test-0")).toBeInTheDocument();
    expect(screen.queryByText("pi-test-11")).not.toBeInTheDocument();
  });

  it("安装插件时校验重复名称、范围并在成功后返回列表", async () => {
    const ecosystem = controller();
    render(<PackageManagerView {...packageProps(ecosystem)} sidebarOpen />);

    fireEvent.click(screen.getByRole("tab", { name: "添加插件" }));
    const source = screen.getByLabelText("插件来源");
    fireEvent.change(source, { target: { value: "npm:pi-test" } });
    expect(screen.getByRole("alert")).toHaveTextContent("该范围内已配置同名插件");
    expect(screen.getByRole("button", { name: "安装" })).toBeDisabled();

    fireEvent.change(source, { target: { value: "  npm:pi-extra  " } });
    fireEvent.click(screen.getByRole("button", { name: "当前项目" }));
    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    await waitFor(() =>
      expect(ecosystem.installPackage).toHaveBeenCalledWith(
        "C:\\work",
        "npm:pi-extra",
        "project",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "已安装" })).toHaveAttribute("aria-selected", "true"),
    );
  });

  it("展示插件加载、空状态和可重试错误", () => {
    const loading = controller({ phase: "loading", packages: [] });
    const props = packageProps(loading);
    const { rerender } = render(<PackageManagerView {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取 Pi 插件");

    const failed = controller({ phase: "error", packages: [], error: "PACKAGE_LIST_FAILED: 无法读取" });
    rerender(<PackageManagerView {...packageProps(failed)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("PACKAGE_LIST_FAILED");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(failed.refresh).toHaveBeenCalledWith("C:\\work");

    const empty = controller({ packages: [] });
    rerender(<PackageManagerView {...packageProps(empty)} />);
    fireEvent.click(screen.getByRole("button", { name: "添加插件" }));
    expect(screen.getByRole("heading", { name: "安装插件" })).toBeInTheDocument();
  });

  it("筛选资源、刷新并复制资源路径", async () => {
    const ecosystem = controller();
    const props = packageProps(ecosystem);
    render(<ResourcesView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "打开侧边栏" }));
    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新资源" }));
    expect(props.onOpenSidebar).toHaveBeenCalledOnce();
    expect(props.onBack).toHaveBeenCalledOnce();
    expect(ecosystem.refresh).toHaveBeenCalledWith("C:\\work");

    fireEvent.click(screen.getByRole("tab", { name: "技能1" }));
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.queryByText("tools.ts")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制review路径" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "C:\\agent\\skills\\review\\SKILL.md",
      ),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "搜索资源" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("没有匹配的资源")).toBeInTheDocument();
  });

  it("展示资源加载、空状态、错误与剪贴板降级", async () => {
    const loading = controller({ phase: "loading", resources: [] });
    const { rerender } = render(<ResourcesView {...packageProps(loading)} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取 Pi 资源");

    const failed = controller({ phase: "error", resources: [], error: "RESOURCE_LIST_FAILED: 无法读取" });
    rerender(<ResourcesView {...packageProps(failed)} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(failed.refresh).toHaveBeenCalledWith("C:\\work");

    const copyFailure = controller({ resources: [resources[0]] });
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    rerender(<ResourcesView {...packageProps(copyFailure)} sidebarOpen />);
    fireEvent.click(screen.getByRole("button", { name: "复制review路径" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());

    const empty = controller({ resources: [] });
    rerender(<ResourcesView {...packageProps(empty)} />);
    expect(screen.getByText("当前项目没有可用资源")).toBeInTheDocument();
  });
});
