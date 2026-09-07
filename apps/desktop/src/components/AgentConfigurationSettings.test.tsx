import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentConfigurationSettings } from "./AgentConfigurationSettings";
import type { ToolPermissionState } from "../stores/useToolPermissions";

describe("AgentConfigurationSettings", () => {
  it("reuses tool selection and default restoration without creating permission controls", () => {
    const tools: ToolPermissionState = {
      mode: "custom",
      availableTools: [
        { name: "read", description: "读取" },
        { name: "bash", description: "命令" },
      ],
      selectedToolNames: ["read"],
      defaultToolNames: ["read", "bash"],
      promptToolNames: ["read"],
      setCustomTools: vi.fn(),
      useDefaultTools: vi.fn(),
    };
    render(<AgentConfigurationSettings tools={tools} />);
    fireEvent.click(screen.getByRole("switch", { name: "允许 bash" }));
    expect(tools.setCustomTools).toHaveBeenLastCalledWith(["read", "bash"]);
    fireEvent.click(screen.getByRole("switch", { name: "允许 read" }));
    expect(tools.setCustomTools).toHaveBeenLastCalledWith([]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "default" } });
    expect(tools.useDefaultTools).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "custom" } });
    expect(tools.setCustomTools).toHaveBeenLastCalledWith(["read"]);
    expect(screen.getAllByText("暂无内置配置链路")).toHaveLength(4);
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("shows the missing catalog without inventing tools", () => {
    render(<AgentConfigurationSettings />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText(/尚无工具清单/)).toBeInTheDocument();
  });
});
