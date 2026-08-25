import { open } from "@tauri-apps/plugin-dialog";

export interface ProjectDirectorySelectionError {
  code:
    | "PROJECT_DIRECTORY_SELECTION_FAILED"
    | "PROJECT_DIRECTORY_SELECTION_INVALID"
    | "ATTACHMENT_SELECTION_FAILED"
    | "ATTACHMENT_SELECTION_INVALID";
  message: string;
}

export async function selectAttachmentFiles(): Promise<string[]> {
  let selected: unknown;
  try {
    selected = await open({
      directory: false,
      multiple: true,
      title: "添加文件",
    });
  } catch {
    throw selectionError("ATTACHMENT_SELECTION_FAILED", "无法打开文件选择器，请重试");
  }
  if (selected === null) return [];
  const paths = typeof selected === "string" ? [selected] : selected;
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || !path.trim())) {
    throw selectionError("ATTACHMENT_SELECTION_INVALID", "文件选择器返回了无效路径");
  }
  return paths;
}

export async function selectAttachmentDirectory(): Promise<string | null> {
  let selected: unknown;
  try {
    selected = await open({
      directory: true,
      multiple: false,
      title: "添加文件夹",
    });
  } catch {
    throw selectionError("ATTACHMENT_SELECTION_FAILED", "无法打开文件夹选择器，请重试");
  }
  if (selected === null) return null;
  if (typeof selected !== "string" || !selected.trim()) {
    throw selectionError("ATTACHMENT_SELECTION_INVALID", "文件夹选择器返回了无效路径");
  }
  return selected;
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
