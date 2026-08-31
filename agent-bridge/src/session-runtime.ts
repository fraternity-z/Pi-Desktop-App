import { existsSync } from "node:fs";
import { readFile, realpath, stat, unlink } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, win32 } from "node:path";

import {
  MAX_COMMANDS,
  MAX_COMMAND_DESCRIPTION_CHARS,
  MAX_COMMAND_NAME_CHARS,
  MAX_SESSION_ID_CHARS,
  MAX_SESSION_IDS,
  THINKING_LEVELS,
  type SlashCommandSummary,
  type ModelSelection,
  type PromptStreamingBehavior,
  type ThinkingLevel,
} from "./protocol.js";
import {
  DEFAULT_REQUEST_HEADER_SETTINGS,
  createRequestHeaderExtension,
  type RequestHeaderExtensionFactory,
  type RequestHeaderSettings,
} from "./request-headers.js";
import {
  emitPerformanceDiagnostic,
  measurePerformance,
  measurePerformanceSync,
  performanceNow,
  type PerformanceDiagnosticSink,
} from "./performance.js";

export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export interface PiModelLike {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
  /**
   * Pi's model-level mapping is intentionally kept at the SDK boundary.
   * Omitted standard levels use the provider default; xhigh/max need an
   * explicit mapping, and null means the level is unsupported.
   */
  readonly thinkingLevelMap?: ThinkingLevelMap;
}

export interface PiModelRuntimeLike {
  getAvailable?(): Promise<PiModelLike[]>;
  getModels?(): PiModelLike[];
  getModel(provider: string, id: string): PiModelLike | undefined;
}

interface PiSessionManagerInstanceLike {
  getCwd?(): string;
}

export type PackageScope = "global" | "project";

export interface PackageSummary {
  source: string;
  scope: PackageScope;
  kind: "npm" | "git" | "local" | "unknown";
  installedPath?: string;
  filtered: boolean;
  enabled: boolean;
}

export interface PackageUpdateInfo {
  source: string;
  displayName: string;
  type: string;
  scope: PackageScope;
}

export interface ResourceSummary {
  kind: "extension" | "skill" | "prompt" | "theme" | "context" | "system";
  name: string;
  path: string;
  source?: string;
}

interface PiSettingsManagerLike {
  getGlobalSettings(): { packages?: unknown[] };
  getProjectSettings(): { packages?: unknown[] };
  setPackages(packages: unknown[]): void;
  setProjectPackages(packages: unknown[]): void;
}

interface PiPackageManagerLike {
  listConfiguredPackages(): Array<{
    source: string;
    scope: string;
    installedPath?: string;
    filtered: boolean;
  }>;
  installAndPersist(source: string, options: { local: boolean }): Promise<void>;
  removeAndPersist(source: string, options: { local: boolean }): Promise<boolean>;
  update(source?: string): Promise<void>;
  checkForAvailableUpdates(): Promise<
    Array<{ source: string; displayName: string; type: string; scope: string }>
  >;
}

interface PiResourceLoaderLike {
  reload(): Promise<void>;
  getExtensions?(): {
    extensions: Array<{ path: string; sourceInfo?: { source?: string } }>;
  };
  getSkills?(): {
    skills: Array<{
      name: string;
      description?: string;
      filePath: string;
      sourceInfo?: { source?: string };
    }>;
  };
  getPrompts?(): {
    prompts: Array<{
      name: string;
      description?: string;
      argumentHint?: string;
      filePath: string;
      sourceInfo?: { source?: string };
    }>;
  };
  getThemes?(): { themes: Array<{ name?: string; path?: string }> };
  getAgentsFiles?(): { agentsFiles: Array<{ path: string }> };
}

interface PiExtensionRunnerLike {
  getRegisteredCommands?(): unknown[];
}

interface PackageContext {
  manager: PiPackageManagerLike;
  settingsManager: PiSettingsManagerLike;
}

interface PiSessionInfoLike {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: Date | string;
  modified: Date | string;
  messageCount: number;
  firstMessage: string;
}

export interface PiSessionLike {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly isStreaming: boolean;
  readonly model?: PiModelLike;
  readonly thinkingLevel: ThinkingLevel;
  readonly messages: unknown[];
  readonly extensionRunner?: PiExtensionRunnerLike;
  readonly promptTemplates?: readonly unknown[];
  readonly resourceLoader?: PiResourceLoaderLike;
  prompt(
    text: string,
    options?: { streamingBehavior?: PromptStreamingBehavior; images?: PiImageContent[] },
  ): Promise<void>;
  clearQueue(): void;
  getSteeringMessages(): string[];
  getFollowUpMessages(): string[];
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  setModel(model: PiModelLike): Promise<void>;
  setThinkingLevel?(level: ThinkingLevel): void;
  getAvailableThinkingLevels?(): readonly ThinkingLevel[];
  getActiveToolNames?(): string[];
  getAllTools?(): PiToolLike[];
  getContextUsage?(): unknown;
  getSessionStats?(): unknown;
  setActiveToolsByName?(toolNames: string[]): void;
  reload?(): Promise<void>;
  dispose(): void;
}

export interface PiImageContent {
  type: "image";
  data: string;
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
}

interface PiToolLike {
  name: string;
  description?: string;
}

export interface PiSdkLike {
  ModelRuntime: {
    create(options?: { authPath?: string; modelsPath?: string }): Promise<PiModelRuntimeLike>;
  };
  SessionManager: {
    create(cwd: string): PiSessionManagerInstanceLike;
    open(sessionPath: string): PiSessionManagerInstanceLike;
    listAll(sessionDir?: string): Promise<PiSessionInfoLike[]>;
  };
  SettingsManager?: {
    create(
      cwd: string,
      agentDir: string,
      options?: { projectTrusted?: boolean },
    ): PiSettingsManagerLike;
  };
  DefaultPackageManager?: new (options: {
    cwd: string;
    agentDir: string;
    settingsManager: PiSettingsManagerLike;
  }) => PiPackageManagerLike;
  DefaultResourceLoader?: new (options: {
    cwd: string;
    agentDir: string;
    extensionFactories: Array<{
      name: string;
      factory: RequestHeaderExtensionFactory;
      hidden: boolean;
    }>;
  }) => PiResourceLoaderLike;
  createAgentSession(options: {
    cwd?: string;
    agentDir: string;
    modelRuntime: PiModelRuntimeLike;
    sessionManager: PiSessionManagerInstanceLike;
    resourceLoader?: PiResourceLoaderLike;
  }): Promise<{
    session: PiSessionLike;
    modelFallbackMessage?: string;
  }>;
}

export interface AgentModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

export interface ToolDisplayPayload {
  text: string;
  format: "text" | "json";
  truncated: boolean;
}

export interface AgentMessageSummary {
  role: "user" | "assistant" | "thinking" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: ToolDisplayPayload;
  toolOutput?: ToolDisplayPayload;
  isError?: boolean;
  timestamp?: string;
}

export interface SessionConfiguration {
  model: AgentModel | null;
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  availableTools: AgentTool[];
  activeToolNames: string[];
  defaultToolNames: string[];
}

export interface AgentTool {
  name: string;
  description: string;
}

export interface ContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

export interface CreatedAgentSession {
  sessionId: string;
  cwd: string;
  sessionPath: string | null;
  modelFallbackMessage?: string;
  configuration: SessionConfiguration;
  messages: AgentMessageSummary[];
  queuedMessages: QueuedMessages;
  streaming: boolean;
  contextUsage?: ContextUsage | null;
}

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

