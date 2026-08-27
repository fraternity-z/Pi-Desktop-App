import {
  AlertTriangle,
  Copy,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import { HighlightedCodeLine } from "./CodeHighlight";
import "./right-panel-content.css";

export interface FileViewerComment {
  readonly id: string;
  readonly line: number;
  readonly text: string;
}

export interface CreateFileViewerComment {
  readonly line: number;
  readonly lineText: string;
  readonly text: string;
}

type AsyncAction = () => void | Promise<void>;

export interface FileViewerProps {
  readonly path: string;
  readonly rootPath?: string | null;
  readonly content: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly comments?: ReadonlyArray<FileViewerComment>;
  readonly onRetry?: () => void;
  readonly onCopy?: (content: string) => void | Promise<void>;
  readonly onOpenExternal?: AsyncAction;
  readonly onReveal?: AsyncAction;
  readonly onMore?: AsyncAction;
  readonly onCreateComment?: (input: CreateFileViewerComment) => void | Promise<void>;
  readonly onDeleteComment?: (commentId: string) => void | Promise<void>;
}

export function relativeFilePath(path: string, rootPath?: string | null): string {
  const normalizedPath = path.replace(/\\/g, "/");
  if (!rootPath) return normalizedPath;
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

export function splitFileContent(content: string): ReadonlyArray<string> {
  return content ? content.replace(/\r\n?/g, "\n").split("\n") : [""];
}

export function FileViewer(props: FileViewerProps): ReactElement {
  const [draftLine, setDraftLine] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const relativePath = useMemo(
    () => relativeFilePath(props.path, props.rootPath),
    [props.path, props.rootPath],
  );
  const lines = useMemo(() => splitFileContent(props.content), [props.content]);
  const commentsByLine = useMemo(() => {
    const map = new Map<number, FileViewerComment[]>();
    for (const comment of props.comments ?? []) {
      map.set(comment.line, [...(map.get(comment.line) ?? []), comment]);
    }
    return map;
  }, [props.comments]);

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

  async function saveComment(): Promise<void> {
    if (draftLine === null || !draftText.trim() || !props.onCreateComment) return;
    const line = lines[draftLine - 1] ?? "";
    await execute(async () => {
      await props.onCreateComment?.({
        line: draftLine,
        lineText: line,
        text: draftText.trim(),
      });
      setDraftLine(null);
      setDraftText("");
    });
  }

  return (
    <section className="right-panel-file-viewer" aria-label={`文件 ${relativePath}`}>
      <header>
        <nav aria-label="文件路径">
          {relativePath.split("/").filter(Boolean).map((part, index) => (
            <span key={`${index}:${part}`}>
              {index ? <b aria-hidden="true">›</b> : null}
              {part}
            </span>
          ))}
        </nav>
        <div className="right-panel-file-actions" aria-label="文件操作">
          <Action icon={<MoreHorizontal />} label="更多文件操作" disabled={pending} onClick={props.onMore} execute={execute} />
          <Action
            icon={<Copy />}
            label="复制文件内容"
            disabled={pending}
            onClick={props.onCopy ? () => props.onCopy?.(props.content) : undefined}
            execute={execute}
          />
          <Action icon={<ExternalLink />} label="在外部打开文件" disabled={pending} onClick={props.onOpenExternal} execute={execute} />
          <Action icon={<FolderOpen />} label="显示文件所在文件夹" disabled={pending} onClick={props.onReveal} execute={execute} />
        </div>
      </header>
      {actionError ? (
        <p className="right-panel-action-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {actionError}
        </p>
      ) : null}
      {props.loading ? (
        <State icon={<LoaderCircle className="spin" />} message="正在读取文件" />
      ) : props.error ? (
        <State icon={<AlertTriangle />} message={props.error} error retry={props.onRetry} />
      ) : (
        <pre className="right-panel-file-code">
          <code>
            {lines.map((line, index) => {
              const lineNumber = index + 1;
              const editorOpen = draftLine === lineNumber;
              return (
                <span className="right-panel-file-line-block" key={lineNumber}>
                  <span className="right-panel-file-line">
                    <i aria-hidden="true">{lineNumber}</i>
                    <span className="right-panel-file-comment-slot">
                      {props.onCreateComment ? (
                        <button
                          type="button"
                          aria-label={`评论第 ${lineNumber} 行`}
                          title="添加本地评论"
                          onClick={() => {
                            setDraftLine(lineNumber);
                            setDraftText("");
                            setActionError(null);
                          }}
                        >
                          <MessageSquarePlus aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                    <span><HighlightedCodeLine content={line || " "} path={props.path} /></span>
                  </span>
                  {editorOpen ? (
                    <span className="right-panel-comment-editor">
                      <span className="right-panel-comment-editor-title">
                        <strong>本地评论</strong>
                        <small>对第 R{lineNumber} 行发布评论</small>
                      </span>
                      <textarea
                        value={draftText}
                        rows={3}
                        placeholder="请求更改"
                        aria-label={`第 ${lineNumber} 行评论`}
                        onChange={(event) => setDraftText(event.currentTarget.value)}
                      />
                      <span className="right-panel-comment-editor-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setDraftLine(null);
                            setDraftText("");
                          }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={pending || !draftText.trim()}
                          onClick={() => void saveComment()}
                        >
                          注释
                        </button>
                      </span>
                    </span>
                  ) : null}
                  {commentsByLine.get(lineNumber)?.map((comment) => (
                    <span key={comment.id} className="right-panel-file-comment">
                      <span>{comment.text}</span>
                      {props.onDeleteComment ? (
                        <button
                          type="button"
                          aria-label="删除本地评论"
                          title="删除"
                          disabled={pending}
                          onClick={() => void execute(() => props.onDeleteComment?.(comment.id))}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                </span>
              );
            })}
          </code>
        </pre>
      )}
    </section>
  );
}

function Action(props: {
  readonly icon: ReactElement;
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick?: AsyncAction;
  readonly execute: (action: AsyncAction) => Promise<void>;
}): ReactElement | null {
  if (!props.onClick) return null;
  return (
    <button
      type="button"
      className="right-panel-content-icon"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={() => void props.execute(props.onClick!)}
    >
      {props.icon}
    </button>
  );
}

function State(props: {
  readonly icon: ReactElement;
  readonly message: string;
  readonly error?: boolean;
  readonly retry?: () => void;
}): ReactElement {
  return (
    <div className="right-panel-content-state" role={props.error ? "alert" : "status"}>
      {props.icon}
      <p>{props.message}</p>
      {props.retry ? <button type="button" className="secondary-button" onClick={props.retry}>重试</button> : null}
    </div>
  );
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
    : "FILE_ACTION_FAILED: 文件操作失败，请重试";
}
