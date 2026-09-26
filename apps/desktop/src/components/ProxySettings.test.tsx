import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    const mode = within(
      screen.getByRole("radiogroup", { name: "代理模式" }),
    ).getByRole("radio", { name: "系统" });
    await waitFor(() => expect(mode).toBeEnabled());
    expect(
      screen.queryByRole("button", { name: "保存代理设置" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("分别配置 AI 与应用"));
    fireEvent.click(
      within(
        await screen.findByRole("radiogroup", { name: "AI代理模式" }),
      ).getByRole("radio", { name: "自定义" }),
    );
    const address = screen.getByLabelText("AI 代理地址");
    fireEvent.change(address, {
      target: { value: "http://user:password@localhost:7890" },
    });
    expect(screen.getByRole("button", { name: "保存代理设置" })).toBeDisabled();
    expect(screen.getByRole("alert")).not.toHaveTextContent("password");
    fireEvent.change(address, { target: { value: "http://127.0.0.1:7890" } });
    fireEvent.change(screen.getByLabelText("绕过代理（仅 AI）"), {
      target: { value: "localhost" },
    });
    fireEvent.click(
      within(
        screen.getByRole("radiogroup", { name: "应用代理模式" }),
      ).getByRole("radio", { name: "直连" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
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
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "AI代理模式" })).getByRole(
        "radio",
        { name: "系统" },
      ),
    );
    expect(screen.queryByLabelText("AI 代理地址")).not.toBeInTheDocument();
  });
  it("retains draft on save failure and recovers from load failure", async () => {
    vi.mocked(getProxySettings).mockRejectedValueOnce(Error("private"));
    render(<ProxySettings />);
    expect(await screen.findByRole("alert")).not.toHaveTextContent("private");
    fireEvent.click(screen.getByRole("button", { name: "重新加载代理设置" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("分别配置 AI 与应用"));
    fireEvent.click(
      within(
        await screen.findByRole("radiogroup", { name: "应用代理模式" }),
      ).getByRole("radio", { name: "自定义" }),
    );
    fireEvent.change(screen.getByLabelText("应用代理地址"), {
      target: { value: "http://localhost:7890" },
    });
    vi.mocked(updateProxySettings).mockRejectedValueOnce({
      code: "BRIDGE_STARTING",
    });
    fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "运行时正在启动",
    );
    expect(screen.getByLabelText("应用代理地址")).toHaveValue(
      "http://localhost:7890",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
    await screen.findByRole("status");
  });
  it("saves a shared proxy and exposes accessible help", async () => {
    render(<ProxySettings />);
    const group = within(screen.getByRole("radiogroup", { name: "代理模式" }));
    await waitFor(() =>
      expect(group.getByRole("radio", { name: "自定义" })).toBeEnabled(),
    );
    fireEvent.click(group.getByRole("radio", { name: "自定义" }));
    fireEvent.change(screen.getByLabelText("代理地址"), {
      target: { value: "http://localhost:7890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存代理设置" }));
    await screen.findByRole("status");
    expect(updateProxySettings).toHaveBeenCalledWith({
      schemaVersion: 1,
      ai: { mode: "custom", url: "http://localhost:7890", noProxy: "" },
      app: { mode: "custom", url: "http://localhost:7890", noProxy: "" },
    });
    const help = screen.getByRole("button", { name: "代理说明" });
    fireEvent.mouseEnter(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent("HTTP_PROXY");
    fireEvent.mouseLeave(help);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent("HTTP_PROXY");
    fireEvent.keyDown(help, { key: "ArrowLeft" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(help);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent("HTTP_PROXY");
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
  it("does not overwrite previously independent proxies on load", async () => {
    vi.mocked(getProxySettings).mockResolvedValueOnce({
      ...DEFAULT_PROXY_SETTINGS,
      ai: {
        mode: "custom",
        url: "https://localhost:7890",
        noProxy: "example.com",
      },
    });
    render(<ProxySettings />);
    expect(await screen.findByLabelText("AI 代理地址")).toHaveValue(
      "https://localhost:7890",
    );
    expect(screen.getByLabelText("绕过代理（仅 AI）")).toHaveValue(
      "example.com",
    );
    expect(updateProxySettings).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("radiogroup", { name: "代理模式" })).queryByRole(
        "radio",
        { checked: true },
      ),
    ).not.toBeInTheDocument();
  });
});
