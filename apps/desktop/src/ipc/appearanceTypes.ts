export type FontStylePreference = "normal" | "medium" | "bold";
export type ContentFontPreference = "inherit" | "system" | "microsoft-yahei" | "noto-sans" | "serif";
export type ColorThemePreset = "chatgpt" | "paper" | "midnight" | "custom";

export interface AppearanceProfile {
  themePreset: ColorThemePreset;
  themeName: string;
  accentColor: string;
  backgroundColor: string | null;
  foregroundColor: string | null;
  uiFont: "system" | "microsoft-yahei" | "noto-sans";
  uiFontStyle: FontStylePreference;
  contentFont: ContentFontPreference;
  contentFontStyle: FontStylePreference;
  codeFont: "system" | "cascadia-code" | "consolas";
  codeFontStyle: FontStylePreference;
  contrast: number;
}

export interface AppearanceConfiguration {
  profile: AppearanceProfile;
  separateModes: boolean;
  lightProfile: AppearanceProfile | null;
  darkProfile: AppearanceProfile | null;
  diffIndicators: "color" | "symbols";
  pointerCursor: boolean;
}
