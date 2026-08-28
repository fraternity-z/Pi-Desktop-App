import {
  ArchiveRestore,
  ArrowLeft,
  BellRing,
  ExternalLink,
  Folder,
  LoaderCircle,
  Menu,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AppearanceSettings } from "../components/AppearanceSettings";
import { ConfirmSidebarDialog } from "../components/SidebarDialog";
import {
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
} from "../components/SettingsControls";
import type { SettingsSectionId } from "../components/SettingsSidebar";
import {
  deleteAgentSessions,
  type DeleteAgentSessionsResult,
} from "../ipc/agent";
import type { AgentEventConnection } from "../stores/useChatSession";
import type { AppPreferences, InterfaceDensity } from "../stores/useAppPreferences";
import type { RequestHeaderSettingsController } from "../stores/useRequestHeaderSettings";
import type { DesktopNotificationController } from "../stores/useDesktopNotifications";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";
import { useSidebarPreferences } from "../stores/useSidebarPreferences";

interface SettingsViewProps {
  section: SettingsSectionId;
  sidebarOpen: boolean;
  sidebarWidth: number;
  preferences: AppPreferences;
  notifications: DesktopNotificationController;
  requestHeaders: RequestHeaderSettingsController;
  runtime: RuntimeStatusController;
  eventConnection: AgentEventConnection;
  onOpenSidebar: () => void;
  onBack: () => void;
  onSidebarWidthChange: (width: number) => void;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
  onClearArchivedSessions?: (sessionIds: string[]) => Promise<DeleteAgentSessionsResult>;
}

const SECTION_TITLES: Record<SettingsSectionId, string> = {
  general: "常规",
  notifications: "通知",
  appearance: "外观",
  behavior: "行为",
  runtime: "运行时",
  archived: "已归档",
};

export function SettingsView({
  section,
  sidebarOpen,
  sidebarWidth,
  preferences,
  notifications,
  requestHeaders,
  runtime,
  eventConnection,
  onOpenSidebar,
  onBack,
  onSidebarWidthChange,
  onPreferencesChange,
  onClearArchivedSessions,
}: SettingsViewProps) {
  return (
    <main className={`workspace-main settings-main settings-main-${section}`}>
      <header className="topbar settings-topbar">
        <div className="topbar-title-group">
          {!sidebarOpen && (
            <button
              className="icon-button sidebar-open-button"
              type="button"
              onClick={onOpenSidebar}
              aria-label="打开设置导航"
              title="打开设置导航"
            >
              <Menu size={19} />
            </button>
          )}
          <button
            className="icon-button settings-inline-back"
            type="button"
            onClick={onBack}
            aria-label="返回会话工作台"
            title="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="topbar-title">
            <span>Pi Desktop</span>
            <h1>设置</h1>
          </div>
        </div>
      </header>

      <div className="settings-content-scroll">
        <div className="settings-content" data-testid={`settings-${section}`}>
          <h1 className="settings-page-title">{SECTION_TITLES[section]}</h1>
          {section === "general" && (
            <GeneralSettings preferences={preferences} onChange={onPreferencesChange} />
          )}
          {section === "appearance" && (
            <AppearanceSettings
              preferences={preferences}
              sidebarWidth={sidebarWidth}
              onSidebarWidthChange={onSidebarWidthChange}
              onChange={onPreferencesChange}
            />
          )}
          {section === "notifications" && (
            <NotificationSettings
              preferences={preferences}
              controller={notifications}
              onChange={onPreferencesChange}
            />
          )}
          {section === "behavior" && (
            <BehaviorSettings preferences={preferences} onChange={onPreferencesChange} />
          )}
          {section === "runtime" && (
            <>
              <RuntimeSettings
                runtime={runtime}
                eventConnection={eventConnection}
                onRefresh={() => void runtime.refresh()}
              />
              <RequestHeaderSettings controller={requestHeaders} />
            </>
          )}
          {section === "archived" && (
            <ArchivedSettings onClearArchivedSessions={onClearArchivedSessions ?? deleteAgentSessions} />
          )}
        </div>
      </div>
    </main>
  );
}

