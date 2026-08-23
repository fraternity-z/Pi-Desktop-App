import { Check, Copy, ExternalLink } from "lucide-react";
import {
  Children,
  isValidElement,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  children: string;
  className?: string;
}

export function MarkdownContent({ children, className }: MarkdownContentProps) {
  return (
    <div className={["markdown-content", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={{
          a: MarkdownLink,
          img: MarkdownImage,
          pre: MarkdownPre,
          input({ type, ...props }) {
            return <input {...props} type={type} disabled />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

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

function MarkdownPre({ children, ...props }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const code = nodeText(children).replace(/\n$/, "");
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="markdown-code-block">
      <button
        type="button"
        className="icon-button markdown-code-copy"
        onClick={() => void copyCode()}
        aria-label="复制代码"
        title="复制代码"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return Children.toArray(node).map(nodeText).join("");
}
