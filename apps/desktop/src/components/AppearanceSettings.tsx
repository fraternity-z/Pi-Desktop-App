import { AlertTriangle, CaseSensitive, ChevronDown, Copy, Download, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { exportAppearanceTheme } from "../ipc/appearance";
import {
  appearanceColors, appearanceProfilePatch, getAppearanceProfile, normalizeHexColor,
  presetProfile, separateAppearanceModesPatch, type AppearanceProfile, type ColorThemePreset,
} from "../stores/appearancePreferences";
import { useResolvedTheme, type AppPreferences, type ThemePreference } from "../stores/useAppPreferences";
import { AppearanceThemeLibrary } from "./AppearanceThemeLibrary";
import { SettingsRow, SettingsToggle } from "./SettingsControls";
import { SidebarDialogFrame } from "./SidebarDialog";
import "./AppearanceSettings.css";

interface AppearanceSettingsProps {
  preferences: AppPreferences;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  onChange: (patch: Partial<AppPreferences>) => void;
}

const UI_FONTS = [
  { value: "system", label: "系统" },
  { value: "microsoft-yahei", label: "微软雅黑" },
  { value: "noto-sans", label: "思源黑体" },
];
const FONT_STYLES = [
  { value: "normal", label: "常规" },
  { value: "medium", label: "中等" },
  { value: "bold", label: "粗体" },
];
const ACCENTS = [
  { value: "default", label: "默认" }, { value: "#3291FF", label: "蓝色" },
  { value: "#8B5CF6", label: "紫色" }, { value: "#E0528D", label: "粉色" },
  { value: "#D97706", label: "橙色" }, { value: "#168568", label: "绿色" },
];

export function AppearanceSettings({ preferences, sidebarWidth, onSidebarWidthChange, onChange }: AppearanceSettingsProps) {
  const mode = useResolvedTheme(preferences.theme);
  const profile = getAppearanceProfile(preferences, mode);
  const colors = appearanceColors(profile, mode);
  const [advanced, setAdvanced] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const advancedId = useId();
  const updateProfile = (patch: Partial<AppearanceProfile>) => onChange(appearanceProfilePatch(preferences, mode, patch));
  const updateConfiguration = (patch: Partial<AppPreferences["appearance"]>) =>
    onChange({ appearance: { ...preferences.appearance, ...patch } });

  async function exportTheme() {
    setExporting(true);
    setFeedback(null);
    try {
      const saved = await exportAppearanceTheme({
        name: profile.themeName, theme: preferences.theme, backgroundPreset: preferences.backgroundPreset,
        customBackgroundPath: preferences.customBackgroundPath, sidebarWidth,
        uiScale: preferences.uiScale, uiFont: preferences.uiFont, uiFontSize: preferences.uiFontSize,
        codeFont: preferences.codeFont, codeFontSize: preferences.codeFontSize,
        sidebarTranslucent: preferences.sidebarTranslucent, appearance: preferences.appearance,
        reduceMotion: preferences.reduceMotion,
      });
      if (saved) setFeedback({ error: false, message: "主题已导出，包含颜色、字体和高级设置" });
    } catch {
      setFeedback({ error: true, message: "无法导出主题，请检查保存位置后重试" });
    } finally {
      setExporting(false);
    }
  }

  function selectTheme(value: string) {
    if (value === "manage") { setLibraryOpen(true); return; }
    if (value.startsWith("mode:")) { onChange({ theme: value.slice(5) as ThemePreference }); return; }
    if (value !== "custom") {
      onChange({ ...appearanceProfilePatch(preferences, mode, presetProfile(value as Exclude<ColorThemePreset, "custom">)), backgroundPreset: "default" });
    }
  }

  return (
    <div className="appearance-settings">
      {preferences.appearance.separateModes && (
        <div className="appearance-mode-bar">
          <span>当前模式</span>
          <Segments label="外观模式" value={preferences.theme} options={[
            { value: "system", label: "系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" },
          ]} onChange={(theme) => onChange({ theme: theme as ThemePreference })} />
        </div>
      )}
      <div className="appearance-card">
        <SettingsRow title="主题" control={
          <div className="appearance-controls">
            <button className="appearance-icon-button" type="button" aria-label="导出主题" title="导出主题" disabled={exporting} onClick={() => void exportTheme()}>
              {exporting ? <LoaderCircle size={20} className="spin" /> : <Download size={20} />}
            </button>
            <button className="appearance-icon-button" type="button" aria-label="复制主题" title="复制主题" onClick={() => {
              updateProfile({ themePreset: "custom", themeName: `${profile.themeName.slice(0, 32)} · 副本`, backgroundColor: colors.background, foregroundColor: colors.foreground });
              setFeedback({ error: false, message: "已复制当前主题，可单独调整颜色和字体" });
            }}><Copy size={20} /></button>
            <PillSelect label="主题" value={profile.themePreset} className="appearance-theme-select" icon={<CaseSensitive size={19} />} onChange={selectTheme} options={[
              { value: "chatgpt", label: "ChatGPT" }, { value: "paper", label: "纸张" }, { value: "midnight", label: "午夜" },
              ...(profile.themePreset === "custom" ? [{ value: "custom", label: profile.themeName }] : []),
              { value: "mode:system", label: `跟随系统${preferences.theme === "system" ? " ✓" : ""}` },
              { value: "mode:light", label: `浅色模式${preferences.theme === "light" ? " ✓" : ""}` },
              { value: "mode:dark", label: `深色模式${preferences.theme === "dark" ? " ✓" : ""}` },
              { value: "manage", label: "管理主题与背景…" },
            ]} />
          </div>
        } />
        <SettingsRow title="强调色" control={<PillSelect label="强调色" value={profile.accentColor} options={[...ACCENTS,
          ...(!ACCENTS.some((accent) => accent.value === profile.accentColor) ? [{ value: profile.accentColor, label: "自定义" }] : []),
        ]} icon={<span className="appearance-swatch" style={{ background: profile.accentColor === "default" ? colors.foreground : colors.accent }} />} onChange={(accentColor) => updateProfile({ accentColor })} />} />
        <SettingsRow title="背景" control={<ColorControl label="背景" value={colors.background} onChange={(backgroundColor) => updateProfile({ backgroundColor })} />} />
        <SettingsRow title="前景" control={<ColorControl label="前景" value={colors.foreground} onChange={(foregroundColor) => updateProfile({ foregroundColor })} />} />
        <SettingsRow title="字体" control={<PillSelect label="字体" value={profile.uiFont} options={UI_FONTS} onChange={(uiFont) => updateProfile({ uiFont: uiFont as AppearanceProfile["uiFont"] })} />} />
      </div>

      <button type="button" className="appearance-advanced-toggle" aria-expanded={advanced} aria-controls={advancedId} onClick={() => setAdvanced(!advanced)}>
        高级 <ChevronDown size={16} />
      </button>
      <div id={advancedId} className="appearance-advanced" hidden={!advanced}>
        <div className="appearance-card">
          <SettingsRow title="界面字号" description="调整 Pi Desktop 的基础字号" control={<FontSizeControl label="界面字号" value={preferences.uiFontSize} min={10} max={24} onChange={(uiFontSize) => onChange({ uiFontSize })} />} />
          <SettingsRow title="代码字体大小" description="调整聊天和差异视图中代码使用的基础字号" control={<FontSizeControl label="代码字体大小" value={preferences.codeFontSize} min={10} max={24} onChange={(codeFontSize) => onChange({ codeFontSize })} />} />
        </div>
        <div className="appearance-card">
          <SettingsRow title="减少动态效果" description="减少动画效果或匹配系统设置" control={<Segments label="减少动态效果" value={preferences.reduceMotion === "system" ? "system" : preferences.reduceMotion ? "on" : "off"} options={[
            { value: "system", label: "系统" }, { value: "on", label: "开启" }, { value: "off", label: "关闭" },
          ]} onChange={(value) => onChange({ reduceMotion: value === "system" ? "system" : value === "on" })} />} />
          <SettingsRow title="分别设置浅色和深色模式" description="分别选择各自的主题、颜色和字体" control={<SettingsToggle label="分别设置浅色和深色模式" checked={preferences.appearance.separateModes} onChange={(enabled) => onChange(separateAppearanceModesPatch(preferences, mode, enabled))} />} />
        </div>
        <div className="appearance-card">
          <SettingsRow title="界面字体样式" control={<PillSelect label="界面字体样式" value={profile.uiFontStyle} options={FONT_STYLES} onChange={(uiFontStyle) => updateProfile({ uiFontStyle: uiFontStyle as AppearanceProfile["uiFontStyle"] })} />} />
          <SettingsRow title="内容字体" control={<div className="appearance-controls">
            <PillSelect label="内容字体" value={profile.contentFont} options={[{ value: "inherit", label: "与界面字体相同" }, ...UI_FONTS, { value: "serif", label: "衬线" }]} onChange={(contentFont) => updateProfile({ contentFont: contentFont as AppearanceProfile["contentFont"] })} />
            <PillSelect label="内容字体样式" value={profile.contentFontStyle} options={FONT_STYLES} onChange={(contentFontStyle) => updateProfile({ contentFontStyle: contentFontStyle as AppearanceProfile["contentFontStyle"] })} />
          </div>} />
          <SettingsRow title="代码字体" control={<div className="appearance-controls">
            <PillSelect label="代码字体" value={profile.codeFont} options={[{ value: "system", label: "系统" }, { value: "cascadia-code", label: "Cascadia Code" }, { value: "consolas", label: "Consolas" }]} onChange={(codeFont) => updateProfile({ codeFont: codeFont as AppearanceProfile["codeFont"] })} />
            <PillSelect label="代码字体样式" value={profile.codeFontStyle} options={FONT_STYLES} onChange={(codeFontStyle) => updateProfile({ codeFontStyle: codeFontStyle as AppearanceProfile["codeFontStyle"] })} />
          </div>} />
          <SettingsRow title="半透明侧边栏" control={<SettingsToggle label="半透明侧边栏" checked={preferences.sidebarTranslucent} onChange={(sidebarTranslucent) => onChange({ sidebarTranslucent })} />} />
          <SettingsRow title="对比度" control={<div className="appearance-contrast">
            <input aria-label="对比度" type="range" min={0} max={100} step={1} value={profile.contrast} onChange={(event) => updateProfile({ contrast: Number(event.target.value) })} />
            <output aria-label="对比度数值">{profile.contrast}</output>
          </div>} />
        </div>
        <div className="appearance-card">
          <SettingsRow title="差异标记" description="使用颜色或 +/− 标记显示更改" control={<Segments label="差异标记" value={preferences.appearance.diffIndicators} options={[{ value: "color", label: "颜色" }, { value: "symbols", label: "+/-" }]} onChange={(diffIndicators) => updateConfiguration({ diffIndicators: diffIndicators as "color" | "symbols" })} />} />
          <SettingsRow title="使用指针光标" description="悬停交互元素时切换为指针光标" control={<SettingsToggle label="使用指针光标" checked={preferences.appearance.pointerCursor} onChange={(pointerCursor) => updateConfiguration({ pointerCursor })} />} />
        </div>
      </div>
      {feedback && <p className="appearance-feedback" aria-label="外观设置反馈" role={feedback.error ? "alert" : "status"} data-kind={feedback.error ? "error" : "success"}>{feedback.error && <AlertTriangle size={14} />}{feedback.message}</p>}
      {libraryOpen && <SidebarDialogFrame title="管理主题与背景" description="导入主题、管理背景图片，或调整窗口布局。" onClose={() => setLibraryOpen(false)}>
        <div className="appearance-library"><AppearanceThemeLibrary preferences={preferences} sidebarWidth={sidebarWidth} onSidebarWidthChange={onSidebarWidthChange} onChange={onChange} /></div>
      </SidebarDialogFrame>}
    </div>
  );
}

function PillSelect({ label, value, options, onChange, icon, className = "" }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (value: string) => void; icon?: ReactNode; className?: string;
}) {
  return <span className={`appearance-select ${icon ? "appearance-select-with-icon" : ""} ${className}`}>
    <span className="appearance-select-value" aria-hidden="true">{options.find((option) => option.value === value)?.label}</span>
    {icon && <span className="appearance-select-icon" aria-hidden="true">{icon}</span>}
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    <ChevronDown size={16} aria-hidden="true" />
  </span>;
}