export interface AgentSessionSummary {
  id: string;
  path: string;
  cwd: string;
  name: string | null;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface DeleteSessionsResult {
  deletedSessionIds: string[];
  missingSessionIds: string[];
}

export interface SessionFileDependencies {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(path: string): Promise<Buffer>;
  unlink(path: string): Promise<void>;
}

export interface RuntimeEvent {
  sessionId: string;
  name:
    | "agent.started"
    | "user.message"
    | "message.delta"
    | "thinking.delta"
    | "message.completed"
    | "message.failed"
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "queue.updated"
    | "agent.settled"
    | "session.configurationChanged"
    | "session.usageChanged";
  data?: unknown;
}

export interface SessionRuntime {
  configureRequestHeaders(settings: RequestHeaderSettings): RequestHeaderSettings;
  createSession(cwd: string): Promise<CreatedAgentSession>;
  listSessions(): Promise<AgentSessionSummary[]>;
  deleteSessions(sessionIds: string[]): Promise<DeleteSessionsResult>;
  openSession(sessionPath: string): Promise<CreatedAgentSession>;
  listModels(): Promise<AgentModel[]>;
  listPackages(cwd: string): Promise<PackageSummary[]>;
  installPackage(cwd: string, source: string, scope: PackageScope): Promise<PackageSummary[]>;
  setPackageEnabled(
    cwd: string,
    source: string,
    scope: PackageScope,
    enabled: boolean,
  ): Promise<PackageSummary[]>;
  removePackage(cwd: string, source: string, scope: PackageScope): Promise<PackageSummary[]>;
  updatePackage(cwd: string, source?: string): Promise<PackageSummary[]>;
  checkPackageUpdates(cwd: string): Promise<PackageUpdateInfo[]>;
  listResources(cwd: string): Promise<ResourceSummary[]>;
  /** 返回当前会话可执行的扩展、提示词模板和技能命令。 */
  listCommands?(sessionId: string): Promise<SlashCommandSummary[]>;
  configureSession(
    sessionId: string,
    update: { model?: ModelSelection; thinkingLevel?: ThinkingLevel },
  ): Promise<SessionConfiguration>;
  prompt(
    sessionId: string,
    text: string,
    streamingBehavior?: PromptStreamingBehavior,
    activeTools?: string[],
    imagePaths?: string[],
  ): Promise<void>;
  clearQueue(sessionId: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  shutdown(): Promise<void>;
}

export class RuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

interface ManagedSession {
  cwd: string;
  session: PiSessionLike;
  resourceLoader?: PiResourceLoaderLike;
  unsubscribe: () => void;
  createdAt: string;
  lastActivityAt: string;
  defaultToolNames: string[];
  contextUsageKey: string;
  historyRevision: number;
  historySummaryMeta?: HistorySummaryMeta;
}

interface HistorySummaryMeta {
  revision: number;
  messageCount: number;
  firstMessage: string;
}

const MAX_HISTORY_MESSAGES = 200;
const MAX_HISTORY_CHARS = 400_000;
const MAX_SUMMARY_CHARS = 240;
const MAX_TOOL_CALL_ID_CHARS = 256;
const MAX_TOOL_NAME_CHARS = 128;
const MAX_TOOL_DESCRIPTION_CHARS = 1_024;
const MAX_AVAILABLE_TOOLS = 256;
const MAX_TOOL_DISPLAY_CHARS = 120_000;
const MAX_TOOL_DISPLAY_DEPTH = 8;
const MAX_TOOL_DISPLAY_ENTRIES = 100;
const MAX_PROMPT_IMAGES = 12;
const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;
const REDACTED_TOOL_VALUE = "[REDACTED]";
const TRUNCATED_TOOL_VALUE = "[TRUNCATED]";
const SENSITIVE_TOOL_KEY =
  /^(?:api[-_]?key|token|access[-_]?token|refresh[-_]?token|authorization|cookie|password|passwd|secret|client[-_]?secret|credentials?)$/i;

const DEFAULT_SESSION_FILE_DEPENDENCIES: SessionFileDependencies = {
  realpath,
  stat,
  readFile,
  unlink,
};

/**
 * Return the levels Pi exposes for a model when the session capability method
 * is unavailable. This mirrors pi-ai's getSupportedThinkingLevels semantics.
 */
export function getSupportedThinkingLevels(
  model?: Pick<PiModelLike, "reasoning" | "thinkingLevelMap">,
): ThinkingLevel[] {
  if (!model) return [...THINKING_LEVELS];
  try {
    if (model.reasoning !== true) return ["off"];

    return THINKING_LEVELS.filter((level) => {
      const mapped = model.thinkingLevelMap?.[level];
      // A malformed provider map must never advertise a value that the SDK
      // cannot serialize as a provider effort.
      if (mapped !== undefined && mapped !== null && typeof mapped !== "string") return false;
      if (mapped === null) return false;
      return level !== "xhigh" && level !== "max" ? true : mapped !== undefined;
    });
  } catch {
    return ["off"];
  }
}

/**
 * Normalize SDK capability output to the canonical Pi order. Unknown values,
 * duplicates and provider-specific strings never cross the desktop boundary.
 */
export function normalizeThinkingLevels(value: unknown): ThinkingLevel[] {
  if (!Array.isArray(value)) return [];
  const supplied = new Set(value);
  return THINKING_LEVELS.filter((level) => supplied.has(level));
}

/**
 * Match Pi's clampThinkingLevel rule: prefer the requested level, then search
 * upward, then downward, and finally use the first available level.
 */
export function clampThinkingLevel(
  requested: unknown,
  available: readonly ThinkingLevel[],
): ThinkingLevel {
  const levels = normalizeThinkingLevels(available);
  if (typeof requested === "string" && levels.includes(requested as ThinkingLevel)) {
    return requested as ThinkingLevel;
  }

  const requestedIndex =
    typeof requested === "string"
      ? THINKING_LEVELS.indexOf(requested as ThinkingLevel)
      : -1;
  if (requestedIndex < 0) return levels[0] ?? "off";

  for (let index = requestedIndex; index < THINKING_LEVELS.length; index += 1) {
    const candidate = THINKING_LEVELS[index];
    if (levels.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVELS[index];
    if (levels.includes(candidate)) return candidate;
  }
  return levels[0] ?? "off";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function packageKindFromSource(source: string): PackageSummary["kind"] {
  if (
    source.startsWith("git+") ||
    source.startsWith("git:") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("ssh://") ||
    source.includes("github.com:")
  ) {
    return "git";
  }
  if (
    isAbsolute(source) ||
    win32.isAbsolute(source) ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith(".\\") ||
    source.startsWith("..\\") ||
    source.startsWith("file:") ||
    source.startsWith("~")
  ) {
    return "local";
  }
  if (source.startsWith("npm:") || source.includes("@") || /^[\w.-]+(\/[\w.-]+)?$/.test(source)) {
    return "npm";
  }
  return "unknown";
}

function packageSourceString(entry: unknown): string {
  if (typeof entry === "string") return entry;
  return isRecord(entry) && typeof entry.source === "string" ? entry.source : "";
}

const DISABLED_PACKAGE_FILTER_PREFIX = "__pix_disabled_filters__/";

function disabledPackageFilters(entry: object): Record<string, unknown> | undefined {
  const extensions = (entry as { extensions?: unknown }).extensions;
  if (!Array.isArray(extensions)) return undefined;
  const marker = extensions.find(
    (value): value is string =>
      typeof value === "string" && value.startsWith(DISABLED_PACKAGE_FILTER_PREFIX),
  );
  if (!marker) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(marker.slice(DISABLED_PACKAGE_FILTER_PREFIX.length), "base64url").toString("utf8"),
    ) as unknown;
    return isRecord(decoded) && typeof decoded.source === "string" ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function packageEntryEnabled(entry: unknown): boolean {
  if (typeof entry === "string") return true;
  if (!isRecord(entry)) return true;
  if (entry.autoload !== false) return true;
  return (
    [entry.extensions, entry.skills, entry.prompts, entry.themes].some(
      (patterns) => Array.isArray(patterns) && patterns.length > 0,
    ) && !disabledPackageFilters(entry)
  );
}

function disablePackageEntry(entry: unknown, source: string): Record<string, unknown> {
  if (isRecord(entry) && disabledPackageFilters(entry)) return entry;
  const record = isRecord(entry) ? { ...entry, source } : { source };
  const encoded = Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
  return {
    source,
    autoload: false,
    extensions: [`${DISABLED_PACKAGE_FILTER_PREFIX}${encoded}`],
  };
}

function enablePackageEntry(entry: unknown, source: string): unknown {
  if (typeof entry === "string") return entry;
  if (!isRecord(entry)) return source;
  const restored = disabledPackageFilters(entry);
  if (restored) return restored;
  const record: Record<string, unknown> = { ...entry, source };
  delete record.autoload;
  return Object.keys(record).length === 1 ? source : record;
}

function normalizePackageSource(source: string): string {
  return source.replace(/\\/g, "/").replace(/\/+$/, "");
}

function findPackageEntry(
  packages: unknown[],
  source: string,
): { index: number; entry: unknown } | undefined {
  const needle = normalizePackageSource(source);
  for (let index = 0; index < packages.length; index += 1) {
    const entry = packages[index];
    const candidate = normalizePackageSource(packageSourceString(entry));
    if (
      candidate &&
      (candidate === needle || candidate.endsWith(needle) || needle.endsWith(candidate))
    ) {
      return { index, entry };
    }
  }
  return undefined;
}

export function resolvePackageRemoveSource(
  configured: Array<{ source: string; scope: string; installedPath?: string }>,
  source: string,
  scope: PackageScope,
): string {
  const expectedScope = scope === "project" ? "project" : "user";
  const match = configured.find(
    (entry) =>
      entry.scope === expectedScope &&
      (entry.source === source ||
        entry.installedPath === source ||
        entry.source.endsWith(source) ||
        source.endsWith(entry.source)),
  );
  if (!match) return source;
  return packageKindFromSource(match.source) === "local"
    ? (match.installedPath ?? match.source)
    : match.source;
}

function listPackagesFromManager(context: PackageContext): PackageSummary[] {
  const globalPackages = context.settingsManager.getGlobalSettings().packages ?? [];
  const projectPackages = context.settingsManager.getProjectSettings().packages ?? [];
  return context.manager.listConfiguredPackages().map((entry) => {
    const scope = entry.scope === "project" ? "project" : "global";
    const match = findPackageEntry(scope === "project" ? projectPackages : globalPackages, entry.source);
    return {
      source: entry.source,
      scope,
      kind: packageKindFromSource(entry.source),
      filtered: entry.filtered,
      enabled: match ? packageEntryEnabled(match.entry) : true,
      ...(entry.installedPath ? { installedPath: entry.installedPath } : {}),
    };
  });
}

function setPackageEnabledInSettings(
  settingsManager: PiSettingsManagerLike,
  source: string,
  scope: PackageScope,
  enabled: boolean,
): void {
  const isProject = scope === "project";
  const current = [
    ...((isProject
      ? settingsManager.getProjectSettings().packages
      : settingsManager.getGlobalSettings().packages) ?? []),
  ];
  const found = findPackageEntry(current, source);
  if (!found) {
    throw new RuntimeError("PACKAGE_NOT_FOUND", "插件未出现在对应范围的 Pi 配置中");
  }
  const sourceString = packageSourceString(found.entry) || source;
  const next = [...current];
  next[found.index] = enabled
    ? enablePackageEntry(found.entry, sourceString)
    : disablePackageEntry(found.entry, sourceString);
  if (isProject) settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
}

function listResourcesFromLoader(
  loader: PiResourceLoaderLike,
  cwd: string,
  agentDir: string,
): ResourceSummary[] {
  const resources: ResourceSummary[] = [];
  for (const extension of loader.getExtensions?.().extensions ?? []) {
    resources.push({
      kind: "extension",
      name: basename(extension.path),
      path: extension.path,
      ...(extension.sourceInfo?.source ? { source: extension.sourceInfo.source } : {}),
    });
  }
  for (const skill of loader.getSkills?.().skills ?? []) {
    resources.push({
      kind: "skill",
      name: skill.name,
      path: skill.filePath,
      ...(skill.sourceInfo?.source ? { source: skill.sourceInfo.source } : {}),
    });
  }
  for (const prompt of loader.getPrompts?.().prompts ?? []) {
    resources.push({
      kind: "prompt",
      name: prompt.name,
      path: prompt.filePath,
      ...(prompt.sourceInfo?.source ? { source: prompt.sourceInfo.source } : {}),
    });
  }
  for (const theme of loader.getThemes?.().themes ?? []) {
    resources.push({ kind: "theme", name: theme.name ?? "theme", path: theme.path ?? "" });
  }
  for (const file of loader.getAgentsFiles?.().agentsFiles ?? []) {
    resources.push({ kind: "context", name: basename(file.path), path: file.path });
  }
  for (const candidates of [
    [
      { path: join(cwd, ".pi", "SYSTEM.md"), source: "project" },
      { path: join(agentDir, "SYSTEM.md"), source: "global" },
    ],
    [
      { path: join(cwd, ".pi", "APPEND_SYSTEM.md"), source: "project" },
      { path: join(agentDir, "APPEND_SYSTEM.md"), source: "global" },
    ],
  ]) {
    const selected = candidates.find((candidate) => existsSync(candidate.path));
    if (selected) {
      resources.push({
        kind: "system",
        name: basename(selected.path),
        path: selected.path,
        source: selected.source,
      });
    }
  }
  return resources;
}

function listCommandsFromSession(
  session: PiSessionLike,
  resourceLoader?: PiResourceLoaderLike,
): SlashCommandSummary[] {
  const commands: SlashCommandSummary[] = [];
  const names = new Set<string>();

  const append = (candidate: SlashCommandSummary | null) => {
    if (!candidate) return;
    const key = candidate.name.toLocaleLowerCase("en-US");
    if (names.has(key) || commands.length >= MAX_COMMANDS) return;
    names.add(key);
    commands.push(candidate);
  };

  // Extension commands have the same precedence as Pi's resolver, so collect
  // them before file prompt templates and skills with the same name.
  let extensionCommands: unknown[] = [];
  try {
    const runner = session.extensionRunner;
    if (runner && typeof runner.getRegisteredCommands === "function") {
      const value = runner.getRegisteredCommands();
      if (Array.isArray(value)) extensionCommands = value;
    }
  } catch {
    // A legacy SDK may expose an extension runner before it is fully bound.
  }
  for (const command of extensionCommands) {
    append(readSlashCommand(command, "extension"));
  }

  let templates: unknown[] = [];
  try {
    const value = session.promptTemplates;
    if (Array.isArray(value)) templates = value;
  } catch {
    // Keep the rest of the catalog available when templates are unreadable.
  }
  try {
    const loaderTemplates = resourceLoader?.getPrompts?.().prompts ?? session.resourceLoader?.getPrompts?.().prompts;
    if (Array.isArray(loaderTemplates)) templates = [...templates, ...loaderTemplates];
  } catch {
    // Keep the session-provided templates when the loader is unavailable.
  }
  for (const template of templates) {
    append(readSlashCommand(template, "prompt"));
  }

  let skills: unknown[] = [];
  try {
    const value = resourceLoader?.getSkills?.().skills ?? session.resourceLoader?.getSkills?.().skills;
    if (Array.isArray(value)) skills = value;
  } catch {
    // Skill discovery is optional for older/custom resource loaders.
  }
  for (const skill of skills) {
    const command = readSlashCommand(skill, "skill");
    if (!command) continue;
    append({
      ...command,
      name: command.name.startsWith("skill:") ? command.name : `skill:${command.name}`,
    });
  }

  return commands;
}

function readSlashCommand(
  value: unknown,
  source: SlashCommandSummary["source"],
): SlashCommandSummary | null {
  if (!isRecord(value)) return null;
  const rawName = source === "extension" ? value.invocationName ?? value.name : value.name;
  if (typeof rawName !== "string") return null;
  const name = rawName.trim();
  if (
    name.length === 0 ||
    name.length > MAX_COMMAND_NAME_CHARS ||
    /[\r\n\0\s/]/.test(name)
  ) {
    return null;
  }
  const description =
    typeof value.description === "string"
      ? value.description.trim().slice(0, MAX_COMMAND_DESCRIPTION_CHARS)
      : "";
  const argumentHint =
    typeof value.argumentHint === "string"
      ? value.argumentHint.trim().slice(0, MAX_COMMAND_DESCRIPTION_CHARS)
      : undefined;
  return {
    name,
    description,
    source,
    ...(argumentHint ? { argumentHint } : {}),
  };
}

function normalizeRuntimePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

async function loadPromptImages(
  imagePaths: string[] | undefined,
  files: SessionFileDependencies,
): Promise<PiImageContent[] | undefined> {
  if (imagePaths === undefined) return undefined;
  if (imagePaths.length === 0 || imagePaths.length > MAX_PROMPT_IMAGES) {
    throw new RuntimeError(
      "PROMPT_IMAGE_COUNT_INVALID",
      `图片数量必须为 1-${MAX_PROMPT_IMAGES} 张`,
    );
  }

  const images: PiImageContent[] = [];
  const unique = new Set<string>();
  for (const imagePath of imagePaths) {
    if (
      typeof imagePath !== "string" ||
      imagePath.trim().length === 0 ||
      imagePath.length > 4_096 ||
      /[\r\n\0]/.test(imagePath) ||
      (!isAbsolute(imagePath) && !win32.isAbsolute(imagePath))
    ) {
      throw new RuntimeError("PROMPT_IMAGE_PATH_INVALID", "图片路径必须是有效的绝对路径");
    }

    let canonical: string;
    let details: { isFile(): boolean; size: number };
    try {
      canonical = await files.realpath(imagePath);
      details = await files.stat(canonical);
    } catch {
      throw new RuntimeError(
        "PROMPT_IMAGE_READ_FAILED",
        "图片不存在、无法访问或不是普通文件",
      );
    }
    if (!details.isFile()) {
      throw new RuntimeError(
        "PROMPT_IMAGE_READ_FAILED",
        "图片不存在、无法访问或不是普通文件",
      );
    }
    if (details.size === 0) {
      throw new RuntimeError("PROMPT_IMAGE_EMPTY", "图片文件不能为空");
    }
    if (!Number.isFinite(details.size) || details.size < 0 || details.size > MAX_PROMPT_IMAGE_BYTES) {
      throw new RuntimeError("PROMPT_IMAGE_TOO_LARGE", "单张图片不能超过 10 MiB");
    }

    const normalized = normalizeRuntimePath(canonical);
    if (unique.has(normalized)) {
      throw new RuntimeError("PROMPT_IMAGE_PATH_INVALID", "图片列表包含重复路径");
    }
    unique.add(normalized);

    const expected = imageMimeTypeFromPath(canonical);
    if (!expected) {
      throw new RuntimeError(
        "PROMPT_IMAGE_TYPE_UNSUPPORTED",
        "仅支持 PNG、JPEG、GIF 或 WebP 图片",
      );
    }
    let bytes: Buffer;
    try {
      bytes = await files.readFile(canonical);
    } catch {
      throw new RuntimeError("PROMPT_IMAGE_READ_FAILED", "图片文件无法读取");
    }
    if (bytes.length === 0) {
      throw new RuntimeError("PROMPT_IMAGE_EMPTY", "图片文件不能为空");
    }
    if (bytes.length > MAX_PROMPT_IMAGE_BYTES) {
      throw new RuntimeError("PROMPT_IMAGE_TOO_LARGE", "单张图片不能超过 10 MiB");
    }
    if (detectImageMimeType(bytes) !== expected) {
      throw new RuntimeError(
        "PROMPT_IMAGE_TYPE_UNSUPPORTED",
        "图片内容与扩展名不匹配，或格式不受支持",
      );
    }
    images.push({ type: "image", data: bytes.toString("base64"), mimeType: expected });
  }
  return images;
}

function imageMimeTypeFromPath(path: string): PiImageContent["mimeType"] | undefined {
  const extension = (win32.isAbsolute(path) ? win32.extname(path) : extname(path)).toLocaleLowerCase();
  if (extension === ".gif") return "image/gif";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return undefined;
}

function detectImageMimeType(bytes: Buffer): PiImageContent["mimeType"] | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const prefix = bytes.subarray(0, 6).toString("ascii");
  if (prefix === "GIF87a" || prefix === "GIF89a") return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

export class PiSessionRuntime implements SessionRuntime {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private modelRuntimePromise: Promise<PiModelRuntimeLike> | undefined;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly openingSessions = new Map<string, Promise<CreatedAgentSession>>();
  private requestHeaderSettings: RequestHeaderSettings = { ...DEFAULT_REQUEST_HEADER_SETTINGS };
  private closed = false;

  constructor(
    private readonly sdk: PiSdkLike,
    private readonly agentDir: string,
    private readonly sessionFiles: SessionFileDependencies = DEFAULT_SESSION_FILE_DEPENDENCIES,
    private readonly diagnostics: PerformanceDiagnosticSink = () => undefined,
  ) {}

  warmUp(): void {
    this.ensureOpen();
    void this.getModelRuntime().catch(() => undefined);
  }

  configureRequestHeaders(settings: RequestHeaderSettings): RequestHeaderSettings {
    this.ensureOpen();
    if (settings.enabled && typeof this.sdk.DefaultResourceLoader !== "function") {
      throw new RuntimeError(
        "REQUEST_HEADERS_UNSUPPORTED",
        "当前 Pi SDK 不支持请求头扩展，请升级后重试",
      );
    }
    this.requestHeaderSettings = { ...settings };
    return { ...this.requestHeaderSettings };
  }

  async createSession(cwd: string): Promise<CreatedAgentSession> {
    this.ensureOpen();
    return measurePerformance(this.diagnostics, "session.create", "total", async () => {
      try {
        const modelRuntime = await this.getModelRuntime();
        const resourceLoader = await this.createResourceLoader(cwd, "session.create");
        const sessionManager = measurePerformanceSync(
          this.diagnostics,
          "session.create",
          "session.manager",
          () => this.sdk.SessionManager.create(cwd),
        );
        const result = await measurePerformance(
          this.diagnostics,
          "session.create",
          "session.create",
          () =>
            this.sdk.createAgentSession({
              cwd,
              agentDir: this.agentDir,
              modelRuntime,
              sessionManager,
              ...(resourceLoader ? { resourceLoader } : {}),
            }),
        );
        return this.activateSession(result, cwd, resourceLoader, "session.create");
      } catch (error) {
        throw mapRuntimeError(error, "SESSION_CREATE_FAILED", "无法创建 Pi 会话");
      }
    });
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    this.ensureOpen();
    try {
      // Default Pi sessions are nested by encoded cwd; an explicit directory is treated as flat.
      const sessions = await this.sdk.SessionManager.listAll();
      const byPath = new Map(
        sessions.flatMap((session) => toSessionSummary(session)).map((session) => [session.path, session]),
      );
      for (const managed of this.sessions.values()) {
        const live = toLiveSessionSummary(managed, byPath.get(managed.session.sessionFile ?? ""));
        if (live) byPath.set(live.path, live);
      }
      return [...byPath.values()].sort((left, right) => right.modified.localeCompare(left.modified));
    } catch (error) {
      throw mapRuntimeError(error, "SESSION_LIST_FAILED", "无法读取 Pi 会话列表");
    }
  }

  async deleteSessions(sessionIds: string[]): Promise<DeleteSessionsResult> {
    this.ensureOpen();
    const ids = validateSessionIds(sessionIds);
    const requested = new Set(ids);
    const managedToRelease = [...this.sessions.entries()].filter(([id, managed]) => {
      if (!requested.has(id)) return false;
      if (managed.session.isStreaming) {
        throw new RuntimeError("SESSION_BUSY", "Pi 正在处理任务，暂时无法清理归档会话");
      }
      return true;
    });

    let listed: PiSessionInfoLike[];
    try {
      listed = await this.sdk.SessionManager.listAll();
    } catch {
      throw new RuntimeError("SESSION_DELETE_FAILED", "无法读取 Pi 会话列表以执行清理");
    }

    let sessionsRoot: string;
    try {
      sessionsRoot = await this.sessionFiles.realpath(join(this.agentDir, "sessions"));
    } catch (error) {
      if (isMissingFileError(error)) {
        for (const [, managed] of managedToRelease) releaseSession(managed);
        for (const [id] of managedToRelease) this.sessions.delete(id);
        return { deletedSessionIds: [], missingSessionIds: ids };
      }
      throw new RuntimeError("SESSION_DELETE_FAILED", "无法访问 Pi 会话目录");
    }

    // A newly created session can have a file before the SDK's directory scan sees it.
    // Keep the path supplied by the managed SDK session as a second, still-authorized candidate.
    const managedPaths = new Map<string, string>();
    for (const [id, managed] of managedToRelease) {
      if (managed.session.sessionFile) managedPaths.set(id, managed.session.sessionFile);
    }
    const candidates = new Map<string, string>();
    for (const id of ids) {
      const entry = listed.find((session) => session.id === id);
      const candidatePath = entry?.path ?? managedPaths.get(id);
      if (!candidatePath) continue;
      const authorizedPath = await this.authorizeSessionFile(candidatePath, sessionsRoot);
      if (authorizedPath) candidates.set(id, authorizedPath);
    }

    for (const [, managed] of managedToRelease) releaseSession(managed);
    for (const [id] of managedToRelease) this.sessions.delete(id);

    const deletedSessionIds: string[] = [];
    const missingSessionIds: string[] = [];
    for (const id of ids) {
      const path = candidates.get(id);
      if (!path) {
        missingSessionIds.push(id);
        continue;
      }
      try {
        await this.sessionFiles.unlink(path);
        deletedSessionIds.push(id);
      } catch (error) {
        if (isMissingFileError(error)) {
          missingSessionIds.push(id);
          continue;
        }
        throw new RuntimeError("SESSION_DELETE_FAILED", "无法删除 Pi 原生会话文件");
      }
    }
    return { deletedSessionIds, missingSessionIds };
  }

  private async authorizeSessionFile(path: string, sessionsRoot: string): Promise<string | null> {
    if (
      typeof path !== "string" ||
      !isAbsolute(path) ||
      extname(path).toLocaleLowerCase() !== ".jsonl"
    ) {
      throw new RuntimeError("SESSION_PATH_INVALID", "Pi 会话文件路径无效");
    }
    let canonical: string;
    try {
      canonical = await this.sessionFiles.realpath(path);
      const details = await this.sessionFiles.stat(canonical);
      if (!details.isFile()) throw new Error("session path is not a file");
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw new RuntimeError("SESSION_PATH_INVALID", "Pi 会话文件无法访问");
    }
    const relativePath = relative(sessionsRoot, canonical);
    if (
      !relativePath ||
      isAbsolute(relativePath) ||
      relativePath === ".." ||
      relativePath.startsWith(`..${win32.sep}`) ||
      relativePath.startsWith("../")
    ) {
      throw new RuntimeError("SESSION_PATH_INVALID", "Pi 会话文件不在授权的 sessions 目录中");
    }
    return path;
  }

  async openSession(sessionPath: string): Promise<CreatedAgentSession> {
    this.ensureOpen();
    const normalizedSessionPath = normalizeRuntimePath(sessionPath);
    const existing = [...this.sessions.values()].find(
      (managed) =>
        managed.session.sessionFile !== undefined &&
        normalizeRuntimePath(managed.session.sessionFile) === normalizedSessionPath,
    );
    if (existing) {
      return describeManagedSession(existing, this.diagnostics, "session.open");
    }

    const pending = this.openingSessions.get(normalizedSessionPath);
    if (pending) return pending;

    const task = measurePerformance(this.diagnostics, "session.open", "total", async () => {
      try {
        const sessionManager = measurePerformanceSync(
          this.diagnostics,
          "session.open",
          "session.manager",
          () => this.sdk.SessionManager.open(sessionPath),
        );
        const cwd = sessionManager.getCwd?.() ?? "";
        const modelRuntime = await this.getModelRuntime();
        const resourceLoader = await this.createResourceLoader(
          cwd || process.cwd(),
          "session.open",
        );
        const result = await measurePerformance(
          this.diagnostics,
          "session.open",
          "session.create",
          () =>
            this.sdk.createAgentSession({
              ...(cwd ? { cwd } : {}),
              agentDir: this.agentDir,
              modelRuntime,
              sessionManager,
              ...(resourceLoader ? { resourceLoader } : {}),
            }),
        );
        return this.activateSession(result, cwd, resourceLoader, "session.open");
      } catch (error) {
        throw mapRuntimeError(error, "SESSION_OPEN_FAILED", "无法打开所选 Pi 会话");
      }
    });
    this.openingSessions.set(normalizedSessionPath, task);
    try {
      return await task;
    } finally {
      if (this.openingSessions.get(normalizedSessionPath) === task) {
        this.openingSessions.delete(normalizedSessionPath);
      }
    }
  }

  async listModels(): Promise<AgentModel[]> {
    this.ensureOpen();
    try {
      const runtime = await this.getModelRuntime();
      let models: PiModelLike[] = [];
      if (typeof runtime.getAvailable === "function") {
        try {
          models = await runtime.getAvailable();
        } catch {
          // Older/custom runtimes can expose the catalog while availability probing fails.
        }
      }
      if (models.length === 0 && typeof runtime.getModels === "function") {
        models = runtime.getModels();
      }
      return uniqueAgentModels(models);
    } catch (error) {
      throw mapRuntimeError(error, "MODEL_LIST_FAILED", "无法读取已配置的 Pi 模型");
    }
  }

  async listPackages(cwd: string): Promise<PackageSummary[]> {
    this.ensureOpen();
    try {
      return listPackagesFromManager(this.createPackageContext(cwd));
    } catch (error) {
      throw mapRuntimeError(error, "PACKAGE_LIST_FAILED", "无法读取已配置的 Pi 插件");
    }
  }

  async installPackage(
    cwd: string,
    source: string,
    scope: PackageScope,
  ): Promise<PackageSummary[]> {
    this.ensureOpen();
    try {
      const context = this.createPackageContext(cwd);
      await context.manager.installAndPersist(source, { local: scope === "project" });
      await this.reloadManagedResources(scope === "global" ? undefined : cwd);
      return listPackagesFromManager(context);
    } catch (error) {
      throw mapRuntimeError(error, "PACKAGE_INSTALL_FAILED", "无法安装所选 Pi 插件");
    }
  }

  async setPackageEnabled(
    cwd: string,
    source: string,
    scope: PackageScope,
    enabled: boolean,
  ): Promise<PackageSummary[]> {
    this.ensureOpen();
    try {
      const context = this.createPackageContext(cwd);
      setPackageEnabledInSettings(context.settingsManager, source, scope, enabled);
      await this.reloadManagedResources(scope === "global" ? undefined : cwd);
      return listPackagesFromManager(context);
    } catch (error) {
      throw mapRuntimeError(error, "PACKAGE_UPDATE_FAILED", "无法更新 Pi 插件启用状态");
    }
  }

  async removePackage(
    cwd: string,
    source: string,
    scope: PackageScope,
  ): Promise<PackageSummary[]> {
    this.ensureOpen();
    try {
      const context = this.createPackageContext(cwd);
      const configured = context.manager.listConfiguredPackages();
      const removeSource = resolvePackageRemoveSource(configured, source, scope);
      const removed = await context.manager.removeAndPersist(removeSource, {
        local: scope === "project",
      });
      if (!removed) {
        throw new RuntimeError("PACKAGE_NOT_FOUND", "插件未出现在对应范围的 Pi 配置中");
      }
      await this.reloadManagedResources(scope === "global" ? undefined : cwd);
      return listPackagesFromManager(context);
    } catch (error) {
      throw mapRuntimeError(error, "PACKAGE_REMOVE_FAILED", "无法移除所选 Pi 插件");
    }
  }

  async updatePackage(cwd: string, source?: string): Promise<PackageSummary[]> {
    this.ensureOpen();
    try {
      const context = this.createPackageContext(cwd);
      await context.manager.update(source);
      await this.reloadManagedResources();
      return listPackagesFromManager(context);
    } catch (error) {
      throw mapRuntimeError(error, "PACKAGE_UPDATE_FAILED", "无法更新 Pi 插件");
    }
  }

  async checkPackageUpdates(cwd: string): Promise<PackageUpdateInfo[]> {
    this.ensureOpen();
    try {
      const updates = await this.createPackageContext(cwd).manager.checkForAvailableUpdates();
      return updates.map((item) => ({
        source: item.source,
        displayName: item.displayName,
        type: item.type,
        scope: item.scope === "project" ? "project" : "global",
      }));
    } catch (error) {
      throw mapRuntimeError(error, "PACKAGE_UPDATE_CHECK_FAILED", "无法检查 Pi 插件更新");
    }
  }

  async listResources(cwd: string): Promise<ResourceSummary[]> {
    this.ensureOpen();
    return measurePerformance(this.diagnostics, "resource.list", "total", async () => {
      try {
        const normalizedCwd = normalizeRuntimePath(cwd);
        const managedLoader = [...this.sessions.values()].find(
          (managed) =>
            managed.resourceLoader !== undefined &&
            normalizeRuntimePath(managed.cwd) === normalizedCwd,
        )?.resourceLoader;
        if (managedLoader) {
          return listResourcesFromLoader(managedLoader, cwd, this.agentDir);
        }
        if (typeof this.sdk.DefaultResourceLoader !== "function") {
          throw new RuntimeError("RESOURCE_LIST_UNSUPPORTED", "当前 Pi SDK 不支持资源清单");
        }
        const loader = new this.sdk.DefaultResourceLoader({
          cwd,
          agentDir: this.agentDir,
          extensionFactories: [],
        });
        await measurePerformance(this.diagnostics, "resource.list", "resource.reload", () =>
          loader.reload(),
        );
        return listResourcesFromLoader(loader, cwd, this.agentDir);
      } catch (error) {
        throw mapRuntimeError(error, "RESOURCE_LIST_FAILED", "无法读取 Pi 资源与技能");
      }
    });
  }

  async listCommands(sessionId: string): Promise<SlashCommandSummary[]> {
    this.ensureOpen();
    return measurePerformance(this.diagnostics, "command.list", "total", async () => {
      const managed = this.requireSession(sessionId);
      try {
        return listCommandsFromSession(managed.session, managed.resourceLoader);
      } catch (error) {
        throw mapRuntimeError(error, "COMMAND_LIST_FAILED", "无法读取当前 Pi 命令清单");
      }
    });
  }

  async configureSession(
    sessionId: string,
    update: { model?: ModelSelection; thinkingLevel?: ThinkingLevel },
  ): Promise<SessionConfiguration> {
    this.ensureOpen();
    const managed = this.requireSession(sessionId);
    if (managed.session.isStreaming) {
      throw new RuntimeError("SESSION_BUSY", "Pi 正在处理任务，暂时无法更改会话配置");
    }

    let modelChanged = false;
    if (update.model) {
      const model = (await this.getModelRuntime()).getModel(update.model.provider, update.model.id);
      if (!model) {
        throw new RuntimeError("MODEL_NOT_FOUND", "所选模型不在当前 Pi 配置中");
      }
      try {
        await managed.session.setModel(model);
        modelChanged = true;
      } catch {
        throw new RuntimeError("MODEL_UPDATE_FAILED", "无法切换到所选模型");
      }
    }

    // The SDK clamps internally, but clamp before calling it as well. This
    // keeps older/custom SDK builds from receiving a level they cannot parse
    // after a model switch.
    if (update.thinkingLevel !== undefined || modelChanged) {
      const availability = resolveThinkingAvailability(managed.session);
      const current = readSessionThinkingLevel(managed.session);
      const requested = update.thinkingLevel ?? current;
      const effective = clampThinkingLevel(requested, availability.levels);
      const shouldApply = update.thinkingLevel !== undefined || effective !== current;

      let setThinkingLevel: PiSessionLike["setThinkingLevel"];
      try {
        setThinkingLevel = managed.session.setThinkingLevel;
      } catch {
        setThinkingLevel = undefined;
      }
      if (shouldApply && typeof setThinkingLevel === "function") {
        try {
          setThinkingLevel.call(managed.session, effective);
        } catch {
          // A capability-less legacy session is allowed to keep its SDK
          // default. A session that reports capabilities still gets a stable
          // error so genuine provider failures remain diagnosable.
          const hasSelectableThinking = availability.levels.some((level) => level !== "off");
          if (
            availability.source !== "fallback" &&
            readModelSupportsThinking(managed.session) &&
            hasSelectableThinking
          ) {
            throw new RuntimeError("THINKING_LEVEL_UPDATE_FAILED", "无法更新思考强度");
          }
        }
      }
    }
    return describeConfiguration(managed.session, managed.defaultToolNames);
  }

  async prompt(
    sessionId: string,
    text: string,
    streamingBehavior?: PromptStreamingBehavior,
    activeTools?: string[],
    imagePaths?: string[],
  ): Promise<void> {
    this.ensureOpen();
    try {
      const managed = this.requireSession(sessionId);
      if (activeTools !== undefined) {
        this.applyActiveTools(managed, activeTools);
      }
      const images = await loadPromptImages(imagePaths, this.sessionFiles);
      managed.lastActivityAt = new Date().toISOString();
      // A prompt may mutate history before its first SDK event is emitted.
      managed.historyRevision += 1;
      const options = {
        ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
        ...(images === undefined ? {} : { images }),
      };
      await managed.session.prompt(text, Object.keys(options).length === 0 ? undefined : options);
    } catch (error) {
      throw mapRuntimeError(error, "PROMPT_FAILED", "Pi 无法完成当前提示");
    }
  }

  async clearQueue(sessionId: string): Promise<void> {
    this.ensureOpen();
    try {
      this.requireSession(sessionId).session.clearQueue();
    } catch (error) {
      throw mapRuntimeError(error, "QUEUE_CLEAR_FAILED", "无法清空当前 Pi 消息队列");
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.ensureOpen();
    try {
      await this.requireSession(sessionId).session.abort();
    } catch (error) {
      throw mapRuntimeError(error, "ABORT_FAILED", "无法停止当前 Pi 任务");
    }
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const managedSessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const managed of managedSessions) {
      try {
        if (managed.session.isStreaming) {
          await managed.session.abort().catch(() => undefined);
        }
      } finally {
        releaseSession(managed);
      }
    }
    this.listeners.clear();
  }

  private async getModelRuntime(): Promise<PiModelRuntimeLike> {
    if (this.modelRuntimePromise) return this.modelRuntimePromise;

    const creation = measurePerformance(
      this.diagnostics,
      "model.runtime",
      "model.initialize",
      () =>
        this.sdk.ModelRuntime.create({
          authPath: join(this.agentDir, "auth.json"),
          modelsPath: join(this.agentDir, "models.json"),
        }),
    );
    this.modelRuntimePromise = creation;
    void creation.catch(() => {
      if (this.modelRuntimePromise === creation) this.modelRuntimePromise = undefined;
    });
    return creation;
  }

  private async createResourceLoader(
    cwd: string,
    operation: "session.create" | "session.open",
  ): Promise<PiResourceLoaderLike | undefined> {
    if (typeof this.sdk.DefaultResourceLoader !== "function") {
      if (this.requestHeaderSettings.enabled) {
        throw new RuntimeError(
          "REQUEST_HEADERS_UNSUPPORTED",
          "当前 Pi SDK 不支持请求头扩展，请升级后重试",
        );
      }
      return undefined;
    }
    const resourceLoader = new this.sdk.DefaultResourceLoader({
      cwd,
      agentDir: this.agentDir,
      extensionFactories: [
        {
          name: "pi-desktop-request-headers",
          hidden: true,
          factory: createRequestHeaderExtension(() => this.requestHeaderSettings),
        },
      ],
    });
    await measurePerformance(this.diagnostics, operation, "resource.reload", () =>
      resourceLoader.reload(),
    );
    return resourceLoader;
  }

  private createPackageContext(cwd: string): PackageContext {
    if (
      typeof this.sdk.SettingsManager?.create !== "function" ||
      typeof this.sdk.DefaultPackageManager !== "function"
    ) {
      throw new RuntimeError("PACKAGE_MANAGER_UNSUPPORTED", "当前 Pi SDK 不支持插件管理");
    }
    const settingsManager = this.sdk.SettingsManager.create(cwd, this.agentDir, {
      projectTrusted: true,
    });
    return {
      settingsManager,
      manager: new this.sdk.DefaultPackageManager({
        cwd,
        agentDir: this.agentDir,
        settingsManager,
      }),
    };
  }

  private async reloadManagedResources(cwd?: string): Promise<void> {
    const normalized = cwd ? normalizeRuntimePath(cwd) : undefined;
    for (const managed of this.sessions.values()) {
      if (normalized && normalizeRuntimePath(managed.cwd) !== normalized) continue;
      if (typeof managed.session.reload === "function") {
        await managed.session.reload();
      } else {
        await managed.resourceLoader?.reload();
      }
    }
  }

  private activateSession(
    result: { session: PiSessionLike; modelFallbackMessage?: string },
    cwd: string,
    resourceLoader?: PiResourceLoaderLike,
    operation?: "session.create" | "session.open",
  ): CreatedAgentSession {
    const { session } = result;
    if (!session.sessionId || this.sessions.has(session.sessionId)) {
      session.dispose();
      throw new RuntimeError("INVALID_SESSION", "Pi SDK 返回了无效或重复的会话 id");
    }

    let unsubscribe: () => void;
    try {
      unsubscribe = session.subscribe((event) => this.forwardSdkEvent(session, event));
    } catch {
      session.dispose();
      throw new RuntimeError("SESSION_SUBSCRIBE_FAILED", "无法订阅 Pi SDK 会话事件");
    }

    const now = new Date().toISOString();
    const defaultToolNames = readActiveToolNames(session);
    const contextUsage = readContextUsage(session);
    const managed = {
      cwd,
      session,
      unsubscribe,
      createdAt: now,
      lastActivityAt: now,
      defaultToolNames,
      contextUsageKey: JSON.stringify(contextUsage),
      historyRevision: 0,
      ...(resourceLoader ? { resourceLoader } : {}),
    };
    this.sessions.set(session.sessionId, managed);

    return {
      ...describeManagedSession(managed, this.diagnostics, operation),
      ...(result.modelFallbackMessage === undefined
        ? {}
        : { modelFallbackMessage: result.modelFallbackMessage }),
    };
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new RuntimeError("RUNTIME_CLOSED", "Bridge 会话运行时已关闭");
    }
  }

  private requireSession(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new RuntimeError("SESSION_NOT_FOUND", `找不到会话 ${sessionId}`);
    }
    return managed;
  }

  private applyActiveTools(managed: ManagedSession, requested: string[]): void {
    const { session } = managed;
    if (session.isStreaming) {
      throw new RuntimeError("SESSION_BUSY", "Pi 正在处理任务，暂时无法更改工具权限");
    }
    if (
      typeof session.getAllTools !== "function" ||
      typeof session.getActiveToolNames !== "function" ||
      typeof session.setActiveToolsByName !== "function"
    ) {
      throw new RuntimeError(
        "TOOL_PERMISSIONS_UNSUPPORTED",
        "当前 Pi SDK 不支持工具权限控制，请升级后重试",
      );
    }

    let available: AgentTool[];
    let current: string[];
    try {
      available = normalizeAvailableTools(session.getAllTools());
      current = normalizeActiveToolNames(session.getActiveToolNames());
    } catch {
      throw new RuntimeError(
        "TOOL_PERMISSION_UPDATE_FAILED",
        "无法读取当前 Pi SDK 工具权限",
      );
    }
    const availableNames = new Set(available.map((tool) => tool.name));
    if (requested.some((name) => !availableNames.has(name))) {
      throw new RuntimeError("TOOL_SELECTION_INVALID", "所选工具不在当前 Pi SDK 工具清单中");
    }

    if (sameStringSet(current, requested)) return;
    try {
      session.setActiveToolsByName(requested);
      if (!sameStringSet(normalizeActiveToolNames(session.getActiveToolNames()), requested)) {
        throw new Error("Pi SDK returned an incomplete tool selection");
      }
    } catch {
      throw new RuntimeError("TOOL_PERMISSION_UPDATE_FAILED", "无法应用所选工具权限");
    }
    const event: RuntimeEvent = {
      sessionId: session.sessionId,
      name: "session.configurationChanged",
      data: describeConfiguration(session, managed.defaultToolNames),
    };
    for (const listener of this.listeners) listener(event);
  }

  private forwardSdkEvent(session: PiSessionLike, event: unknown): void {
    if (!isRecord(event) || typeof event.type !== "string") {
      return;
    }

    const managed = this.sessions.get(session.sessionId);
    if (managed) {
      managed.lastActivityAt = new Date().toISOString();
      managed.historyRevision += 1;
    }

    let runtimeEvent: RuntimeEvent | undefined;
    if (event.type === "agent_start") {
      runtimeEvent = { sessionId: session.sessionId, name: "agent.started" };
    } else if (event.type === "agent_settled") {
      runtimeEvent = { sessionId: session.sessionId, name: "agent.settled" };
    } else if (event.type === "message_start") {
      const content = readUserMessage(event.message);
      if (content) {
        runtimeEvent = { sessionId: session.sessionId, name: "user.message", data: { content } };
      }
    } else if (event.type === "queue_update") {
      const queuedMessages = readQueueEvent(event);
      if (queuedMessages) {
        runtimeEvent = {
          sessionId: session.sessionId,
          name: "queue.updated",
          data: queuedMessages,
        };
      }
    } else if (event.type === "model_select" || event.type === "thinking_level_changed") {
      runtimeEvent = {
        sessionId: session.sessionId,
        name: "session.configurationChanged",
        data: describeConfiguration(session, managed?.defaultToolNames ?? readActiveToolNames(session)),
      };
    } else if (event.type === "message_update" && isRecord(event.assistantMessageEvent)) {
      const update = event.assistantMessageEvent;
      if (
        (update.type === "text_delta" || update.type === "thinking_delta") &&
        typeof update.delta === "string"
      ) {
        runtimeEvent = {
          sessionId: session.sessionId,
          name: update.type === "thinking_delta" ? "thinking.delta" : "message.delta",
          data: { delta: update.delta },
        };
      }
    } else if (event.type === "message_end" && isRecord(event.message)) {
      runtimeEvent = projectMessageEnd(session.sessionId, event.message);
    } else if (event.type === "tool_execution_start") {
      const tool = readToolEvent(event, "input");
      if (tool) {
        runtimeEvent = {
          sessionId: session.sessionId,
          name: "tool.started",
          data: tool,
        };
      }
    } else if (event.type === "tool_execution_end") {
      const tool = readToolEvent(event, "output");
      if (tool) {
        runtimeEvent = {
          sessionId: session.sessionId,
          name: event.isError === true ? "tool.failed" : "tool.completed",
          data: tool,
        };
      }
    }

    if (runtimeEvent) {
      for (const listener of this.listeners) {
        listener(runtimeEvent);
      }
    }
    if (managed) this.emitContextUsageIfChanged(managed);
  }

  private emitContextUsageIfChanged(managed: ManagedSession): void {
    const contextUsage = readContextUsage(managed.session);
    const key = JSON.stringify(contextUsage);
    if (key === managed.contextUsageKey) return;
    managed.contextUsageKey = key;
    const event: RuntimeEvent = {
      sessionId: managed.session.sessionId,
      name: "session.usageChanged",
      data: contextUsage,
    };
    for (const listener of this.listeners) listener(event);
  }
}

function describeManagedSession(
  managed: ManagedSession,
  diagnostics?: PerformanceDiagnosticSink,
  operation?: "session.create" | "session.open",
): CreatedAgentSession {
  const historyStartedAt = performanceNow();
  const messages = summarizeMessages(managed.session.messages);
  // The open/create response already paid for this projection. Reuse its small
  // metadata object when the next catalog refresh asks for the live summary.
  managed.historySummaryMeta = {
    revision: managed.historyRevision,
    messageCount: messages.filter(isConversationMessage).length,
    firstMessage: clipText(
      messages.find((message) => message.role === "user")?.content ?? "",
      MAX_SUMMARY_CHARS,
    ),
  };
  if (diagnostics && operation) {
    emitPerformanceDiagnostic(diagnostics, operation, "history.project", historyStartedAt);
  }
  return {
    sessionId: managed.session.sessionId,
    cwd: managed.cwd,
    sessionPath: managed.session.sessionFile ?? null,
    configuration: describeConfiguration(managed.session, managed.defaultToolNames),
    messages,
    queuedMessages: describeQueue(managed.session),
    streaming: managed.session.isStreaming,
    contextUsage: readContextUsage(managed.session),
  };
}

function toLiveSessionSummary(
  managed: ManagedSession,
  disk: AgentSessionSummary | undefined,
): AgentSessionSummary | null {
  const path = managed.session.sessionFile;
  if (!path || !disk) return null;
  const summary = summarizeManagedHistoryMeta(managed);
  return {
    id: managed.session.sessionId,
    path,
    cwd: managed.cwd,
    name: disk.name,
    created: disk.created,
    modified: managed.lastActivityAt > disk.modified ? managed.lastActivityAt : disk.modified,
    messageCount: Math.max(disk.messageCount, summary.messageCount),
    firstMessage: clipText(summary.firstMessage || disk.firstMessage, MAX_SUMMARY_CHARS),
  };
}

function summarizeManagedHistoryMeta(managed: ManagedSession): HistorySummaryMeta {
  const cached = managed.historySummaryMeta;
  if (cached?.revision === managed.historyRevision) return cached;

  const messages = summarizeMessages(managed.session.messages);
  const summary: HistorySummaryMeta = {
    revision: managed.historyRevision,
    messageCount: messages.filter(isConversationMessage).length,
    firstMessage: clipText(
      messages.find((message) => message.role === "user")?.content ?? "",
      MAX_SUMMARY_CHARS,
    ),
  };
  managed.historySummaryMeta = summary;
  return summary;
}

function isConversationMessage(message: AgentMessageSummary): boolean {
  return message.role === "user" || message.role === "assistant";
}

function projectMessageEnd(sessionId: string, message: Record<string, unknown>): RuntimeEvent | undefined {
  if (message.role !== "assistant") return undefined;
  const reason = typeof message.stopReason === "string" ? message.stopReason : "stop";
  if (reason === "stop" || reason === "length" || reason === "toolUse") {
    return { sessionId, name: "message.completed", data: { reason } };
  }
  if (["aborted", "error", "pending", "deferred"].includes(reason)) {
    return {
      sessionId,
      name: "message.failed",
      data: { reason, message: reason === "aborted" ? "已停止生成" : "模型响应失败" },
    };
  }
  return undefined;
}

function readUserMessage(value: unknown): string {
  if (!isRecord(value) || value.role !== "user") return "";
  return readMessageText(value.content);
}

function readToolEvent(
  event: Record<string, unknown>,
  detail: "input" | "output",
): {
  toolCallId: string;
  toolName: string;
  input?: ToolDisplayPayload;
  output?: ToolDisplayPayload;
} | null {
  const toolCallId = readBoundedText(event.toolCallId, MAX_TOOL_CALL_ID_CHARS);
  const toolName = readBoundedText(event.toolName, MAX_TOOL_NAME_CHARS);
  if (!toolCallId || !toolName) return null;
  const display =
    detail === "input"
      ? projectToolDisplay(event.args ?? event.arguments ?? event.input)
      : projectToolOutput(event.result ?? event.output);
  return detail === "input"
    ? { toolCallId, toolName, ...(display ? { input: display } : {}) }
    : { toolCallId, toolName, ...(display ? { output: display } : {}) };
}

function describeQueue(session: PiSessionLike): QueuedMessages {
  return {
    steering: boundedQueue(session.getSteeringMessages()) ?? [],
    followUp: boundedQueue(session.getFollowUpMessages()) ?? [],
  };
}

function readQueueEvent(event: Record<string, unknown>): QueuedMessages | null {
  const steering = boundedQueue(event.steering);
  const followUp = boundedQueue(event.followUp);
  return steering && followUp ? { steering, followUp } : null;
}

function boundedQueue(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  let total = 0;
  const messages: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.length > 200_000) return null;
    total += item.length;
    if (total > 400_000) return null;
    messages.push(item);
  }
  return messages;
}

function readBoundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 && text.length <= maximumLength ? text : null;
}

function releaseSession(managed: ManagedSession): void {
  try {
    managed.unsubscribe();
  } finally {
    managed.session.dispose();
  }
}

function describeConfiguration(
  session: PiSessionLike,
  defaultToolNames: string[],
): SessionConfiguration {
  const available = resolveThinkingAvailability(session).levels;
  const current = readSessionThinkingLevel(session);
  const model = readSessionModel(session);
  const availableTools = readAvailableTools(session);
  const availableToolNames = new Set(availableTools.map((tool) => tool.name));
  return {
    model: model ? (toAgentModel(model)[0] ?? null) : null,
    thinkingLevel: clampThinkingLevel(current, available),
    availableThinkingLevels: available,
    availableTools,
    activeToolNames: readActiveToolNames(session).filter((name) => availableToolNames.has(name)),
    defaultToolNames: defaultToolNames.filter((name) => availableToolNames.has(name)),
  };
}

type ThinkingAvailabilitySource = "sdk" | "model" | "fallback";

interface ThinkingAvailability {
  levels: ThinkingLevel[];
  source: ThinkingAvailabilitySource;
}

function resolveThinkingAvailability(session: PiSessionLike): ThinkingAvailability {
  let capabilityGetter: PiSessionLike["getAvailableThinkingLevels"];
  try {
    capabilityGetter = session.getAvailableThinkingLevels;
  } catch {
    capabilityGetter = undefined;
  }
  if (typeof capabilityGetter === "function") {
    try {
      const candidate = capabilityGetter.call(session);
      if (isValidThinkingLevelList(candidate)) {
        return { levels: normalizeThinkingLevels(candidate), source: "sdk" };
      }
    } catch {
      // Fall through to the model metadata. Pi model metadata is the
      // compatible fallback for SDK versions without the capability method.
    }
  }

  let model: PiModelLike | undefined;
  try {
    model = session.model;
  } catch {
    return { levels: ["off"], source: "fallback" };
  }
  try {
    const derived = getSupportedThinkingLevels(model);
    if (derived.length > 0) {
      // Without an SDK capability method, a model that omits its map only
      // supplies Pi's conservative standard inference. Keep setter failures
      // non-fatal in that compatibility mode; an explicit map is authoritative.
      return {
        levels: derived,
        source: hasExplicitThinkingLevelMap(model) ? "model" : "fallback",
      };
    }
  } catch {
    // A malformed model object is treated like an SDK without capability data.
  }
  return { levels: ["off"], source: "fallback" };
}

