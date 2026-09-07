import { useEffect, useRef, useState } from "react";
import {
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutBindings,
} from "../stores/useKeyboardShortcuts";
import { SidebarDialogFrame } from "./SidebarDialog";

export function CommandPalette({
  bindings,
  disabled,
  onAction,
  onClose,
}: {
  bindings: ShortcutBindings;
  disabled: Partial<Record<ShortcutAction, boolean>>;
  onAction: (action: ShortcutAction) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const dialog = input.current?.closest<HTMLElement>('[role="dialog"]');
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const elements = Array.from(
        dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input"),
      );
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog?.addEventListener("keydown", trapFocus);
    return () => dialog?.removeEventListener("keydown", trapFocus);
  }, []);
  const actions = SHORTCUT_ACTIONS.filter(
    ({ id, label }) => id !== "commands" && label.includes(query.trim()),
  );
  return (
    <SidebarDialogFrame title="命令面板" onClose={onClose}>
      <div
        className="command-palette"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const elements = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "input, button:not(:disabled)",
            ),
          );
          const index = elements.indexOf(document.activeElement as HTMLElement);
          elements[
            (index + (event.key === "ArrowDown" ? 1 : -1) + elements.length) %
              elements.length
          ]?.focus();
        }}
      >
        <input
          ref={input}
          className="command-palette-search"
          type="search"
          aria-label="搜索命令"
          placeholder="搜索命令…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            const first = actions.find(({ id }) => !disabled[id]);
            if (first) {
              event.preventDefault();
              onAction(first.id);
            }
          }}
        />
        <div className="command-palette-list">
          {actions.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              disabled={disabled[id]}
              onClick={() => onAction(id)}
            >
              <span>{label}</span>
              <kbd>{bindings[id] ?? ""}</kbd>
            </button>
          ))}
          {actions.length === 0 && (
            <p className="settings-search-empty">未找到命令</p>
          )}
        </div>
      </div>
    </SidebarDialogFrame>
  );
}
