import { useEffect, useRef, useState } from "react";

export const SHORTCUT_ACTIONS = [
  { id: "commands", label: "命令面板", shortcut: "Ctrl+K" },
  { id: "newSession", label: "新建会话", shortcut: "Ctrl+N" },
  { id: "packages", label: "打开插件", shortcut: "Ctrl+P" },
  { id: "resources", label: "打开资源", shortcut: "Ctrl+Shift+P" },
  { id: "settings", label: "打开设置", shortcut: "Ctrl+," },
  { id: "chat", label: "返回对话", shortcut: "Ctrl+1" },
  { id: "focus", label: "聚焦输入框", shortcut: "Ctrl+J" },
  { id: "theme", label: "切换主题", shortcut: "Ctrl+Shift+T" },
  { id: "runtime", label: "运行时面板", shortcut: "Ctrl+." },
  { id: "file", label: "打开文件", shortcut: "Ctrl+O" },
  { id: "browser", label: "打开浏览器", shortcut: "Ctrl+T" },
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]["id"];
export type ShortcutBindings = Record<ShortcutAction, string | null>;
export const SHORTCUT_STORAGE_KEY = "pi-desktop.keyboard-shortcuts.v1";
export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUT_ACTIONS.map(({ id, shortcut }) => [id, shortcut]),
) as ShortcutBindings;

const PUNCTUATION_KEYS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
};

export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "ctrlKey"
    | "metaKey"
    | "shiftKey"
    | "altKey"
    | "isComposing"
  >,
): string | null {
  if (
    event.isComposing ||
    (event.ctrlKey && event.altKey) ||
    (event.ctrlKey && event.metaKey)
  )
    return null;
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return null;
  const key = event.code?.match(/^(?:Key([A-Z])|Digit([0-9]))$/);
  const character = key
    ? (key[1] ?? key[2]!)
    : (PUNCTUATION_KEYS[event.code] ?? event.key.toUpperCase());
  if (!/^[A-Z0-9,./;\[\]\\'`=-]$/.test(character)) return null;
  return [
    event.ctrlKey || event.metaKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    character,
  ]
    .filter(Boolean)
    .join("+");
}

export function isShortcut(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(Ctrl|Alt)\+(Shift\+)?[A-Z0-9,./;\[\]\\'`=-]$/.test(value)
  );
}

export function normalizeShortcuts(value: unknown): ShortcutBindings {
  const defaults = { ...DEFAULT_SHORTCUTS };
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("bindings" in value) ||
    !value.bindings ||
    typeof value.bindings !== "object"
  )
    return defaults;
  const bindings = value.bindings as Record<string, unknown>;
  const used = new Set<string>();
  for (const { id } of SHORTCUT_ACTIONS) {
    const candidate = bindings[id];
    const next =
      candidate === null || isShortcut(candidate) ? candidate : defaults[id];
    defaults[id] = next && used.has(next) ? null : next;
    if (defaults[id]) used.add(defaults[id]);
  }
  return defaults;
}

export function useKeyboardShortcuts() {
  const [bindings, setBindings] = useState<ShortcutBindings>(() => {
    try {
      return normalizeShortcuts(
        JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) ?? "null"),
      );
    } catch {
      return { ...DEFAULT_SHORTCUTS };
    }
  });
  const [error, setError] = useState<string | null>(null);
  const current = useRef(bindings);
  function save(next: ShortcutBindings) {
    try {
      localStorage.setItem(
        SHORTCUT_STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, bindings: next }),
      );
    } catch {
      setError("无法保存快捷键，请检查本地存储后重试。");
      return false;
    }
    current.current = next;
    setBindings(next);
    setError(null);
    return true;
  }
  function update(id: ShortcutAction, shortcut: string | null) {
    if (shortcut !== null && !isShortcut(shortcut)) {
      setError("请使用 Ctrl、⌘ 或 Alt 加字母、数字或标点键。");
      return false;
    }
    const conflict = SHORTCUT_ACTIONS.find(
      (action) =>
        action.id !== id && shortcut && current.current[action.id] === shortcut,
    );
    if (conflict) {
      setError(`此快捷键已用于“${conflict.label}”，请先清除该绑定。`);
      return false;
    }
    return save({ ...current.current, [id]: shortcut });
  }
  return {
    bindings,
    error,
    update,
    reset: (id: ShortcutAction) => update(id, DEFAULT_SHORTCUTS[id]),
    resetAll: () => save({ ...DEFAULT_SHORTCUTS }),
  };
}

export type KeyboardShortcutsController = ReturnType<
  typeof useKeyboardShortcuts
>;

export function useShortcutListener(
  bindings: ShortcutBindings,
  onAction: (action: ShortcutAction) => void,
) {
  const handler = useRef(onAction);
  useEffect(() => {
    handler.current = onAction;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        document.querySelector(
          '[data-shortcut-recording="true"], [role="dialog"][aria-modal="true"]',
        )
      )
        return;
      const shortcut = shortcutFromEvent(event);
      const action = SHORTCUT_ACTIONS.find(
        ({ id }) => shortcut && bindings[id] === shortcut,
      );
      if (!action) return;
      event.preventDefault();
      handler.current(action.id);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [bindings]);
}