function isValidThinkingLevelList(value: unknown): value is ThinkingLevel[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > THINKING_LEVELS.length) {
    return false;
  }
  const seen = new Set<ThinkingLevel>();
  for (const level of value) {
    if (!isThinkingLevel(level) || seen.has(level)) return false;
    seen.add(level);
  }
  return true;
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

function readSessionModel(session: PiSessionLike): PiModelLike | undefined {
  try {
    return session.model;
  } catch {
    return undefined;
  }
}

function readSessionThinkingLevel(session: PiSessionLike): ThinkingLevel {
  try {
    return isThinkingLevel(session.thinkingLevel) ? session.thinkingLevel : "off";
  } catch {
    return "off";
  }
}

function readModelSupportsThinking(session: PiSessionLike): boolean {
  const model = readSessionModel(session);
  try {
    return model?.reasoning === true;
  } catch {
    return false;
  }
}

function hasExplicitThinkingLevelMap(model: PiModelLike | undefined): boolean {
  try {
    const map = model?.thinkingLevelMap;
    return typeof map === "object" && map !== null && !Array.isArray(map);
  } catch {
    return false;
  }
}

function readAvailableTools(session: PiSessionLike): AgentTool[] {
  if (typeof session.getAllTools !== "function") return [];
  try {
    return normalizeAvailableTools(session.getAllTools());
  } catch {
    return [];
  }
}

