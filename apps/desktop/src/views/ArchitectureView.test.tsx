import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getArchitectureStatus } from "../ipc/system";
import { ArchitectureView } from "./ArchitectureView";

vi.mock("../ipc/system", () => ({
  getArchitectureStatus: vi.fn(),
}));

describe("ArchitectureView", () => {
  beforeEach(() => {
    vi.mocked(getArchitectureStatus).mockReset();
  });

  it("展示三层架构状态", async () => {
    vi.mocked(getArchitectureStatus).mockResolvedValue({
      renderer: "ready",
      core: "ready",
      bridge: "not-started",
      protocolVersion: 1,
    });

    const { unmount } = render(<ArchitectureView />);

    expect(screen.getByText("正在连接 Rust Core...")).toBeInTheDocument();
    expect(await screen.findByText("not-started")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    unmount();
  });

  it("以可定位消息展示调用失败", async () => {
    vi.mocked(getArchitectureStatus).mockRejectedValue(new Error("invoke failed"));

    render(<ArchitectureView />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法读取架构状态：invoke failed",
    );
  });

  it("安全展示非 Error 类型的拒绝原因", async () => {
    vi.mocked(getArchitectureStatus).mockRejectedValue("core unavailable");

    render(<ArchitectureView />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法读取架构状态：core unavailable",
    );
  });

  it("卸载后忽略尚未完成的状态请求", async () => {
    let resolveStatus: ((value: Awaited<ReturnType<typeof getArchitectureStatus>>) => void) | undefined;
    vi.mocked(getArchitectureStatus).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const { unmount } = render(<ArchitectureView />);

    unmount();
    resolveStatus?.({
      renderer: "ready",
      core: "ready",
      bridge: "not-started",
      protocolVersion: 1,
    });

    await Promise.resolve();
    expect(screen.queryByText("not-started")).not.toBeInTheDocument();
  });
});
