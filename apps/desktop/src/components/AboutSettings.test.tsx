import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appMetadata from "../../package.json";
import {
  AboutSettings,
  PI_DESKTOP_FEEDBACK_URL,
  PI_DESKTOP_PROJECT_URL,
  PI_DESKTOP_RELEASES_URL,
} from "./AboutSettings";
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

describe("AboutSettings", () => {
  beforeEach(() => {
    vi.mocked(checkForUpdates).mockReset();
  });

  it("直接展示应用版本、反馈、更新和项目地址，不使用弹窗", () => {
    render(<AboutSettings />);

    expect(screen.getByRole("heading", { name: "Pi Desktop" })).toBeInTheDocument();
    expect(screen.getByText(`版本 ${appMetadata.version}`)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(checkForUpdates).not.toHaveBeenCalled();
    for (const [name, href] of [
      ["反馈", PI_DESKTOP_FEEDBACK_URL],
      ["检查更新", PI_DESKTOP_RELEASES_URL],
      ["项目地址", PI_DESKTOP_PROJECT_URL],
    ]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("检查到新版本时展示版本信息、发布页和下载地址", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    render(<AboutSettings />);

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
    render(<AboutSettings />);

    fireEvent.click(screen.getByRole("link", { name: "检查更新" }));

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /下载更新/ })).not.toBeInTheDocument();
  });

  it("新版本无安装包时仍可访问发布页", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({ ...availableUpdate, downloadUrl: null });
    render(<AboutSettings />);

    fireEvent.click(screen.getByRole("link", { name: "检查更新" }));

    expect(await screen.findByText("有新版本可用")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看 GitHub 发布页面/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /下载更新/ })).not.toBeInTheDocument();
  });

  it("显示加载状态并避免重复请求，网络异常时保留页面且可重试", async () => {
    let reject: ((reason?: unknown) => void) | undefined;
    vi.mocked(checkForUpdates).mockImplementationOnce(
      () => new Promise((_resolve, nextReject) => {
        reject = nextReject;
      }),
    );
    render(<AboutSettings />);
    const trigger = screen.getByRole("link", { name: "检查更新" });

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(await screen.findByText("正在检查更新…")).toBeInTheDocument();

    await act(async () => {
      reject?.({ code: "UPDATE_CHECK_FAILED", message: "网络不可用" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "检查更新失败：UPDATE_CHECK_FAILED: 网络不可用",
    );
    expect(screen.getByRole("heading", { name: "Pi Desktop" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-disabled", "false");

    vi.mocked(checkForUpdates).mockResolvedValueOnce(availableUpdate);
    fireEvent.click(trigger);
    expect(await screen.findByText("有新版本可用")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])(
    "%s 点击更新链接保留浏览器默认行为",
    (modifier) => {
      render(<AboutSettings />);

      const defaultAllowed = fireEvent.click(screen.getByRole("link", { name: "检查更新" }), {
        [modifier]: true,
      });

      expect(defaultAllowed).toBe(true);
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("重新进入关于页面时清除上次检查状态", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    const { unmount } = render(<AboutSettings />);
    fireEvent.click(screen.getByRole("link", { name: "检查更新" }));
    expect(await screen.findByText("有新版本可用")).toBeInTheDocument();

    unmount();
    render(<AboutSettings />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "检查更新" })).toHaveAttribute("aria-disabled", "false");
    expect(checkForUpdates).toHaveBeenCalledOnce();
  });
});