function normalizeAvailableTools(candidates: PiToolLike[]): AgentTool[] {
  const tools: AgentTool[] = [];
  const names = new Set<string>();
  for (const candidate of candidates) {
    if (tools.length >= MAX_AVAILABLE_TOOLS) break;
    const name = readBoundedText(candidate?.name, MAX_TOOL_NAME_CHARS);
    if (!name || names.has(name)) continue;
    names.add(name);
    const description =
      typeof candidate.description === "string"
        ? candidate.description.trim().slice(0, MAX_TOOL_DESCRIPTION_CHARS)
        : "";
    tools.push({ name, description });
  }
  return tools;
}

function readActiveToolNames(session: PiSessionLike): string[] {
  if (typeof session.getActiveToolNames !== "function") return [];
  try {
    return normalizeActiveToolNames(session.getActiveToolNames());
  } catch {
    return [];
  }
}

function normalizeActiveToolNames(candidates: string[]): string[] {
  const names = new Set<string>();
  for (const candidate of candidates) {
    const name = readBoundedText(candidate, MAX_TOOL_NAME_CHARS);
    if (name) names.add(name);
  }
  return [...names];
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function toAgentModel(model: PiModelLike): AgentModel[] {
  if (!model.provider || !model.id) {
    return [];
  }
  return [
    {
      provider: model.provider,
      id: model.id,
      name: model.name?.trim() || model.id,
      reasoning: Boolean(model.reasoning),
    },
  ];
}

function uniqueAgentModels(models: PiModelLike[]): AgentModel[] {
  const unique = new Map<string, AgentModel>();
  for (const model of models.flatMap((candidate) => toAgentModel(candidate))) {
    const key = `${model.provider}\u0000${model.id}`;
    if (!unique.has(key)) unique.set(key, model);
  }
  return [...unique.values()];
}

export function readContextUsage(session: PiSessionLike): ContextUsage | null {
  let candidate: unknown;
  try {
    candidate = session.getContextUsage?.();
    if (candidate === undefined || candidate === null) {
      const stats = session.getSessionStats?.();
      candidate = isRecord(stats) ? stats.contextUsage : undefined;
    }
  } catch {
    return null;
  }
  if (!isRecord(candidate)) return null;
  const tokens = Number(candidate.tokens);
  const contextWindow = Number(candidate.contextWindow);
  const suppliedPercent = Number(candidate.percent);
  if (
    !Number.isFinite(tokens) ||
    !Number.isFinite(contextWindow) ||
    tokens < 0 ||
    contextWindow <= 0
  ) {
    return null;
  }
  const computedPercent = (tokens / contextWindow) * 100;
  const percent = Number.isFinite(suppliedPercent) ? suppliedPercent : computedPercent;
  return {
    tokens: Math.round(tokens),
    contextWindow: Math.round(contextWindow),
    percent: Math.min(100, Math.max(0, percent)),
  };
}

function toSessionSummary(session: PiSessionInfoLike): AgentSessionSummary[] {
  if (!session.id || !session.path || !session.cwd) {
    return [];
  }
  const created = toIsoString(session.created);
  const modified = toIsoString(session.modified);
  if (!created || !modified) {
    return [];
  }
  return [
    {
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name?.trim() || null,
      created,
      modified,
      messageCount: Number.isFinite(session.messageCount) ? Math.max(0, session.messageCount) : 0,
      firstMessage: clipText(session.firstMessage, MAX_SUMMARY_CHARS),
    },
  ];
}

function toIsoString(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface PendingToolCall {
  toolName: string;
  input: unknown;
}

function summarizeMessages(messages: unknown[]): AgentMessageSummary[] {
  const start = findHistoryStart(messages);
  const pendingTools = new Map<string, PendingToolCall>();
  seedPendingToolCalls(messages, start, pendingTools);
  const selected: AgentMessageSummary[] = [];
  let characters = 0;
  history: for (let index = messages.length - 1; index >= start; index -= 1) {
    const projected = projectHistoryMessage(messages[index], pendingTools);
    for (let partIndex = projected.length - 1; partIndex >= 0; partIndex -= 1) {
      if (selected.length >= MAX_HISTORY_MESSAGES) break history;
      const message = projected[partIndex]!;
      const messageCharacters = historyMessageCharacters(message);
      if (characters + messageCharacters > MAX_HISTORY_CHARS) break history;
      characters += messageCharacters;
      selected.push(message);
    }
  }
  return selected.reverse();
}

function historyMessageCharacters(message: AgentMessageSummary): number {
  return (
    message.content.length +
    (message.toolInput?.text.length ?? 0) +
    (message.toolOutput?.text.length ?? 0)
  );
}

function findHistoryStart(messages: unknown[]): number {
  let projected = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    projected += projectedMessageCount(messages[index]);
    if (projected >= MAX_HISTORY_MESSAGES) return index;
  }
  return 0;
}

function projectedMessageCount(message: unknown): number {
  if (!isRecord(message)) return 0;
  if (message.role === "user") return hasMessageText(message.content) ? 1 : 0;
  if (message.role === "assistant") {
    if (!Array.isArray(message.content)) return hasMessageText(message.content) ? 1 : 0;
    let count = 0;
    for (const part of message.content) {
      if (
        isRecord(part) &&
        (part.type === "text" || part.type === "thinking") &&
        typeof part.text === "string" &&
        part.text.length > 0
      ) {
        count += 1;
      }
    }
    return count;
  }
  if (message.role === "toolResult") {
    return readBoundedText(message.toolCallId, MAX_TOOL_CALL_ID_CHARS) ? 1 : 0;
  }
  return 0;
}

function hasMessageText(content: unknown): boolean {
  if (typeof content === "string") return content.length > 0;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) =>
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.length > 0,
  );
}

