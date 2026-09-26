import { randomUUID } from "node:crypto";
import type { PiModelLike } from "./session-runtime.js";
import {
  ProviderSettingsError,
  boundedText,
  readModelConfig,
  record,
  safeWebUrl,
  saveProviderModel,
  validateProviderId,
  type ProviderModelInput,
} from "./provider-config.js";

export interface ProviderModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  available: boolean;
}
export interface ProviderSummary {
  id: string;
  name: string;
  oauth: boolean;
  connected: boolean;
  authType: "oauth" | "api_key" | null;
  storedCredential: boolean;
  custom: boolean;
  models: ProviderModel[];
}
export interface ProviderSnapshot {
  providers: ProviderSummary[];
  defaultModel: { provider: string; id: string } | null;
  revision: string;
  warning: string | null;
}
export interface LoginPrompt {
  id: string;
  type: "text" | "manual_code" | "select";
  message: string;
  options?: Array<{ id: string; label: string }>;
}
export interface ProviderLogin {
  id: string;
  provider: string;
  status: "pending" | "success" | "cancelled" | "error";
  message: string;
  url: string | null;
  userCode: string | null;
  prompt: LoginPrompt | null;
  errorCode: string | null;
}
interface AuthPrompt {
  type: "text" | "secret" | "manual_code" | "select";
  message: string;
  signal?: AbortSignal;
  options?: ReadonlyArray<{ id: string; label: string }>;
}
interface AuthEvent {
  type: string;
  message?: string;
  url?: string;
  userCode?: string;
  verificationUri?: string;
  links?: ReadonlyArray<{ url: string }>;
}
export interface OfficialProviderRuntime {
  getModels?(): PiModelLike[];
  getAvailable?(): Promise<PiModelLike[]>;
  getModel(provider: string, id: string): PiModelLike | undefined;
  getProviders?(): ReadonlyArray<{
    id: string;
    name?: string;
    auth?: { oauth?: unknown };
  }>;
  getProviderAuthStatus?(provider: string): { configured: boolean };
  isUsingOAuth?(provider: string): boolean;
  listCredentials?(): Promise<
    ReadonlyArray<{ providerId: string; type: "oauth" | "api_key" }>
  >;
  login?(
    provider: string,
    type: "oauth",
    interaction: {
      signal: AbortSignal;
      prompt(prompt: AuthPrompt): Promise<string>;
      notify(event: AuthEvent): void;
    },
  ): Promise<unknown>;
  logout?(provider: string): Promise<void>;
  refresh?(options: {
    allowNetwork: boolean;
    signal?: AbortSignal;
  }): Promise<unknown>;
  getError?(): string | undefined;
}
export interface OfficialModelSettings {
  getDefaultProvider?(): string | undefined;
  getDefaultModel?(): string | undefined;
  setDefaultModelAndProvider?(provider: string, model: string): void;
  flush?(): Promise<void>;
  drainErrors?(): unknown[];
}
interface LoginTask {
  state: ProviderLogin;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  reply?: {
    id: string;
    resolve(value: string): void;
    reject(error: Error): void;
  };
}

const LOGIN_TIMEOUT = 10 * 60 * 1000;
const terminal = (state: ProviderLogin) => state.status !== "pending";
function displayText(value: string): string {
  return value
    .slice(0, 600)
    .replace(
      /(?:Bearer\s+|(?:access_token|refresh_token|api_key|authorization)\s*[:=]\s*)\S+/gi,
      "[已隐藏]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[已隐藏]");
}

/** Owns UI interaction only; all authentication and token persistence belong to Pi. */
export class ProviderSettingsService {
  private task?: LoginTask;
  private starting = false;
  private saving = false;
  private closed = false;

  constructor(
    private readonly agentDir: string,
    private readonly getRuntime: () => Promise<OfficialProviderRuntime>,
    private readonly getSettings: () => OfficialModelSettings,
  ) {}

