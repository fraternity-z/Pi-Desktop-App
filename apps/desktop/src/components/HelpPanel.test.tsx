import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  HelpPanel,
  PI_DESKTOP_FEEDBACK_URL,
  PI_DESKTOP_PROJECT_URL,
  PI_DESKTOP_RELEASES_URL,
} from "./HelpPanel";

describe("HelpPanel", () => {
  it("关闭时不渲染，打开时展示帮助选项和项目地址", () => {
    const onClose = vi.fn();
    const { rerender } = render(<HelpPanel open={false} onClose={onClose} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<HelpPanel open onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "帮助与支持" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "反馈" })).toHaveAttribute(
      "href",
      PI_DESKTOP_FEEDBACK_URL,
    );
    expect(screen.getByRole("link", { name: "检查更新" })).toHaveAttribute(
      "href",
      PI_DESKTOP_RELEASES_URL,
    );
    expect(screen.getByRole("link", { name: "项目地址" })).toHaveAttribute(
      "href",
      PI_DESKTOP_PROJECT_URL,
    );
  });

  it("可以进入关于页并返回帮助选项", () => {
    render(<HelpPanel open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByRole("dialog", { name: "关于 Pi Desktop" })).toBeInTheDocument();
    expect(screen.getByText(/版本/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "项目地址" })).toHaveAttribute(
      "href",
      PI_DESKTOP_PROJECT_URL,
    );

    fireEvent.click(screen.getByRole("button", { name: "返回帮助" }));
    expect(screen.getByRole("dialog", { name: "帮助与支持" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关于" })).toBeInTheDocument();
  });

  it("响应 Esc、遮罩点击和关闭按钮", () => {
    const onClose = vi.fn();
    render(<HelpPanel open onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(document.querySelector(".help-panel-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "关闭帮助" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
