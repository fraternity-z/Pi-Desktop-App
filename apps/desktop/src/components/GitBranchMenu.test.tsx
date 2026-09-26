import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GitBranchesState } from "../stores/useGitBranches";
import { GitBranchMenu } from "./GitBranchMenu";

function state(overrides: Partial<GitBranchesState> = {}): GitBranchesState {
  return {
    branchName: "main", isRepository: true, loading: false, busy: false, error: null,
    branches: [
      { name: "main", current: true, remote: false },
      { name: "feature/local", current: false, remote: false },
      { name: "origin/feature/remote", current: false, remote: true },
    ],
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(true),
    switchTo: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("GitBranchMenu", () => {
  it("supports arrow, Home and End navigation without selecting the current branch", () => {
    render(<GitBranchMenu state={state()} onClose={vi.fn()} />);
    const search = screen.getByRole("textbox", { name: "搜索分支" });
    fireEvent.keyDown(search, { key: "Home" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const create = screen.getByRole("menuitem", { name: "新建分支…" });
    expect(create).toHaveFocus();
    fireEvent.keyDown(create, { key: "ArrowDown" });
    const local = screen.getByRole("menuitemradio", { name: "feature/local" });
    expect(local).toHaveFocus();
    fireEvent.keyDown(local, { key: "End" });
    const remote = screen.getByRole("menuitemradio", { name: "origin/feature/remote" });
    expect(remote).toHaveFocus();
    fireEvent.keyDown(remote, { key: "ArrowUp" });
    expect(local).toHaveFocus();
    fireEvent.keyDown(local, { key: "Home" });
    expect(create).toHaveFocus();
  });

  it("shows grouped branches, marks the current branch and searches case-insensitively", () => {
    render(<GitBranchMenu state={state()} onClose={vi.fn()} />);
    expect(screen.getByRole("group", { name: "本地分支" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "远程分支" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /main/ })).toBeDisabled();
    expect(screen.getByRole("menuitemradio", { name: /main/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "搜索分支" })).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索分支" }), { target: { value: " LOCAL " } });
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索分支" }), { target: { value: "missing" } });
    expect(screen.getByText("没有匹配的分支")).toBeInTheDocument();
  });

  it.each(["feature/local", "origin/feature/remote"])("switches %s and closes only after success", async (name) => {
    const data = state();
    const close = vi.fn();
    render(<GitBranchMenu state={data} onClose={close} />);
    fireEvent.click(screen.getByRole("menuitemradio", { name }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(data.switchTo).toHaveBeenCalledWith(data.branches.find((branch) => branch.name === name));
  });

  it("keeps the menu open when switching fails", async () => {
    const data = state({ switchTo: vi.fn().mockResolvedValue(false), error: "不会强制覆盖你的改动" });
    const close = vi.fn();
    render(<GitBranchMenu state={data} onClose={close} />);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "feature/local" }));
    await waitFor(() => expect(data.switchTo).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("不会强制覆盖");
  });

  it("prefills a new branch from search and submits by Enter", async () => {
    const data = state();
    const close = vi.fn();
    render(<GitBranchMenu state={data} onClose={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索分支" }), { target: { value: "feature/new" } });
    fireEvent.click(screen.getByRole("menuitem", { name: "新建分支…" }));
    expect(screen.getByRole("textbox", { name: "分支名称" })).toHaveValue("feature/new");
    fireEvent.submit(screen.getByRole("textbox", { name: "分支名称" }).closest("form")!);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(data.create).toHaveBeenCalledWith("feature/new");
  });

  it("blocks empty and duplicate branch names and supports returning to the list", () => {
    const data = state();
    render(<GitBranchMenu state={data} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "新建分支…" }));
    const input = screen.getByRole("textbox", { name: "分支名称" });
    expect(screen.getByRole("button", { name: "创建并切换" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(data.create).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " main " } });
    expect(screen.getByRole("alert")).toHaveTextContent("已存在同名");
    expect(screen.getByRole("button", { name: "创建并切换" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: "搜索分支" })).toHaveFocus();
  });

  it("retains the typed name on create failure and locks actions while pending", async () => {
    const data = state({ create: vi.fn().mockResolvedValue(false) });
    const close = vi.fn();
    const { rerender } = render(<GitBranchMenu state={data} onClose={close} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "新建分支…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "分支名称" }), { target: { value: "feature/keep" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并切换" }));
    await waitFor(() => expect(data.create).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "分支名称" })).toHaveValue("feature/keep");
    rerender(<GitBranchMenu state={{ ...data, busy: true }} onClose={close} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在更新分支");
    expect(screen.getByRole("textbox", { name: "分支名称" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled();
  });

  it("renders loading and empty states and supports retry", () => {
    const data = state({ branches: [], loading: true });
    const { rerender } = render(<GitBranchMenu state={data} onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取分支");
    expect(screen.getByRole("button", { name: "刷新分支" })).toBeDisabled();
    rerender(<GitBranchMenu state={{ ...data, loading: false }} onClose={vi.fn()} />);
    expect(screen.getByText(/暂无已提交分支/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新分支" }));
    expect(data.refresh).toHaveBeenCalledOnce();
  });
});
