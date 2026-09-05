import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StartupOverlay } from "./StartupOverlay";
import { StartupWordmark } from "./StartupWordmark";

describe("StartupWordmark", () => {
  it("多个实例的遮罩 ID 互不冲突，每个字形只引用本实例的离线路径", () => {
    const { container } = render(
      <>
        <StartupWordmark />
        <StartupWordmark />
      </>,
    );
    const wordmarks = container.querySelectorAll("svg");
    expect(wordmarks).toHaveLength(2);
    const allMasks = [...container.querySelectorAll("mask")];
    expect(allMasks.length).toBeGreaterThan(0);
    expect(new Set(allMasks.map((mask) => mask.id)).size).toBe(allMasks.length);

    for (const wordmark of wordmarks) {
      const masks = [...wordmark.querySelectorAll("mask")];
      const glyphs = [...wordmark.querySelectorAll("path")].filter((path) => !path.closest("defs"));
      expect(masks.length).toBeGreaterThan(0);
      expect(glyphs.length).toBeGreaterThan(0);
      expect(wordmark.querySelector("image, use, text, foreignObject")).not.toBeInTheDocument();

      for (const glyph of glyphs) {
        expect(glyph).toHaveAttribute("d", expect.stringMatching(/^M\S+/));
        const reference = glyph.closest("[mask]")?.getAttribute("mask");
        expect(reference).toMatch(/^url\(#[^\s()]+\)$/);
        const maskId = reference!.slice(5, -1);
        const matchingMasks = masks.filter((mask) => mask.id === maskId);
        expect(matchingMasks).toHaveLength(1);
        expect(document.getElementById(maskId)).toBe(matchingMasks[0]);

        const strokes = matchingMasks[0]!.querySelectorAll("path");
        expect(strokes.length).toBeGreaterThan(0);
        for (const stroke of strokes) {
          expect(stroke).toHaveAttribute("d", expect.stringMatching(/^M\S+/));
        }
      }

      for (const element of wordmark.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
          if (attribute.localName === "href" || attribute.localName === "src") {
            expect(attribute.value).toMatch(/^#[^\s]+$/);
          }
        }
      }
    }
  });

  it("手写字标不接收焦点或重复播报，启动界面保留唯一的可访问标题", () => {
    render(
      <StartupOverlay ready={false} stage="runtime" error={null} onRetry={vi.fn()}
        onExit={vi.fn()} onFinished={vi.fn()} />,
    );

    const heading = screen.getByRole("heading", { name: "PI Desktop", level: 1 });
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(heading).toHaveAccessibleName("PI Desktop");
    const wordmark = heading.querySelector("svg");
    expect(wordmark).toHaveAttribute("aria-hidden", "true");
    expect(wordmark).toHaveAttribute("focusable", "false");
    expect(wordmark).not.toHaveAttribute("tabindex");
    expect(wordmark!.querySelector("a, [tabindex]")).not.toBeInTheDocument();
    expect(within(heading).queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "PI Desktop 启动界面" })).toHaveFocus();
  });
});
