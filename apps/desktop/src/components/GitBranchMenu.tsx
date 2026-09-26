import { Check, GitBranch, LoaderCircle, Plus, RefreshCw, Search } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

import type { GitBranchesState } from "../stores/useGitBranches";
import "./git-branch-menu.css";

export function GitBranchMenu({ state, onClose }: {
  readonly state: GitBranchesState;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const filtered = state.branches.filter((branch) => branch.name.toLowerCase().includes(query.trim().toLowerCase()));
  const duplicate = state.branches.some((branch) => !branch.remote && branch.name === name.trim());
  const disabled = state.busy || state.loading;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (disabled || !name.trim() || duplicate) return;
    if (await state.create(name)) onClose();
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (creating || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End")) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)'));
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div onKeyDown={navigate}>
      <div className="git-branch-menu-header">
        <p className="composer-menu-title">{creating ? "新建分支" : "切换分支"}</p>
        <button type="button" aria-label="刷新分支" disabled={disabled} onClick={() => void state.refresh()}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      {state.error && <p className="composer-menu-state composer-menu-state-error" role="alert">{state.error}</p>}
      {state.busy && <p className="composer-menu-state" role="status"><LoaderCircle size={14} aria-hidden="true" /> 正在更新分支…</p>}
      {creating ? (
        <form className="git-branch-create" onSubmit={(event) => void create(event)}>
          <label htmlFor="composer-new-branch">分支名称</label>
          <input id="composer-new-branch" autoFocus maxLength={255} placeholder="feature/my-branch"
            value={name} disabled={state.busy} onChange={(event) => setName(event.currentTarget.value)} />
          <p className="git-branch-hint">从当前分支 {state.branchName} 创建，并立即切换；保留未提交改动。</p>
          {duplicate && <p className="composer-menu-state composer-menu-state-error" role="alert">已存在同名本地分支，请使用其他名称。</p>}
          <div className="git-branch-create-actions">
            <button type="button" disabled={state.busy} onClick={() => setCreating(false)}>返回</button>
            <button type="submit" disabled={disabled || !name.trim() || duplicate}><Plus size={14} aria-hidden="true" /> 创建并切换</button>
          </div>
        </form>
      ) : (
        <>
          <label className="git-branch-search">
            <Search size={14} aria-hidden="true" />
            <input autoFocus aria-label="搜索分支" placeholder="搜索分支…" value={query}
              onChange={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <button type="button" role="menuitem" disabled={disabled} onClick={() => { setName(query.trim()); setCreating(true); }}>
            <Plus size={15} aria-hidden="true" /><span>新建分支…</span>
          </button>
          <div className="composer-menu-divider" role="separator" />
          {state.loading && <p className="composer-menu-state" role="status">正在读取分支…</p>}
          {!state.loading && filtered.length === 0 && (
            <p className="composer-menu-state">{query.trim() ? "没有匹配的分支" : "暂无已提交分支，可从当前工作区创建分支"}</p>
          )}
          {[false, true].map((remote) => {
            const group = filtered.filter((branch) => branch.remote === remote);
            return group.length > 0 && (
              <div className="composer-menu-group" key={String(remote)} role="group" aria-label={remote ? "远程分支" : "本地分支"}>
                <p>{remote ? "远程分支 · 创建本地跟踪分支" : "本地分支"}</p>
                {group.map((branch) => (
                  <button type="button" role="menuitemradio" aria-checked={branch.current} key={branch.name}
                    title={branch.name} disabled={disabled || branch.current}
                    onClick={() => { void state.switchTo(branch).then((succeeded) => { if (succeeded) onClose(); }); }}>
                    <GitBranch size={15} aria-hidden="true" /><span>{branch.name}</span>
                    {branch.current && <Check size={14} aria-label="当前分支" />}
                  </button>
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
