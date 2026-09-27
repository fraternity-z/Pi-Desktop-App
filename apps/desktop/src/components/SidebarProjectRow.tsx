import { Ellipsis, Folder, FolderOpen, MessageSquare, Pin, PinOff, Settings, SquarePen } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import "./sidebar-project-row.css";

interface SidebarProjectRowProps {
  name: string;
  cwd: string;
  expanded: boolean;
  active: boolean;
  pinned: boolean;
  sessionCount: number;
  runningCount: number;
  creationDisabled: boolean;
  previewEnabled: boolean;
  onToggle: () => void;
  onNewSession: () => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onTogglePinned: () => void;
  onEdit: () => void;
  onPreviewEnter: () => void;
  onPreviewLeave: () => void;
}

export function SidebarProjectRow({
  name, cwd, expanded, active, pinned, sessionCount, runningCount,
  creationDisabled, previewEnabled, onToggle, onNewSession, onMenu,
  onContextMenu, onTogglePinned, onEdit, onPreviewEnter, onPreviewLeave,
}: SidebarProjectRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const titleId = useId();
  const summaryId = useId();
  const visible = previewEnabled && previewOpen;

  function clearTimers() {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }

  function dismiss() {
    clearTimers();
    setPreviewOpen(false);
  }

  function containsTarget(target: EventTarget | null) {
    return target instanceof Node && (rowRef.current?.contains(target) || cardRef.current?.contains(target));
  }

  function scheduleOpen() {
    clearTimers();
    if (!previewEnabled) return;
    openTimer.current = window.setTimeout(() => setPreviewOpen(true), 400);
  }

  function scheduleClose() {
    clearTimers();
    if (containsTarget(document.activeElement)) return;
    closeTimer.current = window.setTimeout(() => setPreviewOpen(false), 160);
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!containsTarget(event.relatedTarget)) dismiss();
  }

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (!previewEnabled) dismiss();
  }, [previewEnabled]);

  useLayoutEffect(() => {
    if (!visible || !rowRef.current || !cardRef.current) return;
    const row = rowRef.current.getBoundingClientRect();
    const card = cardRef.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(row.right + 8, window.innerWidth - card.width - 8)),
      top: Math.max(8, Math.min(row.top, window.innerHeight - card.height - 8)),
    });
  }, [visible, name, cwd, sessionCount, runningCount]);

  useEffect(() => {
    if (!visible) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (cardRef.current?.contains(document.activeElement)) rowRef.current?.focus();
      dismiss();
    }
    function closeOutside(event: globalThis.PointerEvent) {
      if (!containsTarget(event.target)) dismiss();
    }
    function closeOnScroll(event: Event) {
      if (!(event.target instanceof Node) || !cardRef.current?.contains(event.target)) dismiss();
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [visible]);

  return (
    <>
      <div
        ref={rowRef}
        className="project-row project-row-with-compose"
        data-active={active || undefined}
        data-preview-open={visible || undefined}
        role="button"
        tabIndex={0}
        aria-label={`${expanded ? "折叠" : "展开"}${name}`}
        aria-expanded={expanded}
        aria-describedby={visible ? summaryId : undefined}
        onPointerEnter={scheduleOpen}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          clearTimers();
          if (previewEnabled) setPreviewOpen(true);
        }}
        onBlur={handleBlur}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" && visible) {
            event.preventDefault();
            cardRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            return;
          }
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggle();
        }}
        onContextMenu={(event) => {
          dismiss();
          onContextMenu(event);
        }}
      >
        <div className="project-select" aria-current={active ? "page" : undefined} title={cwd}>
          {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span>{name}</span>
        </div>
        <button
          className="sidebar-row-menu"
          type="button"
          aria-label={`${name}更多操作`}
          title="更多"
          onClick={(event) => {
            event.stopPropagation();
            dismiss();
            onMenu(event);
          }}
        >
          <Ellipsis size={15} />
        </button>
        <button
          className="sidebar-row-menu sidebar-project-compose"
          type="button"
          aria-label={`在${name}中新建会话`}
          title="新建会话"
          disabled={creationDisabled}
          onClick={(event) => {
            event.stopPropagation();
            dismiss();
            onNewSession();
          }}
        >
          <SquarePen size={15} />
        </button>
      </div>
      {visible && createPortal(
        <section
          ref={cardRef}
          className="sidebar-project-preview"
          role="dialog"
          aria-labelledby={titleId}
          style={position}
          onPointerEnter={() => {
            clearTimers();
            onPreviewEnter();
          }}
          onPointerLeave={() => {
            scheduleClose();
            onPreviewLeave();
          }}
          onFocus={() => {
            clearTimers();
            onPreviewEnter();
          }}
          onBlur={handleBlur}
        >
          <header className="sidebar-project-preview-header">
            <Folder size={17} aria-hidden="true" />
            <strong id={titleId}>{name}</strong>
            <button
              type="button"
              aria-label={pinned ? `取消置顶${name}` : `置顶${name}`}
              title={pinned ? "取消置顶" : "置顶"}
              aria-pressed={pinned}
              onClick={onTogglePinned}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          </header>
          <p className="sidebar-project-preview-summary" id={summaryId}>
            <MessageSquare size={16} aria-hidden="true" />
            <span>{sessionCount} 个会话 · {runningCount} 个运行中</span>
          </p>
          <div className="sidebar-project-preview-path">
            <Folder size={16} aria-hidden="true" />
            <span>{cwd}</span>
          </div>
          <button
            className="sidebar-project-preview-edit"
            type="button"
            onClick={() => {
              dismiss();
              onEdit();
            }}
          >
            <Settings size={16} aria-hidden="true" />
            <span>编辑项目</span>
          </button>
        </section>,
        document.body,
      )}
    </>
  );
}
