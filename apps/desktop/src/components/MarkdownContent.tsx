import { ExternalLink } from "lucide-react";
import {
  memo,
  useMemo,
  type ComponentProps,
  type MouseEvent,
} from "react";
import ReactMarkdown, { defaultUrlTransform, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
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
  pre: MarkdownCodeBlock,
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
