export type RightPanelPreviewKind = "image" | "markdown" | "text" | "document";

export interface RightPanelFileTarget {
  readonly path: string;
  readonly name: string;
  readonly extension: string;
  readonly tab: "file" | "preview";
  readonly previewKind: RightPanelPreviewKind | null;
}

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const TEXT_PREVIEW_EXTENSIONS = new Set(["csv", "txt"]);
const DOCUMENT_EXTENSIONS = new Set([
  "doc",
  "docx",
  "odp",
  "ods",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "xls",
  "xlsx",
]);

export function getFileName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function getFileExtension(path: string): string {
  const name = getFileName(path.split(/[?#]/, 1)[0] ?? path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function getPreviewKind(extension: string): RightPanelPreviewKind | null {
  const normalized = extension.toLowerCase();
  if (IMAGE_EXTENSIONS.has(normalized)) return "image";
  if (MARKDOWN_EXTENSIONS.has(normalized)) return "markdown";
  if (TEXT_PREVIEW_EXTENSIONS.has(normalized)) return "text";
  if (DOCUMENT_EXTENSIONS.has(normalized)) return "document";
  return null;
}

export function createRightPanelFileTarget(path: string): RightPanelFileTarget {
  const extension = getFileExtension(path);
  const previewKind = getPreviewKind(extension);
  return {
    path,
    name: getFileName(path),
    extension,
    tab: previewKind === null ? "file" : "preview",
    previewKind,
  };
}

export function decodeBase64Bytes(dataBase64: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(dataBase64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(dataBase64, "base64"));
  }
  throw new Error("WORKSPACE_FILE_DECODE_FAILED: 当前环境不支持解码文件内容");
}

export function decodeBase64Utf8(dataBase64: string): string {
  return new TextDecoder().decode(decodeBase64Bytes(dataBase64));
}

export function getImageMimeType(extension: string): string {
  const normalized = extension.toLowerCase();
  if (normalized === "svg") return "image/svg+xml";
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "png") return "image/png";
  if (normalized === "gif") return "image/gif";
  if (normalized === "webp") return "image/webp";
  if (normalized === "avif") return "image/avif";
  if (normalized === "bmp") return "image/bmp";
  return "application/octet-stream";
}

export function formatRightPanelError(error: unknown, fallbackCode: string, fallbackMessage: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return `${fallbackCode}: ${fallbackMessage}`;
}
