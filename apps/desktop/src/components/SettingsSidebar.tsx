import {
  Activity,
  Archive,
  ArrowLeft,
  Bell,
  Gauge,
  Palette,
  PanelLeftClose,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { SidebarResizer } from "./AppSidebar";

export type SettingsSectionId =
  | "general"
  | "notifications"
  | "appearance"
  | "behavior"
  | "runtime"
  | "archived";

interface SettingsSidebarProps {
  open: boolean;
  width: number;
  activeSection: SettingsSectionId;
  onBack: () => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onClose: () => void;
  onWidthChange: (width: number) => void;
}

interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
  keywords: string;
  icon: LucideIcon;
}

const SETTINGS_GROUPS: Array<{ label: string; items: SettingsNavItem[] }> = [
  {
    label: "应用",
    items: [
      { id: "general", label: "常规", keywords: "提示 状态 工作台", icon: Gauge },
      {
        id: "notifications",
        label: "通知",
        keywords: "桌面 系统 任务 完成 失败 运行时 异常 声音 前台",
        icon: Bell,
      },
      { id: "appearance", label: "外观", keywords: "侧边栏 密度 动效 宽度", icon: Palette },
      { id: "behavior", label: "行为", keywords: "确认 导航 移除", icon: ShieldCheck },
    ],
  },
  {
    label: "Pi",
    items: [
      {
        id: "runtime",
        label: "运行时",
        keywords: "node pi bridge 连接 版本 请求头 claude code codex 伪装",
        icon: Activity,
      },
    ],
  },
  {
    label: "数据",
    items: [
      { id: "archived", label: "已归档", keywords: "会话 恢复 删除 历史", icon: Archive },
    ],
  },
];

export function SettingsSidebar({
  open,
  width,
  activeSection,
  onBack,
  onSectionChange,
  onClose,
  onWidthChange,
}: SettingsSidebarProps) {
  const [query, setQuery] = useState("");
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return SETTINGS_GROUPS;
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.label} ${item.label} ${item.keywords}`.toLocaleLowerCase().includes(normalizedQuery),
      ),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <aside
      className={`app-sidebar settings-sidebar${open ? " app-sidebar-open" : " app-sidebar-collapsed"}`}
      aria-label="设置导航"
      aria-hidden={!open}
      inert={!open}
      style={{ width: open ? `${width}px` : 0 }}
    >
      <div className="settings-sidebar-header">
        <button className="settings-back-button" type="button" onClick={onBack}>
          <ArrowLeft size={17} />
          <span>返回</span>
        </button>
        <button
          className="icon-button sidebar-close-button"
          type="button"
          onClick={onClose}
          aria-label="关闭侧边栏"
          title="关闭侧边栏"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      <label className="settings-search-field">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">搜索设置</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索设置"
        />
      </label>

      <nav className="settings-nav-scroll" aria-label="设置分类">
        {filteredGroups.map((group) => (
          <section className="settings-nav-group" key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeSection;
              return (
                <button
                  className="settings-nav-item"
                  type="button"
                  key={item.id}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSectionChange(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </section>
        ))}
        {filteredGroups.length === 0 && <p className="settings-search-empty">未找到相关设置</p>}
      </nav>

      <SidebarResizer open={open} width={width} onWidthChange={onWidthChange} />
    </aside>
  );
}
