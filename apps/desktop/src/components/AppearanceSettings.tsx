import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import defaultThemePreview from "../assets/theme-default-preview.webp";
import elainaMoonlitCityBackground from "../assets/theme-elaina-moonlit-city.webp";
import elainaSpringMeadowBackground from "../assets/theme-elaina-spring-meadow.webp";
import {
  appearanceBackgroundUrl,
  exportAppearanceTheme,
  importAppearanceTheme,
  selectAppearanceBackground,
  type AppearanceThemeTransfer,
} from "../ipc/appearance";
import type {
  AppearancePreset,
  AppPreferences,
  CodeFontPreference,
  CodeFontSize,
  ThemePreference,
  UiFontPreference,
  UiFontSize,
  UiScale,
} from "../stores/useAppPreferences";
import { SettingsRow, SettingsSection, SettingsSelect, SettingsToggle } from "./SettingsControls";
import { SidebarDialogFrame } from "./SidebarDialog";

interface AppearanceSettingsProps {
  preferences: AppPreferences;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  onChange: (patch: Partial<AppPreferences>) => void;
}

interface ThemeCard {
  id: AppearancePreset;
  label: string;
  preview: string;
  accent: string;
}

const BUILT_IN_THEMES: ThemeCard[] = [
  {
    id: "default",
    label: "默认",
    preview: defaultThemePreview,
    accent: "#3d3d3d",
  },
  {
    id: "cyan-stage",
    label: "魔女伊雷娜 · 月夜旅途",
    preview: elainaMoonlitCityBackground,
    accent: "#8069d7",
  },
  {
    id: "rose-cinema",
    label: "魔女伊雷娜 · 花海日记",
    preview: elainaSpringMeadowBackground,
    accent: "#b582c5",
  },
];

