import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GENERAL_SETTINGS,
  getGeneralSettings,
  updateGeneralSettings,
} from "../ipc/general";
import { GeneralSystemSettings } from "./GeneralSystemSettings";

vi.mock("./ProxySettings", () => ({
  ProxySettings: () => <div>代理设置</div>,
}));
vi.mock("../ipc/general", async (original) => ({
  ...(await original<typeof import("../ipc/general")>()),
  getGeneralSettings: vi.fn(),
  updateGeneralSettings: vi.fn(),
}));
describe("GeneralSystemSettings", () => {
  beforeEach(() => {
    vi.mocked(getGeneralSettings).mockReset().mockResolvedValue({
      settings: DEFAULT_GENERAL_SETTINGS,
      powerSupported: true,
      powerError: null,
    });
    vi.mocked(updateGeneralSettings)
      .mockReset()
      .mockImplementation(async (settings) => ({
        settings,
        powerSupported: true,
        powerError: null,
      }));
  });
  it("persists network and independent power toggles without dropping settings", async () => {
    render(<GeneralSystemSettings />);
    const network = screen.getByRole("switch", { name: "网络宽松模式" });
    expect(network).toBeDisabled();
    await waitFor(() => expect(network).toBeEnabled());
    fireEvent.click(network);
    await waitFor(() =>
      expect(network).toHaveAttribute("aria-checked", "false"),
    );
    expect(screen.queryByText(/明文 HTTP 可能暴露/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "保持电脑唤醒" }));
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "保持电脑唤醒" }),
      ).toHaveAttribute("aria-checked", "true"),
    );
    fireEvent.click(screen.getByRole("switch", { name: "阻止屏幕休眠" }));
    await waitFor(() =>
      expect(updateGeneralSettings).toHaveBeenLastCalledWith({
        schemaVersion: 1,
        relaxedNetwork: false,
        keepAwakeWhileRunning: true,
        preventScreenSleep: true,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "电源设置已保存并生效",
    );
  });
  it("disables unsupported power controls and reports startup failure", async () => {
    vi.mocked(getGeneralSettings).mockResolvedValueOnce({
      settings: DEFAULT_GENERAL_SETTINGS,
      powerSupported: false,
      powerError: { code: "POWER_UNSUPPORTED", message: "private" },
    });
    render(<GeneralSystemSettings />);
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private");
    expect(screen.getByRole("switch", { name: "保持电脑唤醒" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "网络宽松模式" })).toBeEnabled();
  });
  it("keeps saved switch values when writes fail and supports retry", async () => {
    vi.mocked(updateGeneralSettings).mockRejectedValueOnce({
      code: "BRIDGE_STARTING",
      message: "secret",
    });
    render(<GeneralSystemSettings />);
    const network = screen.getByRole("switch", { name: "网络宽松模式" });
    await waitFor(() => expect(network).toBeEnabled());
    fireEvent.click(network);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "运行时正在启动",
    );
    expect(network).toHaveAttribute("aria-checked", "true");
    fireEvent.click(network);
    await waitFor(() =>
      expect(network).toHaveAttribute("aria-checked", "false"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("recovers corrupt configuration only after an explicit reset", async () => {
    vi.mocked(getGeneralSettings).mockRejectedValueOnce(Error("private"));
    render(<GeneralSystemSettings />);
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private");
    expect(updateGeneralSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "恢复默认常规设置" }));
    await waitFor(() =>
      expect(updateGeneralSettings).toHaveBeenCalledWith(
        DEFAULT_GENERAL_SETTINGS,
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "网络宽松模式" }),
      ).toBeEnabled(),
    );
  });
  it("retries loading settings without writing fallback defaults", async () => {
    vi.mocked(getGeneralSettings).mockRejectedValueOnce(
      Error("fixture read failure"),
    );
    render(<GeneralSystemSettings />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重新加载常规设置" }));
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "保持电脑唤醒" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(updateGeneralSettings).not.toHaveBeenCalled();
  });
});
