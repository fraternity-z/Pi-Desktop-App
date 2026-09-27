/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { THINKING_LEVELS, type ThinkingLevel } from "../ipc/agent";
import { ComposerThinkingControl, thinkingLevelLabel } from "./ComposerThinkingControl";

const stylesheet = readFileSync(resolve(process.cwd(), "src/components/composer-model-picker.css"), "utf8");

function props() {
  return { modelName: "6-Astra Excel", level: "high" as ThinkingLevel, availableLevels: ["low", "medium", "high", "xhigh"] as ThinkingLevel[], disabled: false, loading: false, onSelectModel: vi.fn(), onChange: vi.fn() };
}

describe("ComposerThinkingControl", () => {
  it("模型卡片默认透明，只在鼠标悬停时显示加深底色", () => {
    const baseRule = stylesheet.match(/\.composer-model-popover \.composer-model-card \{([^}]+)\}/)?.[1];
    const hoverRule = stylesheet.match(/\.composer-menu\.composer-model-popover \.composer-model-card:not\(:disabled\):hover \{([^}]+)\}/)?.[1];
    expect(baseRule).toContain("background: transparent");
    expect(hoverRule).toContain("background: var(--composer-protrusion)");
    expect(stylesheet).not.toMatch(/\.composer-model-card[^{}]*:focus[^{}]*\{[^}]*background:/);
  });

  it("显示中文档位，并以真实可用档位等距分段", () => {
    const { container } = render(<ComposerThinkingControl {...props()} />);
    const slider = screen.getByRole("slider", { name: "思考强度" });
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "3");
    expect(slider).toHaveAttribute("step", "1");
    expect(slider).toHaveValue("2");
    expect(slider).toHaveAttribute("aria-valuetext", "高");
    expect(slider).toHaveFocus();
    expect(container.querySelectorAll(".composer-thinking-stops span")).toHaveLength(4);
    expect(THINKING_LEVELS.map(thinkingLevelLabel)).toEqual(["关闭", "最低", "低", "中", "高", "极高", "最高"]);
  });

  it("拖动时只预览，松开后仅提交一次，避免连续请求中断拖动", () => {
    const options = props();
    render(<ComposerThinkingControl {...options} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.change(slider, { target: { value: "3" } });
    expect(slider).toHaveAttribute("aria-valuetext", "极高");
    expect(screen.getByRole("button")).toHaveTextContent("极高");
    expect(options.onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(options.onChange).toHaveBeenCalledExactlyOnceWith("xhigh");
  });

  it.each(["ArrowRight", "ArrowLeft", "Home", "End"])("支持 %s 键盘提交和失焦提交", (key) => {
    const options = props();
    render(<ComposerThinkingControl {...options} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.keyUp(slider, { key: "Shift" });
    expect(options.onChange).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key });
    expect(options.onChange).toHaveBeenLastCalledWith("low");
    fireEvent.change(slider, { target: { value: "1" } });
    fireEvent.blur(slider);
    expect(options.onChange).toHaveBeenLastCalledWith("medium");
  });

  it("取消拖动恢复确认值；原值不重复提交", () => {
    const options = props();
    render(<ComposerThinkingControl {...options} />);
    const slider = screen.getByRole("slider");
    fireEvent.pointerUp(slider);
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.pointerCancel(slider);
    expect(slider).toHaveValue("2");
    fireEvent.blur(slider);
    expect(options.onChange).not.toHaveBeenCalled();
  });

  it("切换模型后重建档位，去重排序且不生成不支持的档位", () => {
    const options = props();
    const { rerender, container } = render(<ComposerThinkingControl {...options} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    rerender(<ComposerThinkingControl {...options} modelName="Other" level="medium" availableLevels={["max", "off", "medium", "medium"]} />);
    const slider = screen.getByRole("slider");
    expect(slider).toHaveValue("1");
    expect(slider).toHaveAttribute("max", "2");
    expect(container.querySelectorAll(".composer-thinking-stops span")).toHaveLength(3);
    fireEvent.change(slider, { target: { value: "2" } });
    fireEvent.pointerUp(slider);
    expect(options.onChange).toHaveBeenCalledExactlyOnceWith("max");
  });

  it("只有关闭档位时禁用滑杆，但仍允许切换模型", () => {
    const options = props();
    render(<ComposerThinkingControl {...options} level="off" availableLevels={["off"]} />);
    expect(screen.getByRole("slider")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(options.onSelectModel).toHaveBeenCalledOnce();
    expect(options.onChange).not.toHaveBeenCalled();
  });

  it("配置请求失败后恢复已确认的值，并允许再次尝试", () => {
    const options = props();
    const { rerender } = render(<ComposerThinkingControl {...options} />);
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider, { pointerId: 1 });
    fireEvent.change(slider, { target: { value: "3" } });
    fireEvent.pointerUp(slider);
    rerender(<ComposerThinkingControl {...options} saving />);
    expect(slider).toHaveValue("3");
    rerender(<ComposerThinkingControl {...options} />);
    expect(slider).toHaveValue("2");
    fireEvent.change(slider, { target: { value: "3" } });
    fireEvent.pointerUp(slider);
    expect(options.onChange).toHaveBeenCalledTimes(2);
  });

  it("保存时保持滑杆焦点和视觉状态，并拦截鼠标、键盘和失焦重复提交", () => {
    const options = props();
    const { rerender, container } = render(<ComposerThinkingControl {...options} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "3" } });
    fireEvent.pointerUp(slider);
    rerender(<ComposerThinkingControl {...options} saving />);
    expect(slider).toBeEnabled();
    expect(slider).toHaveFocus();
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(slider.parentElement).toHaveAttribute("data-disabled", "false");
    expect(container.firstChild).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button"));
    expect(options.onSelectModel).not.toHaveBeenCalled();
    expect(fireEvent.pointerDown(slider, { pointerId: 2 })).toBe(false);
    expect(fireEvent.keyDown(slider, { key: "ArrowLeft" })).toBe(false);
    expect(fireEvent.keyDown(slider, { key: "Tab" })).toBe(true);
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.pointerUp(slider);
    fireEvent.keyUp(slider, { key: "ArrowLeft" });
    fireEvent.blur(slider);
    fireEvent.pointerCancel(slider);
    expect(slider).toHaveValue("3");
    expect(options.onChange).toHaveBeenCalledExactlyOnceWith("xhigh");
    rerender(<ComposerThinkingControl {...options} level="xhigh" />);
    expect(slider).not.toHaveAttribute("aria-disabled");
    expect(slider).toHaveValue("3");
  });

  it("真正不可用时仍禁用模型按钮和滑杆", () => {
    const options = props();
    render(<ComposerThinkingControl {...options} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
    const slider = screen.getByRole("slider");
    expect(slider).toBeDisabled();
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.pointerUp(slider);
    expect(options.onChange).not.toHaveBeenCalled();
  });

  it("区分加载、无能力数据和草稿显示值，不伪造档位", () => {
    const options = props();
    const { rerender } = render(<ComposerThinkingControl {...options} availableLevels={undefined} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取思考强度");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    rerender(<ComposerThinkingControl {...options} availableLevels={[]} />);
    expect(screen.getByText("此模型未提供思考强度")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("高");
    rerender(<ComposerThinkingControl {...options} availableLevels={[]} level={null} />);
    expect(screen.getByRole("button")).toHaveTextContent("思考强度");
    rerender(<ComposerThinkingControl {...options} level={null} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "低");
  });
});
