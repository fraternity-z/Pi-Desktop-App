import { FileText, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";

import "./right-panel-content.css";

export interface FileSearchResult {
  readonly path: string;
  readonly name?: string;
  readonly root?: string;
}

export interface FileSearchDialogProps {
  readonly open: boolean;
  readonly search: (query: string) => Promise<ReadonlyArray<FileSearchResult>>;
  readonly onClose: () => void;
  readonly onOpenFile: (file: FileSearchResult) => void | Promise<void>;
  readonly debounceMs?: number;
  readonly maxResults?: number;
}

export function getFileSearchResultName(file: FileSearchResult): string {
  return file.name?.trim() || file.path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || file.path;
}

export function FileSearchDialog(props: FileSearchDialogProps): ReactElement | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<FileSearchResult>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const maxResults = props.maxResults ?? 24;

  useEffect(() => {
    if (props.open) {
      const focusId = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(focusId);
    }
    setQuery("");
    setResults([]);
    setLoading(false);
    setError(null);
    setSelectedIndex(0);
    return undefined;
  }, [props.open]);
  useEffect(() => {
    if (!props.open) return undefined;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let current = true;
    setLoading(true);
    setError(null);
    const searchId = window.setTimeout(() => {
      void props.search(normalizedQuery).then((next) => {
        if (!current) return;
        setResults(next.slice(0, maxResults));
        setSelectedIndex(0);
      }).catch((cause: unknown) => {
        if (!current) return;
        setResults([]);
        setSelectedIndex(0);
        setError(errorMessage(cause));
      }).finally(() => {
        if (current) setLoading(false);
      });
    }, props.debounceMs ?? 160);
    return () => { current = false; window.clearTimeout(searchId); };
  }, [maxResults, props.debounceMs, props.open, props.search, query]);

  if (!props.open || typeof document === "undefined") return null;
  const status = !query.trim() ? null : loading ? "搜索中…" : error ?? (results.length === 0 ? "没有匹配文件" : null);
  const openResult = (file: FileSearchResult) => void props.onOpenFile(file);
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0))); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((index) => Math.max(index - 1, 0)); return; }
    if (event.key === "Enter" && results[selectedIndex]) { event.preventDefault(); openResult(results[selectedIndex]); }
  }
  return createPortal(
    <div className="right-panel-file-search-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section className="right-panel-file-search-dialog" role="dialog" aria-modal="true" aria-label="搜索文件" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><Search aria-hidden="true" /><h2>搜索文件</h2></div><button type="button" className="right-panel-content-icon" aria-label="关闭搜索文件" title="关闭" onClick={props.onClose}><X aria-hidden="true" /></button></header>
        <label className="right-panel-file-search-field"><span className="sr-only">输入内容搜索文件</span><input ref={inputRef} type="search" value={query} placeholder="输入内容搜索文件" aria-label="输入内容搜索文件" onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={onKeyDown} /></label>
        {status ? <p className="right-panel-file-search-status" role={error ? "alert" : "status"}>{loading ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{status}</p> : null}
        {results.length ? <ul className="right-panel-file-search-results">{results.map((file, index) => <li key={`${file.root ?? ""}:${file.path}`}><button type="button" className={index === selectedIndex ? "is-active" : ""} onMouseEnter={() => setSelectedIndex(index)} onClick={() => openResult(file)}><FileText aria-hidden="true" /><span><strong>{getFileSearchResultName(file)}</strong><small>{file.path}</small></span></button></li>)}</ul> : null}
      </section>
    </div>, document.body,
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : "FILE_SEARCH_FAILED: 文件搜索失败，请重试";
}
