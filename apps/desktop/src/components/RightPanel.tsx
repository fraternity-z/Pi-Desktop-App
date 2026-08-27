import {
  Eye,
  FileDiff,
  FileText,
  Globe2,
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
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { clampRightPanelWidth, resolveRightPanelMaxWidth } from "../stores/useRightPanelLayout";

export type RightPanelTabId = "review" | "file" | "preview" | "browser";

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
  readonly activeTab: RightPanelTabId;
  readonly fileTab?: RightPanelTabDescriptor | null;
  readonly previewTab?: RightPanelTabDescriptor | null;
  readonly browserTab?: RightPanelTabDescriptor | null;
  readonly children?: ReactNode;
  readonly onClose: () => void;
  readonly onWidthChange: (width: number) => void;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onActiveTabChange: (tab: RightPanelTabId) => void;
  readonly onOpenFile?: () => void;
  readonly onOpenBrowser?: () => void;
  readonly onCloseFileTab?: () => void;
  readonly onClosePreviewTab?: () => void;
  readonly onCloseBrowserTab?: () => void;
}

interface TabDefinition {
  readonly id: RightPanelTabId;
  readonly label: string;
  readonly icon: typeof FileText;
  readonly close?: () => void;
}

export function RightPanel(props: RightPanelProps): ReactElement | null {
  const [menuOpen, setMenuOpen] = useState(false);
  const generatedId = useId();
  const panelId = `right-panel-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tabPanelId = `${panelId}-content`;
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const maxWidth = resolveRightPanelMaxWidth(typeof window === "undefined" ? null : window.innerWidth);
  const tabs: TabDefinition[] = [
    { id: "review", label: "审查", icon: FileDiff },
    ...(props.fileTab ? [{ id: "file" as const, label: props.fileTab.label, icon: FileText, close: props.onCloseFileTab }] : []),
    ...(props.previewTab ? [{ id: "preview" as const, label: props.previewTab.label, icon: Eye, close: props.onClosePreviewTab }] : []),
    ...(props.browserTab ? [{ id: "browser" as const, label: props.browserTab.label, icon: Globe2, close: props.onCloseBrowserTab }] : []),
  ];

  const selectTab = useCallback((tab: RightPanelTabId) => props.onActiveTabChange(tab), [props]);
  const closeTab = useCallback((tab: TabDefinition) => {
    if (props.activeTab === tab.id) props.onActiveTabChange("review");
    tab.close?.();
  }, [props]);
  const openAction = useCallback((action?: () => void) => {
    setMenuOpen(false);
    action?.();
  }, []);

  function handleTabListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).getAttribute("role") !== "tab") return;
    const currentIndex = tabs.findIndex((tab) => tab.id === props.activeTab);
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
    window.setTimeout(() => document.getElementById(`${panelId}-tab-${nextTab}`)?.focus(), 0);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (!props.open || !props.available) return;
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() === "p" && props.onOpenFile) {
        event.preventDefault();
        props.onOpenFile();
      }
      if (event.key.toLowerCase() === "t" && props.onOpenBrowser) {
        event.preventDefault();
        props.onOpenBrowser();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [props.available, props.onOpenBrowser, props.onOpenFile, props.open]);

  if (!props.available) return null;
  const panelClassName = [
    "right-panel",
    props.opening ? "right-panel-opening" : "",
    props.closing ? "right-panel-closing" : "",
    props.expanded ? "right-panel-expanded" : "",
  ].filter(Boolean).join(" ");

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (props.expanded) return;
    event.preventDefault();
    resizeStart.current = { x: event.clientX, width: props.width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const start = resizeStart.current;
    if (!start) return;
    props.onWidthChange(clampRightPanelWidth(start.width + start.x - event.clientX, maxWidth));
  }
  function endResize(event: PointerEvent<HTMLDivElement>) {
    resizeStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }
  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Home") { event.preventDefault(); props.onWidthChange(320); return; }
    if (event.key === "End") { event.preventDefault(); props.onWidthChange(maxWidth); return; }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    props.onWidthChange(clampRightPanelWidth(props.width + (event.key === "ArrowLeft" ? 8 : -8), maxWidth));
  }

  return (
    <aside
      className={panelClassName}
      aria-label="工作区侧边栏"
      aria-hidden={!props.open}
      inert={!props.open}
      style={{ "--right-panel-width": `${props.width}px` } as CSSProperties}
    >
      {!props.expanded ? <div className="right-panel-resizer" role="separator" aria-label="调整右侧面板宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={maxWidth} aria-valuenow={props.width} tabIndex={0} onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onKeyDown={resizeWithKeyboard} /> : null}
      <header className="right-panel-header">
        <div className="right-panel-tabs" role="tablist" aria-label="右侧面板标签页" aria-orientation="horizontal" onKeyDown={handleTabListKeyDown}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = props.activeTab === tab.id;
            return <div key={tab.id} className={`right-panel-tab-shell${active ? " is-active" : ""}`}>
              <button type="button" id={`${panelId}-tab-${tab.id}`} className="right-panel-tab" role="tab" aria-selected={active} aria-controls={tabPanelId} tabIndex={active ? 0 : -1} title={tab.id === "review" ? "代码审查" : tab.label} onClick={() => selectTab(tab.id)}><Icon aria-hidden="true" /><span>{tab.label}</span></button>
              {tab.id !== "review" ? <button type="button" className="right-panel-icon-button right-panel-tab-close" aria-label={getCloseTabLabel(tab.id)} title={getCloseTabLabel(tab.id)} onClick={() => closeTab(tab)}><X aria-hidden="true" /></button> : null}
            </div>;
          })}
          <div className="right-panel-add-wrap" ref={menuRef}>
            <button type="button" className="right-panel-icon-button" aria-label="打开右侧面板标签页" title="打开标签页" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><Plus aria-hidden="true" /></button>
            {menuOpen ? <div className="right-panel-menu" role="menu">
              {props.onOpenFile ? <button type="button" role="menuitem" onClick={() => openAction(props.onOpenFile)}><FileText aria-hidden="true" /><span>打开文件</span><kbd>Ctrl+P</kbd></button> : null}
              {props.onOpenBrowser ? <button type="button" role="menuitem" onClick={() => openAction(props.onOpenBrowser)}><Globe2 aria-hidden="true" /><span>浏览器</span><kbd>Ctrl+T</kbd></button> : null}
            </div> : null}
          </div>
        </div>
        <div className="right-panel-actions">
          <button type="button" className="right-panel-icon-button" aria-label={props.expanded ? "收起工作区侧边栏" : "展开工作区侧边栏"} aria-pressed={props.expanded} title={props.expanded ? "收起工作区侧边栏" : "展开工作区侧边栏"} onClick={() => props.onExpandedChange(!props.expanded)}>{props.expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
          <button type="button" className="right-panel-icon-button" aria-label="关闭差异侧栏" title="关闭差异侧栏" onClick={props.onClose}><X aria-hidden="true" /></button>
        </div>
      </header>
      <div id={tabPanelId} className="right-panel-content" role="tabpanel" aria-labelledby={`${panelId}-tab-${props.activeTab}`}>{props.children}</div>
    </aside>
  );
}

function getCloseTabLabel(tab: RightPanelTabId): string {
  if (tab === "file") return "关闭文件标签页";
  if (tab === "preview") return "关闭预览标签页";
  return "关闭浏览器标签页";
}
