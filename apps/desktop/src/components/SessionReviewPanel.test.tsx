import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionReview, listSessionReviews, rollbackSessionReview, type SessionReviewPage, type SessionReviewSummary } from "../ipc/sessionReview";
import { listenToAgentEvents } from "../ipc/agent";
import { SessionReviewPanel } from "./SessionReviewPanel";
vi.mock("../ipc/sessionReview", () => ({ getSessionReview: vi.fn(), listSessionReviews: vi.fn(), rollbackSessionReview: vi.fn() }));
vi.mock("../ipc/agent", () => ({ listenToAgentEvents: vi.fn() }));
const entry: SessionReviewSummary = { id: "12345678-1234-1234-1234-123456789abc", toolCallId: "tool-1", path: "src/main.ts", kind: "modified", status: "ready", additions: 1, deletions: 1, createdAt: "2026-09-27T01:00:00.000Z" };
const detail = { ...entry, beforeText: "old\n", afterText: "new\n", diff: "@@ -1 +1 @@\n-old\n+new\n", diffTruncated: false };
const props = () => ({ sessionId: "s-1", cwd: "C:/work", active: true, onOpenFile: vi.fn(), onChanged: vi.fn() });
describe("SessionReviewPanel", () => {
  beforeEach(() => {
    vi.mocked(listSessionReviews).mockReset().mockResolvedValue({ entries: [entry], nextCursor: null, truncated: false });
    vi.mocked(getSessionReview).mockReset().mockResolvedValue(detail);
    vi.mocked(rollbackSessionReview).mockReset().mockResolvedValue({ ...entry, status: "rolled-back" });
    vi.mocked(listenToAgentEvents).mockReset().mockResolvedValue(vi.fn());
  });
  it("loads only active lists and expanded differences", async () => {
    const p = props(); const { rerender } = render(<SessionReviewPanel {...p} active={false} />);
    expect(listSessionReviews).not.toHaveBeenCalled(); rerender(<SessionReviewPanel {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: /src\/main.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "打开文件" }));
    expect(p.onOpenFile).toHaveBeenCalledWith("C:/work/src/main.ts"); expect(getSessionReview).toHaveBeenCalledTimes(1);
  });
  it("requires explicit rollback confirmation and updates state", async () => {
    const p = props(); render(<SessionReviewPanel {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: /src\/main.ts/ }));
    fireEvent.click(await screen.findByRole("button", { name: "回滚此修改" }));
    expect(rollbackSessionReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认回滚" }));
    await screen.findByText("已回滚"); expect(p.onChanged).toHaveBeenCalledOnce();
    expect(rollbackSessionReview).toHaveBeenCalledWith("s-1", "C:/work", entry.id);
  });
  it("retains loaded detail through hide and collapse and invalidates changed summaries", async () => {
    const p = props(); const { rerender } = render(<SessionReviewPanel {...p} />);
    const heading = await screen.findByRole("button", { name: /src\/main.ts/ });
    fireEvent.click(heading);
    await screen.findByRole("table");
    rerender(<SessionReviewPanel {...p} active={false} />);
    rerender(<SessionReviewPanel {...p} />);
    fireEvent.click(heading); fireEvent.click(heading);
    expect(getSessionReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "刷新会话修改" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新会话修改" })).toBeEnabled());
    expect(getSessionReview).toHaveBeenCalledTimes(1);
    vi.mocked(listSessionReviews).mockResolvedValue({ entries: [{ ...entry, status: "conflict" }], nextCursor: null, truncated: false });
    vi.mocked(getSessionReview).mockResolvedValue({ ...detail, status: "conflict", diffTruncated: true });
    fireEvent.click(screen.getByRole("button", { name: "刷新会话修改" }));
    await screen.findByText(/差异预览已简化或截断/);
    expect(getSessionReview).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "回滚此修改" })).toBeDisabled();
  });
  it("shows conflicts without reporting success and paginates large diffs", async () => {
    vi.mocked(getSessionReview).mockResolvedValue({ ...detail, diff: Array.from({ length: 601 }, (_, i) => `+line ${i}`).join("\n") });
    vi.mocked(rollbackSessionReview).mockRejectedValue({ code: "REVIEW_CONFLICT", message: "文件已被后续修改" });
    const p = props(); render(<SessionReviewPanel {...p} />);
    fireEvent.click(await screen.findByRole("button", { name: /src\/main.ts/ }));
    await screen.findByRole("table"); expect(screen.getAllByRole("row")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "下一页" })); expect(screen.getByText("2 / 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回滚此修改" })); fireEvent.click(screen.getByRole("button", { name: "确认回滚" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("文件已被后续修改"); expect(p.onChanged).not.toHaveBeenCalled();
  });
  it("ignores stale session results and handles empty lists", async () => {
    let old!: (page: SessionReviewPage) => void;
    vi.mocked(listSessionReviews).mockImplementationOnce(() => new Promise((resolve) => { old = resolve; })).mockResolvedValueOnce({ entries: [], nextCursor: null, truncated: false });
    const p = props(); const { rerender } = render(<SessionReviewPanel {...p} />); rerender(<SessionReviewPanel {...p} sessionId="s-2" />);
    await screen.findByText("暂无可用的会话修改记录");
    await act(async () => old({ entries: [entry], nextCursor: null, truncated: false }));
    expect(screen.queryByRole("button", { name: /src\/main.ts/ })).not.toBeInTheDocument();
  });
  it("retries failures and loads subsequent pages without duplicates", async () => {
    vi.mocked(listSessionReviews).mockRejectedValueOnce(new Error("retry")).mockResolvedValueOnce({ entries: [entry], nextCursor: entry.id, truncated: true }).mockResolvedValueOnce({ entries: [entry, { ...entry, id: "22345678-1234-1234-1234-123456789abc", path: "second.ts", status: "binary" }], nextCursor: null, truncated: true });
    render(<SessionReviewPanel {...props()} />); fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    fireEvent.click(await screen.findByRole("button", { name: "加载更多修改" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(screen.getByText("仅保留当前分支最近 256 条记录。")).toBeInTheDocument();
  });
});
