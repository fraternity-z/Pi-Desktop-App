import {
  ArrowUp,
  Check,
  ChevronDown,
  Command as CommandIcon,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  Monitor,
  Image as ImageIcon,
  Paperclip,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import type {
  AgentModel,
  AgentTool,
  ContextUsage,
  PromptStreamingBehavior,
  QueuedMessages,
  SessionConfiguration,
  ThinkingLevel,
} from "../ipc/agent";
import type { WorkspacePathMatch } from "../ipc/workspace";
import type {
  AgentEventConnection,
  CatalogPhase,
  ChatPhase,
} from "../stores/useChatSession";
import type { ToolPermissionMode } from "../stores/useToolPermissions";
import { ComposerQueueCard } from "./ComposerQueueCard";
import { isPromptImagePath, MAX_COMPOSER_ATTACHMENTS } from "./composerAttachments";
import {
  buildComposerCommandCatalog,
  composerCommandsFromGroups,
  detectComposerTrigger,
  filterComposerCommands,
  groupComposerCommands,
  replaceTextRange,
  type ComposerCommand,
} from "./composerCommands";

type ComposerMenu = "project" | "resources" | "permission" | "model" | "thinking";
type ResourcePhase = "idle" | "loading" | "ready" | "error";
type SlashCommandsPhase = "idle" | "loading" | "ready" | "error";

interface ChatComposerProps {
  workspaceName: string;
  workspacePath?: string;
  recentWorkspaces?: string[];
  branchName?: string | null;
  draft: string;
  phase: ChatPhase;
  eventConnection: AgentEventConnection;
  models: AgentModel[];
  configuration: SessionConfiguration | null;
  displayThinkingLevel?: ThinkingLevel | null;
  configuring: boolean;
  catalogPhase?: CatalogPhase;
  catalogError?: string | null;
  contextUsage?: ContextUsage | null;
  attachments?: string[];
  attachmentError?: string | null;
  slashCommands?: ComposerCommand[];
  slashCommandsPhase?: SlashCommandsPhase;
  slashCommandsError?: string | null;
  canSend: boolean;
  queuedMessages: QueuedMessages;
  queuePaused: boolean;
  permissionMode: ToolPermissionMode;
  availableTools: AgentTool[];
  selectedToolNames: string[];
  defaultToolNames: string[];
  onDraftChange: (value: string) => void;
  onProjectChange?: (cwd: string) => void;
  onAddProject?: () => void;
  onAddFiles?: () => void;
  onAddFolder?: () => void;
  onPasteImages?: (files: File[]) => void;
  onSearchWorkspacePaths?: (query: string) => Promise<WorkspacePathMatch[]>;
  onAttachPath?: (path: string) => void;
  onRemoveAttachment?: (path: string) => void;
  onRetryModels?: () => void;
  onPrepareConfiguration?: () => Promise<boolean>;
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
  workspacePath = "",
  recentWorkspaces = [],
  branchName = null,
  draft,
  phase,
  eventConnection,
  models,
  configuration,
  displayThinkingLevel = null,
  configuring,
  catalogPhase = "idle",
  catalogError = null,
  contextUsage = null,
  attachments = [],
  attachmentError = null,
  slashCommands = [],
  slashCommandsPhase = "idle",
  slashCommandsError = null,
  canSend,
  queuedMessages,
  queuePaused,
  permissionMode,
  availableTools,
  selectedToolNames,
  defaultToolNames: _defaultToolNames,
  onDraftChange,
  onProjectChange,
  onAddProject,
  onAddFiles,
  onAddFolder,
  onPasteImages,
  onSearchWorkspacePaths,
  onAttachPath,
  onRemoveAttachment,
  onRetryModels,
  onPrepareConfiguration,
  onModelChange,
  onThinkingLevelChange,
  onUseDefaultTools,
  onToolSelectionChange,
  onSend,
  onClearQueue,
  onAbort,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const floatingMenuRef = useRef<HTMLDivElement>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const resourcesTriggerRef = useRef<HTMLButtonElement>(null);
  const permissionTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const thinkingTriggerRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState<ComposerMenu | null>(null);
  const [resourceResults, setResourceResults] = useState<WorkspacePathMatch[]>([]);
  const [resourcePhase, setResourcePhase] = useState<ResourcePhase>("idle");
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [composerAnchor, setComposerAnchor] = useState<HTMLFormElement | null>(null);
  const [caretPosition, setCaretPosition] = useState(draft.length);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const streaming = phase === "streaming";
  const disabled = eventConnection !== "ready";
  const modelDisabled = disabled || streaming || configuring;
  const thinkingDisabled =
    disabled ||
    streaming ||
    configuring ||
    (configuration
      ? configuration.availableThinkingLevels.length <= 1
      : !onPrepareConfiguration);
  const permissionDisabled =
    disabled || streaming || configuring || (availableTools.length === 0 && !onPrepareConfiguration);
  const modelGroups = useMemo(() => groupModelsByProvider(models), [models]);
  const projectOptions = useMemo(
    () => uniquePaths([workspacePath, ...recentWorkspaces]),
    [recentWorkspaces, workspacePath],
  );
  const attachedPathSet = useMemo(
    () => new Set(attachments.map(normalizeComparablePath)),
    [attachments],
  );
  const autoReviewToolNames = useMemo(
    () => availableTools.map((tool) => tool.name).filter(isAutoReviewTool),
    [availableTools],
  );
  const allToolsSelected = sameSelection(
    selectedToolNames,
    availableTools.map((tool) => tool.name),
  );
  const autoReviewSelected =
    permissionMode === "custom" &&
    autoReviewToolNames.length > 0 &&
    sameSelection(selectedToolNames, autoReviewToolNames);
  const permissionState = getPermissionState(
    permissionMode,
    availableTools.length,
    selectedToolNames.length,
    autoReviewSelected,
  );
  const selectedModel = configuration?.model ?? models[0] ?? null;
  const selectedThinkingLevel = configuration?.thinkingLevel ?? displayThinkingLevel;
  const commandCatalog = useMemo(
    () => buildComposerCommandCatalog(slashCommands),
    [slashCommands],
  );
  const composerTrigger = useMemo(
    () => detectComposerTrigger(draft, caretPosition),
    [caretPosition, draft],
  );
  const filteredComposerCommands = useMemo(
    () =>
      composerTrigger
        ? filterComposerCommands(commandCatalog, composerTrigger.query)
        : [],
    [commandCatalog, composerTrigger],
  );
  const composerCommandGroups = useMemo(
    () => groupComposerCommands(filteredComposerCommands),
    [filteredComposerCommands],
  );
  const composerMenuItems = useMemo(
    () => composerCommandsFromGroups(composerCommandGroups),
    [composerCommandGroups],
  );
  const slashPanelOpen =
    openMenu === null && composerTrigger !== null && !suggestionsDismissed && !disabled;

  useLayoutEffect(() => {
    if (composerFormRef.current) {
      setComposerAnchor(composerFormRef.current);
    }
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => {
    setCaretPosition((current) => Math.max(0, Math.min(draft.length, current)));
  }, [draft.length]);

  useEffect(() => {
    setSuggestionIndex(-1);
  }, [composerTrigger?.rangeStart, composerTrigger?.rangeEnd, composerTrigger?.query]);

  useEffect(() => {
    setSuggestionIndex((current) =>
      current >= 0 && current < composerMenuItems.length ? current : -1,
    );
  }, [composerMenuItems.length]);

  useLayoutEffect(() => {
    if (!slashPanelOpen || suggestionIndex < 0) return;
    const item = floatingMenuRef.current?.querySelector<HTMLElement>(
      `[data-suggest-index="${suggestionIndex}"]`,
    );
    item?.scrollIntoView?.({ block: "nearest" });
  }, [composerMenuItems.length, slashPanelOpen, suggestionIndex]);

  useEffect(() => {
    if (openMenu === null) return;
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
      if (event.key === "Escape") setOpenMenu(null);
    }
    function closeOnViewportChange(event: Event) {
      const target = event.target;
      if (target instanceof Node && floatingMenuRef.current?.contains(target)) return;
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
    if (!slashPanelOpen) return;
    function closeOnPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!menuRootRef.current?.contains(target) && !floatingMenuRef.current?.contains(target)) {
        setSuggestionsDismissed(true);
      }
    }
    function closeOnViewportChange(event: Event) {
      const target = event.target;
      if (target instanceof Node && floatingMenuRef.current?.contains(target)) return;
      setSuggestionsDismissed(true);
    }
    document.addEventListener("mousedown", closeOnPointerDown);
    window.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("mousedown", closeOnPointerDown);
      window.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [slashPanelOpen]);

  useEffect(() => {
    if (
      (disabled || configuring || streaming) &&
      (openMenu === "permission" || openMenu === "model" || openMenu === "thinking")
    ) {
      setOpenMenu(null);
    }
  }, [configuring, disabled, openMenu, streaming]);

  useEffect(() => {
    if (openMenu !== "resources") return;
    if (!workspacePath || !onSearchWorkspacePaths) {
      setResourceResults([]);
      setResourcePhase("ready");
      setResourceError(null);
      return;
    }
    let cancelled = false;
    setResourcePhase("loading");
    setResourceError(null);
    const timer = window.setTimeout(() => {
      void onSearchWorkspacePaths("")
        .then((results) => {
          if (cancelled) return;
          setResourceResults(results);
          setResourcePhase("ready");
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setResourceResults([]);
          setResourcePhase("error");
          setResourceError(formatError(error));
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchWorkspacePaths, openMenu, workspacePath]);

  function updateCaretPosition() {
    const textarea = textareaRef.current;
    if (textarea) setCaretPosition(textarea.selectionStart ?? draft.length);
  }

  function handleDraftChange(value: string) {
    const selectionStart = textareaRef.current?.selectionStart;
    const looksLikeAppend =
      selectionStart === 0 && draft.length > 0 && value.length > draft.length && value.startsWith(draft);
    const nextCursor =
      selectionStart === null ||
      selectionStart === undefined ||
      (selectionStart === 0 && draft.length === 0 && value.length > 0) ||
      looksLikeAppend
        ? value.length
        : selectionStart;
    setCaretPosition(nextCursor);
    setSuggestionsDismissed(false);
    if (detectComposerTrigger(value, nextCursor)) setOpenMenu(null);
    onDraftChange(value);
  }

  function selectComposerCommand(command: ComposerCommand) {
    if (!composerTrigger) return;
    const replacement = replaceTextRange(
      draft,
      composerTrigger.rangeStart,
      composerTrigger.rangeEnd,
      `/${command.name} `,
    );
    setSuggestionsDismissed(true);
    setCaretPosition(replacement.cursor);
    onDraftChange(replacement.text);
    const focus = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(replacement.cursor, replacement.cursor);
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focus);
    } else {
      window.setTimeout(focus, 0);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isImeCompositionEvent(event.nativeEvent)) return;
    if (slashPanelOpen) {
      if (event.key === "ArrowDown" && composerMenuItems.length > 0) {
        event.preventDefault();
        setSuggestionIndex((current) => (current + 1) % composerMenuItems.length);
        return;
      }
      if (event.key === "ArrowUp" && composerMenuItems.length > 0) {
        event.preventDefault();
        setSuggestionIndex(
          (current) =>
            current < 0
              ? composerMenuItems.length - 1
              : (current - 1 + composerMenuItems.length) % composerMenuItems.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestionsDismissed(true);
        return;
      }
      const shouldCommit =
        (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey) ||
        (event.key === "Enter" && !event.shiftKey && !event.altKey && suggestionIndex >= 0);
      if (shouldCommit && composerMenuItems.length > 0) {
        event.preventDefault();
        selectComposerCommand(composerMenuItems[suggestionIndex] ?? composerMenuItems[0]!);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && (!event.altKey || streaming)) {
      event.preventDefault();
      onSend(undefined, streaming ? (event.altKey ? "followUp" : "steer") : undefined);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!onPasteImages) return;
    const images = Array.from(event.clipboardData.items).flatMap((item) => {
      if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
      const file = item.getAsFile();
      return file ? [file] : [];
    });
    if (images.length === 0) return;
    event.preventDefault();
    onPasteImages(images);
  }

  return (
    <div className="composer-dock" ref={menuRootRef}>
      <ComposerQueueCard
        queuedMessages={queuedMessages}
        paused={queuePaused}
        onClear={onClearQueue}
      />

      <div className="composer-project-bar">
        <div className="composer-project-picker">
          <button
            ref={projectTriggerRef}
            className="composer-project-trigger"
            type="button"
            aria-label="选择项目"
            aria-haspopup="menu"
            aria-expanded={openMenu === "project"}
            aria-controls={openMenu === "project" ? "composer-project-menu" : undefined}
            title={workspacePath || workspaceName}
            onClick={() => setOpenMenu((current) => (current === "project" ? null : "project"))}
          >
            <Folder size={18} aria-hidden="true" />
            <span>{workspaceName}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {openMenu === "project" && (
            <AnchoredComposerMenu
              id="composer-project-menu"
              anchor={projectTriggerRef.current}
              menuRef={floatingMenuRef}
              className="composer-project-menu"
              ariaLabel="项目列表"
              align="left"
            >
              <p className="composer-menu-title">项目</p>
              {projectOptions.map((path) => {
                const selected = samePath(path, workspacePath);
                return (
                  <button
                    className="composer-project-row"
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    key={path}
                    onClick={() => {
                      setOpenMenu(null);
                      if (!selected) onProjectChange?.(path);
                    }}
                  >
                    <Folder size={15} aria-hidden="true" />
                    <span className="composer-project-copy">
                      <strong>{getPathName(path)}</strong>
                      <small title={path}>{path}</small>
                    </span>
                    {selected && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
              {projectOptions.length > 0 && <div className="composer-menu-divider" role="separator" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onAddProject?.();
                }}
              >
                <FolderPlus size={15} aria-hidden="true" />
                <span>添加项目</span>
              </button>
            </AnchoredComposerMenu>
          )}
        </div>
        <span className="composer-environment-chip" title="本机 Pi Runtime">
          <Monitor size={17} aria-hidden="true" />
          本地
        </span>
        {branchName && (
          <span className="composer-environment-chip" title={`Git 分支：${branchName}`}>
            <GitBranch size={17} aria-hidden="true" />
            {branchName}
          </span>
        )}
      </div>

      <form
        ref={composerFormRef}
        className="composer-frame"
        onSubmit={onSend}
        aria-busy={streaming || configuring}
      >
        {(attachments.length > 0 || attachmentError) && (
          <div className="composer-attachment-region">
            {attachments.length > 0 && (
              <div className="composer-attachment-list" aria-label="已添加的路径">
                {attachments.map((path) => (
                  <span className="composer-attachment-chip" key={path} title={path}>
                    {isPromptImagePath(path) ? (
                      <ImageIcon size={13} aria-hidden="true" />
                    ) : (
                      <Paperclip size={13} aria-hidden="true" />
                    )}
                    <span>{getPathName(path)}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment?.(path)}
                      aria-label={`移除 ${getPathName(path)}`}
                      title="移除"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {attachmentError && (
              <p className="composer-attachment-error" role="alert">
                {attachmentError}
              </p>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          aria-label="发送给 Pi 的消息"
          aria-autocomplete="list"
          aria-controls={slashPanelOpen ? "composer-slash-menu" : undefined}
          aria-activedescendant={
            slashPanelOpen && suggestionIndex >= 0
              ? `composer-slash-item-${suggestionIndex}`
              : undefined
          }
          aria-expanded={slashPanelOpen}
          value={draft}
          onChange={(event) => handleDraftChange(event.target.value)}
          onSelect={updateCaretPosition}
          onClick={updateCaretPosition}
          onKeyUp={updateCaretPosition}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={streaming ? "继续输入可加入后续队列" : "描述你想构建的内容..."}
          disabled={disabled}
          rows={1}
        />

        <div className="composer-actions">
          <div className="composer-context">
            <div className="composer-picker composer-resources-picker">
              <button
                ref={resourcesTriggerRef}
                className="composer-icon-trigger"
                type="button"
                aria-label="添加文件或文件夹"
                title="添加"
                aria-haspopup="menu"
                aria-expanded={openMenu === "resources"}
                aria-controls={openMenu === "resources" ? "composer-resources-menu" : undefined}
                onClick={() =>
                  setOpenMenu((current) => (current === "resources" ? null : "resources"))
                }
              >
                <Plus size={21} aria-hidden="true" />
              </button>
              {openMenu === "resources" && (
                <AnchoredComposerMenu
                  id="composer-resources-menu"
                  anchor={resourcesTriggerRef.current}
                  menuRef={floatingMenuRef}
                  className="composer-resources-menu"
                  ariaLabel="添加文件或文件夹"
                  align="left"
                  defaultWidth={680}
                  maximumHeight={520}
                >
                  <p className="composer-resources-title">添加</p>
                  <div className="composer-resource-actions">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={attachments.length >= MAX_COMPOSER_ATTACHMENTS}
                      onClick={() => onAddFiles?.()}
                    >
                      <File size={16} aria-hidden="true" />
                      <span>添加文件</span>
                      <small>本地</small>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={attachments.length >= MAX_COMPOSER_ATTACHMENTS}
                      onClick={() => onAddFolder?.()}
                    >
                      <FolderOpen size={16} aria-hidden="true" />
                      <span>添加文件夹</span>
                      <small>本地</small>
                    </button>
                  </div>
                  {workspacePath && onSearchWorkspacePaths && (
                    <div className="composer-resource-results" aria-live="polite">
                      {resourcePhase === "loading" ? (
                        <p className="composer-menu-state">
                          <LoaderCircle className="spin" size={15} aria-hidden="true" />
                          正在读取当前项目
                        </p>
                      ) : resourcePhase === "error" ? (
                        <p className="composer-menu-state composer-menu-state-error">{resourceError}</p>
                      ) : resourceResults.length === 0 ? (
                        <p className="composer-menu-state">当前项目中没有可添加的路径</p>
                      ) : (
                        resourceResults.map((result) => {
                          const selected = attachedPathSet.has(normalizeComparablePath(result.path));
                          return (
                            <button
                              className="composer-resource-row"
                              type="button"
                              role="menuitemcheckbox"
                              aria-checked={selected}
                              disabled={selected || attachments.length >= MAX_COMPOSER_ATTACHMENTS}
                              key={result.path}
                              title={result.path}
                              onClick={() => onAttachPath?.(result.path)}
                            >
                              {result.kind === "folder" ? (
                                <Folder size={16} aria-hidden="true" />
                              ) : (
                                <File size={16} aria-hidden="true" />
                              )}
                              <span>{getPathName(result.path)}</span>
                              <small>{getParentPath(result.relativePath)}</small>
                              {selected && <Check size={14} aria-hidden="true" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </AnchoredComposerMenu>
              )}
            </div>

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
                onClick={() => {
                  const opening = openMenu !== "permission";
                  setOpenMenu(opening ? "permission" : null);
                  if (opening && !configuration) void onPrepareConfiguration?.();
                }}
              >
                {permissionState.tone === "full" ? (
                  <ShieldAlert size={17} aria-hidden="true" />
                ) : permissionState.tone === "none" ? (
                  <ShieldOff size={17} aria-hidden="true" />
                ) : permissionState.tone === "default" ? (
                  <ShieldCheck size={17} aria-hidden="true" />
                ) : (
                  <Shield size={17} aria-hidden="true" />
                )}
                <span>{permissionState.label}</span>
              </button>
              {openMenu === "permission" && (
                <AnchoredComposerMenu
                  id="composer-permission-menu"
                  anchor={permissionTriggerRef.current}
                  menuRef={floatingMenuRef}
                  className="composer-permission-menu"
                  ariaLabel="工具权限"
                  align="left"
                  defaultWidth={324}
                >
                  {!configuration && availableTools.length === 0 ? (
                    <p className="composer-menu-state">
                      <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      正在读取权限
                    </p>
                  ) : (
                    <>
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
                    <ShieldCheck size={18} aria-hidden="true" />
                    <span className="composer-permission-copy">
                      <strong>默认权限</strong>
                      <small>默认可读写当前项目文件；超出范围时再请求授权</small>
                    </span>
                    {permissionMode === "default" && <Check size={16} aria-hidden="true" />}
                  </button>
                  <button
                    className="composer-permission-row"
                    type="button"
                    role="menuitemradio"
                    aria-checked={autoReviewSelected}
                    disabled={autoReviewToolNames.length === 0}
                    onClick={() => {
                      setOpenMenu(null);
                      onToolSelectionChange(autoReviewToolNames);
                    }}
                  >
                    <Shield size={18} aria-hidden="true" />
                    <span className="composer-permission-copy">
                      <strong>自动审核</strong>
                      <small>自动处理权限请求；偶发误判时可改回手动确认</small>
                    </span>
                    {autoReviewSelected && <Check size={16} aria-hidden="true" />}
                  </button>
                  <button
                    className="composer-permission-row composer-permission-row-full"
                    type="button"
                    role="menuitemradio"
                    aria-checked={permissionMode === "custom" && allToolsSelected}
                    onClick={() => {
                      setOpenMenu(null);
                      onToolSelectionChange(availableTools.map((tool) => tool.name));
                    }}
                  >
                    <ShieldAlert size={18} aria-hidden="true" />
                    <span className="composer-permission-copy">
                      <strong>完全访问</strong>
                      <small>可编辑任意路径并执行联网命令，无需再次确认</small>
                    </span>
                    {permissionMode === "custom" && allToolsSelected && (
                      <Check size={16} aria-hidden="true" />
                    )}
                  </button>

                    </>
                  )}
                </AnchoredComposerMenu>
              )}
            </div>

            <div className="composer-operation-status" aria-live="polite">
              {configuring ? (
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
            <ContextMeter usage={contextUsage} />

            <div className="composer-picker">
              <button
                ref={modelTriggerRef}
                className="composer-picker-trigger composer-model-trigger"
                type="button"
                disabled={modelDisabled}
                aria-label="选择模型"
                aria-haspopup="menu"
                aria-expanded={openMenu === "model"}
                aria-controls={openMenu === "model" ? "composer-model-menu" : undefined}
                onClick={() => setOpenMenu((current) => (current === "model" ? null : "model"))}
              >
                <span>
                  {selectedModel?.name ??
                    (catalogPhase === "loading" ? "正在加载模型" : "选择模型")}
                </span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {openMenu === "model" && (
                <AnchoredComposerMenu
                  id="composer-model-menu"
                  anchor={modelTriggerRef.current}
                  menuRef={floatingMenuRef}
                  className="composer-model-menu"
                  ariaLabel="模型列表"
                  defaultWidth={330}
                >
                  {catalogPhase === "loading" && models.length === 0 ? (
                    <p className="composer-menu-state">
                      <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      正在加载模型
                    </p>
                  ) : models.length === 0 ? (
                    <div className="composer-model-empty">
                      <p>{catalogError || "当前 Pi 配置中没有可用模型"}</p>
                      {onRetryModels && (
                        <button type="button" onClick={onRetryModels}>
                          <RefreshCw size={14} aria-hidden="true" />
                          重新加载
                        </button>
                      )}
                    </div>
                  ) : (
                    modelGroups.map(([provider, providerModels]) => (
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
                    ))
                  )}
                </AnchoredComposerMenu>
              )}
            </div>

            <div className="composer-picker">
              <button
                ref={thinkingTriggerRef}
                className="composer-picker-trigger composer-thinking-trigger"
                type="button"
                disabled={thinkingDisabled}
                aria-label="选择思考强度"
                aria-haspopup="menu"
                aria-expanded={openMenu === "thinking"}
                aria-controls={openMenu === "thinking" ? "composer-thinking-menu" : undefined}
                onClick={() => {
                  const opening = openMenu !== "thinking";
                  setOpenMenu(opening ? "thinking" : null);
                  if (opening && !configuration) void onPrepareConfiguration?.();
                }}
              >
                <span>{selectedThinkingLevel ? thinkingLevelShortLabel(selectedThinkingLevel) : "思考"}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {openMenu === "thinking" && (
                <AnchoredComposerMenu
                  id="composer-thinking-menu"
                  anchor={thinkingTriggerRef.current}
                  menuRef={floatingMenuRef}
                  className="composer-thinking-menu"
                  ariaLabel="思考强度列表"
                  defaultWidth={240}
                >
                  {configuration ? (
                    <>
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
                    </>
                  ) : (
                    <p className="composer-menu-state">
                      <LoaderCircle className="spin" size={15} aria-hidden="true" />
                      正在读取思考强度
                    </p>
                  )}
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
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </div>
      </form>

      {slashPanelOpen && (
        <AnchoredComposerMenu
          id="composer-slash-menu"
          anchor={composerAnchor}
          menuRef={floatingMenuRef}
          className="composer-slash-menu"
          ariaLabel="命令"
          align="left"
          defaultWidth={560}
          maximumHeight={360}
        >
          <div className="composer-suggest-scroll">
            {slashCommandsPhase === "loading" && (
              <p className="composer-suggest-state">
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
                正在读取命令
              </p>
            )}
            {slashCommandsPhase === "error" && slashCommandsError && (
              <p className="composer-suggest-state composer-suggest-state-error" role="status">
                {slashCommandsError}
              </p>
            )}
            {composerCommandGroups.map((group) => (
              <section className="composer-suggest-group" key={group.id}>
                <div className="composer-suggest-group-label">
                  {group.id === "skill" ? "技能" : "命令"}
                </div>
                {group.items.map(({ command, flatIndex }) => {
                  const active = suggestionIndex >= 0 && flatIndex === suggestionIndex;
                  return (
                    <button
                      className="composer-suggest-item"
                      data-active={active}
                      data-suggest-index={flatIndex}
                      data-testid="composer-slash-item"
                      id={`composer-slash-item-${flatIndex}`}
                      key={`${command.source}:${command.name}`}
                      type="button"
                      role="menuitem"
                      aria-selected={active}
                      title={command.description}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setSuggestionIndex(flatIndex)}
                      onClick={() => selectComposerCommand(command)}
                    >
                      <span className="composer-suggest-icon" aria-hidden="true">
                        {command.source === "skill" ? (
                          <Sparkles size={16} />
                        ) : (
                          <CommandIcon size={16} />
                        )}
                      </span>
                      <span className="composer-suggest-copy">
                        <span className="composer-suggest-name">/{command.name}</span>
                        {command.description && (
                          <span className="composer-suggest-description">{command.description}</span>
                        )}
                      </span>
                      {command.argumentHint && (
                        <span className="composer-suggest-hint">{command.argumentHint}</span>
                      )}
                    </button>
                  );
                })}
              </section>
            ))}
            {composerMenuItems.length === 0 && slashCommandsPhase !== "loading" && (
              <p className="composer-suggest-state">没有匹配的命令</p>
            )}
          </div>
        </AnchoredComposerMenu>
      )}
    </div>
  );
}

function ContextMeter({ usage }: { usage: ContextUsage | null }) {
  const hasPercent = usage !== null && Number.isFinite(usage.percent);
  const percent = hasPercent ? clamp(Math.round(usage.percent), 0, 100) : 0;
  const title = usage
    ? `上下文占用 ${formatTokenCount(usage.tokens)} / ${formatTokenCount(usage.contextWindow)}（${percent}%）`
    : "上下文占用量将在会话开始后显示";
  return (
    <span
      className="composer-context-meter"
      role="meter"
      aria-label="上下文占用量"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={hasPercent ? percent : undefined}
      title={title}
      data-empty={!hasPercent}
      data-context-percent={percent}
    >
      <svg className="composer-context-ring" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle
          className="composer-context-ring-track"
          cx="10"
          cy="10"
          r="7"
          stroke="currentColor"
          strokeWidth="2.25"
          opacity="0.2"
        />
        {percent > 0 && (
          <circle
            className="composer-context-ring-progress"
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - percent}
            transform="rotate(-90 10 10)"
          />
        )}
      </svg>
      <span>{percent}%</span>
    </span>
  );
}

interface AnchoredComposerMenuProps {
  id: string;
  anchor: HTMLElement | null;
  menuRef: RefObject<HTMLDivElement | null>;
  className: string;
  ariaLabel: string;
  children: ReactNode;
  align?: "left" | "right";
  defaultWidth?: number;
  maximumHeight?: number;
}

function AnchoredComposerMenu({
  id,
  anchor,
  menuRef,
  className,
  ariaLabel,
  children,
  align = "right",
  defaultWidth = 280,
  maximumHeight = 420,
}: AnchoredComposerMenuProps) {
  const [menuSize, setMenuSize] = useState({ width: defaultWidth, height: 0 });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const measure = () => {
      const next = {
        width: Math.ceil(menu.offsetWidth) || defaultWidth,
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
  }, [anchor, defaultWidth, menuRef]);

  if (!anchor || typeof document === "undefined") return null;
  const anchorRect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const viewportPadding = 8;
  const gap = 8;
  const availableAbove = Math.max(0, anchorRect.top - gap - viewportPadding);
  const maxHeight = Math.max(
    72,
    Math.min(maximumHeight, viewportHeight * 0.72, Math.max(72, availableAbove)),
  );
  const renderedHeight = Math.min(menuSize.height || maxHeight, maxHeight);
  const renderedWidth = Math.min(menuSize.width, Math.max(160, viewportWidth - 16));
  const preferredLeft = align === "left" ? anchorRect.left : anchorRect.right - renderedWidth;
  const left = clamp(
    preferredLeft,
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

export function isImeCompositionEvent(
  event: Pick<globalThis.KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
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
  autoReviewSelected: boolean,
): { label: string; tone: "default" | "full" | "none" | "custom" } {
  if (mode === "default") return { label: "默认权限", tone: "default" };
  if (selectedCount === 0) return { label: "禁止工具", tone: "none" };
  if (availableCount > 0 && selectedCount === availableCount) {
    return { label: "完全访问", tone: "full" };
  }
  if (autoReviewSelected) return { label: "自动审核", tone: "custom" };
  return { label: `${selectedCount} 项工具`, tone: "custom" };
}

function isAutoReviewTool(name: string): boolean {
  return ["read", "grep", "find", "ls"].includes(name.toLocaleLowerCase("en-US"));
}

function sameSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((item) => expected.has(item));
}

function uniquePaths(paths: string[]): string[] {
  const unique = new Map<string, string>();
  for (const path of paths) {
    if (!path.trim()) continue;
    const key = normalizeComparablePath(path);
    if (!unique.has(key)) unique.set(key, path);
  }
  return [...unique.values()];
}

function normalizeComparablePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
}

function samePath(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function getPathName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized || "未绑定项目";
}

function getParentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "当前项目";
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function thinkingLevelShortLabel(level: ThinkingLevel): string {
  return {
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
    max: "Max",
  }[level];
}

function thinkingLevelLabel(level: ThinkingLevel): string {
  return {
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "XHigh",
    max: "Max",
  }[level];
}
