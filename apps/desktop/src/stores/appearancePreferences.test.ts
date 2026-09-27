import { beforeEach, describe, expect, it } from "vitest";
import {
  appearanceColors, appearanceProfilePatch, applyAppearanceColors, DEFAULT_APPEARANCE,
  DEFAULT_APPEARANCE_PROFILE, getAppearanceProfile, normalizeAppearanceConfiguration,
  normalizeAppearanceProfile, normalizeHexColor, presetProfile, separateAppearanceModesPatch,
} from "./appearancePreferences";
import { applyAppPreferences, DEFAULT_APP_PREFERENCES, normalizeAppPreferences } from "./useAppPreferences";

describe("appearance profiles", () => {
  beforeEach(() => document.documentElement.removeAttribute("style"));

  it.each([null, undefined, 32, [], "red"])("rejects invalid configuration %s", (value) => {
    expect(normalizeAppearanceConfiguration(value)).toEqual(DEFAULT_APPEARANCE);
  });

  it("normalizes hex colors and rejects CSS injection", () => {
    expect(normalizeHexColor(" #aabbcc " )).toBe("#AABBCC");
    for (const value of ["#FFF", "red", "url(file:///secret)", "#ffffff;display:none", null]) expect(normalizeHexColor(value)).toBeNull();
    expect(normalizeAppearanceProfile({ themeName: "x".repeat(41), contrast: 101, accentColor: "red", uiFont: "url(x)", contentFontStyle: "heavy" })).toEqual(DEFAULT_APPEARANCE_PROFILE);
    expect(normalizeAppearanceProfile({ contrast: 4.5 }).contrast).toBe(45);
    expect(normalizeAppearanceProfile({ contrast: NaN }).contrast).toBe(45);
  });

  it("validates and preserves all supported typography and color fields", () => {
    const profile = { ...DEFAULT_APPEARANCE_PROFILE, themePreset: "custom" as const, themeName: "我的配色",
      accentColor: "#AABBCC", backgroundColor: "#101010", foregroundColor: "#EFEFEF",
      uiFont: "microsoft-yahei" as const, uiFontStyle: "bold" as const, contentFont: "serif" as const,
      contentFontStyle: "medium" as const, codeFont: "consolas" as const, codeFontStyle: "bold" as const, contrast: 100 };
    const appearance = { profile, separateModes: true, lightProfile: profile, darkProfile: profile, diffIndicators: "symbols" as const, pointerCursor: true };
    expect(normalizeAppearanceConfiguration(appearance)).toEqual(appearance);
  });

  it("keeps shared font fields compatible with legacy settings", () => {
    const preferences = { ...DEFAULT_APP_PREFERENCES, uiFont: "noto-sans" as const };
    expect(getAppearanceProfile(preferences, "light").uiFont).toBe("noto-sans");
    expect(appearanceProfilePatch(preferences, "light", { codeFont: "consolas" })).toMatchObject({ codeFont: "consolas", uiFont: "noto-sans" });
  });

  it("isolates light and dark edits and preserves both when toggling separation", () => {
    let preferences = normalizeAppPreferences({ ...DEFAULT_APP_PREFERENCES, ...separateAppearanceModesPatch(DEFAULT_APP_PREFERENCES, "light", true) });
    preferences = normalizeAppPreferences({ ...preferences, ...appearanceProfilePatch(preferences, "dark", { backgroundColor: "#222233", uiFont: "noto-sans" }) });
    expect(getAppearanceProfile(preferences, "dark").backgroundColor).toBe("#222233");
    expect(getAppearanceProfile(preferences, "light").backgroundColor).toBeNull();
    const patch = separateAppearanceModesPatch(preferences, "dark", false);
    preferences = normalizeAppPreferences({ ...preferences, ...patch });
    expect(getAppearanceProfile(preferences, "light").uiFont).toBe("noto-sans");
    expect(getAppearanceProfile(preferences, "light").backgroundColor).toBe("#222233");
    preferences = normalizeAppPreferences({ ...preferences, ...separateAppearanceModesPatch(preferences, "light", true) });
    expect(getAppearanceProfile(preferences, "light").backgroundColor).toBeNull();
    expect(getAppearanceProfile(preferences, "dark").backgroundColor).toBe("#222233");
  });

  it.each(["chatgpt", "paper", "midnight"] as const)("applies %s tokens for both modes", (preset) => {
    const profile = presetProfile(preset);
    for (const mode of ["light", "dark"] as const) {
      const colors = appearanceColors(profile, mode);
      applyAppearanceColors(profile, mode, document.documentElement);
      expect(document.documentElement.style.getPropertyValue("--panel")).toBe(colors.background);
      expect(document.documentElement.style.getPropertyValue("--text")).toBe(colors.foreground);
    }
  });

  it.each([
    { mode: "light", profile: DEFAULT_APPEARANCE_PROFILE,
      surface: "#fcfdff", panel: "#fdfeff", raised: "#fdfeff", subtle: "#f5f7f9" },
    { mode: "dark", profile: DEFAULT_APPEARANCE_PROFILE,
      surface: "#191b1c", panel: "#191a1b", raised: "#222324", subtle: "#1e2023" },
    { mode: "light", profile: { ...DEFAULT_APPEARANCE_PROFILE,
      backgroundColor: "#FFFEEE", foregroundColor: "#112233", accentColor: "#008040" },
      surface: "#fbfceb", panel: "#fcfdec", raised: "#fcfdec", subtle: "#f4f7e6" },
    { mode: "dark", profile: { ...DEFAULT_APPEARANCE_PROFILE,
      backgroundColor: "#202020", foregroundColor: "#E0E0E0", accentColor: "#FF0000" },
      surface: "#232020", panel: "#222020", raised: "#2a2828", subtle: "#292424" },
  ] as const)("applies restrained $mode surface colors for $profile.accentColor", ({ mode, profile, surface, panel, raised, subtle }) => {
    const root = document.documentElement;
    const originalProfile = { ...profile };
    const { background, foreground } = appearanceColors(profile, mode);
    applyAppearanceColors(profile, mode, root);
    expect(root.style.getPropertyValue("--surface")).toBe(surface);
    expect(root.style.getPropertyValue("--surface-panel")).toBe(panel);
    expect(root.style.getPropertyValue("--surface-raised")).toBe(raised);
    expect(root.style.getPropertyValue("--surface-raised-translucent")).toBe(`${raised}F5`);
    expect(root.style.getPropertyValue("--surface-subtle")).toBe(subtle);
    for (const token of ["canvas", "panel", "composer", "input-bg"]) {
      expect(root.style.getPropertyValue(`--${token}`)).toBe(background);
    }
    for (const token of ["text", "code-text"]) {
      expect(root.style.getPropertyValue(`--${token}`)).toBe(foreground);
    }
    const expectedRoot = document.createElement("div");
    expectedRoot.style.backgroundColor = background;
    expectedRoot.style.color = foreground;
    expect(root.style.backgroundColor).toBe(expectedRoot.style.backgroundColor);
    expect(root.style.color).toBe(expectedRoot.style.color);
    expect(profile).toEqual(originalProfile);
  });

  it.each(["#000000", "#FFFFFF"])("keeps extreme accent %s subtle on custom backgrounds", (accentColor) => {
    const root = document.documentElement;
    const profile = { ...DEFAULT_APPEARANCE_PROFILE, backgroundColor: "#808080", accentColor };
    for (const mode of ["light", "dark"] as const) {
      applyAppearanceColors(profile, mode, root);
      for (const token of ["surface", "surface-panel"]) {
        const color = root.style.getPropertyValue(`--${token}`);
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        for (const offset of [1, 3, 5]) {
          expect(Math.abs(parseInt(color.slice(offset, offset + 2), 16) - 128)).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("restores surface colors and alpha without accumulating tint across repeated theme switches", () => {
    const root = document.documentElement;
    const darkProfile = { ...DEFAULT_APPEARANCE_PROFILE, backgroundColor: "#202020", accentColor: "#FF0000" };
    applyAppearanceColors(DEFAULT_APPEARANCE_PROFILE, "light", root);
    const lightStyles = root.style.cssText;
    applyAppearanceColors(darkProfile, "dark", root);
    const darkStyles = root.style.cssText;
    for (let count = 0; count < 3; count += 1) {
      applyAppearanceColors(DEFAULT_APPEARANCE_PROFILE, "light", root);
      expect(root.style.cssText).toBe(lightStyles);
      applyAppearanceColors(darkProfile, "dark", root);
      expect(root.style.cssText).toBe(darkStyles);
      expect(root.style.getPropertyValue("--surface-raised-translucent")).toMatch(/^#[0-9a-f]{6}F5$/);
    }
  });

  it("applies custom colors contrast font styles and interaction preferences globally", () => {
    const profile = { ...DEFAULT_APPEARANCE_PROFILE, themePreset: "custom" as const, backgroundColor: "#FFFEEE", foregroundColor: "#112233", accentColor: "#000000", contentFont: "serif" as const, uiFontStyle: "bold" as const, codeFontStyle: "medium" as const };
    applyAppPreferences({ ...DEFAULT_APP_PREFERENCES, appearance: { ...DEFAULT_APPEARANCE, profile, pointerCursor: true, diffIndicators: "symbols" } });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--app-ui-weight")).toBe("700");
    expect(root.style.getPropertyValue("--app-code-weight")).toBe("500");
    expect(root.style.getPropertyValue("--app-content-font")).toContain("serif");
    expect(root.dataset.pointerCursor).toBe("true");
    expect(root.dataset.diffIndicators).toBe("symbols");
    expect(root.style.getPropertyValue("--button-primary-text")).toBe("#FFFFFF");
    const oldLine = root.style.getPropertyValue("--line");
    applyAppearanceColors({ ...profile, contrast: 100, accentColor: "#FFFFFF" }, "dark", root);
    expect(root.style.getPropertyValue("--line")).not.toBe(oldLine);
    expect(root.style.getPropertyValue("--button-primary-text")).toBe("#1A1C1F");
    applyAppPreferences({ ...DEFAULT_APP_PREFERENCES, appearance: { ...DEFAULT_APPEARANCE, profile: { ...profile, contentFont: "noto-sans" } } });
    expect(root.style.getPropertyValue("--app-content-font")).toContain("Noto Sans");
  });
});
