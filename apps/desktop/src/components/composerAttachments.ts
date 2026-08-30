export const MAX_COMPOSER_ATTACHMENTS = 12;
const PROMPT_IMAGE_EXTENSION = /\.(?:gif|jpe?g|png|webp)$/i;

export function normalizeAttachedPaths(paths: string[]): string[] {
  const selected: string[] = [];
  const keys = new Set<string>();
  for (const candidate of paths) {
    const path = candidate.trim();
    if (!path) continue;
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const key = /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
      ? normalized.toLocaleLowerCase("en-US")
      : normalized;
    if (keys.has(key)) continue;
    keys.add(key);
    selected.push(path);
    if (selected.length >= MAX_COMPOSER_ATTACHMENTS) break;
  }
  return selected;
}

export function promptWithAttachedPaths(message: string, paths: string[]): string {
  const attachedPaths = normalizeAttachedPaths(paths);
  if (attachedPaths.length === 0) return message;
  const rows = attachedPaths.map((path) => `  <path>${escapeXml(path)}</path>`).join("\n");
  return `${message}\n\n<attached-paths>\n${rows}\n</attached-paths>`;
}

export function isPromptImagePath(path: string): boolean {
  return PROMPT_IMAGE_EXTENSION.test(path.trim());
}

export function promptImagePaths(paths: string[]): string[] {
  return normalizeAttachedPaths(paths).filter(isPromptImagePath);
}

export function displayPromptContent(content: string): string {
  const marker = "\n\n<attached-paths>\n";
  const markerIndex = content.lastIndexOf(marker);
  if (markerIndex < 0 || !content.endsWith("\n</attached-paths>")) return content;
  return content.slice(0, markerIndex);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
