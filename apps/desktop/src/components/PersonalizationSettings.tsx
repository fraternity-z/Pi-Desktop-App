import { LoaderCircle, RefreshCw, RotateCcw, Save } from "lucide-react";

import type { PromptKind } from "../ipc/settings";
import { usePromptDocument } from "../stores/usePromptDocument";

export function PersonalizationSettings() {
  return (
    <div className="personalization-settings">
      <p className="settings-row-description prompt-scope-note">
        用户级提示词 · 保存到 Pi 原生配置目录，在新会话中生效。项目级同名文件可能优先使用。
      </p>
      <PromptEditor
        kind="system"
        title="系统提示词"
        description="替换 Pi 默认系统提示词。移除用户覆盖后，使用项目配置或 Pi 默认提示词。"
      />
      <PromptEditor
        kind="append"
        title="追加提示词"
        description="在系统提示词后补充偏好与约定，保留原有系统提示词。"
      />
    </div>
  );
}

function PromptEditor({
  kind,
  title,
  description,
}: {
  kind: PromptKind;
  title: string;
  description: string;
}) {
  const controller = usePromptDocument(kind);
  const { document, draft, busy, dirty, error, status } = controller;
  const tooLarge = new TextEncoder().encode(draft).length > 256 * 1024;
  const invalid = tooLarge || draft.includes("\0");

  return (
    <section className="prompt-editor" aria-label={title}>
      <div className="settings-section-heading">
        <h2>
          <label htmlFor={`prompt-${kind}`}>{title}</label>
        </h2>
        <div className="prompt-editor-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`重新加载${title}`}
            title="重新加载文件（放弃未保存修改）"
            disabled={busy}
            onClick={() => void controller.refresh()}
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`移除用户${title}`}
            title="移除用户级文件"
            disabled={busy || document?.content == null}
            onClick={() => void controller.save(null)}
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !dirty || invalid}
            onClick={() => void controller.save()}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
            保存{title}
          </button>
        </div>
      </div>
      <p className="settings-row-description">{description}</p>
      <textarea
        id={`prompt-${kind}`}
        value={draft}
        disabled={busy || !document}
        spellCheck={false}
        aria-describedby={`prompt-${kind}-path`}
        onChange={(event) => controller.setDraft(event.target.value)}
      />
      <div className="prompt-editor-footer settings-row-description">
        <span id={`prompt-${kind}-path`}>
          {document?.path ?? `~/.pi/agent/${kind === "system" ? "SYSTEM.md" : "APPEND_SYSTEM.md"}`}
        </span>
        <span>
          {busy ? "处理中" : dirty ? "未保存" : document?.content == null ? "未设置" : "已保存"}
        </span>
      </div>
      {invalid && (
        <p className="settings-runtime-error" role="alert">
          提示词最多 256 KiB，且不能包含空字符。
        </p>
      )}
      {error && (
        <p className="settings-runtime-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="settings-row-description" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
