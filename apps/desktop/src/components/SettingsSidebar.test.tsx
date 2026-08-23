import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "./SettingsSidebar";

describe("SettingsSidebar", () => {
  it("支持返回、分组导航、搜索和键盘调整宽度", () => {
    const onBack = vi.fn();
    const onSectionChange = vi.fn();
    const onWidthChange = vi.fn();

    render(
      <SettingsSidebar
        open
        width={272}
        activeSection="general"
        onBack={onBack}
        onSectionChange={onSectionChange}
        onClose={vi.fn()}
        onWidthChange={onWidthChange}
      />,
    );

    expect(screen.getByRole("button", { name: "常规" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    expect(onSectionChange).toHaveBeenCalledWith("appearance");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索设置" }), {
      target: { value: "版本" },
    });
    expect(screen.getByRole("button", { name: "运行时" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "常规" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索设置" }), {
      target: { value: "Codex" },
    });
    expect(screen.getByRole("button", { name: "运行时" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("separator", { name: "调整侧边栏宽度" }), {
      key: "ArrowLeft",
    });
    expect(onWidthChange).toHaveBeenCalledWith(264);

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("搜索无结果时显示空状态", () => {
    render(
      <SettingsSidebar
        open
        width={272}
        activeSection="general"
        onBack={vi.fn()}
        onSectionChange={vi.fn()}
        onClose={vi.fn()}
        onWidthChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索设置" }), {
      target: { value: "不存在的选项" },
    });
    expect(screen.getByText("未找到相关设置")).toBeInTheDocument();
  });
});
