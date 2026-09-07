import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROXY_SETTINGS,
  getProxySettings,
  updateProxySettings,
} from "../ipc/proxy";
import { ProxySettings } from "./ProxySettings";

vi.mock("../ipc/proxy", async (original) => ({
  ...(await original<typeof import("../ipc/proxy")>()),
  getProxySettings: vi.fn(),
  updateProxySettings: vi.fn(),
}));
describe("ProxySettings", () => {
  beforeEach(() => {
    vi.mocked(getProxySettings)
      .mockReset()
      .mockResolvedValue(DEFAULT_PROXY_SETTINGS);
    vi.mocked(updateProxySettings)
      .mockReset()
      .mockImplementation(async (settings) => settings);
  });
  it("loads, validates and persists independent proxy scopes", async () => {
    render(<ProxySettings />);
    const mode = screen.getByRole("combobox", { name: "AI 代理模式" });
    await waitFor(() => expect(mode).toBeEnabled());
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.change(mode, { target: { value: "custom" } });
    const address = screen.getByLabelText("AI 代理地址");
    fireEvent.change(address, {
      target: { value: "http://user:password@localhost:7890" },
    });
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("alert")).not.toHaveTextContent("password");
    fireEvent.change(address, { target: { value: "http://127.0.0.1:7890" } });
    fireEvent.change(screen.getByLabelText("绕过代理"), {
      target: { value: "localhost" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "应用代理模式" }), {
      target: { value: "direct" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("status");
    expect(updateProxySettings).toHaveBeenCalledWith({
      schemaVersion: 1,
      ai: {
        mode: "custom",
        url: "http://127.0.0.1:7890",
        noProxy: "localhost",
      },
      app: { mode: "direct", url: "", noProxy: "" },
    });
    fireEvent.change(mode, { target: { value: "system" } });
    expect(screen.queryByLabelText("AI 代理地址")).not.toBeInTheDocument();
  });
  it("retains draft on save failure and recovers from load failure", async () => {
    vi.mocked(getProxySettings).mockRejectedValueOnce(Error("private"));
    render(<ProxySettings />);
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "应用代理模式" }), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("应用代理地址"), {
      target: { value: "http://localhost:7890" },
    });
    vi.mocked(updateProxySettings).mockRejectedValueOnce({
      code: "BRIDGE_STARTING",
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "运行时正在启动",
    );
    expect(screen.getByLabelText("应用代理地址")).toHaveValue(
      "http://localhost:7890",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("status");
  });
});
