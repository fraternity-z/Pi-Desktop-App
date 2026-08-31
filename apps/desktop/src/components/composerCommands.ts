export type ComposerCommandSource = "builtin" | "extension" | "prompt" | "skill";

export interface ComposerCommand {
  name: string;
  description: string;
  source: ComposerCommandSource;
  argumentHint?: string;
}

export interface ComposerTrigger {
  kind: "slash";
  query: string;
  rangeStart: number;
  rangeEnd: number;
}

export interface ComposerCommandGroup {
  id: "command" | "skill";
  items: Array<{ command: ComposerCommand; flatIndex: number }>;
}

const BUILTIN_COMMANDS: readonly ComposerCommand[] = [
  { name: "new", description: "新建会话", source: "builtin" },
  { name: "model", description: "切换模型", source: "builtin", argumentHint: "<provider/model>" },
  { name: "settings", description: "打开设置", source: "builtin" },
  { name: "session", description: "打开会话列表", source: "builtin" },
  { name: "name", description: "设置当前会话名称", source: "builtin", argumentHint: "<名称>" },
  { name: "packages", description: "管理 Pi 插件", source: "builtin" },
  { name: "resources", description: "查看 Pi 资源", source: "builtin" },
  { name: "reload", description: "重新加载 Pi 运行时", source: "builtin" },
  { name: "hotkeys", description: "打开快捷键设置", source: "builtin" },
];

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

function isTriggerBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  return /[\s([{"'`]/u.test(text.charAt(index - 1));
}

/** 找到光标所在行、当前未完成的 slash token。 */
export function detectComposerTrigger(text: string, cursorInput = text.length): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  let slashStart = -1;
  for (let index = lineStart; index < cursor; index += 1) {
    if (text.charAt(index) === "/" && isTriggerBoundary(text, index)) slashStart = index;
  }
  if (slashStart < 0) return null;
  const region = text.slice(slashStart, cursor);
  const match = /^\/([^\s]*)$/.exec(region);
  const query = match?.[1];
  if (query === undefined || query.includes("/")) return null;
  return { kind: "slash", query, rangeStart: slashStart, rangeEnd: cursor };
}

export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(text.length, Math.floor(rangeStart)));
  const end = Math.max(start, Math.min(text.length, Math.floor(rangeEnd)));
  const next = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  return { text: next, cursor: start + replacement.length };
}

export function filterComposerCommands(
  commands: readonly ComposerCommand[],
  query: string,
  limit = 200,
): ComposerCommand[] {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  return commands
    .filter((command) => {
      if (!needle) return true;
      return (
        command.name.toLocaleLowerCase("zh-CN").includes(needle) ||
        command.description.toLocaleLowerCase("zh-CN").includes(needle)
      );
    })
    .sort((left, right) => {
      const leftName = left.name.toLocaleLowerCase("zh-CN");
      const rightName = right.name.toLocaleLowerCase("zh-CN");
      const leftPrefix = leftName.startsWith(needle) ? 0 : 1;
      const rightPrefix = rightName.startsWith(needle) ? 0 : 1;
      return leftPrefix - rightPrefix || leftName.localeCompare(rightName, "zh-CN");
    })
    .slice(0, Math.max(0, limit));
}

export function groupComposerCommands(commands: readonly ComposerCommand[]): ComposerCommandGroup[] {
  const buckets: Record<ComposerCommandGroup["id"], ComposerCommand[]> = {
    command: [],
    skill: [],
  };
  for (const command of commands) {
    const group = command.source === "skill" || command.name.startsWith("skill:") ? "skill" : "command";
    buckets[group].push(command);
  }
  let flatIndex = 0;
  return (["command", "skill"] as const).flatMap((id) => {
    if (buckets[id].length === 0) return [];
    return [{
      id,
      items: buckets[id].map((command) => ({ command, flatIndex: flatIndex++ })),
    }];
  });
}

export function composerCommandsFromGroups(groups: readonly ComposerCommandGroup[]): ComposerCommand[] {
  return groups.flatMap((group) => group.items.map((item) => item.command));
}

/** 将 Bridge 命令与桌面内置命令合并，大小写不敏感去重。 */
export function buildComposerCommandCatalog(
  runtimeCommands: readonly ComposerCommand[] = [],
): ComposerCommand[] {
  const merged: ComposerCommand[] = [];
  const names = new Set<string>();
  for (const command of [...runtimeCommands, ...BUILTIN_COMMANDS]) {
    const name = command.name.trim();
    if (!name || /[\s/\r\n\0]/u.test(name)) continue;
    const key = name.toLocaleLowerCase("en-US");
    if (names.has(key)) continue;
    names.add(key);
    merged.push({
      ...command,
      name,
      description: command.description.trim(),
      ...(command.argumentHint?.trim() ? { argumentHint: command.argumentHint.trim() } : {}),
    });
  }
  return merged;
}

export function parseSlashLine(value: string): { name: string; args: string } | undefined {
  const trimmed = value.trim();
  if (trimmed.includes("\n") || trimmed.includes("\r")) return undefined;
  const match = /^\/([^\s]+)(?:\s+(.+))?$/.exec(trimmed);
  if (!match) return undefined;
  return { name: match[1] ?? "", args: (match[2] ?? "").trim() };
}

export function slashToPromptText(name: string, args = ""): string {
  const body = args.trim();
  return body ? `/${name} ${body}` : `/${name}`;
}
