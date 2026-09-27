import { Check, CodeXml, Copy, TriangleAlert, WrapText } from "lucide-react";
import {
  Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type ComponentProps, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HighlightedCodeLine } from "./CodeHighlight";
import "./MarkdownCodeBlock.css";

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  py: "Python", python: "Python", ts: "TypeScript", tsx: "TypeScript", typescript: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", javascript: "JavaScript",
  json: "JSON", css: "CSS", scss: "SCSS", less: "Less", html: "HTML", htm: "HTML",
  xml: "XML", svg: "SVG", md: "Markdown", mdx: "MDX", markdown: "Markdown",
  sh: "Shell", bash: "Bash", zsh: "Zsh", rs: "Rust", rust: "Rust",
  c: "C", cpp: "C++", "c++": "C++", cs: "C#", "c#": "C#", csharp: "C#",
  java: "Java", go: "Go", ruby: "Ruby", rb: "Ruby", sql: "SQL", yaml: "YAML", yml: "YAML",
  text: "文本", plaintext: "文本", txt: "文本",
};

export function MarkdownCodeBlock({ children }: ComponentProps<"pre">) {
  // react-markdown appends one terminating newline; retain all code whitespace before it.
  const code = nodeText(children).replace(/\n$/, "");
  const language = codeLanguage(children);
  const languageKey = language?.toLowerCase() ?? "";
  const label = Object.hasOwn(LANGUAGE_LABELS, languageKey) ? LANGUAGE_LABELS[languageKey] : language ?? "代码";
  const [wrapped, setWrapped] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  const copyRequest = useRef(0);

  useEffect(() => {
    setCopyState("idle");
    return () => {
      copyRequest.current += 1;
      window.clearTimeout(resetTimer.current);
    };
  }, [code]);

  async function copyCode() {
    const request = ++copyRequest.current;
    window.clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(code);
      if (request !== copyRequest.current) return;
      setCopyState("copied");
      resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1_200);
    } catch {
      if (request === copyRequest.current) setCopyState("error");
    }
  }

  const copyLabel = copyState === "copied" ? "代码已复制" : copyState === "error" ? "复制失败，点击重试" : "复制代码";
  return (
    <div className="markdown-code-block markdown-code-card" data-wrap={wrapped}>
      <div className="markdown-code-toolbar">
        <span className="markdown-code-language"><CodeXml size={18} aria-hidden="true" /><span>{label}</span></span>
        <div className="markdown-code-actions">
          <CodeAction label={wrapped ? "禁用自动换行" : "启用自动换行"} pressed={wrapped} onClick={() => setWrapped(!wrapped)}>
            <WrapText size={18} aria-hidden="true" />
          </CodeAction>
          <CodeAction label={copyLabel} onClick={() => void copyCode()}>
            {copyState === "copied" ? <Check size={18} aria-hidden="true" /> : copyState === "error" ? <TriangleAlert size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
          </CodeAction>
        </div>
      </div>
      <pre tabIndex={0} role="region" aria-label={`${label}代码${wrapped ? "（自动换行）" : "（可横向滚动）"}`}>
        <code><HighlightedCodeLine content={code} path={language ?? undefined} /></code>
      </pre>
      <span className="markdown-code-status" role="status">{copyState === "idle" ? "" : copyLabel}</span>
    </div>
  );
}

function CodeAction({ label, pressed, onClick, children }: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !tooltipRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const above = anchor.top - tooltip.height - gap;
    setPosition({
      left: Math.max(margin, Math.min(anchor.left + (anchor.width - tooltip.width) / 2, window.innerWidth - tooltip.width - margin)),
      top: Math.max(margin, Math.min(above >= margin ? above : anchor.bottom + gap, window.innerHeight - tooltip.height - margin)),
    });
  }, [open, label]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="markdown-code-action"
        aria-label={label}
        aria-pressed={pressed}
        aria-describedby={open ? id : undefined}
        onClick={onClick}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (document.activeElement !== buttonRef.current) setOpen(false); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >{children}</button>
      {open && createPortal(
        <span ref={tooltipRef} id={id} role="tooltip" className="markdown-code-tooltip" style={position}>{label}</span>,
        document.body,
      )}
    </>
  );
}

function codeLanguage(node: ReactNode): string | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: string }>(child)) continue;
    const match = /(?:^|\s)language-(\S+)/.exec(child.props.className ?? "");
    if (match?.[1]) return match[1];
  }
  return null;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}
