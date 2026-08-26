import { existsSync } from "node:fs";
import { basename, isAbsolute, join, win32 } from "node:path";

import {
  THINKING_LEVELS,
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

export interface PiModelLike {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
  readonly reasoning?: boolean;
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
    skills: Array<{ name: string; filePath: string; sourceInfo?: { source?: string } }>;
  };
  getPrompts?(): {
    prompts: Array<{ name: string; filePath: string; sourceInfo?: { source?: string } }>;
  };
  getThemes?(): { themes: Array<{ name?: string; path?: string }> };
  getAgentsFiles?(): { agentsFiles: Array<{ path: string }> };
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
  prompt(text: string, options?: { streamingBehavior?: PromptStreamingBehavior }): Promise<void>;
  clearQueue(): void;
  getSteeringMessages(): string[];
  getFollowUpMessages(): string[];
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  setModel(model: PiModelLike): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): void;
  getAvailableThinkingLevels(): ThinkingLevel[];
  getActiveToolNames?(): string[];
  getAllTools?(): PiToolLike[];
  getContextUsage?(): unknown;
  getSessionStats?(): unknown;
  setActiveToolsByName?(toolNames: string[]): void;
  reload?(): Promise<void>;
  dispose(): void;
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

export interface AgentMessageSummary {
  role: "user" | "assistant" | "thinking" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolName?: string;
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
  configureSession(
    sessionId: string,
    update: { model?: ModelSelection; thinkingLevel?: ThinkingLevel },
  ): Promise<SessionConfiguration>;
  prompt(
    sessionId: string,
    text: string,
    streamingBehavior?: PromptStreamingBehavior,
    activeTools?: string[],
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
}

const MAX_HISTORY_MESSAGES = 200;
const MAX_HISTORY_CHARS = 400_000;
const MAX_SUMMARY_CHARS = 240;
const MAX_TOOL_CALL_ID_CHARS = 256;
const MAX_TOOL_NAME_CHARS = 128;
const MAX_TOOL_DESCRIPTION_CHARS = 1_024;
const MAX_AVAILABLE_TOOLS = 256;

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

function normalizeRuntimePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export class PiSessionRuntime implements SessionRuntime {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private modelRuntimePromise: Promise<PiModelRuntimeLike> | undefined;
  private readonly sessions = new Map<string, ManagedSession>();
  private requestHeaderSettings: RequestHeaderSettings = { ...DEFAULT_REQUEST_HEADER_SETTINGS };
  private closed = false;

  constructor(
    private readonly sdk: PiSdkLike,
    private readonly agentDir: string,
  ) {}

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
    try {
      const modelRuntime = await this.getModelRuntime();
      const resourceLoader = await this.createResourceLoader(cwd);
      const result = await this.sdk.createAgentSession({
        cwd,
        agentDir: this.agentDir,
        modelRuntime,
        sessionManager: this.sdk.SessionManager.create(cwd),
        ...(resourceLoader ? { resourceLoader } : {}),
      });
      return this.activateSession(result, cwd, resourceLoader);
    } catch (error) {
      throw mapRuntimeError(error, "SESSION_CREATE_FAILED", "无法创建 Pi 会话");
    }
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

  async openSession(sessionPath: string): Promise<CreatedAgentSession> {
    this.ensureOpen();
    const existing = [...this.sessions.values()].find(
      (managed) => managed.session.sessionFile === sessionPath,
    );
    if (existing) {
      return describeManagedSession(existing);
    }
    try {
      const sessionManager = this.sdk.SessionManager.open(sessionPath);
      const cwd = sessionManager.getCwd?.() ?? "";
      const modelRuntime = await this.getModelRuntime();
      const resourceLoader = await this.createResourceLoader(cwd || process.cwd());
      const result = await this.sdk.createAgentSession({
        ...(cwd ? { cwd } : {}),
        agentDir: this.agentDir,
        modelRuntime,
        sessionManager,
        ...(resourceLoader ? { resourceLoader } : {}),
      });
      return this.activateSession(result, cwd, resourceLoader);
    } catch (error) {
      throw mapRuntimeError(error, "SESSION_OPEN_FAILED", "无法打开所选 Pi 会话");
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
    try {
      if (typeof this.sdk.DefaultResourceLoader !== "function") {
        throw new RuntimeError("RESOURCE_LIST_UNSUPPORTED", "当前 Pi SDK 不支持资源清单");
      }
      const loader = new this.sdk.DefaultResourceLoader({
        cwd,
        agentDir: this.agentDir,
        extensionFactories: [],
      });
      await loader.reload();
      return listResourcesFromLoader(loader, cwd, this.agentDir);
    } catch (error) {
      throw mapRuntimeError(error, "RESOURCE_LIST_FAILED", "无法读取 Pi 资源与技能");
    }
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

    if (update.model) {
      const model = (await this.getModelRuntime()).getModel(update.model.provider, update.model.id);
      if (!model) {
        throw new RuntimeError("MODEL_NOT_FOUND", "所选模型不在当前 Pi 配置中");
      }
      try {
        await managed.session.setModel(model);
      } catch {
        throw new RuntimeError("MODEL_UPDATE_FAILED", "无法切换到所选模型");
      }
    }

    if (update.thinkingLevel) {
      try {
        managed.session.setThinkingLevel(update.thinkingLevel);
      } catch {
        throw new RuntimeError("THINKING_LEVEL_UPDATE_FAILED", "无法更新思考强度");
      }
    }
    return describeConfiguration(managed.session, managed.defaultToolNames);
  }

  async prompt(
    sessionId: string,
    text: string,
    streamingBehavior?: PromptStreamingBehavior,
    activeTools?: string[],
  ): Promise<void> {
    this.ensureOpen();
    try {
      const managed = this.requireSession(sessionId);
      if (activeTools !== undefined) {
        this.applyActiveTools(managed, activeTools);
      }
      managed.lastActivityAt = new Date().toISOString();
      await managed.session.prompt(
        text,
        streamingBehavior === undefined ? undefined : { streamingBehavior },
      );
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
    this.modelRuntimePromise ??= this.sdk.ModelRuntime.create({
      authPath: join(this.agentDir, "auth.json"),
      modelsPath: join(this.agentDir, "models.json"),
    });
    return this.modelRuntimePromise;
  }

  private async createResourceLoader(cwd: string): Promise<PiResourceLoaderLike | undefined> {
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
    await resourceLoader.reload();
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
      ...(resourceLoader ? { resourceLoader } : {}),
    };
    this.sessions.set(session.sessionId, managed);

    return {
      ...describeManagedSession(managed),
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
    if (managed) managed.lastActivityAt = new Date().toISOString();

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
      const tool = readToolEvent(event);
      if (tool) {
        runtimeEvent = {
          sessionId: session.sessionId,
          name: "tool.started",
          data: tool,
        };
      }
    } else if (event.type === "tool_execution_end") {
      const tool = readToolEvent(event);
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

function describeManagedSession(managed: ManagedSession): CreatedAgentSession {
  return {
    sessionId: managed.session.sessionId,
    cwd: managed.cwd,
    sessionPath: managed.session.sessionFile ?? null,
    configuration: describeConfiguration(managed.session, managed.defaultToolNames),
    messages: summarizeMessages(managed.session.messages),
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
  const messages = summarizeMessages(managed.session.messages);
  const firstMessage = messages.find((message) => message.role === "user")?.content ?? "";
  return {
    id: managed.session.sessionId,
    path,
    cwd: managed.cwd,
    name: disk.name,
    created: disk.created,
    modified: managed.lastActivityAt > disk.modified ? managed.lastActivityAt : disk.modified,
    messageCount: Math.max(disk.messageCount, messages.filter(isConversationMessage).length),
    firstMessage: clipText(firstMessage || disk.firstMessage, MAX_SUMMARY_CHARS),
  };
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

function readToolEvent(event: Record<string, unknown>): {
  toolCallId: string;
  toolName: string;
} | null {
  const toolCallId = readBoundedText(event.toolCallId, MAX_TOOL_CALL_ID_CHARS);
  const toolName = readBoundedText(event.toolName, MAX_TOOL_NAME_CHARS);
  return toolCallId && toolName ? { toolCallId, toolName } : null;
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
  const available = session
    .getAvailableThinkingLevels()
    .filter((level): level is ThinkingLevel => THINKING_LEVELS.includes(level));
  const availableTools = readAvailableTools(session);
  const availableToolNames = new Set(availableTools.map((tool) => tool.name));
  return {
    model: session.model ? (toAgentModel(session.model)[0] ?? null) : null,
    thinkingLevel: THINKING_LEVELS.includes(session.thinkingLevel) ? session.thinkingLevel : "off",
    availableThinkingLevels: available.length > 0 ? available : ["off"],
    availableTools,
    activeToolNames: readActiveToolNames(session).filter((name) => availableToolNames.has(name)),
    defaultToolNames: defaultToolNames.filter((name) => availableToolNames.has(name)),
  };
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

function summarizeMessages(messages: unknown[]): AgentMessageSummary[] {
  const summaries = messages.flatMap(projectHistoryMessage);

  const selected: AgentMessageSummary[] = [];
  let characters = 0;
  for (const message of summaries.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    if (characters + message.content.length > MAX_HISTORY_CHARS) {
      break;
    }
    characters += message.content.length;
    selected.push(message);
  }
  return selected.reverse();
}

function projectHistoryMessage(message: unknown): AgentMessageSummary[] {
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
    const toolName = readBoundedText(message.toolName, MAX_TOOL_NAME_CHARS);
    if (!toolCallId || !toolName) return [];
    return [
      {
        role: "tool",
        content: "",
        toolCallId,
        toolName,
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

function clipText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= maximumLength
    ? normalized
    : `${normalized.slice(0, maximumLength - 1)}…`;
}

function mapRuntimeError(error: unknown, code: string, message: string): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError(code, message);
}