function seedPendingToolCalls(
  messages: unknown[],
  start: number,
  pendingTools: Map<string, PendingToolCall>,
): void {
  const unresolved = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (index < start && unresolved.size === 0) break;
    const message = messages[index];
    if (!isRecord(message)) continue;
    if (index >= start && message.role === "toolResult") {
      const toolCallId = readBoundedText(message.toolCallId, MAX_TOOL_CALL_ID_CHARS);
      if (toolCallId) unresolved.add(toolCallId);
      continue;
    }
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex];
      const identity = readToolCallIdentity(part);
      if (!identity || !unresolved.has(identity.toolCallId)) continue;
      pendingTools.set(identity.toolCallId, {
        toolName: identity.toolName,
        input: readToolCallInput(part),
      });
      unresolved.delete(identity.toolCallId);
    }
  }
}

function readToolCallIdentity(
  part: unknown,
): { toolCallId: string; toolName: string } | null {
  if (!isRecord(part) || (part.type !== "toolCall" && part.type !== "tool_use")) return null;
  const toolCallId = readBoundedText(part.id ?? part.toolCallId, MAX_TOOL_CALL_ID_CHARS);
  const toolName = readBoundedText(part.name ?? part.toolName, MAX_TOOL_NAME_CHARS);
  if (!toolCallId || !toolName) return null;
  return { toolCallId, toolName };
}

