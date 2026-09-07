import { RotateCcw, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  SHORTCUT_ACTIONS,
  shortcutFromEvent,
  type ShortcutAction,
  type KeyboardShortcutsController,
} from "../stores/useKeyboardShortcuts";
import { SettingsRow } from "./SettingsControls";

export function KeyboardShortcutSettings({
  controller,
}: {
  controller: KeyboardShortcutsController;
}) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const actions = SHORTCUT_ACTIONS.filter(({ id, label }) =>
    `${label} ${controller.bindings[id] ?? "未设置"}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div data-shortcut-recording={recording !== null}>
      <div className="shortcut-toolbar">
        <p className="settings-row-description">
          点击组合键后按下新快捷键。Esc 取消；Mac 使用 ⌘ 代替 Ctrl。
        </p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            controller.resetAll();
            setRecording(null);
          }}
        >
          全部重置
        </button>
      </div>
      <label className="settings-search-field shortcut-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">搜索快捷键</span>
        <input
          type="search"
          placeholder="搜索快捷键…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="settings-card">
        {actions.map(({ id, label }, index) => (
          <SettingsRow
            key={id}
            title={label}
            last={index === actions.length - 1}
            control={
              <div className="shortcut-row-actions">
                <button
                  className="shortcut-binding"
                  type="button"
                  aria-label={`修改${label}快捷键`}
                  aria-pressed={recording === id}
                  onClick={() => {
                    setRecording(id);
                    setHint("请按下组合键，Esc 取消。");
                  }}
                  onBlur={() => {
                    setRecording(null);
                    setHint(null);
                  }}
                  onKeyDown={(event) => {
                    if (recording !== id) return;
                    if (event.key === "Tab") {
                      setRecording(null);
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setRecording(null);
                      setHint(null);
                      return;
                    }
                    const shortcut = shortcutFromEvent(event.nativeEvent);
                    if (!shortcut) {
                      setHint("请使用 Ctrl、⌘ 或 Alt 加字母、数字或标点键。");
                      return;
                    }
                    if (controller.update(id, shortcut)) {
                      setRecording(null);
                      setHint("快捷键已保存。");
                    }
                  }}
                >
                  {recording === id
                    ? "按下组合键…"
                    : (controller.bindings[id]
                        ?.split("+")
                        .map((key) => <kbd key={key}>{key}</kbd>) ?? "未设置")}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`重置${label}快捷键`}
                  onClick={() => controller.reset(id)}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`清除${label}快捷键`}
                  disabled={controller.bindings[id] === null}
                  onClick={() => controller.update(id, null)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            }
          />
        ))}
        {actions.length === 0 && (
          <p className="settings-search-empty">未找到快捷键</p>
        )}
      </div>
      {controller.error && (
        <p className="settings-runtime-error" role="alert">
          {controller.error}
        </p>
      )}
      {hint && (
        <p className="settings-row-description" role="status">
          {hint}
        </p>
      )}
      <p className="settings-row-description prompt-scope-note">
        快捷键仅在应用内生效。当前版本尚未提供会话分叉和内嵌 Pi
        TUI，因此没有这两项绑定。
      </p>
    </div>
  );
}
