import { open } from "@tauri-apps/plugin-dialog";

export interface ProjectDirectorySelectionError {
  code: "PROJECT_DIRECTORY_SELECTION_FAILED" | "PROJECT_DIRECTORY_SELECTION_INVALID";
  message: string;
}

export async function selectProjectDirectory(): Promise<string | null> {
  let selected: unknown;
  try {
    selected = await open({
      directory: true,
      multiple: false,
      title: "选择项目文件夹",
    });
  } catch {
    throw selectionError(
      "PROJECT_DIRECTORY_SELECTION_FAILED",
      "无法打开资源管理器，请重试",
    );
  }

  if (selected === null) {
    return null;
  }
  if (typeof selected !== "string" || selected.trim().length === 0) {
    throw selectionError(
      "PROJECT_DIRECTORY_SELECTION_INVALID",
      "文件夹选择器返回了无效路径",
    );
  }
  return selected;
}

function selectionError(
  code: ProjectDirectorySelectionError["code"],
  message: string,
): ProjectDirectorySelectionError {
  return { code, message };
}
