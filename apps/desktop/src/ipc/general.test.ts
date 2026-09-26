import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import {
  DEFAULT_GENERAL_SETTINGS,
  getGeneralSettings,
  updateGeneralSettings,
} from "./general";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
it("uses typed general settings commands and propagates stable errors", async () => {
  const state = {
    settings: DEFAULT_GENERAL_SETTINGS,
    powerSupported: true,
    powerError: null,
  };
  vi.mocked(invoke).mockResolvedValue(state);
  expect(await getGeneralSettings()).toEqual(state);
  expect(invoke).toHaveBeenCalledWith("get_general_settings");
  expect(await updateGeneralSettings(DEFAULT_GENERAL_SETTINGS)).toEqual(state);
  expect(invoke).toHaveBeenCalledWith("update_general_settings", {
    settings: DEFAULT_GENERAL_SETTINGS,
  });
  vi.mocked(invoke).mockRejectedValueOnce({ code: "GENERAL_WRITE_FAILED" });
  await expect(updateGeneralSettings(DEFAULT_GENERAL_SETTINGS)).rejects.toEqual(
    { code: "GENERAL_WRITE_FAILED" },
  );
});
