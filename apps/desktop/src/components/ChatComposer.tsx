import { ArrowUp, ChevronDown, Folder, Square } from "lucide-react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

import type { AgentModel, SessionConfiguration, ThinkingLevel } from "../ipc/agent";
import type { AgentEventConnection, ChatPhase } from "../stores/useChatSession";

interface ChatComposerProps {
  workspaceName: string;
  draft: string;
  phase: ChatPhase;
  eventConnection: AgentEventConnection;
  models: AgentModel[];
  configuration: SessionConfiguration | null;
  configuring: boolean;
  canSend: boolean;
  onDraftChange: (value: string) => void;
  onModelChange: (provider: string, id: string) => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  onSend: (event?: FormEvent) => void;
  onAbort: () => void;
}

export function ChatComposer({
  workspaceName,
  draft,
  phase,
  eventConnection,
  models,
  configuration,
  configuring,
  canSend,
  onDraftChange,
  onModelChange,
  onThinkingLevelChange,
  onSend,
  onAbort,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streaming = phase === "streaming";
  const disabled = streaming || eventConnection !== "ready";
  const modelValue = configuration?.model
    ? serializeModel(configuration.model.provider, configuration.model.id)
    : "";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draft]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="composer-dock">
      <form className="composer-frame" onSubmit={onSend} aria-busy={streaming || configuring}>
        <textarea
          ref={textareaRef}
          aria-label="发送给 Pi 的消息"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={streaming ? "Pi 正在处理当前任务" : "描述你想让 Pi 完成的任务"}
          disabled={disabled}
          rows={1}
        />

        <div className="composer-actions">
          <div className="composer-context" title={workspaceName}>
            <Folder size={15} />
            <span>{workspaceName}</span>
          </div>

          <div className="composer-controls">
            <label className="composer-select" title="模型">
              <span className="sr-only">模型</span>
              <select
                aria-label="模型"
                value={modelValue}
                disabled={disabled || configuring || models.length === 0 || !configuration}
                onChange={(event) => {
                  const selected = parseModel(event.target.value);
                  if (selected) {
                    onModelChange(selected.provider, selected.id);
                  }
                }}
              >
                {models.length === 0 && <option value="">无可用模型</option>}
                {configuration?.model &&
                  !models.some(
                    (model) =>
                      model.provider === configuration.model?.provider &&
                      model.id === configuration.model?.id,
                  ) && (
                    <option value={modelValue}>{configuration.model.name}</option>
                  )}
                {models.map((model) => (
                  <option value={serializeModel(model.provider, model.id)} key={`${model.provider}/${model.id}`}>
                    {model.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>

            <label className="composer-select" title="思考强度">
              <span className="sr-only">思考强度</span>
              <select
                aria-label="思考强度"
                value={configuration?.thinkingLevel ?? ""}
                disabled={
                  disabled ||
                  configuring ||
                  !configuration ||
                  configuration.availableThinkingLevels.length <= 1
                }
                onChange={(event) =>
                  onThinkingLevelChange(event.target.value as ThinkingLevel)
                }
              >
                {!configuration && <option value="">思考强度</option>}
                {configuration?.availableThinkingLevels.map((level) => (
                  <option value={level} key={level}>
                    {thinkingLevelLabel(level)}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>

            <span className="composer-status" aria-live="polite">
              {streaming
                ? "处理中"
                : configuring
                  ? "正在更新配置"
                  : eventConnection === "ready"
                    ? "就绪"
                    : "连接中"
              }
            </span>

            {streaming ? (
              <button
                className="composer-submit composer-stop"
                type="button"
                onClick={onAbort}
                aria-label="停止"
                title="停止"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                className="composer-submit"
                type="submit"
                disabled={!canSend || configuring}
                aria-label="发送"
                title="发送"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function serializeModel(provider: string, id: string): string {
  return `${provider}\u0000${id}`;
}

function parseModel(value: string): { provider: string; id: string } | null {
  const separator = value.indexOf("\u0000");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

function thinkingLevelLabel(level: ThinkingLevel): string {
  return {
    off: "关闭思考",
    minimal: "极简思考",
    low: "轻度思考",
    medium: "标准思考",
    high: "深度思考",
    xhigh: "强化思考",
    max: "最大思考",
  }[level];
}
