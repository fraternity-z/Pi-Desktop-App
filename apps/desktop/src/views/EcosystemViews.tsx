import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clipboard,
  Download,
  LoaderCircle,
  Menu,
  Package,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { ConfirmSidebarDialog } from "../components/SidebarDialog";
import type {
  AgentPackageSummary,
  AgentResourceSummary,
  PackageScope,
} from "../ipc/agent";
import type { useAgentEcosystem } from "../stores/useAgentEcosystem";

type EcosystemController = ReturnType<typeof useAgentEcosystem>;

interface EcosystemViewProps {
  cwd: string;
  sidebarOpen: boolean;
  ecosystem: EcosystemController;
  onOpenSidebar: () => void;
  onBack: () => void;
}

export function PackageManagerView({
  cwd,
  sidebarOpen,
  ecosystem,
  onOpenSidebar,
  onBack,
}: EcosystemViewProps) {
  const [tab, setTab] = useState<"installed" | "add">("installed");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [scope, setScope] = useState<PackageScope>("global");
  const [page, setPage] = useState(0);
  const [removeTarget, setRemoveTarget] = useState<AgentPackageSummary | null>(null);
  const busy = ecosystem.operation !== null;
  const updateSources = useMemo(
    () => new Set(ecosystem.updates.map((item) => item.source)),
    [ecosystem.updates],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return ecosystem.packages.filter(
      (item) =>
        !needle ||
        item.source.toLocaleLowerCase().includes(needle) ||
        item.kind.toLocaleLowerCase().includes(needle),
    );
  }, [ecosystem.packages, query]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const duplicate = ecosystem.packages.some(
    (item) => item.source === source.trim() && item.scope === scope,
  );

  useEffect(() => setPage(0), [query]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  async function install(event: FormEvent) {
    event.preventDefault();
    const nextSource = source.trim();
    if (!nextSource || duplicate || busy) return;
    if (await ecosystem.installPackage(cwd, nextSource, scope)) {
      setSource("");
      setTab("installed");
    }
  }

  return (
    <main className="ecosystem-view">
      <EcosystemTopbar
        title="插件"
        subtitle="管理 Pi 已配置的扩展包"
        sidebarOpen={sidebarOpen}
        onOpenSidebar={onOpenSidebar}
        onBack={onBack}
      >
        <button
          className="icon-button"
          type="button"
          title="检查更新"
          aria-label="检查插件更新"
          disabled={busy}
          onClick={() => void ecosystem.checkUpdates(cwd)}
        >
          <Download size={16} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="刷新"
          aria-label="刷新插件"
          disabled={busy}
          onClick={() => void ecosystem.refresh(cwd, "packages")}
        >
          <RefreshCw className={ecosystem.phase === "loading" ? "spin" : undefined} size={16} />
        </button>
      </EcosystemTopbar>

      <div className="ecosystem-content">
        <div className="ecosystem-toolbar">
          <div className="segmented-control" role="tablist" aria-label="插件视图">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "installed"}
              onClick={() => setTab("installed")}
            >
              已安装
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "add"}
              onClick={() => setTab("add")}
            >
              添加插件
            </button>
          </div>
          {tab === "installed" && (
            <label className="ecosystem-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索插件"
                aria-label="搜索插件"
              />
            </label>
          )}
        </div>

        <EcosystemError
          error={ecosystem.error}
          onRetry={() => void ecosystem.refresh(cwd, "packages")}
        />

        {tab === "add" ? (
          <form className="package-install-form" onSubmit={install}>
            <div className="package-install-copy">
              <h2>安装插件</h2>
              <p>支持 npm 包、Git 地址或本机绝对路径，安装由官方 Pi 包管理器完成。</p>
            </div>
            <label>
              <span>插件来源</span>
              <input
                value={source}
                maxLength={4096}
                placeholder="npm:package、Git URL 或绝对路径"
                onChange={(event) => setSource(event.target.value)}
                aria-invalid={duplicate || undefined}
                autoFocus
              />
            </label>
            <fieldset>
              <legend>安装范围</legend>
              <div className="segmented-control">
                <button
                  type="button"
                  aria-pressed={scope === "global"}
                  onClick={() => setScope("global")}
                >
                  全局
                </button>
                <button
                  type="button"
                  aria-pressed={scope === "project"}
                  onClick={() => setScope("project")}
                >
                  当前项目
                </button>
              </div>
            </fieldset>
            {duplicate && (
              <p className="form-hint-error" role="alert">
                该范围内已配置同名插件
              </p>
            )}
            <div className="package-install-actions">
              <button className="primary-button" type="submit" disabled={!source.trim() || duplicate || busy}>
                {ecosystem.operation?.startsWith("install:") ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Download size={15} />
                )}
                安装
              </button>
            </div>
          </form>
        ) : ecosystem.phase === "loading" && ecosystem.packages.length === 0 ? (
          <EcosystemLoading label="正在读取 Pi 插件" />
        ) : visible.length === 0 ? (
          <EcosystemEmpty
            icon={<Package size={22} />}
            title={query ? "没有匹配的插件" : "尚未配置插件"}
            action={query ? undefined : { label: "添加插件", onClick: () => setTab("add") }}
          />
        ) : (
          <>
            <div className="ecosystem-list" role="list">
              {visible.map((item) => {
                const itemBusy = ecosystem.operation?.endsWith(item.source) ?? false;
                return (
                  <div className="package-row" role="listitem" key={`${item.scope}:${item.source}`}>
                    <div className="package-row-icon" aria-hidden="true">
                      <Package size={17} />
                    </div>
                    <div className="package-row-main">
                      <strong title={item.source}>{packageDisplayName(item.source)}</strong>
                      <span title={item.installedPath ?? item.source}>
                        {item.scope === "project" ? "项目" : "全局"} · {item.kind}
                        {item.filtered ? " · 已过滤" : ""}
                      </span>
                    </div>
                    {updateSources.has(item.source) && <span className="update-badge">可更新</span>}
                    <label className="compact-switch" title={item.enabled ? "停用" : "启用"}>
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        disabled={busy}
                        onChange={(event) =>
                          void ecosystem.setPackageEnabled(cwd, item, event.target.checked)
                        }
                      />
                      <span aria-hidden="true" />
                    </label>
                    <div className="package-row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`更新${packageDisplayName(item.source)}`}
                        title="更新"
                        disabled={busy || item.kind === "local"}
                        onClick={() => void ecosystem.updatePackage(cwd, item.source)}
                      >
                        {itemBusy && ecosystem.operation?.startsWith("update:") ? (
                          <LoaderCircle className="spin" size={15} />
                        ) : (
                          <Upload size={15} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`移除${packageDisplayName(item.source)}`}
                        title="移除"
                        disabled={busy}
                        onClick={() => setRemoveTarget(item)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {pageCount > 1 && (
              <nav className="ecosystem-pagination" aria-label="插件分页">
                <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                  上一页
                </button>
                <span>{page + 1} / {pageCount}</span>
                <button
                  type="button"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </button>
              </nav>
            )}
          </>
        )}
      </div>

      {removeTarget && (
        <ConfirmSidebarDialog
          title="移除插件"
          description={`确定从${removeTarget.scope === "project" ? "当前项目" : "全局配置"}中移除“${packageDisplayName(removeTarget.source)}”吗？`}
          confirmLabel="移除"
          danger
          busy={ecosystem.operation === `remove:${removeTarget.source}`}
          onClose={() => setRemoveTarget(null)}
          onConfirm={() =>
            void ecosystem.removePackage(cwd, removeTarget).then((removed) => {
              if (removed) setRemoveTarget(null);
            })
          }
        />
      )}
    </main>
  );
}

export function ResourcesView({
  cwd,
  sidebarOpen,
  ecosystem,
  onOpenSidebar,
  onBack,
}: EcosystemViewProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AgentResourceSummary["kind"] | "all">("all");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return ecosystem.resources.filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        (!needle ||
          item.name.toLocaleLowerCase().includes(needle) ||
          item.path.toLocaleLowerCase().includes(needle) ||
          item.source?.toLocaleLowerCase().includes(needle)),
    );
  }, [ecosystem.resources, kind, query]);

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      window.setTimeout(() => setCopiedPath((current) => (current === path ? null : current)), 1600);
    } catch {
      setCopiedPath(null);
    }
  }

  return (
    <main className="ecosystem-view">
      <EcosystemTopbar
        title="资源"
        subtitle="扩展、技能、提示词与上下文"
        sidebarOpen={sidebarOpen}
        onOpenSidebar={onOpenSidebar}
        onBack={onBack}
      >
        <button
          className="icon-button"
          type="button"
          title="刷新"
          aria-label="刷新资源"
          disabled={ecosystem.phase === "loading"}
          onClick={() => void ecosystem.refresh(cwd, "resources")}
        >
          <RefreshCw className={ecosystem.phase === "loading" ? "spin" : undefined} size={16} />
        </button>
      </EcosystemTopbar>
      <div className="ecosystem-content">
        <div className="ecosystem-toolbar ecosystem-toolbar-wrap">
          <div className="resource-kind-tabs" role="tablist" aria-label="资源类型">
            {(["all", "skill", "extension", "prompt", "theme", "context", "system"] as const).map(
              (itemKind) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={kind === itemKind}
                  key={itemKind}
                  onClick={() => setKind(itemKind)}
                >
                  {resourceKindLabel(itemKind)}
                  <span>{resourceKindCount(ecosystem.resources, itemKind)}</span>
                </button>
              ),
            )}
          </div>
          <label className="ecosystem-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索资源"
              aria-label="搜索资源"
            />
          </label>
        </div>
        <EcosystemError
          error={ecosystem.error}
          onRetry={() => void ecosystem.refresh(cwd, "resources")}
        />
        {ecosystem.phase === "loading" && ecosystem.resources.length === 0 ? (
          <EcosystemLoading label="正在读取 Pi 资源" />
        ) : filtered.length === 0 ? (
          <EcosystemEmpty
            icon={<Search size={22} />}
            title={query || kind !== "all" ? "没有匹配的资源" : "当前项目没有可用资源"}
          />
        ) : (
          <div className="ecosystem-list" role="list">
            {filtered.map((item) => (
              <div className="resource-row" role="listitem" key={`${item.kind}:${item.path}`}>
                <span className="resource-kind-chip">{resourceKindLabel(item.kind)}</span>
                <div className="resource-row-main">
                  <strong>{item.name}</strong>
                  <span title={item.path}>{item.path}</span>
                </div>
                {item.source && <span className="resource-source" title={item.source}>{item.source}</span>}
                <button
                  className="icon-button"
                  type="button"
                  title="复制路径"
                  aria-label={`复制${item.name}路径`}
                  onClick={() => void copyPath(item.path)}
                >
                  {copiedPath === item.path ? <Check size={15} /> : <Clipboard size={15} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function EcosystemTopbar({
  title,
  subtitle,
  sidebarOpen,
  children,
  onOpenSidebar,
  onBack,
}: {
  title: string;
  subtitle: string;
  sidebarOpen: boolean;
  children: ReactNode;
  onOpenSidebar: () => void;
  onBack: () => void;
}) {
  return (
    <header className="ecosystem-topbar">
      <div className="ecosystem-topbar-leading">
        {!sidebarOpen && (
          <button className="icon-button" type="button" aria-label="打开侧边栏" onClick={onOpenSidebar}>
            <Menu size={18} />
          </button>
        )}
        <button className="icon-button" type="button" aria-label="返回对话" title="返回" onClick={onBack}>
          <ArrowLeft size={17} />
        </button>
        <div>
          <h1>{title}</h1>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className="ecosystem-topbar-actions">{children}</div>
    </header>
  );
}

function EcosystemError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return error ? (
    <div className="ecosystem-error" role="alert">
      <AlertTriangle size={16} />
      <span>{error}</span>
      <button type="button" onClick={onRetry}>重试</button>
    </div>
  ) : null;
}

function EcosystemLoading({ label }: { label: string }) {
  return (
    <div className="ecosystem-state" role="status">
      <LoaderCircle className="spin" size={23} />
      <span>{label}</span>
    </div>
  );
}

function EcosystemEmpty({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="ecosystem-state ecosystem-empty">
      {icon}
      <span>{title}</span>
      {action && <button type="button" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

function packageDisplayName(source: string): string {
  const normalized = source.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.replace(/^npm:/, "").split("/").at(-1) || source;
}

function resourceKindLabel(kind: AgentResourceSummary["kind"] | "all"): string {
  return {
    all: "全部",
    extension: "扩展",
    skill: "技能",
    prompt: "提示词",
    theme: "主题",
    context: "上下文",
    system: "系统",
  }[kind];
}

function resourceKindCount(
  resources: AgentResourceSummary[],
  kind: AgentResourceSummary["kind"] | "all",
): number {
  return kind === "all" ? resources.length : resources.filter((item) => item.kind === kind).length;
}
