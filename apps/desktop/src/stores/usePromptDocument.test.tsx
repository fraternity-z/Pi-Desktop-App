import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPromptDocument, savePromptDocument } from "../ipc/settings";
import { usePromptDocument } from "./usePromptDocument";

vi.mock("../ipc/settings", () => ({ getPromptDocument: vi.fn(), savePromptDocument: vi.fn() }));

describe("usePromptDocument", () => {
  beforeEach(() => {
    vi.mocked(getPromptDocument)
      .mockReset()
      .mockResolvedValue({ path: "fixture/SYSTEM.md", content: "old" });
    vi.mocked(savePromptDocument)
      .mockReset()
      .mockImplementation(async (_kind, content) => ({ path: "fixture/SYSTEM.md", content }));
  });

  it("loads in StrictMode and saves with the original content for conflict checking", async () => {
    const { result } = renderHook(() => usePromptDocument("system"), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.document?.content).toBe("old"));
    act(() => result.current.setDraft("new"));
    expect(result.current.dirty).toBe(true);
    await act(() => result.current.save());
    expect(savePromptDocument).toHaveBeenCalledWith("system", "new", "old");
    expect(result.current.dirty).toBe(false);
    expect(result.current.status).toContain("已保存");
    await act(() => result.current.save(null));
    expect(savePromptDocument).toHaveBeenLastCalledWith("system", null, "new");
    expect(result.current.document?.content).toBeNull();
    expect(result.current.draft).toBe("");
  });

  it("preserves the draft after a conflict and reloads explicitly", async () => {
    vi.mocked(savePromptDocument).mockRejectedValue({
      code: "PROMPT_CONFLICT",
      message: "请重新加载",
    });
    const { result } = renderHook(() => usePromptDocument("append"));
    await waitFor(() => expect(result.current.document).not.toBeNull());
    act(() => result.current.setDraft("unsaved"));
    await act(() => result.current.save());
    expect(result.current.draft).toBe("unsaved");
    expect(result.current.error).toBe("PROMPT_CONFLICT: 请重新加载");
    expect(result.current.dirty).toBe(true);
    vi.mocked(getPromptDocument).mockResolvedValue({
      path: "fixture/APPEND_SYSTEM.md",
      content: "external",
    });
    await act(() => result.current.refresh());
    expect(result.current.draft).toBe("external");
    expect(result.current.error).toBeNull();
  });

  it("recovers from read failure without exposing raw exception text", async () => {
    vi.mocked(getPromptDocument).mockRejectedValueOnce(new Error("private exception payload"));
    const { result } = renderHook(() => usePromptDocument("system"));
    await waitFor(() => expect(result.current.error).toContain("PROMPT_REQUEST_FAILED"));
    expect(result.current.error).not.toContain("private exception");
    await act(() => result.current.save());
    expect(savePromptDocument).not.toHaveBeenCalled();
    await act(() => result.current.refresh());
    expect(result.current.document?.content).toBe("old");
  });

  it("ignores late reads after unmount and prevents duplicate saves", async () => {
    const { result, unmount } = renderHook(() => usePromptDocument("system"));
    await waitFor(() => expect(result.current.document).not.toBeNull());
    let resolveSave!: (value: { path: string; content: string }) => void;
    vi.mocked(savePromptDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.save("next");
    });
    await act(() => result.current.save("duplicate"));
    expect(savePromptDocument).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      resolveSave({ path: "fixture/SYSTEM.md", content: "next" });
      await saving;
    });
  });
});
