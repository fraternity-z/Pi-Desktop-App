import {
  Eye,
  FileDiff,
  FileText,
  FolderOpen,
  Maximize2,
  Minimize2,
  Plus,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type CSSProperties,
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { clampRightPanelWidth, resolveRightPanelMaxWidth, RIGHT_PANEL_DEFAULT_WIDTH } from "../stores/useRightPanelLayout";
import type { RightPanelTabId, RightPanelToolTabId } from "../stores/useRightPanelSessionState";

export type { RightPanelTabId } from "../stores/useRightPanelSessionState";

export interface RightPanelTabDescriptor {
  readonly label: string;
  readonly title?: string;
}

export interface RightPanelProps {
  readonly open: boolean;
  readonly available: boolean;
  readonly opening?: boolean;
  readonly closing?: boolean;
  readonly width: number;
  readonly expanded: boolean;
  readonly activeTab: RightPanelTabId | null;
  readonly toolTabs?: ReadonlyArray<RightPanelToolTabId>;
  readonly onCloseToolTab?: (tab: RightPanelToolTabId) => void;
  readonly fileTab?: RightPanelTabDescriptor | null;
  readonly previewTab?: RightPanelTabDescriptor | null;
  readonly sessionKey?: string;
  readonly children?: ReactNode;
  readonly onClose: () => void;
  readonly onWidthChange: (width: number) => void;
  readonly onWidthCommit?: (width: number) => void;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onActiveTabChange: (tab: RightPanelTabId | null) => void;
  readonly onOpenFile?: () => void;
  readonly fileShortcut?: string | null;
  readonly onCloseFileTab?: () => void;
  readonly onClosePreviewTab?: () => void;
}

interface TabDefinition {
  readonly id: RightPanelTabId;
  readonly label: string;
  readonly title?: string;
  readonly icon: typeof FileText;
  readonly close?: () => void;
}

export function RightPanel(props: RightPanelProps): ReactElement | null {
  const [menuOpen, setMenuOpen] = useState(false);
  const [order, setOrder] = useState<RightPanelTabId[]>(["review", "files", "file", "preview"]);
  const dragTab = useRef<RightPanelTabId | null>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const dragScrollFrame = useRef<number | null>(null);
  const dragScrollDirection = useRef(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useRef<RightPanelTabId | "launcher" | null>(null);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(`pi-desktop.panel-order:${props.sessionKey ?? "default"}`) ?? "null");
      const ids: RightPanelTabId[] = ["review", "files", "file", "preview"];
      setOrder(Array.isArray(saved) ? [...new Set([...saved.filter((id): id is RightPanelTabId => ids.includes(id)), ...ids])] : ids);
    } catch { setOrder(["review", "files", "file", "preview"]); }
  }, [props.sessionKey]);
  function reorder(from: RightPanelTabId, to: RightPanelTabId, after: boolean) {
    if (from === to) return;
    setOrder((current) => {
      const next = current.filter((id) => id !== from);
      next.splice(next.indexOf(to) + (after ? 1 : 0), 0, from);
      try { window.sessionStorage.setItem(`pi-desktop.panel-order:${props.sessionKey ?? "default"}`, JSON.stringify(next)); } catch { /* Keep in-memory layout. */ }
      return next;
    });
    focusAfterRender.current = from;
  }
  const stopDragScroll = useCallback(() => {
    if (dragScrollFrame.current !== null) window.cancelAnimationFrame(dragScrollFrame.current);
    dragScrollFrame.current = null;
    dragScrollDirection.current = 0;
  }, []);
  function scrollWhileDragging(event: DragEvent<HTMLDivElement>) {
    if (!dragTab.current) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    dragScrollDirection.current = event.clientX < bounds.left + 28 ? -1 : event.clientX > bounds.right - 28 ? 1 : 0;
    if (!dragScrollDirection.current) { stopDragScroll(); return; }
    if (dragScrollFrame.current !== null) return;
    const scroll = () => {
      dragScrollFrame.current = null;
      const strip = tabStripRef.current;
      if (!strip || !dragTab.current || !dragScrollDirection.current) return;
      strip.scrollLeft += dragScrollDirection.current * 12;
      dragScrollFrame.current = window.requestAnimationFrame(scroll);
    };
    dragScrollFrame.current = window.requestAnimationFrame(scroll);
  }
  useEffect(() => {
    if (!props.open || !props.available) { dragTab.current = null; stopDragScroll(); }
    return stopDragScroll;
  }, [props.open, props.available, stopDragScroll]);
  const generatedId = useId();
  const panelId = `right-panel-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tabPanelId = `${panelId}-content`;
  const resizeStart = useRef<{ x: number; width: number; latest: number } | null>(null);
  const resizeFrame = useRef<number | null>(null);
  const pendingWidth = useRef<number | null>(null);
  const widthChange = useRef(props.onWidthChange);
  widthChange.current = props.onWidthChange;
  const menuRef = useRef<HTMLDivElement>(null);
  const maxWidth = resolveRightPanelMaxWidth(typeof window === "undefined" ? null : window.innerWidth);
  const tabs: TabDefinition[] = [
    ...((props.toolTabs ?? ["review", "files"]).map((id): TabDefinition => ({ id, label: id === "review" ? "审查" : "文件", icon: id === "review" ? FileDiff : FolderOpen, close: props.onCloseToolTab ? () => props.onCloseToolTab?.(id) : undefined }))),
    ...(props.fileTab ? [{ id: "file" as const, label: props.fileTab.label, title: props.fileTab.title, icon: FileText, close: props.onCloseFileTab }] : []),
    ...(props.previewTab ? [{ id: "preview" as const, label: props.previewTab.label, title: props.previewTab.title, icon: Eye, close: props.onClosePreviewTab }] : []),
  ];
  tabs.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  useEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    if (!props.open || !props.available) return;
    if (target === "launcher") launcherRef.current?.focus();
    else document.getElementById(`${panelId}-tab-${target}`)?.focus();
  });

  const selectTab = useCallback((tab: RightPanelTabId) => props.onActiveTabChange(tab), [props]);
  const closeTab = useCallback((tab: TabDefinition) => {
    if (!tab.close) return;
    const remaining = tabs.filter((item) => item.id !== tab.id);
    const next = remaining[Math.min(tabs.indexOf(tab), remaining.length - 1)]?.id ?? null;
    if (props.activeTab === tab.id) props.onActiveTabChange(next);
    const closedShell = document.getElementById(`${panelId}-tab-${tab.id}`)?.parentElement;
    if (closedShell?.contains(document.activeElement)) focusAfterRender.current = (props.activeTab === tab.id ? next : props.activeTab) ?? "launcher";
    tab.close?.();
  }, [props, tabs, panelId]);
  const openAction = useCallback((action?: () => void) => {
    setMenuOpen(false);
    action?.();
  }, []);

  function handleTabListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).getAttribute("role") !== "tab") return;
    const currentIndex = tabs.findIndex((tab) => `${panelId}-tab-${tab.id}` === (event.target as HTMLElement).id);
    if (currentIndex < 0) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); closeTab(tabs[currentIndex]!); return; }
    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const next = tabs[currentIndex + (event.key === "ArrowLeft" ? -1 : 1)];
      if (next) reorder(tabs[currentIndex]!.id, next.id, event.key === "ArrowRight");
      return;
    }
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex]?.id;
    if (!nextTab) return;
    props.onActiveTabChange(nextTab);
    focusAfterRender.current = nextTab;
  }

  useEffect(() => {
    if (!menuOpen || !props.open || !props.available) return;
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); launcherRef.current?.focus(); }
    };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen, props.open, props.available]);
  useEffect(() => {
    if (!props.open || !props.available) setMenuOpen(false);
  }, [props.open, props.available]);

  useEffect(() => {
    if (!props.open || !props.available || props.expanded) {
      if (resizeFrame.current !== null) window.cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = null;
      pendingWidth.current = null;
      resizeStart.current = null;
    }
  }, [props.open, props.available, props.expanded]);
  useEffect(() => () => {
    if (resizeFrame.current !== null) window.cancelAnimationFrame(resizeFrame.current);
  }, []);

  const panelClassName = [
    "right-panel",
    props.opening ? "right-panel-opening" : "",
    props.closing ? "right-panel-closing" : "",
    props.expanded ? "right-panel-expanded" : "",
  ].filter(Boolean).join(" ");

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (props.expanded) return;
    event.preventDefault();
    resizeStart.current = { x: event.clientX, width: props.width, latest: props.width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const start = resizeStart.current;
    if (!start) return;
    pendingWidth.current = clampRightPanelWidth(start.width + start.x - event.clientX, maxWidth);
    start.latest = pendingWidth.current;
    if (resizeFrame.current === null) {
      resizeFrame.current = window.requestAnimationFrame(() => {
        resizeFrame.current = null;
        if (pendingWidth.current !== null) widthChange.current(pendingWidth.current);
        pendingWidth.current = null;
      });
    }
  }
  function endResize(event: PointerEvent<HTMLDivElement>) {
    if (!resizeStart.current) return;
    if (resizeFrame.current !== null) window.cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = null;
    if (pendingWidth.current !== null) widthChange.current(pendingWidth.current);
    props.onWidthCommit?.(resizeStart.current.latest);
    pendingWidth.current = null;
    resizeStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Home") { event.preventDefault(); commitWidth(320); return; }
    if (event.key === "End") { event.preventDefault(); commitWidth(maxWidth); return; }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    commitWidth(clampRightPanelWidth(props.width + (event.key === "ArrowLeft" ? 8 : -8), maxWidth));
  }
  function commitWidth(width: number) { props.onWidthChange(width); props.onWidthCommit?.(width); }
  function launchTool(tab: RightPanelToolTabId) {
    openAction(() => props.onActiveTabChange(tab));
    focusAfterRender.current = tab;
  }

  return (
    <aside
      className={panelClassName}
      aria-label="工作区侧边栏"
      aria-hidden={!props.open || !props.available}
      inert={!props.open || !props.available}
      hidden={!props.available}
      style={{ "--right-panel-width": `${props.width}px`, display: props.available ? undefined : "none" } as CSSProperties}
    >
      {!props.expanded ? <div className="right-panel-resizer" role="separator" aria-label="调整右侧面板宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={maxWidth} aria-valuenow={props.width} tabIndex={0} onDoubleClick={() => commitWidth(clampRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH, maxWidth))} onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={resizeWithKeyboard} /> : null}
      <header className="right-panel-header">
        <div className="right-panel-tabs-wrap">
        <div ref={tabStripRef} className="right-panel-tabs" role="tablist" aria-label="右侧面板标签页" aria-orientation="horizontal" onKeyDown={handleTabListKeyDown} onDragOver={scrollWhileDragging} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stopDragScroll(); }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = props.activeTab === tab.id;
            return <div key={tab.id} className={`right-panel-tab-shell${active ? " is-active" : ""}`} draggable onDragStart={(event) => { dragTab.current = tab.id; event.dataTransfer.setData("text/plain", tab.id); }} onDragEnd={() => { dragTab.current = null; stopDragScroll(); }} onDrop={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              if (dragTab.current) reorder(dragTab.current, tab.id, event.clientX > bounds.left + bounds.width / 2);
              dragTab.current = null;
              stopDragScroll();
            }} onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab); } }}>
              <button type="button" id={`${panelId}-tab-${tab.id}`} className="right-panel-tab" role="tab" aria-selected={active} aria-controls={tabPanelId} tabIndex={active ? 0 : -1} title={tab.id === "review" ? "代码审查" : tab.title ?? tab.label} onClick={() => selectTab(tab.id)}><Icon aria-hidden="true" /><span>{tab.label}</span></button>
              {tab.close ? <button type="button" className="right-panel-icon-button right-panel-tab-close" aria-label={getCloseTabLabel(tab.id)} title={getCloseTabLabel(tab.id)} onClick={() => closeTab(tab)}><X aria-hidden="true" /></button> : null}
            </div>;
          })}
        </div>
          <div className="right-panel-add-wrap" ref={menuRef}>
            <button ref={launcherRef} type="button" className="right-panel-icon-button" aria-label="打开右侧面板标签页" title="打开标签页" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><Plus aria-hidden="true" /></button>
            {menuOpen ? <div className="right-panel-menu" role="menu">
              <div className="right-panel-menu-heading">工具与面板</div>
              {props.onOpenFile ? <button type="button" role="menuitem" onClick={() => openAction(props.onOpenFile)}><FileText aria-hidden="true" /><span>打开文件</span><kbd>{props.fileShortcut ?? ""}</kbd></button> : null}
              <button type="button" role="menuitem" onClick={() => launchTool("files")}><FolderOpen aria-hidden="true" /><span>文件列表</span></button>
              <button type="button" role="menuitem" onClick={() => launchTool("review")}><FileDiff aria-hidden="true" /><span>Git 审查</span></button>
            </div> : null}
          </div>
        </div>
        <div className="right-panel-actions">
          <button type="button" className="right-panel-icon-button" aria-label={props.expanded ? "收起工作区侧边栏" : "展开工作区侧边栏"} aria-pressed={props.expanded} title={props.expanded ? "收起工作区侧边栏" : "展开工作区侧边栏"} onClick={() => props.onExpandedChange(!props.expanded)}>{props.expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
          <button type="button" className="right-panel-icon-button" aria-label="关闭差异侧栏" title="关闭差异侧栏" onClick={props.onClose}><X aria-hidden="true" /></button>
        </div>
      </header>
      <div id={tabPanelId} className="right-panel-content" role="tabpanel" aria-labelledby={props.activeTab ? `${panelId}-tab-${props.activeTab}` : undefined} aria-label={props.activeTab ? undefined : "打开工具"}>
        {props.activeTab === null ? <div className="right-panel-content-state"><p>打开工具或文件以继续</p><button type="button" className="secondary-button" onClick={() => launchTool("files")}>文件列表</button><button type="button" className="secondary-button" onClick={() => launchTool("review")}>Git 审查</button></div> : null}
        {props.children}
      </div>
    </aside>
  );
}

function getCloseTabLabel(tab: RightPanelTabId): string {
  if (tab === "file") return "关闭文件标签页";
  if (tab === "preview") return "关闭预览标签页";
  if (tab === "review") return "关闭审查标签页";
  if (tab === "files") return "关闭文件列表标签页";
  return "关闭标签页";
}
