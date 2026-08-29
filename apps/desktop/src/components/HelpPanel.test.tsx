import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HelpPanel,
  PI_DESKTOP_FEEDBACK_URL,
  PI_DESKTOP_PROJECT_URL,
  PI_DESKTOP_RELEASES_URL,
} from "./HelpPanel";
import { checkForUpdates } from "../ipc/update";

vi.mock("../ipc/update", () => ({
  checkForUpdates: vi.fn(),
}));

const availableUpdate = {
  currentVersion: "0.1.2",
  latestVersion: "0.1.3",
  updateAvailable: true,
  releaseUrl: "https://github.com/fraternity-z/Pi-Desktop-App/releases/tag/v0.1.3",
  downloadUrl: "https://github.com/fraternity-z/Pi-Desktop-App/releases/download/v0.1.3/Pi.exe",
};

describe("HelpPanel", () => {
  beforeEach(() => {
    vi.mocked(checkForUpdates).mockReset();
  });

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

  it("检查到新版本时展示版本信息、发布页和下载地址", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    render(<HelpPanel open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("link", { name: "检查更新" }));

    expect(await screen.findByText("有新版本可用")).toBeInTheDocument();
    expect(screen.getByText("当前版本：0.1.2")).toBeInTheDocument();
    expect(screen.getByText("最新版本：0.1.3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看 GitHub 发布页面/ })).toHaveAttribute(
      "href",
      availableUpdate.releaseUrl,
    );
    expect(screen.getByRole("link", { name: /下载更新/ })).toHaveAttribute(
      "href",
      availableUpdate.downloadUrl,
    );
  });

  it("版本相同时提示已是最新版本", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({
      ...availableUpdate,
      latestVersion: "0.1.2",
      updateAvailable: false,
      downloadUrl: null,
    });
    render(<HelpPanel open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("link", { name: "检查更新" }));

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /下载更新/ })).not.toBeInTheDocument();
  });

  it("显示加载状态并避免重复请求，网络异常时保留面板", async () => {
    let reject: ((reason?: unknown) => void) | undefined;
    vi.mocked(checkForUpdates).mockImplementation(
      () => new Promise((_resolve, nextReject) => {
        reject = nextReject;
      }),
    );
    render(<HelpPanel open onClose={vi.fn()} />);
    const trigger = screen.getByRole("link", { name: "检查更新" });

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(await screen.findByText("正在检查更新…")).toBeInTheDocument();

    await act(async () => {
      reject?.({ code: "UPDATE_CHECK_FAILED", message: "网络不可用" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "检查更新失败：UPDATE_CHECK_FAILED: 网络不可用",
    );
    expect(screen.getByRole("dialog", { name: "帮助与支持" })).toBeInTheDocument();
  });
});
