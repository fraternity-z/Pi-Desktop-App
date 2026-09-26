import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { HighlightedCodeLine } from "./CodeHighlight";
import { collapseUnchangedLines } from "./gitReviewModel";
import type { ToolDiffPreview as Preview } from "./toolActivityModel";

export function ToolDiffPreview({ preview }: { preview: Preview }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  async function copyDiff() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(preview.text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    resetTimer.current = setTimeout(() => setCopyState("idle"), 1_500);
  }

  return (
    <section className="timeline-tool-panel timeline-tool-diff" aria-label={preview.path + " 差异预览"}>
      <header className="timeline-tool-panel-header">
        <span className="timeline-tool-diff-path" title={preview.path}>{preview.path.split(/[\\/]/).pop()}</span>
        {preview.stats && <span className="timeline-tool-diff-stats" aria-label={`新增 ${preview.stats.additions} 行，删除 ${preview.stats.deletions} 行`}>
          <span>+{preview.stats.additions}</span><span>-{preview.stats.deletions}</span>
        </span>}
        <span className="timeline-tool-panel-actions">
          {preview.truncated && <small>预览已截断</small>}
          {copyState === "failed" && <small role="status">复制失败，请重试</small>}
          <button type="button" className="icon-button timeline-tool-payload-copy" aria-label={copyState === "copied" ? "差异已复制" : "复制差异"} onClick={() => void copyDiff()}>
            {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </span>
      </header>
      <div className="timeline-tool-diff-body" tabIndex={0} role="region" aria-label="差异代码">
        {collapseUnchangedLines(preview.lines).map((line, index) => (
          <div className="timeline-tool-diff-line" data-kind={line.kind} key={index}>
            <span className="timeline-tool-diff-number" aria-hidden="true">{line.newLine ?? line.oldLine ?? "…"}</span>
            <span className="timeline-tool-diff-sign" aria-hidden="true">{line.kind === "add" ? "+" : line.kind === "delete" ? "−" : " "}</span>
            <code><HighlightedCodeLine content={line.content || " "} path={preview.path} /></code>
          </div>
        ))}
        {preview.lines.length === 0 && <p className="timeline-tool-diff-note">没有可预览的文本变更。</p>}
      </div>
      <p className="timeline-tool-diff-note">{preview.note}</p>
    </section>
  );
}
