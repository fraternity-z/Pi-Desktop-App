import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listWorkspaceEntries, type WorkspaceDirectoryPage } from "../ipc/workspace";
import { WorkspaceFilesPanel } from "./WorkspaceFilesPanel";

vi.mock("../ipc/workspace", () => ({ listWorkspaceEntries: vi.fn() }));
const folder = { name: "src", relativePath: "src", kind: "folder" as const };
const file = { name: "main.ts", relativePath: "src/main.ts", kind: "file" as const };
const props = () => ({ cwd: "C:/work", active: true, onOpenFile: vi.fn(), onSearch: vi.fn() });

describe("WorkspaceFilesPanel", () => {
  beforeEach(() => vi.mocked(listWorkspaceEntries).mockReset().mockResolvedValue({ entries: [], nextCursor: null }));

  it("filters cached descendants, shows empty results and clears without new requests", async () => {
    vi.mocked(listWorkspaceEntries).mockResolvedValueOnce({ entries: [folder, { name: "readme.md", relativePath: "readme.md", kind: "file" }], nextCursor: null }).mockResolvedValueOnce({ entries: [file], nextCursor: null });
    render(<WorkspaceFilesPanel {...props()} />);
    fireEvent.click(await screen.findByRole("treeitem", { name: "src" }));
    await screen.findByRole("treeitem", { name: "main.ts" });
    fireEvent.click(screen.getByRole("treeitem", { name: "src" }));
    fireEvent.change(screen.getByRole("textbox", { name: "筛选文件" }), { target: { value: "MAIN" } });
    expect(screen.getByRole("treeitem", { name: "main.ts" })).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "readme.md" })).not.toBeInTheDocument();
    expect(screen.getByText("仅筛选已加载的文件与目录")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "筛选文件" }), { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的已加载文件");
    fireEvent.click(screen.getByRole("button", { name: "清除文件筛选" }));
    expect(screen.getByRole("treeitem", { name: "readme.md" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "src" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("仅筛选已加载的文件与目录")).not.toBeInTheDocument();
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2);
  });

  it("keeps one initial request under StrictMode and rejects responses preceding refresh", async () => {
    let finish!: (value: WorkspaceDirectoryPage) => void;
    vi.mocked(listWorkspaceEntries).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ entries: [folder], nextCursor: null });
    render(<StrictMode><WorkspaceFilesPanel {...props()} /></StrictMode>);
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "刷新文件列表" }));
    expect(await screen.findByRole("treeitem", { name: "src" })).toBeInTheDocument();
    await act(async () => finish({ entries: [], nextCursor: null }));
    expect(screen.getByRole("treeitem", { name: "src" })).toBeInTheDocument();
  });

  it("navigates visible rows and expands or collapses with arrow keys", async () => {
    vi.mocked(listWorkspaceEntries).mockResolvedValueOnce({ entries: [folder, { name: "z.txt", relativePath: "z.txt", kind: "file" }], nextCursor: null }).mockResolvedValueOnce({ entries: [file], nextCursor: null });
    render(<WorkspaceFilesPanel {...props()} />);
    const src = await screen.findByRole("treeitem", { name: "src" });
    act(() => src.focus());
    fireEvent.keyDown(src, { key: "ArrowRight" });
    const child = await screen.findByRole("treeitem", { name: "main.ts" });
    fireEvent.keyDown(src, { key: "ArrowRight" });
    expect(child).toHaveFocus();
    fireEvent.keyDown(child, { key: "ArrowLeft" });
    expect(src).toHaveFocus();
    fireEvent.keyDown(src, { key: "ArrowLeft" });
    expect(screen.queryByRole("treeitem", { name: "main.ts" })).not.toBeInTheDocument();
    fireEvent.keyDown(src, { key: "End" });
    const last = screen.getByRole("treeitem", { name: "z.txt" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(src).toHaveFocus();
    fireEvent.keyDown(src, { key: "ArrowDown" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowUp" });
    expect(src).toHaveFocus();
  });

  it("loads only active roots and caches expanded directories between tab switches", async () => {
    vi.mocked(listWorkspaceEntries).mockResolvedValueOnce({ entries: [folder], nextCursor: null }).mockResolvedValueOnce({ entries: [file], nextCursor: null });
    const input = props();
    const { rerender } = render(<WorkspaceFilesPanel {...input} active={false} />);
    expect(listWorkspaceEntries).not.toHaveBeenCalled();
    rerender(<WorkspaceFilesPanel {...input} />);
    fireEvent.click(await screen.findByRole("treeitem", { name: "src" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "main.ts" }));
    expect(input.onOpenFile).toHaveBeenCalledWith({ path: "C:/work/src/main.ts" });
    fireEvent.click(screen.getByRole("treeitem", { name: "src" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "src" }));
    rerender(<WorkspaceFilesPanel {...input} active={false} />);
    rerender(<WorkspaceFilesPanel {...input} />);
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "搜索工作区文件" }));
    expect(input.onSearch).toHaveBeenCalledOnce();
  });

  it("keeps a reachable tab stop after collapsing or removing the focused row", async () => {
    vi.mocked(listWorkspaceEntries).mockResolvedValueOnce({ entries: [folder], nextCursor: null }).mockResolvedValueOnce({ entries: [file], nextCursor: null }).mockResolvedValueOnce({ entries: [{ name: "new.ts", relativePath: "new.ts", kind: "file" }], nextCursor: null });
    render(<WorkspaceFilesPanel {...props()} />);
    const src = await screen.findByRole("treeitem", { name: "src" });
    fireEvent.click(src);
    const child = await screen.findByRole("treeitem", { name: "main.ts" });
    act(() => child.focus());
    fireEvent.click(src);
    expect(src).toHaveAttribute("tabindex", "0");
    fireEvent.click(screen.getByRole("button", { name: "刷新文件列表" }));
    expect(await screen.findByRole("treeitem", { name: "new.ts" })).toHaveAttribute("tabindex", "0");
  });

  it("defers selected file ancestor requests while inactive", async () => {
    vi.mocked(listWorkspaceEntries).mockResolvedValueOnce({ entries: [folder], nextCursor: null }).mockResolvedValueOnce({ entries: [file], nextCursor: null });
    const input = { ...props(), selectedPath: "C:/work/src/main.ts" };
    const { rerender } = render(<WorkspaceFilesPanel {...input} active={false} />);
    expect(listWorkspaceEntries).not.toHaveBeenCalled();
    rerender(<WorkspaceFilesPanel {...input} />);
    expect(await screen.findByRole("treeitem", { name: "main.ts" })).toBeInTheDocument();
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2);
  });

  it("appends pages, retries errors and refreshes cached entries", async () => {
    vi.mocked(listWorkspaceEntries).mockResolvedValueOnce({ entries: [folder], nextCursor: "0:src" }).mockRejectedValueOnce(new Error("retry me")).mockResolvedValueOnce({ entries: [{ name: "readme.md", relativePath: "readme.md", kind: "file" }], nextCursor: null });
    render(<WorkspaceFilesPanel {...props()} />);
    fireEvent.click(await screen.findByRole("button", { name: "加载更多文件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("retry me");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("treeitem", { name: "readme.md" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "src" })).toBeInTheDocument();
    expect(listWorkspaceEntries).toHaveBeenLastCalledWith("C:/work", "", "0:src");
    fireEvent.click(screen.getByRole("button", { name: "刷新文件列表" }));
    await screen.findByText("空文件夹");
    expect(screen.queryByRole("treeitem", { name: "src" })).not.toBeInTheDocument();
  });

  it("ignores stale workspace responses and expands a selected file's ancestors", async () => {
    let resolveOld!: (page: WorkspaceDirectoryPage) => void;
    vi.mocked(listWorkspaceEntries).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce({ entries: [folder], nextCursor: null }).mockResolvedValueOnce({ entries: [file], nextCursor: null });
    const input = props();
    const { rerender } = render(<WorkspaceFilesPanel {...input} />);
    rerender(<WorkspaceFilesPanel {...input} cwd="C:/other" selectedPath="C:/other/src/main.ts" />);
    expect(await screen.findByRole("treeitem", { name: "main.ts" })).toHaveAttribute("aria-selected", "true");
    await act(async () => resolveOld({ entries: [{ name: "stale.txt", relativePath: "stale.txt", kind: "file" }], nextCursor: null }));
    expect(screen.queryByText("stale.txt")).not.toBeInTheDocument();
    await waitFor(() => expect(listWorkspaceEntries).toHaveBeenCalledTimes(3));
  });
});
