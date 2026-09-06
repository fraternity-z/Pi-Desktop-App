import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import type { ReactElement } from "react";

type HighlightLanguage =
  | "bash"
  | "css"
  | "javascript"
  | "json"
  | "markdown"
  | "python"
  | "rust"
  | "typescript"
  | "xml";

const HIGHLIGHT_CACHE = new Map<string, string>();
let registered = false;

function ensureLanguagesRegistered(): void {
  if (registered) return;
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("xml", xml);
  registered = true;
}

function escapeHtml(content: string): string {
  return content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveLanguage(path?: string): HighlightLanguage | null {
  const extension = path?.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "typescript"].includes(extension)) return "typescript";
  if (["js", "jsx", "mjs", "cjs", "javascript"].includes(extension)) return "javascript";
  if (extension === "json") return "json";
  if (["css", "scss", "less"].includes(extension)) return "css";
  if (["html", "htm", "xml", "svg"].includes(extension)) return "xml";
  if (["md", "mdx", "markdown"].includes(extension)) return "markdown";
  if (["sh", "bash", "zsh"].includes(extension)) return "bash";
  if (["rs", "rust"].includes(extension)) return "rust";
  if (["py", "python"].includes(extension)) return "python";
  return null;
}

export function highlightCodeLine(content: string, path?: string): string {
  if (!content.trim()) return content;
  ensureLanguagesRegistered();
  const language = resolveLanguage(path);
  const cacheKey = `${language ?? "plain"}:${content}`;
  const cached = HIGHLIGHT_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  let highlighted = escapeHtml(content);
  if (language !== null && content.length <= 64_000) {
    try {
      highlighted = hljs.highlight(content, { language, ignoreIllegals: true }).value;
    } catch {
      highlighted = escapeHtml(content);
    }
  }
  // Streaming code blocks produce distinct prefixes; bound their retained memory.
  if (content.length <= 16_000) {
    if (HIGHLIGHT_CACHE.size >= 256) HIGHLIGHT_CACHE.delete(HIGHLIGHT_CACHE.keys().next().value!);
    HIGHLIGHT_CACHE.set(cacheKey, highlighted);
  }
  return highlighted;
}

export function HighlightedCodeLine(props: {
  readonly content: string;
  readonly path?: string;
  readonly className?: string;
}): ReactElement {
  return (
    <span
      className={props.className}
      dangerouslySetInnerHTML={{ __html: highlightCodeLine(props.content, props.path) }}
    />
  );
}