function Segments({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  const name = useId();
  return <div className="appearance-segments" role="radiogroup" aria-label={label}>
    {options.map((option) => <label key={option.value} className={value === option.value ? "is-selected" : ""}>
      <input type="radio" name={name} value={option.value} aria-label={option.label} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </div>;
}

function FontSizeControl({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid = draft !== "" && Number.isInteger(Number(draft)) && Number(draft) >= min && Number(draft) <= max;
  return <label className="appearance-font-size">
    <input aria-label={label} type="number" min={min} max={max} step={1} value={draft} aria-invalid={!valid} title={`${min}–${max} px`} onChange={(event) => {
      const raw = event.target.value;
      setDraft(raw);
      const next = Number(raw);
      if (raw && Number.isInteger(next) && next >= min && next <= max) onChange(next);
    }} onBlur={() => { if (!valid) setDraft(String(value)); }} />
    <span>px</span>
  </label>;
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  function commit() {
    const normalized = normalizeHexColor(draft);
    if (normalized) { onChange(normalized); setDraft(normalized); setInvalid(false); }
    else setInvalid(true);
  }
  return <div className="appearance-color-field">
    <div className="appearance-color-control" data-invalid={invalid}>
      <input className="appearance-color-picker" type="color" aria-label={`${label}颜色选择器`} value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      <input className="appearance-hex-input" aria-label={`${label}颜色`} spellCheck={false} maxLength={7} value={draft} aria-invalid={invalid} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { setDraft(value); setInvalid(false); } }} />
    </div>
    {invalid && <span className="appearance-color-error" role="alert">请输入 #RRGGBB 格式的颜色</span>}
  </div>;
}
