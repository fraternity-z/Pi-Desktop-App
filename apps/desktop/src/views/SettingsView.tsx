import { ArrowLeft, LoaderCircle, Menu, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import type { SettingsSectionId } from "../components/SettingsSidebar";
import type { AgentEventConnection } from "../stores/useChatSession";
import type { AppPreferences, InterfaceDensity } from "../stores/useAppPreferences";
import type { RequestHeaderSettingsController } from "../stores/useRequestHeaderSettings";
import type { RuntimeStatusController } from "../stores/useRuntimeStatus";

interface SettingsViewProps {
  section: SettingsSectionId;
  sidebarOpen: boolean;
  sidebarWidth: number;
  preferences: AppPreferences;
  requestHeaders: RequestHeaderSettingsController;
  runtime: RuntimeStatusController;
  eventConnection: AgentEventConnection;
  onOpenSidebar: () => void;
  onBack: () => void;
  onSidebarWidthChange: (width: number) => void;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
}

const SECTION_TITLES: Record<SettingsSectionId, string> = {
  general: "常规",
  appearance: "外观",
  behavior: "行为",
  runtime: "运行时",
};

export function SettingsView({
  section,
  sidebarOpen,
  sidebarWidth,
  preferences,
  requestHeaders,
  runtime,
  eventConnection,
  onOpenSidebar,
  onBack,
  onSidebarWidthChange,
  onPreferencesChange,
}: SettingsViewProps) {
  return (
    <main className="workspace-main settings-main">
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
        </div>
      </div>
    </main>
  );
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

function AppearanceSettings({
  preferences,
  sidebarWidth,
  onSidebarWidthChange,
  onChange,
}: {
  preferences: AppPreferences;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  onChange: (patch: Partial<AppPreferences>) => void;
}) {
  return (
    <>
      <SettingsSection label="布局">
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
          title="侧边栏透明效果"
          description="为侧边栏启用半透明背景和模糊效果。"
          control={
            <SettingsToggle
              label="侧边栏透明效果"
              checked={preferences.sidebarTranslucent}
              onChange={(checked) => onChange({ sidebarTranslucent: checked })}
            />
          }
        />
        <SettingsRow
          title="侧边栏宽度"
          description={
            <div className="settings-range-control">
              <input
                type="range"
                min={232}
                max={360}
                step={4}
                value={sidebarWidth}
                aria-label="侧边栏宽度"
                onChange={(event) => onSidebarWidthChange(Number(event.target.value))}
              />
              <span>{sidebarWidth}px</span>
            </div>
          }
          control={<span className="sr-only">{sidebarWidth}px</span>}
          last
        />
      </SettingsSection>

      <SettingsSection label="动效">
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

function BehaviorSettings({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (patch: Partial<AppPreferences>) => void;
}) {
  return (
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

function SettingsSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section-block">
      <div className="settings-section-heading">
        <h2>{label}</h2>
        {action}
      </div>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  control,
  last = false,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`settings-row${last ? " settings-row-last" : ""}`}>
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  );
}

function SettingsToggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className="settings-toggle"
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function SettingsSelect({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="settings-select"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
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
