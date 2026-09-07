import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPromptDocument, savePromptDocument } from "../ipc/settings";
import { PersonalizationSettings } from "./PersonalizationSettings";

vi.mock("../ipc/settings", () => ({ getPromptDocument: vi.fn(), savePromptDocument: vi.fn() }));

describe("PersonalizationSettings", () => {
  beforeEach(() => {
    vi.mocked(getPromptDocument)
      .mockReset()
      .mockImplementation(async (kind) => ({ path: `fixture/${kind}.md`, content: null }));
    vi.mocked(savePromptDocument)
      .mockReset()
      .mockImplementation(async (kind, content) => ({ path: `fixture/${kind}.md`, content }));
  });

  it("edits and saves the two official documents independently", async () => {
    render(<PersonalizationSettings />);
    const system = screen.getByRole("textbox", { name: "系统提示词" });
    const append = screen.getByRole("textbox", { name: "追加提示词" });
    await waitFor(() => expect(system).toBeEnabled());
    expect(screen.getByRole("button", { name: "保存系统提示词" })).toBeDisabled();
    fireEvent.change(system, { target: { value: "system content" } });
    fireEvent.change(append, { target: { value: "append content" } });
    fireEvent.click(screen.getByRole("button", { name: "保存系统提示词" }));
    await waitFor(() =>
      expect(savePromptDocument).toHaveBeenCalledWith("system", "system content", null),
    );
    expect(append).toHaveValue("append content");
    fireEvent.click(screen.getByRole("button", { name: "保存追加提示词" }));
    await waitFor(() =>
      expect(savePromptDocument).toHaveBeenCalledWith("append", "append content", null),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "移除用户系统提示词" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "移除用户系统提示词" }));
    await waitFor(() =>
      expect(savePromptDocument).toHaveBeenCalledWith("system", null, "system content"),
    );
  });

  it("blocks oversized multibyte text and allows retry after read failure", async () => {
    vi.mocked(getPromptDocument).mockRejectedValueOnce({
      code: "PROMPT_READ_FAILED",
      message: "无法读取",
    });
    render(<PersonalizationSettings />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重新加载系统提示词" }));
    const system = screen.getByRole("textbox", { name: "系统提示词" });
    await waitFor(() => expect(system).toBeEnabled());
    fireEvent.change(system, { target: { value: "中".repeat(90_000) } });
    expect(screen.getByRole("button", { name: "保存系统提示词" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("256 KiB");
  });
});
