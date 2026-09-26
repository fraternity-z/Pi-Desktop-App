import { Check, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { HighlightedCodeLine } from "./CodeHighlight";
import { prepareMarkdownMath, remarkLatexBracketDisplay, remarkRestoreMathPipes } from "./markdown-math";

interface MarkdownContentProps {
  children: string;
  className?: string;
}

// Sanitize user content first, preserving only the math markers required by
// KaTeX. Sanitizing its generated HTML afterwards would remove formula layout.
const REHYPE_PLUGINS: Options["rehypePlugins"] = [
  [rehypeSanitize, {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      code: [["className", /^language-./, "math-inline", "math-display"]],
    },
  }],
  rehypeMath,
];

function rehypeMath() {
  // KaTeX mutates macros for \gdef. Never share that state across messages or
  // streaming parses, even when their compatibility aliases are identical.
  return rehypeKatex({
    trust: false,
    strict: "ignore",
    maxSize: 20,
    maxExpand: 1_000,
    macros: { "\\sinc": "\\operatorname{sinc}" },
  });
}
const MARKDOWN_COMPONENTS = {
  a: MarkdownLink,
  img: MarkdownImage,
  pre: MarkdownPre,
  input: MarkdownInput,
  table: MarkdownTable,
};

export const MarkdownContent = memo(function MarkdownContent({
  children,
  className,
}: MarkdownContentProps) {
  const { source, pipeMarker } = useMemo(() => prepareMarkdownMath(children), [children]);
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkMath, remarkRestoreMathPipes(pipeMarker), remarkLatexBracketDisplay(children)],
    [children, pipeMarker],
  );
  return (
    <div className={["markdown-content", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={REHYPE_PLUGINS}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={MARKDOWN_COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

function safeMarkdownUrl(url: string, key: string): string {
  const transformed = defaultUrlTransform(url);
  if (key === "src" && transformed && !/^(https?:|data:image\/)/i.test(transformed)) {
    return "";
  }
  return transformed;
}

function MarkdownLink({ href, children, ...props }: ComponentProps<"a">) {
  const external = Boolean(href && /^(https?:|mailto:)/i.test(href));
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!href) event.preventDefault();
  }
  return (
    <a
      {...props}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={handleClick}
    >
      {children}
      {external && <ExternalLink className="markdown-external-icon" size={12} aria-hidden />}
    </a>
  );
}

function MarkdownImage({ alt }: ComponentProps<"img">) {
  return alt ? <span className="markdown-image-placeholder">[图片：{alt}]</span> : null;
}

function MarkdownInput({ type, ...props }: ComponentProps<"input">) {
  return <input {...props} type={type} disabled />;
}

function MarkdownTable({ children, ...props }: ComponentProps<"table">) {
  return (
    <div className="markdown-table-scroll" role="region" aria-label="表格（可横向滚动）" tabIndex={0}>
      <table {...props}>{children}</table>
    </div>
  );
}

function MarkdownPre({ children, ...props }: ComponentProps<"pre">) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);
  const code = nodeText(children).replace(/\n$/, "");
  const language = codeLanguage(children);
  const copyLabel = copyState === "copied" ? "代码已复制" : copyState === "error" ? "复制失败，点击重试" : "复制代码";
  async function copyCode() {
    window.clearTimeout(resetTimer.current);
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
      resetTimer.current = window.setTimeout(() => setCopyState("idle"), 1_200);
    } catch {
      setCopyState("error");
    }
  }
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{language ?? "代码"}</span>
        <button
          type="button"
          className="icon-button markdown-code-copy"
          onClick={() => void copyCode()}
          aria-label={copyLabel}
          title={copyLabel}
        >
          {copyState === "copied" ? <Check size={14} /> : copyState === "error" ? <TriangleAlert size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre {...props}><code><HighlightedCodeLine content={code} path={language ?? undefined} /></code></pre>
    </div>
  );
}

function codeLanguage(node: ReactNode): string | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: string }>(child)) continue;
    const match = /(?:^|\s)language-([\w-]+)/.exec(child.props.className ?? "");
    if (match?.[1]) return match[1];
  }
  return null;
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return Children.toArray(node).map(nodeText).join("");
}
