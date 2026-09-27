import { ChevronDown, ChevronRight, FileCode2, FileImage, FileText, Folder, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { listWorkspaceEntries, type WorkspaceDirectoryPage } from "../ipc/workspace";
import { formatRightPanelError } from "../stores/rightPanelFiles";
import { relativeFilePath } from "./FileViewer";
import "./workspace-files.css";

interface DirectoryState extends WorkspaceDirectoryPage { loading: boolean; error: string | null }
interface WorkspaceFilesPanelProps {
  readonly cwd: string;
  readonly active: boolean;
  readonly selectedPath?: string | null;
  readonly onOpenFile: (file: { path: string }) => void;
  readonly onSearch: () => void;
}

export function WorkspaceFilesPanel(props: WorkspaceFilesPanelProps): ReactElement {
  // A workspace-keyed child resets only on an actual workspace change, including
  // StrictMode effect replay. Hidden tabs retain their cached directory pages.
  return <WorkspaceTree key={props.cwd} {...props} />;
}

function WorkspaceTree({ cwd, active, selectedPath, onOpenFile, onSearch }: WorkspaceFilesPanelProps): ReactElement {
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const cache = useRef<Record<string, DirectoryState>>({});
  const inflight = useRef(new Set<string>());
  const generation = useRef(0);
  const alive = useRef(true);
  const tree = useRef<HTMLDivElement>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLocaleLowerCase();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async (directory: string, more = false, retry = false) => {
    const previous = cache.current[directory];
    if (!cwd || inflight.current.has(directory) || (previous && !more && !retry)) return;
    const cursor = more ? previous?.nextCursor ?? null : null;
    if (more && cursor === null) return;
    const version = generation.current;
    inflight.current.add(directory);
    const update = (state: DirectoryState) => {
      if (!alive.current || version !== generation.current) return;
      cache.current = { ...cache.current, [directory]: state };
      setDirectories(cache.current);
    };
    update({ entries: previous?.entries ?? [], nextCursor: cursor, loading: true, error: null });
    try {
      const page = await listWorkspaceEntries(cwd, directory, cursor);
      const entries = more ? [...(previous?.entries ?? []), ...page.entries] : page.entries;
      update({ ...page, entries: [...new Map(entries.map((entry) => [entry.relativePath, entry])).values()], loading: false, error: null });
    } catch (cause) {
      update({ entries: previous?.entries ?? [], nextCursor: cursor, loading: false, error: formatRightPanelError(cause, "WORKSPACE_LIST_FAILED", "无法读取目录") });
    } finally {
      if (version === generation.current) inflight.current.delete(directory);
    }
  }, [cwd]);
  useEffect(() => { if (active) void load(""); }, [active, load]);
  useEffect(() => {
    if (!active || !selectedPath) return;
    const relative = relativeFilePath(selectedPath, cwd);
    if (/^(?:[A-Za-z]:|\/|\\)/.test(relative)) return;
    const parts = relative.split("/").slice(0, -1);
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    setExpanded((current) => new Set([...current, ...ancestors]));
    for (const directory of ancestors) void load(directory);
  }, [active, cwd, load, selectedPath]);
  const matchingPaths = new Set<string>();
  if (query) {
    for (const state of Object.values(directories)) {
      for (const entry of state.entries) {
        if (!entry.relativePath.toLocaleLowerCase().includes(query)) continue;
        const parts = entry.relativePath.split("/");
        for (let index = 1; index <= parts.length; index += 1) matchingPaths.add(parts.slice(0, index).join("/"));
      }
    }
  }
  const directoryEntries = (directory: string) => (directories[directory]?.entries ?? []).filter((entry) => !query || matchingPaths.has(entry.relativePath));
  const directoryOpen = (path: string) => expanded.has(path) || Boolean(query && directories[path]);
  const visiblePaths: string[] = [];
  function collectVisible(directory: string) {
    for (const entry of directoryEntries(directory)) {
      visiblePaths.push(entry.relativePath);
      if (entry.kind === "folder" && directoryOpen(entry.relativePath)) collectVisible(entry.relativePath);
    }
  }
  collectVisible("");
  const tabStopPath = visiblePaths.includes(focusedPath ?? "") ? focusedPath
    : [...visiblePaths].reverse().find((path) => focusedPath?.startsWith(`${path}/`)) ?? visiblePaths[0];
  function refresh() {
    generation.current += 1;
    inflight.current.clear();
    cache.current = {};
    setDirectories({});
    void load("");
    for (const directory of expanded) void load(directory);
  }
  function renderDirectory(directory: string, depth: number): ReactNode {
    const state = directories[directory];
    return <div role={depth ? "group" : undefined}>
      {directoryEntries(directory).map((entry) => {
        const folder = entry.kind === "folder";
        const open = directoryOpen(entry.relativePath);
        return <div key={entry.relativePath}>
          <button type="button" className="workspace-file-row" role="treeitem" tabIndex={tabStopPath === entry.relativePath ? 0 : -1} onFocus={() => setFocusedPath(entry.relativePath)} aria-level={depth + 1} aria-expanded={folder ? open : undefined} aria-selected={!folder && relativeFilePath(selectedPath ?? "", cwd) === entry.relativePath} style={{ paddingLeft: 12 + depth * 16 }} title={entry.relativePath} onClick={() => {
            if (!folder) { onOpenFile({ path: `${cwd.replace(/[\\/]+$/, "")}/${entry.relativePath}` }); return; }
            setExpanded((current) => { const next = new Set(current); if (open) next.delete(entry.relativePath); else next.add(entry.relativePath); return next; });
            if (!open) void load(entry.relativePath);
          }}>
            {folder ? open ? <ChevronDown /> : <ChevronRight /> : <span className="workspace-file-indent" />}
            {folder ? <Folder className="workspace-file-icon-folder" /> : /\.(?:png|jpe?g|gif|webp|svg)$/i.test(entry.name) ? <FileImage className="workspace-file-icon-image" /> : /\.(?:[cm]?[jt]sx?|json|css|html|rs|py|ya?ml)$/i.test(entry.name) ? <FileCode2 className="workspace-file-icon-code" /> : <FileText className={/\.(?:md|markdown)$/i.test(entry.name) ? "workspace-file-icon-markdown" : undefined} />}<span>{entry.name}</span>
          </button>
          {folder && open ? renderDirectory(entry.relativePath, depth + 1) : null}
        </div>;
      })}
      {!state || state.loading ? <p className="workspace-file-note" role="status">正在读取目录…</p> : null}
      {state?.error ? <div className="workspace-file-note" role="alert">{state.error}<button type="button" onClick={() => void load(directory, state.nextCursor !== null, true)}>重试</button></div> : null}
      {state && !state.loading && !state.error && state.entries.length === 0 && !query ? <p className="workspace-file-note">空文件夹</p> : null}
      {state?.nextCursor && !state.loading && !state.error ? <button className="workspace-file-more" type="button" onClick={() => void load(directory, true)}>加载更多文件</button> : null}
    </div>;
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLButtonElement;
    if (target.getAttribute("role") !== "treeitem") return;
    const items = [...(tree.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])];
    const index = items.indexOf(target);
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") next = items[Math.min(index + 1, items.length - 1)];
    else if (event.key === "ArrowUp") next = items[Math.max(0, index - 1)];
    else if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items.at(-1);
    else if (event.key === "ArrowRight") {
      if (target.getAttribute("aria-expanded") === "false") target.click();
      else if (target.getAttribute("aria-expanded") === "true" && Number(items[index + 1]?.getAttribute("aria-level")) > Number(target.getAttribute("aria-level"))) next = items[index + 1];
    } else if (event.key === "ArrowLeft") {
      if (target.getAttribute("aria-expanded") === "true") target.click();
      else next = items.slice(0, index).reverse().find((item) => Number(item.getAttribute("aria-level")) < Number(target.getAttribute("aria-level")));
    } else return;
    event.preventDefault();
    next?.focus();
  }
  return <section className="workspace-files" aria-label="工作区文件列表">
    <header><span title={cwd}>{cwd.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "文件"}</span><button type="button" aria-label="搜索工作区文件" title="搜索文件" onClick={onSearch}><Search /></button><button type="button" aria-label="刷新文件列表" title="刷新文件列表" onClick={refresh}><RefreshCw /></button></header>
    <div className="workspace-file-filter"><Search aria-hidden="true" /><input aria-label="筛选文件" placeholder="筛选文件…" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />{filter ? <button type="button" aria-label="清除文件筛选" onClick={() => setFilter("")}><X /></button> : null}</div>
    {query ? <p className="workspace-file-filter-hint">仅筛选已加载的文件与目录</p> : null}
    <div ref={tree} className="workspace-file-tree" role="tree" aria-label="文件树" onKeyDown={navigate}>{cwd ? <>{renderDirectory("", 0)}{query && visiblePaths.length === 0 && !directories[""]?.loading ? <p className="workspace-file-note" role="status">没有匹配的已加载文件</p> : null}</> : <p className="workspace-file-note">请选择工作区</p>}</div>
  </section>;
}
