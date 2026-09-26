import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  DEFAULT_GENERAL_SETTINGS,
  getGeneralSettings,
  updateGeneralSettings,
  type GeneralSettingsState,
} from "../ipc/general";
import { useGeneralSettings } from "./useGeneralSettings";
vi.mock("../ipc/general", async (original) => ({
  ...(await original<typeof import("../ipc/general")>()),
  getGeneralSettings: vi.fn(),
  updateGeneralSettings: vi.fn(),
}));
const state: GeneralSettingsState = {
  settings: DEFAULT_GENERAL_SETTINGS,
  powerSupported: true,
  powerError: null,
};
beforeEach(() => {
  vi.mocked(getGeneralSettings).mockReset().mockResolvedValue(state);
  vi.mocked(updateGeneralSettings)
    .mockReset()
    .mockImplementation(async (settings) => ({ ...state, settings }));
});
it("handles StrictMode and ignores duplicate writes and completion after unmount", async () => {
  const { result, unmount } = renderHook(useGeneralSettings, {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(result.current.busy).toBe(false));
  let resolve!: (state: GeneralSettingsState) => void;
  vi.mocked(updateGeneralSettings).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  let saving: Promise<void> | null = null;
  act(() => {
    saving = result.current.update({ keepAwakeWhileRunning: true });
  });
  await act(async () => {
    await result.current.update({ preventScreenSleep: true });
    await result.current.refresh();
  });
  expect(updateGeneralSettings).toHaveBeenCalledOnce();
  unmount();
  await act(async () => {
    resolve(state);
    await saving;
  });
});
it.each(["POWER_APPLY_FAILED", "POWER_ROLLBACK_FAILED"])(
  "sanitizes %s while preserving the saved state",
  async (code) => {
    const { result } = renderHook(useGeneralSettings);
    await waitFor(() => expect(result.current.busy).toBe(false));
    vi.mocked(updateGeneralSettings).mockRejectedValueOnce({
      code,
      message: "private token",
    });
    await act(async () => {
      await result.current.update({ preventScreenSleep: true });
    });
    expect(result.current.state).toEqual(state);
    expect(result.current.error).toContain(
      code === "POWER_ROLLBACK_FAILED" ? "请重启应用" : "原配置保留",
    );
    expect(result.current.error).not.toContain("private token");
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
  },
);
it("ignores late read errors after unmount", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(getGeneralSettings).mockReturnValueOnce(
    new Promise((_resolve, r) => {
      reject = r;
    }),
  );
  const { unmount } = renderHook(useGeneralSettings);
  unmount();
  await act(async () => {
    reject(Error("fixture"));
  });
});