function readToolCallInput(part: unknown): unknown {
  if (!isRecord(part)) return undefined;
  return part.arguments ?? part.args ?? part.input;
}

function projectHistoryMessage(
  message: unknown,
  pendingTools: Map<string, PendingToolCall>,
): AgentMessageSummary[] {
  if (!isRecord(message)) return [];
  const timestamp = readTimestamp(message.timestamp);
  if (message.role === "user") {
    const content = readMessageText(message.content);
    return content ? [{ role: "user", content, ...(timestamp ? { timestamp } : {}) }] : [];
  }
  if (message.role === "assistant") {
    if (!Array.isArray(message.content)) {
      const content = readMessageText(message.content);
      return content ? [{ role: "assistant", content, ...(timestamp ? { timestamp } : {}) }] : [];
    }
    const projected: AgentMessageSummary[] = [];
    for (const part of message.content) {
      if (!isRecord(part) || typeof part.text !== "string" || !part.text) continue;
      if (part.type === "thinking") {
        projected.push({ role: "thinking", content: part.text, ...(timestamp ? { timestamp } : {}) });
      } else if (part.type === "text") {
        projected.push({ role: "assistant", content: part.text, ...(timestamp ? { timestamp } : {}) });
      }
    }
    return projected;
  }
  if (message.role === "toolResult") {
    const toolCallId = readBoundedText(message.toolCallId, MAX_TOOL_CALL_ID_CHARS);
    const pending = toolCallId ? pendingTools.get(toolCallId) : undefined;
    const toolName =
      readBoundedText(message.toolName, MAX_TOOL_NAME_CHARS) ?? pending?.toolName ?? null;
    if (!toolCallId || !toolName) return [];
    pendingTools.delete(toolCallId);
    const toolInput = pending ? projectToolDisplay(pending.input) : undefined;
    const toolOutput = projectToolOutput(message.content ?? message.result ?? message.output);
    return [
      {
        role: "tool",
        content: "",
        toolCallId,
        toolName,
        ...(toolInput ? { toolInput } : {}),
        ...(toolOutput ? { toolOutput } : {}),
        isError: message.isError === true,
        ...(timestamp ? { timestamp } : {}),
      },
    ];
  }
  return [];
}