  async snapshot(refresh = false): Promise<ProviderSnapshot> {
    this.ensureOpen();
    const runtime = await this.getRuntime();
    if (!runtime.getProviders) throw this.unsupported();
    if (refresh && runtime.refresh)
      await runtime.refresh({ allowNetwork: false });
    const config = await readModelConfig(this.agentDir);
    const available = (await runtime.getAvailable?.()) ?? [];
    const keys = new Set(
      available.map((model) => `${model.provider}\0${model.id}`),
    );
    const credentials = (await runtime.listCredentials?.()) ?? [];
    const models = runtime.getModels?.() ?? available;
    if (models.length > 4000)
      throw new ProviderSettingsError(
        "MODEL_CATALOG_TOO_LARGE",
        "模型目录过大，请使用 Pi CLI 缩小目录后重试",
      );
    const providers = runtime
      .getProviders()
      .map((provider): ProviderSummary => {
        const credential = credentials.find(
          (entry) => entry.providerId === provider.id,
        );
        return {
          id: provider.id,
          name: provider.name || provider.id,
          oauth: Boolean(provider.auth?.oauth),
          connected:
            runtime.getProviderAuthStatus?.(provider.id).configured ??
            available.some((model) => model.provider === provider.id),
          authType: runtime.isUsingOAuth?.(provider.id)
            ? "oauth"
            : (credential?.type ??
              (available.some((model) => model.provider === provider.id)
                ? "api_key"
                : null)),
          storedCredential: Boolean(credential),
          custom: Object.hasOwn(config.providers, provider.id),
          models: models
            .filter((model) => model.provider === provider.id)
            .map((model) => ({
              provider: model.provider,
              id: model.id,
              name: model.name || model.id,
              reasoning: model.reasoning === true,
              available: keys.has(`${model.provider}\0${model.id}`),
            })),
        };
      })
      .sort(
        (a, b) =>
          Number(b.connected) - Number(a.connected) ||
          a.name.localeCompare(b.name),
      );
    const settings = this.getSettings();
    const provider = settings.getDefaultProvider?.();
    const id = settings.getDefaultModel?.();
    return {
      providers,
      defaultModel: provider && id ? { provider, id } : null,
      revision: config.revision,
      warning: runtime.getError?.()
        ? "Pi 报告部分模型配置不可用，请检查 models.json；可用模型仍可选择。"
        : null,
    };
  }

  async setDefault(provider: string, id: string): Promise<void> {
    this.ensureOpen();
    validateProviderId(provider);
    boundedText(id, 256, "模型 ID");
    const runtime = await this.getRuntime();
    const available = (await runtime.getAvailable?.()) ?? [];
    if (
      !available.some((model) => model.provider === provider && model.id === id)
    )
      throw new ProviderSettingsError(
        "MODEL_UNAVAILABLE",
        "该模型尚未连接或已不可用，请先登录或配置认证并刷新",
      );
    const settings = this.getSettings();
    if (!settings.setDefaultModelAndProvider || !settings.flush)
      throw this.unsupported();
    settings.setDefaultModelAndProvider(provider, id);
    await settings.flush();
    if (settings.drainErrors?.().length)
      throw new ProviderSettingsError(
        "DEFAULT_MODEL_SAVE_FAILED",
        "默认模型未能写入 Pi 设置，请检查目录权限",
      );
  }

  async saveModel(input: ProviderModelInput): Promise<void> {
    this.ensureOpen();
    if (this.saving)
      throw new ProviderSettingsError(
        "MODEL_CONFIG_BUSY",
        "模型配置正在保存，请稍后重试",
      );
    this.saving = true;
    try {
      const runtime = await this.getRuntime();
      if (!runtime.refresh) throw this.unsupported();
      await saveProviderModel(this.agentDir, input);
      try {
        await runtime.refresh({ allowNetwork: false });
      } catch {
        throw new ProviderSettingsError(
          "MODEL_REFRESH_FAILED",
          "模型配置已保存，但 Pi 刷新失败，请重新加载或重启应用",
        );
      }
    } finally {
      this.saving = false;
    }
  }

