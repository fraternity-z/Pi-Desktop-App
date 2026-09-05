import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionLoading } from "./SessionLoading";

describe("SessionLoading", () => {
  it("只播报加载状态，占位内容不进入无障碍树且不接收焦点", () => {
    const { container } = render(<SessionLoading />);
    expect(screen.getByRole("status", { name: "正在切换会话" })).toHaveAttribute("aria-live", "polite");
    expect(container.firstChild).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".conversation-loading-skeleton")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
  });
});
