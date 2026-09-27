import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { listenToAgentEvents } from "../ipc/agent";
import { getSessionReview, listSessionReviews, rollbackSessionReview, type SessionReviewDetail, type SessionReviewSummary } from "../ipc/sessionReview";
import { parseUnifiedDiff } from "./gitReviewModel";
import "./session-review.css";

interface Props { sessionId: string; cwd: string; active: boolean; onOpenFile: (path: string) => void; onChanged: () => void }
const STATUS: Record<SessionReviewSummary["status"], string> = { ready: "可回滚", unchanged: "内容未改变", binary: "二进制文件", "too-large": "超过快照上限", "unsafe-path": "不支持的文件路径", sensitive: "敏感文件不保存快照", unavailable: "无可用快照", failed: "工具执行失败", conflict: "存在后续修改", "rolled-back": "已回滚" };
const errorText = (error: unknown) => error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "读取会话审查失败，请重试";

export function SessionReviewPanel(props: Props) {
  return <SessionReviewWorkspace key={`${props.cwd}:${props.sessionId}`} {...props} />;
}
function SessionReviewWorkspace({ sessionId, cwd, active, onOpenFile, onChanged }: Props) {
  const [entries, setEntries] = useState<SessionReviewSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const dirty = useRef(true);
  const activeRef = useRef(active); activeRef.current = active;
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const load = useCallback(async (next?: string) => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const page = await listSessionReviews(sessionId, cwd, next);
      if (!alive.current || generation.current !== current) return;
      setEntries((previous) => next ? [...previous, ...page.entries.filter((entry) => !previous.some((item) => item.id === entry.id))] : page.entries);
      setCursor(page.nextCursor); setTruncated(page.truncated); dirty.current = false;
    } catch (failure) { if (alive.current && generation.current === current) setError(errorText(failure)); }
    finally { if (alive.current && generation.current === current) setLoading(false); }
  }, [cwd, sessionId]);
  useEffect(() => { if (active && dirty.current) void load(); }, [active, load]);
  useEffect(() => {
    let disposed = false; let unlisten: (() => void) | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    void listenToAgentEvents((event) => {
      if (event.sessionId !== sessionId || event.name !== "session.reviewChanged") return;
      dirty.current = true;
      if (activeRef.current) {
        clearTimeout(timer);
        timer = setTimeout(() => { if (activeRef.current) void load(); }, 120);
      }
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(() => { /* Manual refresh remains available. */ });
    return () => { disposed = true; clearTimeout(timer); unlisten?.(); };
  }, [sessionId, load]);
  const refresh = () => { void load(); };
  return <section className="session-review" aria-label="会话文件修改">
    <div className="session-review-toolbar"><strong>会话修改 · {entries.length}{cursor ? "+" : ""}</strong><button type="button" className="icon-button" aria-label="刷新会话修改" disabled={loading} onClick={refresh}><RefreshCw size={15} /></button></div>
    <p className="session-review-note">记录本会话 Write/Edit 的逐次修改；只在当前内容仍匹配时回滚。旧记录、二进制及超过 32 KiB 的文件不提供回滚。</p>
    {error && <div role="alert">{error}<button type="button" onClick={refresh}>重试</button></div>}
    {!loading && !error && !entries.length && <p className="right-panel-content-state">暂无可用的会话修改记录</p>}
    {entries.map((entry) => <SessionChangeCard key={entry.id} entry={entry} cwd={cwd} sessionId={sessionId} active={active} onOpenFile={onOpenFile} onRollback={(updated) => { setEntries((previous) => previous.map((item) => item.id === updated.id ? updated : item)); onChanged(); }} />)}
    {loading && <p role="status">正在读取修改记录…</p>}
    {cursor && <button type="button" className="secondary-button" disabled={loading} onClick={() => void load(cursor)}>加载更多修改</button>}
    {truncated && <p role="status">仅保留当前分支最近 256 条记录。</p>}
  </section>;
}
function SessionChangeCard({ entry, sessionId, cwd, active, onOpenFile, onRollback }: { entry: SessionReviewSummary; sessionId: string; cwd: string; active: boolean; onOpenFile: (path: string) => void; onRollback: (entry: SessionReviewSummary) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; value: SessionReviewDetail } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const detailKey = JSON.stringify([entry, retry]);
  const detail = loaded?.key === detailKey ? loaded.value : null;
  const cachedKey = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!expanded || !active || cachedKey.current === detailKey) return;
    let cancelled = false; setError(null); setPage(0);
    void getSessionReview(sessionId, cwd, entry.id).then((value) => { if (!cancelled) { cachedKey.current = detailKey; setLoaded({ key: detailKey, value }); } }).catch((failure) => { if (!cancelled) setError(errorText(failure)); });
    return () => { cancelled = true; };
  }, [expanded, active, sessionId, cwd, entry.id, detailKey]);
  const lines = useMemo(() => detail?.diff ? parseUnifiedDiff(detail.diff) : [], [detail]);
  const totalPages = Math.max(1, Math.ceil(lines.length / 200));
  async function rollback() {
    setBusy(true); setError(null);
    try { const updated = await rollbackSessionReview(sessionId, cwd, entry.id); if (alive.current) { onRollback(updated); setConfirm(false); } }
    catch (failure) { if (alive.current) { setError(errorText(failure)); setConfirm(false); } }
    finally { if (alive.current) setBusy(false); }
  }
  return <article className="session-change-card">
    <button type="button" className="session-change-heading" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="session-change-kind">{{ added: "A", modified: "M", deleted: "D", unknown: "?" }[entry.kind]}</span><span title={entry.path}>{entry.path || "不支持的路径"}</span><span className="session-change-stats">+{entry.additions} −{entry.deletions}</span></button>
    <div className="session-change-status"><span>{STATUS[entry.status]}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString()}</time></div>
    {expanded && <div className="session-change-body">
      {error && <div role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>重试读取</button></div>}
      {!detail && !error && <p role="status">正在读取差异…</p>}
      {detail && <><div className="session-change-actions">{entry.path && entry.status !== "unsafe-path" && <button type="button" onClick={() => onOpenFile(`${cwd}/${entry.path}`)}>打开文件</button>}<button type="button" disabled={entry.status !== "ready" || busy} onClick={() => setConfirm(true)}><RotateCcw size={13} />回滚此修改</button></div>
        {confirm && <div className="session-change-confirm" role="alertdialog" aria-label="确认回滚文件修改"><p>将 {entry.path} 恢复到本次修改前的内容{entry.kind === "added" ? "（删除本次新建文件）" : ""}。若已有后续修改，将拒绝覆盖。</p><button type="button" disabled={busy} onClick={() => void rollback()}>{busy ? "正在回滚…" : "确认回滚"}</button><button type="button" disabled={busy} onClick={() => setConfirm(false)}>取消</button></div>}
        {lines.length > 0 ? <div className="session-change-diff" role="table" aria-label={`${entry.path} 的差异`}>{lines.slice(page * 200, (page + 1) * 200).map((line, index) => <div role="row" key={page * 200 + index} className={`session-diff-line is-${line.kind}`}><span role="cell">{line.oldLine}</span><span role="cell">{line.newLine}</span><code role="cell">{line.kind === "add" ? "+" : line.kind === "delete" ? "−" : " "}{line.content}</code></div>)}</div> : <p>{STATUS[entry.status]}，无文本差异。</p>}
        {totalPages > 1 && <nav className="session-change-pages" aria-label="差异分页"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {totalPages}</span><button type="button" disabled={page + 1 === totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>}
        {detail.diffTruncated && <p role="status">差异预览已简化或截断，增删统计可能为近似值；回滚仍使用完整快照。</p>}</>}
    </div>}
  </article>;
}