  async startLogin(provider: string): Promise<ProviderLogin> {
    this.ensureOpen();
    validateProviderId(provider);
    if (this.starting || (this.task && !terminal(this.task.state)))
      throw new ProviderSettingsError("LOGIN_BUSY", "请完成或取消当前账户登录");
    this.starting = true;
    try {
      const runtime = await this.getRuntime();
      this.ensureOpen();
      if (
        !runtime.login ||
        !runtime
          .getProviders?.()
          .some((item) => item.id === provider && item.auth?.oauth)
      )
        throw new ProviderSettingsError(
          "OAUTH_UNSUPPORTED",
          "当前 Pi SDK 未为此提供商提供账户登录，请使用模型配置或升级 Pi",
        );
      const controller = new AbortController();
      const task: LoginTask = {
        controller,
        state: {
          id: randomUUID(),
          provider,
          status: "pending",
          message: "正在启动 Pi 官方登录…",
          url: null,
          userCode: null,
          prompt: null,
          errorCode: null,
        },
        timer: setTimeout(() => {
          this.finish(
            task,
            "error",
            "登录等待超时，请重新登录",
            "LOGIN_TIMEOUT",
          );
          controller.abort();
        }, LOGIN_TIMEOUT),
      };
      task.timer.unref?.();
      this.task = task;
      void Promise.resolve()
        .then(() =>
          runtime.login!(provider, "oauth", {
            signal: controller.signal,
            prompt: (prompt) => this.prompt(task, prompt),
            notify: (event) => this.notify(task, event),
          }),
        )
        .then(
          () => {
            if (!terminal(task.state))
              this.finish(task, "success", "账户已连接，Pi 将管理凭据刷新");
          },
          (error: unknown) => {
            if (!terminal(task.state))
              this.finish(
                task,
                "error",
                error instanceof ProviderSettingsError
                  ? error.message
                  : "Pi 官方登录未完成，请重试并检查网络或账户权限",
                error instanceof ProviderSettingsError
                  ? error.code
                  : "LOGIN_FAILED",
              );
          },
        );
      return this.copy(task);
    } finally {
      this.starting = false;
    }
  }

  status(id: string): ProviderLogin {
    return this.copy(this.requireTask(id));
  }

  reply(id: string, promptId: string, value: string): ProviderLogin {
    const task = this.requireTask(id);
    if (terminal(task.state) || !task.reply || task.reply.id !== promptId)
      throw new ProviderSettingsError(
        "LOGIN_PROMPT_EXPIRED",
        "登录提示已失效，请按当前步骤操作",
      );
    boundedText(value, 8192, "登录输入");
    if (
      task.state.prompt?.type === "select" &&
      !task.state.prompt.options?.some((option) => option.id === value)
    )
      throw new ProviderSettingsError(
        "INVALID_LOGIN_CHOICE",
        "请选择当前提示中的选项",
      );
    task.reply.resolve(value.trim());
    return this.copy(task);
  }

  cancel(id: string): ProviderLogin {
    const task = this.requireTask(id);
    if (!terminal(task.state)) {
      this.finish(task, "cancelled", "已取消账户登录");
      task.controller.abort();
    }
    return this.copy(task);
  }

  async logout(provider: string): Promise<void> {
    this.ensureOpen();
    validateProviderId(provider);
    if (this.starting || (this.task && !terminal(this.task.state)))
      throw new ProviderSettingsError("LOGIN_BUSY", "请先完成或取消账户登录");
    const runtime = await this.getRuntime();
    if (
      !runtime.logout ||
      !runtime.getProviders?.().some((item) => item.id === provider)
    )
      throw this.unsupported();
    await runtime.logout(provider);
  }

