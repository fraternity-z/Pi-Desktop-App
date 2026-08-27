import { AlertTriangle, FileText, FolderOpen, LoaderCircle, Maximize2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { decodeBase64Bytes, getImageMimeType } from "../stores/rightPanelFiles";
import { MarkdownContent } from "./MarkdownContent";
import "./right-panel-content.css";

export type QuickPreviewKind = "image" | "markdown" | "text" | "document";

export interface QuickPreviewTarget {
  readonly kind: QuickPreviewKind;
  readonly name: string;
  readonly path?: string;
  readonly extension?: string;
  readonly src?: string;
  readonly content?: string;
}

type AsyncAction = () => void | Promise<void>;

export interface QuickPreviewProps {
  readonly target: QuickPreviewTarget;
  readonly dataBase64?: string;
  readonly content?: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onOpenExternal?: AsyncAction;
  readonly onReveal?: AsyncAction;
  readonly onRetry?: () => void;
}

const DOCX_CLASS_NAME = "pi-right-panel-docx";
const DOCX_DEFAULT_ZOOM = 0.75;
const DOCX_MIN_ZOOM = 0.1;
const DOCX_HORIZONTAL_PADDING = 48;

export function previewPathSegments(target: QuickPreviewTarget): ReadonlyArray<string> {
  return (target.path ?? target.name).replace(/\\/g, "/").split("/").filter(Boolean);
}

export function QuickPreview(props: QuickPreviewProps): ReactElement {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const extension = (props.target.extension ?? props.target.name.split(".").pop() ?? "").toLowerCase();
  const content = props.content ?? props.target.content ?? "";
  const src = props.target.src ?? (
    props.dataBase64
      ? `data:${props.target.kind === "image" ? getImageMimeType(extension) : documentMimeType(extension)};base64,${props.dataBase64}`
      : undefined
  );

  useEffect(() => {
    setActionError(null);
    setPending(false);
  }, [props.target.name, props.target.path]);

  async function execute(action: AsyncAction): Promise<void> {
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(actionMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (props.loading) {
    return <PreviewState icon={<LoaderCircle className="spin" />} message="正在加载预览" />;
  }
  if (props.error) {
    return <PreviewState icon={<AlertTriangle />} message={props.error} error retry={props.onRetry} />;
  }

  const actions = props.onOpenExternal || props.onReveal ? (
    <div className="right-panel-preview-actions">
      {props.onOpenExternal ? (
        <button
          type="button"
          className="right-panel-content-icon"
          disabled={pending}
          aria-label="在外部打开预览"
          title="在外部打开"
          onClick={() => void execute(props.onOpenExternal!)}
        >
          <Maximize2 aria-hidden="true" />
        </button>
      ) : null}
      {props.onReveal ? (
        <button
          type="button"
          className="right-panel-content-icon"
          disabled={pending}
          aria-label="显示预览所在文件夹"
          title="显示所在文件夹"
          onClick={() => void execute(props.onReveal!)}
        >
          <FolderOpen aria-hidden="true" />
        </button>
      ) : null}
    </div>
  ) : null;

  let body: ReactElement;
  if (props.target.kind === "image" && src) {
    body = <div className="right-panel-preview-image-stage"><img src={src} alt={props.target.name} /></div>;
  } else if (props.target.kind === "markdown" || extension === "md" || extension === "markdown") {
    body = <MarkdownContent className="right-panel-preview-markdown">{content}</MarkdownContent>;
  } else if (extension === "pdf" && src) {
    body = (
      <object className="right-panel-preview-pdf" data={src} type="application/pdf" aria-label={`预览 ${props.target.name}`}>
        <p>无法内嵌预览 PDF。</p>
      </object>
    );
  } else if (extension === "docx" && props.dataBase64) {
    body = <DocxPreview dataBase64={props.dataBase64} title={props.target.name} />;
  } else if (props.target.kind === "text" || ["txt", "csv"].includes(extension)) {
    body = <pre className="right-panel-preview-text">{content}</pre>;
  } else {
    body = (
      <DocumentFallback
        target={props.target}
        pending={pending}
        onOpenExternal={props.onOpenExternal ? () => void execute(props.onOpenExternal!) : undefined}
      />
    );
  }

  return (
    <section className="right-panel-quick-preview" aria-label={`${props.target.name}预览`}>
      <header>
        <nav aria-label="预览文件路径" title={props.target.path}>
          {previewPathSegments(props.target).map((part, index) => (
            <span key={`${index}:${part}`}>{index ? " › " : ""}{part}</span>
          ))}
        </nav>
        {actions}
      </header>
      {actionError ? (
        <p className="right-panel-action-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {actionError}
        </p>
      ) : null}
      {body}
    </section>
  );
}

function DocxPreview(props: { readonly dataBase64: string; readonly title: string }): ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; error: string | null }>({
    status: "loading",
    error: null,
  });

  useEffect(() => {
    const body = bodyRef.current;
    const styles = styleRef.current;
    if (!body || !styles) return undefined;
    let current = true;
    body.replaceChildren();
    styles.replaceChildren();
    setState({ status: "loading", error: null });
    const bytes = decodeBase64Bytes(props.dataBase64);
    void import("docx-preview")
      .then(({ renderAsync }) => renderAsync(bytes, body, styles, {
        className: DOCX_CLASS_NAME,
        renderAltChunks: false,
        useBase64URL: true,
      }))
      .then(() => {
        if (!current) return;
        appendDocxStyle(styles);
        updateDocxFit(body);
        setState({ status: "ready", error: null });
      })
      .catch((cause: unknown) => {
        body.replaceChildren();
        styles.replaceChildren();
        if (current) setState({ status: "error", error: actionMessage(cause) });
      });
    return () => {
      current = false;
      body.replaceChildren();
      styles.replaceChildren();
    };
  }, [props.dataBase64]);

  useEffect(() => {
    if (state.status !== "ready" || !bodyRef.current) return undefined;
    const body = bodyRef.current;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateDocxFit(body);
      });
    };
    const timeout = window.setTimeout(schedule, 100);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(body);
    window.addEventListener("resize", schedule);
    for (const image of body.querySelectorAll("img")) {
      image.addEventListener("load", schedule);
      image.addEventListener("error", schedule);
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      for (const image of body.querySelectorAll("img")) {
        image.removeEventListener("load", schedule);
        image.removeEventListener("error", schedule);
      }
    };
  }, [state.status]);

  return (
    <section className="right-panel-docx-shell" aria-busy={state.status === "loading"}>
      <div ref={styleRef} aria-hidden="true" />
      <div ref={bodyRef} className="right-panel-docx-body" aria-label={props.title} data-testid="docx-preview-panel" />
      {state.status === "loading" ? <div className="right-panel-docx-overlay">正在渲染 DOCX 文档…</div> : null}
      {state.status === "error" ? (
        <div className="right-panel-docx-overlay right-panel-docx-error" role="alert">
          打开文件失败：{state.error}
        </div>
      ) : null}
    </section>
  );
}

