import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatSettingsPath, SettingsPath } from "./SettingsPath";

describe("formatSettingsPath", () => {
  it.each([
    [String.raw`\\?\C:\Users\test\.pi\agent\SYSTEM.md`, String.raw`C:\Users\test\.pi\agent\SYSTEM.md`],
    [String.raw`\\?\d:\项目\提示词.md`, String.raw`d:\项目\提示词.md`],
    [String.raw`\\?\UNC\server\share\SYSTEM.md`, String.raw`\\server\share\SYSTEM.md`],
    [String.raw`\\?\unc\server\share\APPEND_SYSTEM.md`, String.raw`\\server\share\APPEND_SYSTEM.md`],
    [String.raw`C:\Users\test\SYSTEM.md`, String.raw`C:\Users\test\SYSTEM.md`],
    [String.raw`\\server\share\SYSTEM.md`, String.raw`\\server\share\SYSTEM.md`],
    ["/home/test/.pi/agent/SYSTEM.md", "/home/test/.pi/agent/SYSTEM.md"],
    ["~/.pi/agent/SYSTEM.md", "~/.pi/agent/SYSTEM.md"],
    [String.raw`\\?\Volume{fixture}\SYSTEM.md`, String.raw`\\?\Volume{fixture}\SYSTEM.md`],
    [String.raw`\\.\pipe\pi`, String.raw`\\.\pipe\pi`],
    [String.raw`\\?\C:relative`, String.raw`\\?\C:relative`],
    ["", ""],
  ])("formats %s without changing unrelated path syntax", (path, expected) => {
    expect(formatSettingsPath(path)).toBe(expected);
  });
});

describe("SettingsPath", () => {
  it("keeps the complete readable path available in its title and description target", () => {
    const path = String.raw`\\?\C:\Users\test\.pi\agent\SYSTEM.md`;
    const displayPath = String.raw`C:\Users\test\.pi\agent\SYSTEM.md`;
    render(<SettingsPath path={path} id="prompt-system-path" />);
    expect(screen.getByText(displayPath)).toHaveAttribute("title", displayPath);
    expect(screen.getByText(displayPath)).toHaveAttribute("id", "prompt-system-path");
  });
});