function readTimestamp(value: unknown): string | undefined {
  const date = typeof value === "number" || typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function readMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("");
}

type SanitizedToolValue =
  | null
  | boolean
  | number
  | string
  | SanitizedToolValue[]
  | { [key: string]: SanitizedToolValue };

interface ToolSanitizeState {
  seen: WeakSet<object>;
  truncated: boolean;
}

function projectToolOutput(value: unknown): ToolDisplayPayload | undefined {
  const displayValue = isRecord(value) && "content" in value ? value.content : value;
  const content = readToolOutputText(displayValue);
  if (content) return createToolDisplayPayload(content, "text", false);
  return projectToolDisplay(displayValue);
}

function readToolOutputText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!isRecord(block)) return [];
      if (block.type === "text" && typeof block.text === "string") return [block.text];
      if (block.type === "image" || block.type === "image_url") return ["[image omitted]"];
      return [];
    })
    .join("");
}

function projectToolDisplay(value: unknown): ToolDisplayPayload | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return createToolDisplayPayload(value, "text", false);
  const state: ToolSanitizeState = { seen: new WeakSet(), truncated: false };
  const sanitized = sanitizeToolValue(value, 0, state);
  if (sanitized === undefined) return undefined;
  let text: string | undefined;
  try {
    text = JSON.stringify(sanitized, null, 2);
  } catch {
    return undefined;
  }
  return text ? createToolDisplayPayload(text, "json", state.truncated) : undefined;
}

function sanitizeToolValue(
  value: unknown,
  depth: number,
  state: ToolSanitizeState,
): SanitizedToolValue | undefined {
  if (value === null) return null;
  if (typeof value === "string") return redactInlineSecrets(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return undefined;
  if (depth >= MAX_TOOL_DISPLAY_DEPTH) {
    state.truncated = true;
    return TRUNCATED_TOOL_VALUE;
  }
  if (state.seen.has(value)) {
    state.truncated = true;
    return "[CIRCULAR]";
  }

  if (isRecord(value) && (value.type === "image" || value.type === "image_url")) {
    state.truncated = true;
    return "[image omitted]";
  }

  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_TOOL_DISPLAY_ENTRIES) state.truncated = true;
      return value.slice(0, MAX_TOOL_DISPLAY_ENTRIES).map((item) => {
        return sanitizeToolValue(item, depth + 1, state) ?? null;
      });
    }

    const entries = Object.entries(value);
    if (entries.length > MAX_TOOL_DISPLAY_ENTRIES) state.truncated = true;
    const sanitized: { [key: string]: SanitizedToolValue } = {};
    for (const [key, item] of entries.slice(0, MAX_TOOL_DISPLAY_ENTRIES)) {
      if (SENSITIVE_TOOL_KEY.test(key)) {
        sanitized[key] = REDACTED_TOOL_VALUE;
        continue;
      }
      const projected = sanitizeToolValue(item, depth + 1, state);
      if (projected !== undefined) sanitized[key] = projected;
    }
    return sanitized;
  } finally {
    state.seen.delete(value);
  }
}

function createToolDisplayPayload(
  value: string,
  format: ToolDisplayPayload["format"],
  structurallyTruncated: boolean,
): ToolDisplayPayload | undefined {
  const redacted = redactInlineSecrets(value);
  if (!redacted.trim()) return undefined;
  const truncated = redacted.length > MAX_TOOL_DISPLAY_CHARS;
  return {
    text: truncated ? redacted.slice(0, MAX_TOOL_DISPLAY_CHARS) : redacted,
    format,
    truncated: structurallyTruncated || truncated,
  };
}

function redactInlineSecrets(value: string): string {
  return value
    .replace(
      /\b(authorization)(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}${REDACTED_TOOL_VALUE}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|credentials?|cookie|secret|token)(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}${REDACTED_TOOL_VALUE}`,
    );
}

function clipText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength - 1)}…`;
}

function validateSessionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SESSION_IDS) {
    throw new RuntimeError("SESSION_IDS_INVALID", `会话 id 必须为 1-${MAX_SESSION_IDS} 项的数组`);
  }
  const ids = new Set<string>();
  for (const item of value) {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (
      typeof item !== "string" ||
      normalized.length === 0 ||
      item.length > MAX_SESSION_ID_CHARS ||
      /[\r\n\0]/.test(item) ||
      ids.has(normalized)
    ) {
      throw new RuntimeError("SESSION_IDS_INVALID", "会话 id 包含无效或重复值");
    }
    ids.add(normalized);
  }
  return [...ids];
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function mapRuntimeError(error: unknown, code: string, message: string): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError(code, message);
}