export function AppearanceSettings({
  preferences,
  sidebarWidth,
  onSidebarWidthChange,
  onChange,
}: AppearanceSettingsProps) {
  const [previewPreset, setPreviewPreset] = useState<AppearancePreset>(
    preferences.backgroundPreset,
  );
  const [dialogMode, setDialogMode] = useState<"new" | "edit" | null>(null);
  const [busyAction, setBusyAction] = useState<"import" | "export" | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );
  const themeTrack = useRef<HTMLDivElement>(null);

  useEffect(() => setPreviewPreset(preferences.backgroundPreset), [preferences.backgroundPreset]);

  const customPreview = useMemo(() => {
    if (!preferences.customBackgroundPath) return null;
    try {
      return appearanceBackgroundUrl(preferences.customBackgroundPath);
    } catch {
      return null;
    }
  }, [preferences.customBackgroundPath]);

  const themeCards = useMemo(
    () => [
      ...BUILT_IN_THEMES,
      ...(customPreview
        ? [
            {
              id: "custom" as const,
              label: preferences.customThemeName,
              preview: customPreview,
              accent: "#6b8fd8",
            },
          ]
        : []),
    ],
    [customPreview, preferences.customThemeName],
  );

  useEffect(() => {
    const track = themeTrack.current;
    if (!track) return;

    const keepSelectedThemeVisible = () => {
      track
        .querySelector<HTMLElement>('[aria-pressed="true"]')
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };

    keepSelectedThemeVisible();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(keepSelectedThemeVisible);
    observer.observe(track);
    return () => observer.disconnect();
  }, [previewPreset, themeCards.length]);

  function applyPreview() {
    onChange({ backgroundPreset: previewPreset });
    setFeedback({ kind: "success", message: "外观主题已应用到整个软件" });
  }

  async function importTheme() {
    setBusyAction("import");
    setFeedback(null);
    try {
      const imported = await importAppearanceTheme();
      if (!imported) return;
      onChange({
        theme: imported.theme,
        backgroundPreset: imported.backgroundPreset,
        customBackgroundPath: imported.customBackgroundPath,
        customThemeName: imported.name,
        uiScale: imported.uiScale,
        uiFont: imported.uiFont,
        uiFontSize: imported.uiFontSize,
        codeFont: imported.codeFont,
        codeFontSize: imported.codeFontSize,
        sidebarTranslucent: imported.sidebarTranslucent,
      });
      onSidebarWidthChange(imported.sidebarWidth);
      setPreviewPreset(imported.backgroundPreset);
      setFeedback({ kind: "success", message: `已导入并应用“${imported.name}”` });
    } catch (cause) {
      setFeedback({ kind: "error", message: formatAppearanceError(cause) });
    } finally {
      setBusyAction(null);
    }
  }

  async function exportTheme() {
    const selected = themeCards.find((theme) => theme.id === previewPreset);
    setBusyAction("export");
    setFeedback(null);
    try {
      const exported = await exportAppearanceTheme({
        name: selected?.label ?? "外观主题",
        theme: preferences.theme,
        backgroundPreset: previewPreset,
        uiScale: preferences.uiScale,
        uiFont: preferences.uiFont,
        uiFontSize: preferences.uiFontSize,
        codeFont: preferences.codeFont,
        codeFontSize: preferences.codeFontSize,
        sidebarTranslucent: preferences.sidebarTranslucent,
        sidebarWidth,
        customBackgroundPath:
          previewPreset === "custom" ? preferences.customBackgroundPath : null,
      });
      if (exported) setFeedback({ kind: "success", message: "主题已导出" });
    } catch (cause) {
      setFeedback({ kind: "error", message: formatAppearanceError(cause) });
    } finally {
      setBusyAction(null);
    }
  }

  function scrollThemes(direction: -1 | 1) {
    themeTrack.current?.scrollBy({ left: direction * 260, behavior: "smooth" });
  }

  return (
    <>
      <SettingsSection label="主题">
        <SettingsRow
          title="主题"
          description="浅色、深色，或跟随系统"
          control={
            <SettingsSelect
              label="主题"
              value={preferences.theme}
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
              onChange={(value) => onChange({ theme: value as ThemePreference })}
            />
          }
          last
        />
      </SettingsSection>

      <section className="settings-section-block appearance-theme-section">
        <div className="settings-section-heading">
          <h2>主题皮肤</h2>
        </div>
        <div className="appearance-theme-browser">
          <button
            className="appearance-theme-arrow"
            type="button"
            aria-label="向前浏览主题"
            title="向前浏览"
            onClick={() => scrollThemes(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <div className="appearance-theme-track" ref={themeTrack}>
            {themeCards.map((theme) => {
              const previewing = theme.id === previewPreset;
              const applied = theme.id === preferences.backgroundPreset;
              return (
                <button
                  className="appearance-theme-card"
                  type="button"
                  key={theme.id}
                  aria-pressed={previewing}
                  aria-label={`预览主题：${theme.label}`}
                  onClick={() => {
                    setPreviewPreset(theme.id);
                    setFeedback(null);
                  }}
                >
                  <span className="appearance-theme-image-wrap">
                    <img src={theme.preview} alt="" />
                    <span className="appearance-theme-preview-panel" aria-hidden="true">
                      <span
                        className="appearance-theme-swatch"
                        style={{ background: theme.accent }}
                      />
                    </span>
                    {applied && (
                      <span className="appearance-theme-applied" title="当前已应用">
                        <Check size={13} />
                      </span>
                    )}
                  </span>
                  <strong>{theme.label}</strong>
                </button>
              );
            })}
          </div>
          <button
            className="appearance-theme-arrow"
            type="button"
            aria-label="向后浏览主题"
            title="向后浏览"
            onClick={() => scrollThemes(1)}
          >
            <ChevronRight size={18} />
          </button>
          <div className="appearance-theme-actions">
            <button type="button" onClick={() => setDialogMode("new")}>
              <Plus size={17} />
              新建主题
            </button>
            <button type="button" disabled={busyAction !== null} onClick={() => void importTheme()}>
              {busyAction === "import" ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
              导入
            </button>
            <button
              type="button"
              disabled={previewPreset !== "custom" || !customPreview}
              onClick={() => setDialogMode("edit")}
            >
              <Pencil size={17} />
              编辑
            </button>
            <button type="button" disabled={busyAction !== null} onClick={() => void exportTheme()}>
              {busyAction === "export" ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
              导出
            </button>
            {previewPreset !== preferences.backgroundPreset && (
              <button
                className="appearance-apply-button"
                type="button"
                onClick={applyPreview}
              >
                <Check size={17} />
                应用
              </button>
            )}
          </div>
        </div>
        {feedback && (
          <p className="appearance-feedback" data-kind={feedback.kind} role={feedback.kind === "error" ? "alert" : "status"}>
            {feedback.kind === "error" && <AlertTriangle size={14} />}
            {feedback.message}
          </p>
        )}
      </section>

      <SettingsSection label="应用整体缩放">
        <SettingsRow
          title="缩放比例"
          description="整体缩放界面密度与会话内容"
          control={
            <SettingsSelect
              label="缩放比例"
              value={String(preferences.uiScale)}
              options={[80, 90, 100, 110, 125].map((value) => ({
                value: String(value),
                label: `${value}%`,
              }))}
              onChange={(value) => onChange({ uiScale: Number(value) as UiScale })}
            />
          }
          last
        />
      </SettingsSection>

      <SettingsSection label="字体">
        <SettingsRow
          title="UI 字体"
          description="菜单、设置与会话正文使用的字体"
          control={
            <SettingsSelect
              label="UI 字体"
              value={preferences.uiFont}
              options={[
                { value: "system", label: "系统默认" },
                { value: "microsoft-yahei", label: "微软雅黑" },
                { value: "noto-sans", label: "思源黑体" },
              ]}
              onChange={(value) => onChange({ uiFont: value as UiFontPreference })}
            />
          }
        />
        <SettingsRow
          title="UI 字号"
          description="界面与会话正文字号"
          control={
            <SettingsSelect
              label="UI 字号"
              value={String(preferences.uiFontSize)}
              options={[12, 13, 14, 15, 16].map((value) => ({
                value: String(value),
                label: `${value}px`,
              }))}
              onChange={(value) => onChange({ uiFontSize: Number(value) as UiFontSize })}
            />
          }
        />
        <SettingsRow
          title="代码字体"
          description="Markdown 与工具输出中的代码字体"
          control={
            <SettingsSelect
              label="代码字体"
              value={preferences.codeFont}
              options={[
                { value: "system", label: "系统默认" },
                { value: "cascadia-code", label: "Cascadia Code" },
                { value: "consolas", label: "Consolas" },
              ]}
              onChange={(value) => onChange({ codeFont: value as CodeFontPreference })}
            />
          }
        />
        <SettingsRow
          title="代码字号"
          description="代码块字号"
          control={
            <SettingsSelect
              label="代码字号"
              value={String(preferences.codeFontSize)}
              options={[11, 12, 13, 14, 15].map((value) => ({
                value: String(value),
                label: `${value}px`,
              }))}
              onChange={(value) => onChange({ codeFontSize: Number(value) as CodeFontSize })}
            />
          }
          last
        />
      </SettingsSection>

      <SettingsSection label="侧边栏半透明">
        <SettingsRow
          title="侧边栏半透明"
          description="开启后侧栏使用系统磨砂效果；关闭则按主题实色显示"
          control={
            <SettingsToggle
              label="侧边栏半透明"
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

      {dialogMode && (
        <AppearanceThemeDialog
          mode={dialogMode}
          initialName={dialogMode === "edit" ? preferences.customThemeName : "我的主题"}
          initialPath={dialogMode === "edit" ? preferences.customBackgroundPath : null}
          onSave={(name, path) => {
            onChange({ customThemeName: name, customBackgroundPath: path });
            setPreviewPreset("custom");
            setDialogMode(null);
            setFeedback({ kind: "success", message: "主题已保存，可预览后应用" });
          }}
          onClose={() => setDialogMode(null)}
        />
      )}
    </>
  );
}

function AppearanceThemeDialog({
  mode,
  initialName,
  initialPath,
  onSave,
  onClose,
}: {
  mode: "new" | "edit";
  initialName: string;
  initialPath: string | null;
  onSave: (name: string, path: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [backgroundPath, setBackgroundPath] = useState(initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => {
    if (!backgroundPath) return null;
    try {
      return appearanceBackgroundUrl(backgroundPath);
    } catch {
      return null;
    }
  }, [backgroundPath]);

  async function chooseBackground() {
    setBusy(true);
    setError(null);
    try {
      const selected = await selectAppearanceBackground();
      if (selected) setBackgroundPath(selected.path);
    } catch (cause) {
      setError(formatAppearanceError(cause));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !backgroundPath || busy) return;
    onSave(name.trim(), backgroundPath);
  }

  return (
    <SidebarDialogFrame
      title={mode === "new" ? "新建主题" : "编辑主题"}
      description="选择一张图片并保存为自定义主题。"
      busy={busy}
      onClose={onClose}
    >
      <form className="sidebar-dialog-form appearance-theme-dialog" onSubmit={submit}>
        <label>
          <span>主题名称</span>
          <input
            value={name}
            maxLength={40}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="appearance-theme-dialog-picker">
          {preview ? (
            <img src={preview} alt="自定义主题背景预览" />
          ) : (
            <div className="appearance-theme-dialog-empty">
              <ImagePlus size={23} />
              <span>尚未选择背景图片</span>
            </div>
          )}
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void chooseBackground()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : preview ? <RefreshCw size={15} /> : <ImagePlus size={15} />}
            {preview ? "更换背景" : "选择图片"}
          </button>
        </div>
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
          <button className="primary-button" type="submit" disabled={busy || !name.trim() || !backgroundPath}>
            <Check size={15} />
            保存主题
          </button>
        </div>
      </form>
    </SidebarDialogFrame>
  );
}

function formatAppearanceError(cause: unknown): string {
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
  return "APPEARANCE_OPERATION_FAILED: 外观操作失败，请重试";
}
