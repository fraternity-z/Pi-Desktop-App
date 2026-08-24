import { AlertTriangle, FolderGit2, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type {
  CreatedWorktree,
  CreateWorktreeInput,
  WorktreeOptions,
} from "../ipc/workspace";

interface SidebarDialogFrameProps {
  title: string;
  description?: string;
  busy?: boolean;
  children: ReactNode;
  onClose: () => void;
}

function SidebarDialogFrame({
  title,
  description,
  busy = false,
  children,
  onClose,
}: SidebarDialogFrameProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current
      ?.querySelector<HTMLElement>("input, select, button:not(:disabled)")
      ?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previous?.focus();
    };
  }, [busy, onClose]);

  return createPortal(
    <div
      className="sidebar-dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="sidebar-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sidebar-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            title="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function RenameSidebarDialog({
  title,
  label,
  initialValue,
  existingNames = [],
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  initialValue: string;
  existingNames?: string[];
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const normalized = value.trim().toLocaleLowerCase();
  const duplicate = existingNames.some(
    (name) => name.trim().toLocaleLowerCase() === normalized && name !== initialValue,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || duplicate) return;
    onConfirm(value.trim());
  }

  return (
    <SidebarDialogFrame title={title} onClose={onClose}>
      <form className="sidebar-dialog-form" onSubmit={submit}>
        <label>
          <span>{label}</span>
          <input
            value={value}
            maxLength={120}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={duplicate || undefined}
          />
        </label>
        {duplicate && (
          <p className="sidebar-dialog-error" role="alert">
            <AlertTriangle size={14} />
            名称已存在，请使用其他名称
          </p>
        )}
        <div className="sidebar-dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={!value.trim() || duplicate}>
            确定
          </button>
        </div>
      </form>
    </SidebarDialogFrame>
  );
}

export function ConfirmSidebarDialog({
  title,
  description,
  confirmLabel,
  error,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  error?: string | null;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <SidebarDialogFrame title={title} description={description} busy={busy} onClose={onClose}>
      {error && (
        <p className="sidebar-dialog-error" role="alert">
          <AlertTriangle size={14} />
          {error}
        </p>
      )}
      <div className="sidebar-dialog-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className={danger ? "danger-button" : "primary-button"}
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy && <LoaderCircle className="spin" size={14} />}
          {confirmLabel}
        </button>
      </div>
    </SidebarDialogFrame>
  );
}

export function CreateWorktreeDialog({
  cwd,
  loadOptions,
  onCreate,
  onCreated,
  onClose,
}: {
  cwd: string;
  loadOptions: (cwd: string) => Promise<WorktreeOptions>;
  onCreate: (input: CreateWorktreeInput) => Promise<CreatedWorktree>;
  onCreated: (worktree: CreatedWorktree) => void | Promise<void>;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<WorktreeOptions | null>(null);
  const [base, setBase] = useState("HEAD");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadOptions(cwd)
      .then((next) => {
        if (!active) return;
        setOptions(next);
        setName(next.suggestedName);
      })
      .catch((cause) => {
        if (active) setError(formatWorktreeError(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cwd, loadOptions]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await onCreate({
        cwd,
        base,
        name: name.trim() || null,
      });
      await onCreated(created);
      onClose();
    } catch (cause) {
      setError(formatWorktreeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidebarDialogFrame
      title="创建 Git 工作树"
      description="从当前项目创建可长期使用的独立工作目录。"
      busy={busy}
      onClose={onClose}
    >
      <form className="sidebar-dialog-form sidebar-worktree-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>基于</span>
          <select
            value={base}
            disabled={loading || busy}
            onChange={(event) => setBase(event.target.value)}
          >
            <option value="HEAD">HEAD（当前检出）</option>
            {options?.branches.map((branch) => (
              <option key={`${branch.remote ? "remote" : "local"}:${branch.name}`} value={branch.name}>
                {branch.name}
                {branch.current ? "（当前）" : branch.remote ? "（远程）" : ""}
              </option>
            ))}
          </select>
          <small className="sidebar-dialog-hint">
            HEAD 为当前检出；main/master 为对应分支尖端。仅在已位于该分支时二者相同。
          </small>
        </label>
        <label>
          <span>项目名称</span>
          <input
            value={name}
            maxLength={80}
            disabled={loading || busy}
            placeholder={options?.suggestedName || "自动生成"}
            onChange={(event) => setName(event.target.value)}
          />
          <small className="sidebar-dialog-hint">
            用作目录名与新分支名；留空则自动生成。
          </small>
        </label>
        {loading && (
          <p className="sidebar-dialog-loading" role="status">
            <LoaderCircle className="spin" size={14} />
            正在读取 Git 分支
          </p>
        )}
        {error && (
          <p className="sidebar-dialog-error" role="alert">
            <AlertTriangle size={14} />
            {error}
          </p>
        )}
        <div className="sidebar-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={loading || busy}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <FolderGit2 size={14} />}
            {busy ? "正在创建…" : "创建并打开"}
          </button>
        </div>
      </form>
    </SidebarDialogFrame>
  );
}

function formatWorktreeError(cause: unknown): string {
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    "message" in cause &&
    typeof cause.code === "string" &&
    typeof cause.message === "string"
  ) {
    return `${cause.code}: ${cause.message}`;
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return "WORKTREE_CREATE_FAILED: 无法创建 Git 工作树，请重试";
}
