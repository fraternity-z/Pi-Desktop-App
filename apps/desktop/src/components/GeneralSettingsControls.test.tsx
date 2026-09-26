import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsRow } from "./GeneralSettingsControls";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderHelp() {
  return render(
    <div data-testid="scroll-container" style={{ overflow: "hidden" }}>
      <GeneralSettingsRow title="代理" help="所有请求共用代理设置。">
        <button type="button">设置控件</button>
      </GeneralSettingsRow>
    </div>,
  );
}

function mockGeometry(left: number, top: number, width = 320, height = 100) {
  vi.stubGlobal("innerWidth", 600);
  vi.stubGlobal("innerHeight", 400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "tooltip"
      ? new DOMRect(0, 0, width, height)
      : new DOMRect(left, top, 20, 20);
  });
}

describe("GeneralSettingsRow help", () => {
  it("renders outside clipping ancestors and keeps the accessible description", () => {
    renderHelp();
    const button = screen.getByRole("button", { name: "代理说明" });
    fireEvent.mouseEnter(button);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.parentElement).toBe(document.body);
    expect(screen.getByTestId("scroll-container")).not.toContainElement(tooltip);
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
    expect(button).toHaveAccessibleDescription("所有请求共用代理设置。");
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it.each([
    [2, 60, 320, 100, 8, 87],
    [560, 60, 320, 100, 272, 87],
    [200, 360, 320, 100, 188, 253],
    [200, 120, 320, 384, 188, 8],
  ])("bounds placement for anchor (%i, %i) and tooltip %ix%i", (left, top, width, height, x, y) => {
    mockGeometry(left, top, width, height);
    renderHelp();
    fireEvent.focus(screen.getByRole("button", { name: "代理说明" }));
    expect(screen.getByRole("tooltip")).toHaveStyle({ left: `${x}px`, top: `${y}px` });
  });

  it.each(["scroll", "window-scroll", "resize", "outside", "escape", "blur"])("dismisses on %s without leaving a detached tooltip", (action) => {
    renderHelp();
    const button = screen.getByRole("button", { name: "代理说明" });
    fireEvent.click(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    if (action === "scroll") fireEvent.scroll(screen.getByTestId("scroll-container"));
    if (action === "window-scroll") fireEvent.scroll(window);
    if (action === "resize") fireEvent.resize(window);
    if (action === "outside") fireEvent.pointerDown(document.body);
    if (action === "escape") fireEvent.keyDown(document, { key: "Escape" });
    if (action === "blur") fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("allows reading inside the tooltip and removes the portal on unmount", () => {
    const { unmount } = renderHelp();
    const button = screen.getByRole("button", { name: "代理说明" });
    fireEvent.click(button);
    fireEvent.pointerDown(button);
    fireEvent.pointerDown(screen.getByRole("tooltip"));
    fireEvent.scroll(screen.getByRole("tooltip"));
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    unmount();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
