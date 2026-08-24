import {
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  LoaderCircle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Square,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import type {
  AgentModel,
  AgentTool,
  PromptStreamingBehavior,
  QueuedMessages,
  SessionConfiguration,
  ThinkingLevel,
} from "../ipc/agent";
import type { AgentEventConnection, ChatPhase } from "../stores/useChatSession";
import type { ToolPermissionMode } from "../stores/useToolPermissions";
import { ComposerQueueCard } from "./ComposerQueueCard";

interface ChatComposerProps {
  workspaceName: string;
  draft: string;
  phase: ChatPhase;
  eventConnection: AgentEventConnection;
  models: AgentModel[];
  configuration: SessionConfiguration | null;
  configuring: boolean;
  canSend: boolean;
  queuedMessages: QueuedMessages;
  queuePaused: boolean;
  permissionMode: ToolPermissionMode;
  availableTools: AgentTool[];
  selectedToolNames: string[];
  defaultToolNames: string[];
  onDraftChange: (value: string) => void;
  onModelChange: (provider: string, id: string) => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  onUseDefaultTools: () => void;
  onToolSelectionChange: (toolNames: string[]) => void;
  onSend: (event?: FormEvent, behavior?: PromptStreamingBehavior) => void;
  onClearQueue: () => void;
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
  queuedMessages,
  queuePaused,
  permissionMode,
  availableTools,
  selectedToolNames,
  defaultToolNames,
  onDraftChange,
  onModelChange,
  onThinkingLevelChange,
  onUseDefaultTools,
  onToolSelectionChange,
  onSend,
  onClearQueue,
  onAbort,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const permissionTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState<"permission" | "model" | "thinking" | null>(null);
  const streaming = phase === "streaming";
  const disabled = eventConnection !== "ready";
  const modelDisabled = disabled || streaming || configuring || models.length === 0 || !configuration;
  const thinkingDisabled =
    disabled ||
    streaming ||
    configuring ||
    !configuration ||
    configuration.availableThinkingLevels.length <= 1;
  const permissionDisabled = disabled || streaming || configuring || availableTools.length === 0;
  const modelGroups = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedToolSet = useMemo(() => new Set(selectedToolNames), [selectedToolNames]);
  const allToolsSelected =
    availableTools.length > 0 && availableTools.every((tool) => selectedToolSet.has(tool.name));
  const noToolsSelected = selectedToolNames.length === 0;
  const permissionState = getPermissionState(
    permissionMode,
    availableTools.length,
    selectedToolNames.length,
  );

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
      const target = event.target as Node;
      if (
        !menuRootRef.current?.contains(target) &&
        !floatingMenuRef.current?.contains(target)
      ) {
        setOpenMenu(null);
      }
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }
    function closeOnViewportChange(event: Event) {
      const target = event.target;
      if (target instanceof Node && floatingMenuRef.current?.contains(target)) {
        return;
      }
      setOpenMenu(null);
    }
    document.addEventListener("mousedown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [openMenu]);

  useEffect(() => {
    if (disabled || configuring || streaming) {
      setOpenMenu(null);
    }
  }, [configuring, disabled, streaming]);

  function toggleTool(toolName: string) {
    const nextSelection = new Set(selectedToolNames);
    if (nextSelection.has(toolName)) {
      nextSelection.delete(toolName);
    } else {
      nextSelection.add(toolName);
    }
    onToolSelectionChange(
      availableTools.map((tool) => tool.name).filter((name) => nextSelection.has(name)),
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isImeCompositionEvent(event.nativeEvent)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && (!event.altKey || streaming)) {
      event.preventDefault();
      onSend(undefined, streaming ? (event.altKey ? "followUp" : "steer") : undefined);
    }
  }

  return (
    <div className="composer-dock">
      <ComposerQueueCard
        queuedMessages={queuedMessages}
        paused={queuePaused}
        onClear={onClearQueue}
      />
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
          placeholder={streaming ? "继续输入可加入后续队列" : "描述你想让 Pi 完成的任务"}
          disabled={disabled}
          rows={1}
        />

        <div className="composer-actions" ref={menuRootRef}>
          <div className="composer-context">
            <div className="composer-picker composer-permission-picker">
              <button
                ref={permissionTriggerRef}
                className="composer-access-trigger"
                data-mode={permissionState.tone}
                type="button"
                disabled={permissionDisabled}
                aria-label="选择工具权限"
                aria-haspopup="menu"
                aria-expanded={openMenu === "permission"}
                aria-controls={openMenu === "permission" ? "composer-permission-menu" : undefined}
                onClick={() =>
                  setOpenMenu((current) => (current === "permission" ? null : "permission"))
                }
              >
                {permissionState.tone === "full" ? (
                  <ShieldAlert size={14} aria-hidden="true" />
                ) : permissionState.tone === "none" ? (
                  <ShieldOff size={14} aria-hidden="true" />
                ) : permissionState.tone === "default" ? (
                  <ShieldCheck size={14} aria-hidden="true" />
                ) : (
                  <Shield size={14} aria-hidden="true" />
                )}
                <span>{permissionState.label}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {openMenu === "permission" && (
                <AnchoredComposerMenu
                  id="composer-permission-menu"
                  anchor={permissionTriggerRef.current}
                  menuRef={floatingMenuRef}
                  className="composer-permission-menu"
                  ariaLabel="工具权限"
                >
                  <p className="composer-menu-title">权限预设</p>
                  <button
                    className="composer-permission-row"
                    type="button"
                    role="menuitemradio"
                    aria-checked={permissionMode === "default"}
                    onClick={() => {
                      setOpenMenu(null);
                      onUseDefaultTools();
                    }}
                  >
                    <ShieldCheck size={15} aria-hidden="true" />
                    <span className="composer-permission-copy">
                      <strong>默认权限</strong>
                      <small>{formatToolCount(defaultToolNames.length)} · Pi SDK 默认</small>
                    </span>
                    {permissionMode === "default" && <Check size={14} aria-hidden="true" />}
                  </button>
                  <button
                    className="composer-permission-row"
                    type="button"
                    role="menuitemradio"
                    aria-checked={permissionMode === "custom" && allToolsSelected}
                    onClick={() => {
                      setOpenMenu(null);
                      onToolSelectionChange(availableTools.map((tool) => tool.name));
                    }}
                  >
                    <ShieldAlert size={15} aria-hidden="true" />
                    <span className="composer-permission-copy">
                      <strong>完全访问</strong>
                      <small>{formatToolCount(availableTools.length)}</small>
                    </span>
                    {permissionMode === "custom" && allToolsSelected && (
                      <Check size={14} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    className="composer-permission-row"
                    type="button"
                    role="menuitemradio"
                    aria-checked={permissionMode === "custom" && noToolsSelected}
                    onClick={() => {
                      setOpenMenu(null);
                      onToolSelectionChange([]);
                    }}
                  >
                    <ShieldOff size={15} aria-hidden="true" />
                    <span className="composer-permission-copy">
                      <strong>禁止工具</strong>
                      <small>0 项工具</small>
                    </span>
                    {permissionMode === "custom" && noToolsSelected && (
                      <Check size={14} aria-hidden="true" />
                    )}
                  </button>

                  <div className="composer-menu-divider" role="separator" />
                  <p className="composer-menu-title">工具权限</p>
                  {availableTools.map((tool) => {
                    const checked = selectedToolSet.has(tool.name);
                    const toolLabel = getToolLabel(tool.name);
                    return (
                      <button
                        className="composer-permission-row composer-tool-row"
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        key={tool.name}
                        onClick={() => toggleTool(tool.name)}
                      >
                        <span className="composer-tool-check" aria-hidden="true">
                          {checked && <Check size={12} />}
                        </span>
                        <span className="composer-permission-copy">
                          <strong>{toolLabel}</strong>
                          <small title={tool.description || tool.name}>
                            {tool.name}
                            {tool.description ? ` · ${tool.description}` : ""}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </AnchoredComposerMenu>
              )}
            </div>

            <div className="composer-operation-status" aria-live="polite">
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
              ) : eventConnection !== "ready" ? (
                <span>正在连接</span>
              ) : null}
            </div>
          </div>

          <div className="composer-controls">
            <div className="composer-picker">
              <button
                ref={modelTriggerRef}
                className="composer-picker-trigger"
                type="button"
                disabled={modelDisabled}
                aria-label="选择模型"
                aria-haspopup="menu"
                aria-expanded={openMenu === "model"}
                aria-controls={openMenu === "model" ? "composer-model-menu" : undefined}
                onClick={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
              >
                <span>{configuration?.model?.name ?? "无可用模型"}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {openMenu === "model" && (
                <AnchoredComposerMenu
                  id="composer-model-menu"
                  anchor={modelTriggerRef.current}
                  menuRef={floatingMenuRef}
                  className="composer-model-menu"
                  ariaLabel="模型列表"
                >
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
                </AnchoredComposerMenu>
              )}
            </div>

            <div className="composer-picker">
              <button
                ref={thinkingTriggerRef}
                className="composer-picker-trigger"
                type="button"
                disabled={thinkingDisabled}
                aria-label="选择思考强度"
                aria-haspopup="menu"
                aria-expanded={openMenu === "thinking"}
                aria-controls={openMenu === "thinking" ? "composer-thinking-menu" : undefined}
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
                <AnchoredComposerMenu
                  id="composer-thinking-menu"
                  anchor={thinkingTriggerRef.current}
                  menuRef={floatingMenuRef}
                  className="composer-thinking-menu"
                  ariaLabel="思考强度列表"
                >
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
                </AnchoredComposerMenu>
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

interface AnchoredComposerMenuProps {
  id: string;
  anchor: HTMLElement | null;
  menuRef: RefObject<HTMLDivElement | null>;
  className: string;
  ariaLabel: string;
  children: ReactNode;
}

function AnchoredComposerMenu({
  id,
  anchor,
  menuRef,
  className,
  ariaLabel,
  children,
}: AnchoredComposerMenuProps) {
  const [menuSize, setMenuSize] = useState({ width: 280, height: 0 });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const measure = () => {
      const next = {
        width: Math.ceil(menu.offsetWidth) || 280,
        height: Math.ceil(menu.offsetHeight),
      };
      setMenuSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(menu);
    return () => observer?.disconnect();
  }, [anchor, menuRef]);

  if (!anchor || typeof document === "undefined") {
    return null;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewportPadding = 8;
  const gap = 7;
  const availableAbove = Math.max(0, anchorRect.top - gap - viewportPadding);
  const maxHeight = Math.max(
    72,
    Math.min(360, viewportHeight * 0.55, Math.max(72, availableAbove)),
  );
  const renderedHeight = Math.min(menuSize.height || maxHeight, maxHeight);
  const renderedWidth = Math.min(menuSize.width, Math.max(160, viewportWidth - 32));
  const left = clamp(
    anchorRect.right - renderedWidth,
    viewportPadding,
    Math.max(viewportPadding, viewportWidth - renderedWidth - viewportPadding),
  );
  const top = clamp(
    anchorRect.top - gap - renderedHeight,
    viewportPadding,
    Math.max(viewportPadding, viewportHeight - renderedHeight - viewportPadding),
  );
  const style: CSSProperties = { left, top, maxHeight };

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      className={`composer-menu ${className}`}
      role="menu"
      aria-label={ariaLabel}
      data-floating-menu=""
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isImeCompositionEvent(event: Pick<globalThis.KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}

function groupModelsByProvider(models: AgentModel[]): [string, AgentModel[]][] {
  const groups = new Map<string, AgentModel[]>();
  for (const model of models) {
    groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
  }
  return [...groups.entries()];
}

function getPermissionState(
  mode: ToolPermissionMode,
  availableCount: number,
  selectedCount: number,
): { label: string; tone: "default" | "full" | "none" | "custom" } {
  if (mode === "default") {
    return { label: "默认权限", tone: "default" };
  }
  if (selectedCount === 0) {
    return { label: "禁止工具", tone: "none" };
  }
  if (availableCount > 0 && selectedCount === availableCount) {
    return { label: "完全访问", tone: "full" };
  }
  return { label: `${selectedCount} 项工具`, tone: "custom" };
}

function formatToolCount(count: number): string {
  return `${count} 项工具`;
}

function getToolLabel(name: string): string {
  const labels: Record<string, string> = {
    read: "读取文件",
    bash: "运行命令",
    edit: "编辑文件",
    write: "写入文件",
    grep: "搜索内容",
    find: "查找文件",
    ls: "浏览目录",
  };
  return labels[name] ?? name;
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