function appendDocxStyle(container: HTMLElement): void {
  const style = document.createElement("style");
  style.dataset.styleId = "right-panel-docx-style";
  style.textContent = `
    .${DOCX_CLASS_NAME}-wrapper {
      min-height: 100%; display: flex; flex-flow: column; align-items: center;
      gap: 0.875rem; padding: 1.5rem 1.5rem 4.6875rem; box-sizing: border-box;
      width: max-content; min-width: 100%; background: var(--canvas) !important;
    }
    .${DOCX_CLASS_NAME}-wrapper > section.${DOCX_CLASS_NAME} {
      margin: 0 !important; border: 1px solid var(--line); border-radius: 0;
      background: white !important; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
      transform-origin: top center; zoom: var(--right-panel-docx-zoom, 1);
    }
  `;
  container.appendChild(style);
}

function updateDocxFit(container: HTMLElement): void {
  container.style.setProperty("--right-panel-docx-zoom", "1");
  const wrapper = container.querySelector<HTMLElement>(`.${DOCX_CLASS_NAME}-wrapper`);
  const pages = Array.from(container.querySelectorAll<HTMLElement>(`section.${DOCX_CLASS_NAME}`));
  const widest = Math.max(
    wrapper?.scrollWidth ?? 0,
    ...pages.map((page) => Math.max(page.scrollWidth, page.offsetWidth, page.getBoundingClientRect().width)),
  );
  const visible = container.getBoundingClientRect().width || container.clientWidth;
  const available = Math.max(1, visible - DOCX_HORIZONTAL_PADDING);
  const zoom = widest > 0
    ? Math.min(DOCX_DEFAULT_ZOOM, Math.max(DOCX_MIN_ZOOM, available / widest))
    : DOCX_DEFAULT_ZOOM;
  container.style.setProperty("--right-panel-docx-zoom", zoom.toFixed(3));
}

function DocumentFallback(props: {
  readonly target: QuickPreviewTarget;
  readonly pending: boolean;
  readonly onOpenExternal?: () => void;
}): ReactElement {
  return (
    <div className="right-panel-document-preview">
      <FileText aria-hidden="true" />
      <strong>{props.target.extension?.toUpperCase() ?? "文件"}</strong>
      <h2>{props.target.name}</h2>
      <p>当前格式可能无法直接内嵌渲染，可以用系统默认应用打开查看。</p>
      {props.onOpenExternal ? (
        <button type="button" className="primary-button" disabled={props.pending} onClick={props.onOpenExternal}>
          打开文件
        </button>
      ) : null}
    </div>
  );
}

function PreviewState(props: {
  readonly icon: ReactElement;
  readonly message: string;
  readonly error?: boolean;
  readonly retry?: () => void;
}): ReactElement {
  return (
    <div className="right-panel-content-state right-panel-preview-state" role={props.error ? "alert" : "status"}>
      {props.icon}
      <p>{props.message}</p>
      {props.retry ? <button type="button" className="secondary-button" onClick={props.retry}>重试</button> : null}
    </div>
  );
}

function documentMimeType(extension: string): string {
  return extension === "pdf" ? "application/pdf" : "application/octet-stream";
}

function actionMessage(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    "message" in cause &&
    typeof cause.code === "string" &&
    typeof cause.message === "string"
  ) return `${cause.code}: ${cause.message}`;
  return cause instanceof Error && cause.message
    ? cause.message
    : "PREVIEW_ACTION_FAILED: 预览操作失败，请重试";
}
