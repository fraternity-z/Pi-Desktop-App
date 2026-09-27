import type { AppearanceConfiguration, AppearanceProfile, ColorThemePreset } from "../ipc/appearanceTypes";
import type { AppPreferences, ResolvedTheme } from "./useAppPreferences";

export type { AppearanceConfiguration, AppearanceProfile, ColorThemePreset } from "../ipc/appearanceTypes";

export const DEFAULT_APPEARANCE_PROFILE: AppearanceProfile = {
  themePreset: "chatgpt", themeName: "ChatGPT", accentColor: "default",
  backgroundColor: null, foregroundColor: null,
  uiFont: "system", uiFontStyle: "normal", contentFont: "inherit",
  contentFontStyle: "normal", codeFont: "system", codeFontStyle: "normal", contrast: 45,
};

export const DEFAULT_APPEARANCE: AppearanceConfiguration = {
  profile: DEFAULT_APPEARANCE_PROFILE, separateModes: false,
  lightProfile: null, darkProfile: null, diffIndicators: "color", pointerCursor: false,
};

const UI_FONTS = ["system", "microsoft-yahei", "noto-sans"] as const;
const FONT_STYLES = ["normal", "medium", "bold"] as const;

export function normalizeHexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toUpperCase() : null;
}

export function normalizeAppearanceProfile(value: unknown): AppearanceProfile {
  const input = record(value);
  const name = typeof input.themeName === "string" ? input.themeName.trim() : "";
  return {
    themePreset: choice(input.themePreset, ["chatgpt", "paper", "midnight", "custom"], "chatgpt"),
    themeName: name && name.length <= 40 ? name : "ChatGPT",
    accentColor: normalizeHexColor(input.accentColor) ?? "default",
    backgroundColor: normalizeHexColor(input.backgroundColor),
    foregroundColor: normalizeHexColor(input.foregroundColor),
    uiFont: choice(input.uiFont, UI_FONTS, "system"),
    uiFontStyle: choice(input.uiFontStyle, FONT_STYLES, "normal"),
    contentFont: choice(input.contentFont, ["inherit", ...UI_FONTS, "serif"], "inherit"),
    contentFontStyle: choice(input.contentFontStyle, FONT_STYLES, "normal"),
    codeFont: choice(input.codeFont, ["system", "cascadia-code", "consolas"], "system"),
    codeFontStyle: choice(input.codeFontStyle, FONT_STYLES, "normal"),
    contrast: typeof input.contrast === "number" && Number.isInteger(input.contrast)
      && input.contrast >= 0 && input.contrast <= 100 ? input.contrast : 45,
  };
}

export function normalizeAppearanceConfiguration(value: unknown): AppearanceConfiguration {
  const input = record(value);
  return {
    profile: normalizeAppearanceProfile(input.profile),
    separateModes: input.separateModes === true,
    lightProfile: input.lightProfile ? normalizeAppearanceProfile(input.lightProfile) : null,
    darkProfile: input.darkProfile ? normalizeAppearanceProfile(input.darkProfile) : null,
    diffIndicators: input.diffIndicators === "symbols" ? "symbols" : "color",
    pointerCursor: input.pointerCursor === true,
  };
}

export function getAppearanceProfile(preferences: AppPreferences, mode: ResolvedTheme): AppearanceProfile {
  const { appearance } = preferences;
  const override = mode === "dark" ? appearance.darkProfile : appearance.lightProfile;
  if (appearance.separateModes && override) return override;
  return { ...appearance.profile, uiFont: preferences.uiFont, codeFont: preferences.codeFont };
}

export function appearanceProfilePatch(
  preferences: AppPreferences, mode: ResolvedTheme, patch: Partial<AppearanceProfile>,
): Partial<AppPreferences> {
  const profile = normalizeAppearanceProfile({ ...getAppearanceProfile(preferences, mode), ...patch });
  return preferences.appearance.separateModes
    ? { appearance: { ...preferences.appearance, [mode === "dark" ? "darkProfile" : "lightProfile"]: profile } }
    : { uiFont: profile.uiFont, codeFont: profile.codeFont, appearance: { ...preferences.appearance, profile } };
}

