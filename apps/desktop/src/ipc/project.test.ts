import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectProjectDirectory } from "./project";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("selectProjectDirectory", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });

  it("通过原生资源管理器选择单个项目目录", async () => {
    vi.mocked(open).mockResolvedValue("C:\\projects\\pi-app");

    await expect(selectProjectDirectory()).resolves.toBe("C:\\projects\\pi-app");
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "选择项目文件夹",
    });
  });

  it("用户取消选择时返回 null", async () => {
    vi.mocked(open).mockResolvedValue(null);

    await expect(selectProjectDirectory()).resolves.toBeNull();
  });

  it("拒绝选择器返回的无效路径", async () => {
    vi.mocked(open).mockResolvedValue([] as never);

    await expect(selectProjectDirectory()).rejects.toEqual({
      code: "PROJECT_DIRECTORY_SELECTION_INVALID",
      message: "文件夹选择器返回了无效路径",
    });
  });

  it("将原生选择器失败映射为稳定错误", async () => {
    vi.mocked(open).mockRejectedValue(new Error("native dialog failed"));

    await expect(selectProjectDirectory()).rejects.toEqual({
      code: "PROJECT_DIRECTORY_SELECTION_FAILED",
      message: "无法打开资源管理器，请重试",
    });
  });
});
