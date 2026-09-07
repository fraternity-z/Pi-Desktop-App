import { act, fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  normalizeShortcuts,
  SHORTCUT_STORAGE_KEY,
  shortcutFromEvent,
  useKeyboardShortcuts,
  useShortcutListener,
} from "./useKeyboardShortcuts";

describe("keyboard shortcuts", () => {
  it("uses physical punctuation keys with Shift", () => {
    expect(shortcutFromEvent(new KeyboardEvent("keydown", { key: "|", code: "Backslash", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+\\");
  });
  beforeEach(() => localStorage.clear());
  it("normalizes modifiers, physical keys and ignores composition and AltGr", () => {
    expect(
      shortcutFromEvent(
        new KeyboardEvent("keydown", { key: "K", code: "KeyK", metaKey: true }),
      ),
    ).toBe("Ctrl+K");
    expect(
      shortcutFromEvent(
        new KeyboardEvent("keydown", {
          key: "中",
          code: "KeyK",
          ctrlKey: true,
          isComposing: true,
        }),
      ),
    ).toBeNull();
    expect(
      shortcutFromEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, altKey: true }),
      ),
    ).toBeNull();
    expect(
      shortcutFromEvent(
        new KeyboardEvent("keydown", { key: "Shift", ctrlKey: true }),
      ),
    ).toBeNull();
    expect(
      shortcutFromEvent(
        new KeyboardEvent("keydown", { key: ",", ctrlKey: true }),
      ),
    ).toBe("Ctrl+,");
  });
  it("validates stored versions, clears duplicates and preserves disabled bindings", () => {
    expect(normalizeShortcuts({ schemaVersion: 8 })).toEqual(DEFAULT_SHORTCUTS);
    expect(normalizeShortcuts(null)).toEqual(DEFAULT_SHORTCUTS);
    const bindings = normalizeShortcuts({
      schemaVersion: 1,
      bindings: { commands: null, newSession: "Ctrl+P", theme: "invalid" },
    });
    expect(bindings.commands).toBeNull();
    expect(bindings.packages).toBeNull();
    expect(bindings.theme).toBe(DEFAULT_SHORTCUTS.theme);
  });
  it("persists edits and reset, rejecting conflicts and failed persistence", () => {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, "invalid");
    const { result } = renderHook(useKeyboardShortcuts);
    act(() => {
      expect(result.current.update("commands", "Ctrl+N")).toBe(false);
    });
    expect(result.current.error).toContain("新建会话");
    act(() => {
      result.current.update("commands", null);
      result.current.update("newSession", "Alt+Shift+K");
    });
    expect(
      JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY)!).bindings
        .newSession,
    ).toBe("Alt+Shift+K");
    act(() => {
      result.current.reset("commands");
      result.current.resetAll();
    });
    expect(result.current.bindings).toEqual(DEFAULT_SHORTCUTS);
    act(() => {
      expect(result.current.update("commands", "Escape")).toBe(false);
    });
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw Error("full");
      });
    act(() => {
      expect(result.current.update("commands", null)).toBe(false);
    });
    expect(result.current.bindings.commands).toBe("Ctrl+K");
    spy.mockRestore();
  });
  it("dispatches once, uses latest callback, ignores repeats, modals and cleans up", () => {
    const action = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ callback }) => useShortcutListener(DEFAULT_SHORTCUTS, callback),
      { initialProps: { callback: action } },
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(action).toHaveBeenCalledWith("commands");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, repeat: true });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    dialog.remove();
    expect(action).toHaveBeenCalledTimes(1);
    const next = vi.fn();
    rerender({ callback: next });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true, shiftKey: true });
    expect(next).toHaveBeenCalledWith("resources");
    unmount();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
