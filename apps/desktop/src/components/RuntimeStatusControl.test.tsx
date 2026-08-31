import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import { RuntimeStatusControl } from "./RuntimeStatusControl";

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

describe("RuntimeStatusControl", () => {
  it("运行时与事件通道就绪时仅显示绿色正常图标", () => {
    render(<RuntimeStatusControl runtime={readyRuntime} eventConnection="ready" />);

    expect(screen.getByRole("status", { name: "状态正常" })).toHaveClass(
      "runtime-status-icon-ready",
    );
    expect(screen.getByTitle("状态正常：Pi 0.84.2 · Node 22.23.2")).toBeInTheDocument();
  });

  it("运行时异常时仅显示红色异常图标", () => {
    render(
      <RuntimeStatusControl
        runtime={{
          phase: "ready",
          status: {
            status: "unavailable",
            runtimeSource: null,
            piVersion: null,
            nodeVersion: null,
            error: { code: "RUNTIME_NOT_FOUND", message: "未找到可用运行时" },
          },
          refresh: vi.fn(),
        }}
        eventConnection="ready"
      />,
    );

    expect(screen.getByRole("status", { name: "状态异常" })).toHaveClass(
      "runtime-status-icon-error",
    );
    expect(screen.getByTitle("RUNTIME_NOT_FOUND: 未找到可用运行时")).toBeInTheDocument();
  });

  it("检测或连接期间显示单个加载图标", () => {
    render(<RuntimeStatusControl runtime={readyRuntime} eventConnection="connecting" />);

    expect(screen.getByRole("status", { name: "正在检测运行状态" })).toHaveClass(
      "runtime-status-icon-loading",
    );
  });

  it("后台启动 Bridge 时继续显示加载状态", () => {
    render(
      <RuntimeStatusControl
        runtime={{
          phase: "ready",
          status: {
            status: "starting",
            runtimeSource: null,
            piVersion: null,
            nodeVersion: null,
            error: null,
          },
          refresh: vi.fn(),
        }}
        eventConnection="ready"
      />,
    );

    expect(screen.getByRole("status", { name: "正在检测运行状态" })).toHaveClass(
      "runtime-status-icon-loading",
    );
  });
});