  close(): void {
    this.closed = true;
    if (this.task && !terminal(this.task.state))
      this.cancel(this.task.state.id);
  }

  private prompt(task: LoginTask, prompt: AuthPrompt): Promise<string> {
    if (
      terminal(task.state) ||
      task.controller.signal.aborted ||
      prompt.signal?.aborted
    )
      return Promise.reject(new Error("Login cancelled"));
    if (prompt.type === "secret")
      return Promise.reject(
        new ProviderSettingsError(
          "LOGIN_SECRET_UNSUPPORTED",
          "此官方登录步骤需要密钥输入，请在 Pi CLI 中完成 /login 后刷新；桌面不会接收或读取密钥",
        ),
      );
    if (task.reply)
      return Promise.reject(
        new ProviderSettingsError(
          "LOGIN_PROMPT_CONFLICT",
          "登录步骤发生冲突，请取消后重试",
        ),
      );
    const id = randomUUID();
    task.state.prompt = {
      id,
      type: prompt.type,
      message: displayText(prompt.message),
      ...(prompt.type === "select"
        ? {
            options: (prompt.options ?? [])
              .slice(0, 64)
              .map((option) => ({
                id: option.id,
                label: displayText(option.label),
              })),
          }
        : {}),
    };
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        prompt.signal?.removeEventListener("abort", abort);
        task.controller.signal.removeEventListener("abort", abort);
        if (task.reply?.id === id) {
          task.reply = undefined;
          task.state.prompt = null;
        }
      };
      const abort = () => {
        cleanup();
        reject(new Error("Login cancelled"));
      };
      task.reply = {
        id,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      prompt.signal?.addEventListener("abort", abort, { once: true });
      task.controller.signal.addEventListener("abort", abort, { once: true });
    });
  }

  private notify(task: LoginTask, event: AuthEvent): void {
    if (terminal(task.state)) return;
    if (event.type === "auth_url" || event.type === "device_code") {
      const url = safeWebUrl(
        event.type === "auth_url" ? event.url : event.verificationUri,
      );
      if (!url) {
        this.finish(
          task,
          "error",
          "Pi 返回了不安全的授权链接，已停止登录",
          "INVALID_AUTH_URL",
        );
        task.controller.abort();
        return;
      }
      task.state.url = url;
      task.state.userCode =
        event.type === "device_code"
          ? (event.userCode ?? "").slice(0, 256)
          : null;
      task.state.message = "请打开官方授权页面，完成后返回此处";
    } else {
      task.state.message = event.message
        ? displayText(event.message)
        : "等待 Pi 官方认证完成…";
      const link = event.links
        ?.map((item) => safeWebUrl(item.url))
        .find(Boolean);
      if (link && !task.state.url) task.state.url = link;
    }
  }

  private finish(
    task: LoginTask,
    status: ProviderLogin["status"],
    message: string,
    code: string | null = null,
  ): void {
    clearTimeout(task.timer);
    task.state.status = status;
    task.state.message = message;
    task.state.errorCode = code;
    task.state.url = null;
    task.state.userCode = null;
    task.reply?.reject(new Error("Login finished"));
    task.state.prompt = null;
  }
  private requireTask(id: string): LoginTask {
    if (!this.task || this.task.state.id !== id)
      throw new ProviderSettingsError(
        "LOGIN_NOT_FOUND",
        "登录已失效，请重新开始",
      );
    return this.task;
  }
  private copy(task: LoginTask): ProviderLogin {
    return structuredClone(task.state);
  }
  private ensureOpen(): void {
    if (this.closed)
      throw new ProviderSettingsError(
        "PROVIDER_SETTINGS_CLOSED",
        "运行时已关闭，请重新连接",
      );
  }
  private unsupported(): ProviderSettingsError {
    return new ProviderSettingsError(
      "PROVIDER_SETTINGS_UNSUPPORTED",
      "当前 Pi SDK 不支持完整模型设置，请升级 Pi 后重试",
    );
  }
}
