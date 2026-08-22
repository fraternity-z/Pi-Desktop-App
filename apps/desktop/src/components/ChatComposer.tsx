import { ArrowUp, Check, ChevronDown, Folder, LoaderCircle, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

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
  const menuRootRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<"model" | "thinking" | null>(null);
  const streaming = phase === "streaming";
  const disabled = streaming || eventConnection !== "ready";
  const modelDisabled = disabled || configuring || models.length === 0 || !configuration;
  const thinkingDisabled =
    disabled ||
    configuring ||
    !configuration ||
    configuration.availableThinkingLevels.length <= 1;
  const modelGroups = useMemo(() => groupModelsByProvider(models), [models]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => {
    if (openMenu === null) {
      return;
    }
    function closeOnPointerDown(event: MouseEvent) {
      if (!menuRootRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  useEffect(() => {
    if (disabled || configuring) {
      setOpenMenu(null);
    }
  }, [configuring, disabled]);

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
      <div className="composer-protrusion" title={workspaceName}>
        <Folder size={15} />
        <span>{workspaceName}</span>
      </div>
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
          <div className="composer-context" aria-live="polite">
            {streaming ? (
              <>
                <LoaderCircle className="spin" size={14} />
                <span>Pi 正在处理</span>
              </>
            ) : configuring ? (
              <>
                <LoaderCircle className="spin" size={14} />
                <span>正在应用配置</span>
              </>
            ) : (
              <span>{eventConnection === "ready" ? "完全访问" : "正在连接"}</span>
            )}
          </div>

          <div className="composer-controls" ref={menuRootRef}>
            <div className="composer-picker">
              <button
                className="composer-picker-trigger"
                type="button"
                disabled={modelDisabled}
                aria-label="选择模型"
                aria-haspopup="menu"
                aria-expanded={openMenu === "model"}
                onClick={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
              >
                <span>{configuration?.model?.name ?? "无可用模型"}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {openMenu === "model" && (
                <div className="composer-menu composer-model-menu" role="menu" aria-label="模型列表">
                  {modelGroups.map(([provider, providerModels]) => (
                    <div className="composer-menu-group" key={provider}>
                      <p>{provider}</p>
                      {providerModels.map((model) => {
                        const selected =
                          model.provider === configuration?.model?.provider &&
                          model.id === configuration.model.id;
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            key={`${model.provider}/${model.id}`}
                            onClick={() => {
                              setOpenMenu(null);
                              onModelChange(model.provider, model.id);
                            }}
                          >
                            <span>{model.name}</span>
                            {selected && <Check size={14} aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="composer-picker">
              <button
                className="composer-picker-trigger"
                type="button"
                disabled={thinkingDisabled}
                aria-label="选择思考强度"
                aria-haspopup="menu"
                aria-expanded={openMenu === "thinking"}
                onClick={() =>
                  setOpenMenu((current) => (current === "thinking" ? null : "thinking"))
                }
              >
                <span>
                  {configuration ? thinkingLevelLabel(configuration.thinkingLevel) : "思考强度"}
                </span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {openMenu === "thinking" && configuration && (
                <div className="composer-menu composer-thinking-menu" role="menu" aria-label="思考强度列表">
                  <p className="composer-menu-title">思考强度</p>
                  {configuration.availableThinkingLevels.map((level) => {
                    const selected = level === configuration.thinkingLevel;
                    return (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        key={level}
                        onClick={() => {
                          setOpenMenu(null);
                          onThinkingLevelChange(level);
                        }}
                      >
                        <span>{thinkingLevelLabel(level)}</span>
                        {selected && <Check size={14} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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

function groupModelsByProvider(models: AgentModel[]): [string, AgentModel[]][] {
  const groups = new Map<string, AgentModel[]>();
  for (const model of models) {
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  }
  return [...groups.entries()];
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