export function separateAppearanceModesPatch(
  preferences: AppPreferences, mode: ResolvedTheme, enabled: boolean,
): Partial<AppPreferences> {
  const profile = getAppearanceProfile(preferences, mode);
  const appearance = preferences.appearance;
  return {
    uiFont: profile.uiFont, codeFont: profile.codeFont,
    appearance: {
      ...appearance, separateModes: enabled, profile,
      lightProfile: appearance.lightProfile ?? { ...profile },
      darkProfile: appearance.darkProfile ?? { ...profile },
    },
  };
}

export function presetProfile(preset: Exclude<ColorThemePreset, "custom">): AppearanceProfile {
  return {
    ...DEFAULT_APPEARANCE_PROFILE, themePreset: preset,
    themeName: { chatgpt: "ChatGPT", paper: "纸张", midnight: "午夜" }[preset],
  };
}

export function appearanceColors(profile: AppearanceProfile, mode: ResolvedTheme) {
  const dark = mode === "dark";
  const palettes = {
    chatgpt: dark ? ["#191919", "#F2F2F2"] : ["#FFFFFF", "#1A1C1F"],
    custom: dark ? ["#191919", "#F2F2F2"] : ["#FFFFFF", "#1A1C1F"],
    paper: dark ? ["#24211D", "#EDE7DC"] : ["#FAF8F4", "#35312B"],
    midnight: dark ? ["#141B2D", "#E3E9F5"] : ["#EEF2FA", "#202D49"],
  };
  const [background, foreground] = palettes[profile.themePreset];
  return {
    background: profile.backgroundColor ?? background,
    foreground: profile.foregroundColor ?? foreground,
    accent: profile.accentColor === "default" ? "#3291FF" : profile.accentColor,
  };
}

export function applyAppearanceColors(profile: AppearanceProfile, mode: ResolvedTheme, root: HTMLElement) {
  const { background, foreground, accent } = appearanceColors(profile, mode);
  const mix = (amount: number) => blendHex(background, foreground, amount);
  const surface = mix(0.025);
  const raisedSurface = blendHex(mode === "dark" ? mix(0.04) : background, accent, 0.01);
  const tokens: Record<string, string> = {
    canvas: background, panel: background, surface: blendHex(background, accent, 0.015),
    "surface-panel": blendHex(background, accent, 0.01),
    "surface-raised": raisedSurface, "surface-raised-translucent": `${raisedSurface}F5`,
    sidebar: surface, "surface-subtle": blendHex(surface, accent, 0.02), composer: background, "input-bg": background,
    "composer-protrusion": surface, "user-bubble": mix(0.055), "code-bg": surface,
    text: foreground, "code-text": foreground, muted: mix(0.65), subtle: mix(0.56),
    line: mix(0.05 + profile.contrast * 0.0008), "line-strong": mix(0.15 + profile.contrast * 0.002),
    "input-border": mix(0.05 + profile.contrast * 0.0008), "code-border": mix(0.09),
    "input-placeholder": mix(0.55), hover: mix(0.065), selected: mix(0.09),
    "button-secondary-bg": background, "button-secondary-hover": mix(0.07), "button-secondary-text": foreground,
    "button-primary-bg": profile.accentColor === "default" ? foreground : accent,
    "button-primary-hover": profile.accentColor === "default" ? mix(0.86) : blendHex(accent, foreground, 0.18),
    "button-primary-text": profile.accentColor === "default" ? background : readableText(accent),
    "sidebar-translucent": `${surface}DC`, "switch-bg": mix(0.1), "switch-border": mix(0.1),
    "switch-thumb": "#FFFFFF", "switch-active": accent, "switch-active-border": accent,
    "switch-active-thumb": "#FFFFFF", focus: accent, "appearance-accent": accent,
    link: profile.accentColor === "default" ? mode === "dark" ? "#85B7FB" : "#315F9E" : accent,
    "link-hover": profile.accentColor === "default" ? foreground : accent, scrollbar: mix(0.25),
  };
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--${key}`, value);
  root.style.color = foreground;
  root.style.backgroundColor = background;
}

function blendHex(from: string, to: string, amount: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const a = parseInt(from.slice(offset, offset + 2), 16);
    const b = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * amount).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function readableText(hex: string): string {
  const luminance = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.179 ? "#1A1C1F" : "#FFFFFF";
}

function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
