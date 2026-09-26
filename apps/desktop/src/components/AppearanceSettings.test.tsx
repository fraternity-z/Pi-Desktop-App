import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportAppearanceTheme } from "../ipc/appearance";
import { APP_PREFERENCES_STORAGE_KEY, useAppPreferences } from "../stores/useAppPreferences";
import { AppearanceSettings } from "./AppearanceSettings";

vi.mock("../ipc/appearance", () => ({
  appearanceBackgroundUrl: vi.fn((path: string) => `asset://${path}`),
  exportAppearanceTheme: vi.fn(), importAppearanceTheme: vi.fn(), selectAppearanceBackground: vi.fn(),
}));

function Harness() {
  const { preferences, updatePreferences } = useAppPreferences();
  return <AppearanceSettings preferences={preferences} onChange={updatePreferences} sidebarWidth={300} onSidebarWidthChange={vi.fn()} />;
}

describe("appearance screenshot controls", () => {
  beforeEach(() => { window.localStorage.clear(); vi.clearAllMocks(); });

  it("renders all reference controls and collapses advanced settings", () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll(".appearance-card")).toHaveLength(5);
    expect(screen.getByRole("combobox", { name: "主题" })).toHaveValue("chatgpt");
    expect(screen.getByLabelText("背景颜色")).toHaveValue("#FFFFFF");
    expect(screen.getByLabelText("前景颜色")).toHaveValue("#1A1C1F");
    expect(screen.getByRole("slider", { name: "对比度" })).toHaveValue("45");
    expect(screen.getByRole("switch", { name: "半透明侧边栏" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "高级" }));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "高级" }));
    expect(screen.getByRole("slider")).toBeVisible();
  });

  it("edits colors through picker and hex input and rejects invalid values", () => {
    render(<Harness />);
    const background = screen.getByLabelText("背景颜色");
    fireEvent.change(background, { target: { value: "#abc123" } });
    fireEvent.keyDown(background, { key: "Enter" });
    expect(background).toHaveValue("#ABC123");
    expect(document.documentElement.style.getPropertyValue("--panel")).toBe("#ABC123");
    fireEvent.change(background, { target: { value: "invalid" } });
    fireEvent.blur(background);
    expect(screen.getByRole("alert")).toHaveTextContent("#RRGGBB");
    fireEvent.keyDown(background, { key: "Escape" });
    expect(background).toHaveValue("#ABC123");
    fireEvent.change(screen.getByLabelText("前景颜色选择器"), { target: { value: "#223344" } });
    expect(document.documentElement.style.getPropertyValue("--text")).toBe("#223344");
  });

  it("applies presets accent and copied theme immediately", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), { target: { value: "paper" } });
    expect(screen.getByLabelText("背景颜色")).toHaveValue("#FAF8F4");
    fireEvent.change(screen.getByRole("combobox", { name: "强调色" }), { target: { value: "#8B5CF6" } });
    expect(document.documentElement.style.getPropertyValue("--switch-active")).toBe("#8B5CF6");
    fireEvent.click(screen.getByRole("button", { name: "复制主题" }));
    expect(screen.getByRole("combobox", { name: "主题" })).toHaveValue("custom");
    expect(screen.getByRole("option", { name: "纸张 · 副本" })).toBeInTheDocument();
    expect(screen.getByLabelText("背景颜色")).toHaveValue("#FAF8F4");
    expect(screen.getByRole("status", { name: "外观设置反馈" })).toHaveTextContent("已复制");
  });

  it("applies fonts and styles independently", () => {
    render(<Harness />);
    for (const [label, value, token, expected] of [
      ["字体", "microsoft-yahei", "--app-ui-font", "Microsoft YaHei"],
      ["内容字体", "serif", "--app-content-font", "serif"],
      ["代码字体", "cascadia-code", "--app-code-font", "Cascadia Code"],
      ["界面字体样式", "bold", "--app-ui-weight", "700"],
      ["内容字体样式", "medium", "--app-content-weight", "500"],
      ["代码字体样式", "bold", "--app-code-weight", "700"],
    ]) {
      fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } });
      expect(document.documentElement.style.getPropertyValue(token)).toContain(expected);
    }
  });

  it("accepts valid numeric font sizes and restores empty or out of range input", () => {
    render(<Harness />);
    const size = screen.getByRole("spinbutton", { name: "界面字号" });
    fireEvent.change(size, { target: { value: "18" } });
    expect(document.documentElement.style.getPropertyValue("--app-ui-font-size")).toBe("18px");
    for (const invalid of ["", "0", "25", "12.5"]) {
      fireEvent.change(size, { target: { value: invalid } });
      expect(size).toHaveAttribute("aria-invalid", "true");
      fireEvent.blur(size);
      expect(size).toHaveValue(18);
    }
    fireEvent.change(screen.getByRole("spinbutton", { name: "代码字体大小" }), { target: { value: "24" } });
    expect(document.documentElement.style.getPropertyValue("--app-code-font-size")).toBe("24px");
  });

  it("isolates light and dark colors then persists changes across remounts", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("switch", { name: "分别设置浅色和深色模式" }));
    fireEvent.click(screen.getByRole("radio", { name: "深色" }));
    fireEvent.change(screen.getByLabelText("背景颜色选择器"), { target: { value: "#101020" } });
    fireEvent.click(screen.getByRole("radio", { name: "浅色" }));
    expect(screen.getByLabelText("背景颜色")).toHaveValue("#FFFFFF");
    fireEvent.click(screen.getByRole("radio", { name: "深色" }));
    expect(screen.getByLabelText("背景颜色")).toHaveValue("#101020");
    unmount();
    render(<Harness />);
    expect(screen.getByLabelText("背景颜色")).toHaveValue("#101020");
    fireEvent.click(screen.getByRole("switch", { name: "分别设置浅色和深色模式" }));
    expect(screen.queryByRole("radiogroup", { name: "外观模式" })).not.toBeInTheDocument();
  });

  it("switches motion diff markers pointer cursor translucency and contrast", () => {
    render(<Harness />);
    const motion = within(screen.getByRole("radiogroup", { name: "减少动态效果" }));
    fireEvent.click(motion.getByRole("radio", { name: "开启" }));
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    fireEvent.click(motion.getByRole("radio", { name: "关闭" }));
    expect(document.documentElement.dataset.reduceMotion).toBe("false");
    fireEvent.click(motion.getByRole("radio", { name: "系统" }));
    expect(JSON.parse(localStorage.getItem(APP_PREFERENCES_STORAGE_KEY)!).reduceMotion).toBe("system");
    fireEvent.click(screen.getByRole("radio", { name: "+/-" }));
    expect(document.documentElement.dataset.diffIndicators).toBe("symbols");
    fireEvent.click(screen.getByRole("switch", { name: "使用指针光标" }));
    expect(document.documentElement.dataset.pointerCursor).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "半透明侧边栏" }));
    expect(document.documentElement.dataset.sidebarTranslucent).toBe("false");
    fireEvent.change(screen.getByRole("slider", { name: "对比度" }), { target: { value: "80" } });
    expect(screen.getByLabelText("对比度数值")).toHaveTextContent("80");
  });

  it("exports all settings with busy feedback and handles errors without raw details", async () => {
    let resolve: (saved: boolean) => void = () => {};
    vi.mocked(exportAppearanceTheme).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "导出主题" }));
    expect(screen.getByRole("button", { name: "导出主题" })).toBeDisabled();
    expect(exportAppearanceTheme).toHaveBeenCalledWith(expect.objectContaining({ appearance: expect.objectContaining({ profile: expect.objectContaining({ contrast: 45 }) }), reduceMotion: "system" }));
    resolve(true);
    await waitFor(() => expect(screen.getByRole("status", { name: "外观设置反馈" })).toHaveTextContent("主题已导出"));
    vi.mocked(exportAppearanceTheme).mockRejectedValueOnce(new Error("private path"));
    fireEvent.click(screen.getByRole("button", { name: "导出主题" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("无法导出主题"));
    expect(screen.queryByText("private path")).not.toBeInTheDocument();
    vi.mocked(exportAppearanceTheme).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "导出主题" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "导出主题" })).not.toBeDisabled());
    expect(screen.queryByRole("status", { name: "外观设置反馈" })).not.toBeInTheDocument();
  });

  it("keeps library font controls synchronized with the active independent mode", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("switch", { name: "分别设置浅色和深色模式" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "界面字号" }), { target: { value: "24" } });
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), { target: { value: "manage" } });
    const library = within(screen.getByRole("dialog", { name: "管理主题与背景" }));
    expect(library.getByRole("combobox", { name: "UI 字号" })).toHaveValue("24");
    fireEvent.change(library.getByRole("combobox", { name: "UI 字体" }), { target: { value: "microsoft-yahei" } });
    fireEvent.change(library.getByRole("combobox", { name: "代码字体" }), { target: { value: "consolas" } });
    expect(document.documentElement.style.getPropertyValue("--app-ui-font")).toContain("Microsoft YaHei");
    expect(document.documentElement.style.getPropertyValue("--app-code-font")).toContain("Consolas");
    fireEvent.click(library.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("combobox", { name: "字体" })).toHaveValue("microsoft-yahei");
    fireEvent.click(screen.getByRole("radio", { name: "深色" }));
    expect(screen.getByRole("combobox", { name: "字体" })).toHaveValue("system");
  });

  it("keeps mode switching and legacy theme management available from theme menu", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), { target: { value: "mode:dark" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.change(screen.getByRole("combobox", { name: "主题" }), { target: { value: "manage" } });
    const dialog = screen.getByRole("dialog", { name: "管理主题与背景" });
    expect(within(dialog).getByRole("button", { name: "导入" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