function NotificationSettings({
  preferences,
  controller,
  onChange,
}: {
  preferences: AppPreferences;
  controller: DesktopNotificationController;
  onChange: (patch: Partial<AppPreferences>) => void;
}) {
  const busy = controller.phase !== "idle";
  const desktopNotificationsEnabled =
    preferences.desktopNotifications && controller.permission === "granted";
  const dependentControlsDisabled = busy || !desktopNotificationsEnabled;
  const permissionLabel =
    controller.phase === "checking-permission"
      ? "检测权限中"
      : controller.permission === "granted"
        ? "系统已允许"
        : controller.permission === "denied"
          ? "系统未允许"
          : "权限未知";

  return (
    <>
      <SettingsSection
        label="桌面通知"
        action={
          <SettingsStatus ready={controller.permission === "granted"} label={permissionLabel} />
        }
      >
        <SettingsRow
          title="桌面通知"
          description="允许 Pi Desktop 发送系统通知。首次启用时会请求系统权限。"
          control={
            <SettingsToggle
              label="桌面通知"
              checked={desktopNotificationsEnabled}
              disabled={busy}
              onChange={(enabled) => void controller.setEnabled(enabled)}
            />
          }
        />
        <SettingsRow
          title="任务完成时通知"
          description="Pi 任务成功结束后发送通知。"
          control={
            <SettingsToggle
              label="任务完成时通知"
              checked={preferences.taskCompletedNotifications}
              disabled={dependentControlsDisabled}
              onChange={(checked) => onChange({ taskCompletedNotifications: checked })}
            />
          }
        />
        <SettingsRow
          title="任务失败时通知"
          description="Pi 任务因错误失败后发送通知；主动停止的任务不会通知。"
          control={
            <SettingsToggle
              label="任务失败时通知"
              checked={preferences.taskFailedNotifications}
              disabled={dependentControlsDisabled}
              onChange={(checked) => onChange({ taskFailedNotifications: checked })}
            />
          }
        />
        <SettingsRow
          title="Host 异常时通知"
          description="Agent Host 崩溃或 Pi Bridge 意外退出时发送通知。"
          control={
            <SettingsToggle
              label="Host 异常时通知"
              checked={preferences.hostExceptionNotifications}
              disabled={dependentControlsDisabled}
              onChange={(checked) => onChange({ hostExceptionNotifications: checked })}
            />
          }
        />
        <SettingsRow
          title="仅在窗口未聚焦时通知"
          description="窗口处于前台并已聚焦时不弹出系统通知。"
          control={
            <SettingsToggle
              label="仅在窗口未聚焦时通知"
              checked={preferences.notifyOnlyWhenUnfocused}
              disabled={dependentControlsDisabled}
              onChange={(checked) => onChange({ notifyOnlyWhenUnfocused: checked })}
            />
          }
        />
        <SettingsRow
          title="通知声音"
          description="通知时播放系统提示音（视系统支持而定）。"
          control={
            <SettingsToggle
              label="通知声音"
              checked={preferences.notificationSound}
              disabled={dependentControlsDisabled}
              onChange={(checked) => onChange({ notificationSound: checked })}
            />
          }
          last
        />
      </SettingsSection>

      <div className="settings-notification-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void controller.sendTestNotification()}
        >
          {controller.phase === "sending-test" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <BellRing size={15} />
          )}
          发送测试通知
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void controller.openSystemSettings()}
        >
          {controller.phase === "opening-settings" ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ExternalLink size={15} />
          )}
          打开系统通知设置
        </button>
      </div>
      {controller.error && (
        <p className="settings-notification-feedback settings-notification-error" role="alert">
          {controller.error}
        </p>
      )}
      {controller.status && (
        <p className="settings-notification-feedback" role="status">
          {controller.status}
        </p>
      )}
    </>
  );
}

function ArchivedSettings({
  onClearArchivedSessions,
}: {
  onClearArchivedSessions: (sessionIds: string[]) => Promise<DeleteAgentSessionsResult>;
}) {
  const sidebar = useSidebarPreferences();
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cleanupTarget, setCleanupTarget] = useState<string[] | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const archivedIds = sidebar.preferences.archivedThreads;
  const archivedGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const entries = sidebar.preferences.archivedThreads
      .map((id) => {
        const meta = sidebar.preferences.archivedThreadMeta[id] ?? {};
        return {
          id,
          title: sidebar.preferences.threadAliases[id] || meta.title || `会话 ${id.slice(0, 8)}`,
          cwd: meta.cwd || "",
          archivedAt: meta.archivedAt || "",
        };
      })
      .filter(
        (item) =>
          !needle ||
          item.title.toLocaleLowerCase().includes(needle) ||
          item.cwd.toLocaleLowerCase().includes(needle),
      )
      .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = entry.cwd || "__conversation__";
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [query, sidebar.preferences]);
  const resultCount = archivedGroups.reduce((count, [, entries]) => count + entries.length, 0);

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    const target = deleteTarget;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const result = await onClearArchivedSessions([target.id]);
      validateArchivedCleanupResult(result, [target.id]);
      sidebar.deleteThread(target.id);
      setDeleteTarget(null);
    } catch (cause) {
      setDeleteError(formatArchivedCleanupError(cause));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function confirmCleanup() {
    if (!cleanupTarget || cleanupBusy) return;
    const target = cleanupTarget;
    setCleanupBusy(true);
    setCleanupError(null);
    setCleanupStatus(null);
    try {
      const result = await onClearArchivedSessions(target);
      validateArchivedCleanupResult(result, target);
      sidebar.clearArchivedThreads(target);
      setCleanupTarget(null);
      setCleanupStatus(`已清理 ${target.length} 个归档会话及其 Pi 原生 JSONL 文件`);
    } catch (cause) {
      setCleanupError(formatArchivedCleanupError(cause));
    } finally {
      setCleanupBusy(false);
    }
  }

  return (
    <>
      <div className="settings-archive-toolbar">
        <label className="settings-archive-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            aria-label="搜索已归档会话"
            placeholder="搜索已归档会话"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="settings-archive-toolbar-actions">
          <span>{resultCount} 个会话</span>
          <button
            className="secondary-button settings-archive-cleanup"
            type="button"
            aria-label="清理所有归档"
            title="清理所有归档"
            disabled={cleanupBusy || archivedIds.length === 0}
            onClick={() => {
              setCleanupError(null);
              setCleanupStatus(null);
              setCleanupTarget([...archivedIds]);
            }}
          >
            {cleanupBusy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
            清理所有归档
          </button>
        </div>
      </div>

      {cleanupError && (
        <p className="settings-archive-feedback settings-archive-error" role="alert">
          {cleanupError}
        </p>
      )}
      {cleanupStatus && (
        <p className="settings-archive-feedback" role="status">
          {cleanupStatus}
        </p>
      )}

      {archivedGroups.length === 0 ? (
        <div className="settings-archive-empty">
          <ArchiveRestore size={24} aria-hidden="true" />
          <strong>{query.trim() ? "没有匹配的会话" : "暂无已归档会话"}</strong>
          <span>{query.trim() ? "请尝试其他关键词。" : "从侧边栏归档的会话会显示在这里。"}</span>
        </div>
      ) : (
        archivedGroups.map(([cwd, entries]) => (
          <SettingsSection
            key={cwd}
            label={cwd === "__conversation__" ? "对话" : archivedWorkspaceName(cwd)}
          >
            {entries.map((entry, index) => (
              <SettingsRow
                key={entry.id}
                title={entry.title}
                description={
                  <div className="settings-archive-meta">
                    {entry.cwd && (
                      <span title={entry.cwd}>
                        <Folder size={13} aria-hidden="true" />
                        {entry.cwd}
                      </span>
                    )}
                    <time dateTime={entry.archivedAt || undefined}>
                      {formatArchivedDate(entry.archivedAt)}
                    </time>
                  </div>
                }
                control={
                  <div className="settings-archive-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`恢复${entry.title}`}
                      title="恢复"
                      onClick={() => sidebar.setThreadArchived(entry.id, false)}
                    >
                      <ArchiveRestore size={16} />
                    </button>
                    <button
                      className="icon-button settings-archive-delete"
                      type="button"
                      aria-label={`删除${entry.title}`}
                      title="删除"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget({ id: entry.id, title: entry.title });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                }
                last={index === entries.length - 1}
              />
            ))}
          </SettingsSection>
        ))
      )}

      {deleteTarget && (
        <ConfirmSidebarDialog
          title="删除已归档会话"
          description={`将永久删除“${deleteTarget.title}”及其 Pi 原生 JSONL 文件。此操作不可恢复。`}
          confirmLabel="删除"
          danger
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {cleanupTarget && (
        <ConfirmSidebarDialog
          title="清理所有归档"
          description={`将永久删除 ${cleanupTarget.length} 个归档会话及其 Pi 原生 JSONL 文件。此操作不可恢复。`}
          confirmLabel="清理"
          danger
          busy={cleanupBusy}
          error={cleanupError}
          onConfirm={() => void confirmCleanup()}
          onClose={() => setCleanupTarget(null)}
        />
      )}
    </>
  );
}

function archivedWorkspaceName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function formatArchivedDate(value: string): string {
  if (!value) return "归档时间未知";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "归档时间未知";
  return `归档于 ${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp)}`;
}

function formatArchivedCleanupError(cause: unknown): string {
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
  return "SESSION_DELETE_FAILED: 清理归档会话未完成，请重试";
}

function validateArchivedCleanupResult(
  result: DeleteAgentSessionsResult | null | undefined,
  target: readonly string[],
): void {
  const deleted = result?.deletedSessionIds;
  const missing = result?.missingSessionIds;
  if (
    !Array.isArray(deleted) ||
    !Array.isArray(missing) ||
    !deleted.every((id): id is string => typeof id === "string") ||
    !missing.every((id): id is string => typeof id === "string")
  ) {
    throw new Error("cleanup result has invalid session id arrays");
  }
  const requested = new Set(target);
  const handled = new Set<string>();
  for (const id of [...deleted, ...missing]) {
    if (!requested.has(id) || !handled.add(id)) {
      throw new Error("cleanup result contains an unknown or duplicate session id");
    }
  }
  if (handled.size !== requested.size) {
    throw new Error("cleanup result did not cover every requested session");
  }
}

function GeneralSettings({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (patch: Partial<AppPreferences>) => void;
}) {
  return (
    <SettingsSection label="工作台">
      <SettingsRow
        title="建议提示"
        description="在空会话和空工作区中显示上下文提示。"
        control={
          <SettingsToggle
            label="建议提示"
            checked={preferences.showSuggestions}
            onChange={(checked) => onChange({ showSuggestions: checked })}
          />
        }
      />
      <SettingsRow
        title="运行状态"
        description="在会话标题栏显示 Pi 与事件连接状态。"
        control={
          <SettingsToggle
            label="运行状态"
            checked={preferences.showRuntimeStatus}
            onChange={(checked) => onChange({ showRuntimeStatus: checked })}
          />
        }
        last
      />
    </SettingsSection>
  );
}

function BehaviorSettings({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (patch: Partial<AppPreferences>) => void;
}) {
  return (
    <>
      <SettingsSection label="导航与确认">
        <SettingsRow
          title="移除项目时确认"
          description="从最近项目列表移除工作区前显示确认。"
          control={
            <SettingsToggle
              label="移除项目时确认"
              checked={preferences.confirmRemoveWorkspace}
              onChange={(checked) => onChange({ confirmRemoveWorkspace: checked })}
            />
          }
        />
        <SettingsRow
          title="窄屏导航后关闭侧边栏"
          description="在较小窗口中选择页面或会话后收起侧边栏。"
          control={
            <SettingsToggle
              label="窄屏导航后关闭侧边栏"
              checked={preferences.closeSidebarOnNavigation}
              onChange={(checked) => onChange({ closeSidebarOnNavigation: checked })}
            />
          }
          last
        />
      </SettingsSection>
      <SettingsSection label="界面辅助">
        <SettingsRow
          title="界面密度"
          description="调整导航与设置项的纵向间距。"
          control={
            <SettingsSelect
              label="界面密度"
              value={preferences.interfaceDensity}
              options={[
                { value: "comfortable", label: "舒适" },
                { value: "compact", label: "紧凑" },
              ]}
              onChange={(value) => onChange({ interfaceDensity: value as InterfaceDensity })}
            />
          }
        />
        <SettingsRow
          title="减少动态效果"
          description="关闭非必要的过渡与动画。"
          control={
            <SettingsToggle
              label="减少动态效果"
              checked={preferences.reduceMotion}
              onChange={(checked) => onChange({ reduceMotion: checked })}
            />
          }
          last
        />
      </SettingsSection>
    </>
  );
}

function RuntimeSettings({
  runtime,
  eventConnection,
  onRefresh,
}: {
  runtime: RuntimeStatusController;
  eventConnection: AgentEventConnection;
  onRefresh: () => void;
}) {
  const runtimeReady = runtime.phase === "ready" && runtime.status.status === "ready";
  const runtimeLabel =
    runtime.phase === "loading"
      ? "检测中"
      : runtime.phase === "error"
        ? "检测失败"
        : runtime.status.status === "ready"
          ? "可用"
          : "不可用";

  return (
    <SettingsSection
      label="本机运行时"
      action={
        <button
          className="icon-button settings-refresh-button"
          type="button"
          onClick={onRefresh}
          disabled={runtime.phase === "loading"}
          aria-label="重新检测运行时"
          title="重新检测"
        >
          {runtime.phase === "loading" ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
        </button>
      }
    >
      <SettingsRow
        title="运行状态"
        control={<SettingsStatus ready={runtimeReady} label={runtimeLabel} />}
      />
      <SettingsRow
        title="Pi 版本"
        control={<SettingsValue value={runtime.phase === "ready" ? runtime.status.piVersion : null} />}
      />
      <SettingsRow
        title="Node.js 版本"
        control={
          <SettingsValue value={runtime.phase === "ready" ? runtime.status.nodeVersion : null} />
        }
      />
      <SettingsRow
        title="运行时来源"
        control={
          <SettingsValue value={runtime.phase === "ready" ? runtime.status.runtimeSource : null} />
        }
      />
      <SettingsRow
        title="事件连接"
        control={
          <SettingsStatus
            ready={eventConnection === "ready"}
            label={formatEventConnection(eventConnection)}
          />
        }
        last
      />
      {runtime.phase === "error" && <p className="settings-runtime-error">{runtime.message}</p>}
      {runtime.phase === "ready" && runtime.status.error && (
        <p className="settings-runtime-error">
          {runtime.status.error.code}: {runtime.status.error.message}
        </p>
      )}
    </SettingsSection>
  );
}

function RequestHeaderSettings({
  controller,
}: {
  controller: RequestHeaderSettingsController;
}) {
  const controlsDisabled = controller.phase !== "ready" || controller.saving;
  const action = controller.phase === "loading" || controller.saving ? (
    <span className="settings-save-status" role="status">
      <LoaderCircle className="spin" size={15} />
      {controller.saving ? "保存中" : "加载中"}
    </span>
  ) : controller.error ? (
    <button
      className="icon-button settings-refresh-button"
      type="button"
      onClick={() => void controller.refresh()}
      aria-label="重新加载请求头设置"
      title="重新加载"
    >
      <RefreshCw size={16} />
    </button>
  ) : undefined;

  return (
    <SettingsSection label="请求标识" action={action}>
      <SettingsRow
        title="客户端请求头伪装"
        description="将模型服务请求标识为所选客户端；鉴权请求头保持不变。"
        control={
          <SettingsToggle
            label="客户端请求头伪装"
            checked={controller.settings.enabled}
            disabled={controlsDisabled}
            onChange={(enabled) => void controller.update({ enabled })}
          />
        }
      />
      <SettingsRow
        title="客户端类型"
        description="选择随模型请求发送的内置请求头模板。"
        control={
          <SettingsSelect
            label="客户端类型"
            value={controller.settings.client}
            options={[
              { value: "claude-code", label: "Claude Code" },
              { value: "codex", label: "Codex" },
            ]}
            disabled={controlsDisabled || !controller.settings.enabled}
            onChange={(client) =>
              void controller.update({ client: client as "claude-code" | "codex" })
            }
          />
        }
        last
      />
      {controller.error && (
        <p className="settings-runtime-error" role="alert">
          {controller.error}
        </p>
      )}
    </SettingsSection>
  );
}

function SettingsStatus({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className="settings-status" data-ready={ready}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function SettingsValue({ value }: { value: string | null }) {
  return <span className="settings-value">{value || "未检测到"}</span>;
}

function formatEventConnection(connection: AgentEventConnection): string {
  if (connection === "ready") return "已连接";
  if (connection === "connecting") return "连接中";
  return "连接失败";
}
