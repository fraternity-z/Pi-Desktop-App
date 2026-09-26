import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export class ProviderSettingsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderSettingsError";
  }
}

export const MODEL_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
export interface ProviderModelInput {
  provider: string;
  baseUrl: string;
  api: (typeof MODEL_APIS)[number];
  apiKeyEnv?: string;
  modelId: string;
  modelName: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  expectedRevision: string;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateProviderId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  ) {
    throw new ProviderSettingsError(
      "INVALID_PROVIDER",
      "提供商 ID 必须为 1–128 位小写字母、数字、点、横线或下划线",
    );
  }
  return value;
}

export function boundedText(
  value: unknown,
  max: number,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new ProviderSettingsError(
      "INVALID_PROVIDER_INPUT",
      `${label}为空、过长或包含控制字符`,
    );
  }
  return value.trim();
}

export function safeWebUrl(
  value: unknown,
  allowQuery = true,
): string | undefined {
  if (typeof value !== "string" || value.length > 8192) return undefined;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      !["https:", "http:"].includes(url.protocol)
    )
      return undefined;
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return undefined;
    if (!allowQuery && (url.search || url.hash)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function validateProviderModel(value: unknown): ProviderModelInput {
  if (!record(value))
    throw new ProviderSettingsError(
      "INVALID_PROVIDER_INPUT",
      "模型配置必须是对象",
    );
  const provider = validateProviderId(value.provider);
  const baseUrl = safeWebUrl(value.baseUrl, false);
  if (!baseUrl || baseUrl.length > 2048)
    throw new ProviderSettingsError(
      "INVALID_MODEL_URL",
      "端点必须使用 HTTPS（本地服务可用 HTTP），且不能含密码、查询参数或片段",
    );
  if (!MODEL_APIS.includes(value.api as ProviderModelInput["api"]))
    throw new ProviderSettingsError(
      "INVALID_MODEL_API",
      "请选择支持的模型 API 协议",
    );
  if (
    value.apiKeyEnv !== undefined &&
    (typeof value.apiKeyEnv !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.apiKeyEnv))
  ) {
    throw new ProviderSettingsError(
      "INVALID_API_KEY_ENV",
      "只接受环境变量名称，不接受 API Key 或命令",
    );
  }
  if (typeof value.reasoning !== "boolean")
    throw new ProviderSettingsError(
      "INVALID_PROVIDER_INPUT",
      "思考能力必须为布尔值",
    );
  for (const key of ["contextWindow", "maxTokens"] as const) {
    if (
      !Number.isInteger(value[key]) ||
      (value[key] as number) < 1 ||
      (value[key] as number) > 10_000_000
    ) {
      throw new ProviderSettingsError(
        "INVALID_MODEL_LIMIT",
        "上下文与输出上限必须为 1–10,000,000 的整数",
      );
    }
  }
  if ((value.maxTokens as number) > (value.contextWindow as number))
    throw new ProviderSettingsError(
      "INVALID_MODEL_LIMIT",
      "输出上限不能超过上下文窗口",
    );
  if (
    typeof value.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.expectedRevision)
  )
    throw new ProviderSettingsError(
      "INVALID_CONFIG_REVISION",
      "请刷新配置后重试",
    );
  return {
    provider,
    baseUrl,
    api: value.api as ProviderModelInput["api"],
    ...(value.apiKeyEnv === undefined
      ? {}
      : { apiKeyEnv: value.apiKeyEnv as string }),
    modelId: boundedText(value.modelId, 256, "模型 ID"),
    modelName: boundedText(value.modelName, 256, "模型名称"),
    reasoning: value.reasoning,
    contextWindow: value.contextWindow as number,
    maxTokens: value.maxTokens as number,
    expectedRevision: value.expectedRevision,
  };
}

export interface ModelConfigDocument {
  text: string;
  revision: string;
  providers: Record<string, unknown>;
}

export async function readModelConfig(
  agentDir: string,
): Promise<ModelConfigDocument> {
  let text = "{}\n";
  try {
    const path = join(agentDir, "models.json");
    if ((await stat(path)).size > 1024 * 1024)
      throw new ProviderSettingsError(
        "MODEL_CONFIG_TOO_LARGE",
        "models.json 超过 1 MiB，请使用 Pi CLI 管理",
      );
    text = await readFile(path, "utf8");
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw new ProviderSettingsError(
        "MODEL_CONFIG_TOO_LARGE",
        "models.json 超过 1 MiB",
      );
  } catch (error) {
    if (error instanceof ProviderSettingsError) throw error;
    if (!record(error) || error.code !== "ENOENT")
      throw new ProviderSettingsError(
        "MODEL_CONFIG_READ_FAILED",
        "无法读取 Pi models.json，请检查文件权限",
      );
  }
  const errors: ParseError[] = [];
  const data: unknown = parse(text, errors, { allowTrailingComma: false });
  if (
    errors.length ||
    !record(data) ||
    (data.providers !== undefined && !record(data.providers))
  ) {
    throw new ProviderSettingsError(
      "MODEL_CONFIG_INVALID",
      "Pi models.json 格式无效；请修复原文件后刷新，不会覆盖现有内容",
    );
  }
  return {
    text,
    revision: createHash("sha256").update(text).digest("hex"),
    providers: (data.providers ?? {}) as Record<string, unknown>,
  };
}

/** Edits only the requested provider/model; never returns existing credentials. */
export async function saveProviderModel(
  agentDir: string,
  raw: unknown,
): Promise<void> {
  const input = validateProviderModel(raw);
  if (input.apiKeyEnv && !process.env[input.apiKeyEnv]?.trim()) {
    throw new ProviderSettingsError(
      "API_KEY_ENV_MISSING",
      "Bridge 尚未读取到该环境变量。请在系统中设置后重启应用，或先通过 Pi CLI 登录",
    );
  }
  const current = await readModelConfig(agentDir);
  if (current.revision !== input.expectedRevision)
    throw new ProviderSettingsError(
      "MODEL_CONFIG_CONFLICT",
      "Pi 配置已被其他操作修改，请刷新后重试",
    );
  const existing = Object.hasOwn(current.providers, input.provider)
    ? current.providers[input.provider]
    : undefined;
  if (existing !== undefined && !record(existing))
    throw new ProviderSettingsError(
      "MODEL_CONFIG_INVALID",
      "现有提供商配置格式无效，不会覆盖",
    );
  const provider = (existing ?? {}) as Record<string, unknown>;
  if (provider.models !== undefined && !Array.isArray(provider.models))
    throw new ProviderSettingsError(
      "MODEL_CONFIG_INVALID",
      "现有模型列表格式无效，不会覆盖",
    );
  const models = [...((provider.models ?? []) as unknown[])];
  const index = models.findIndex(
    (model) => record(model) && model.id === input.modelId,
  );
  const model = {
    ...(index < 0 ? {} : (models[index] as Record<string, unknown>)),
    id: input.modelId,
    name: input.modelName,
    reasoning: input.reasoning,
    contextWindow: input.contextWindow,
    maxTokens: input.maxTokens,
  };
  if (index < 0) models.push(model);
  else models[index] = model;
  let text = current.text;
  const fields: Record<string, unknown> = {
    baseUrl: input.baseUrl,
    api: input.api,
    models,
  };
  if (input.apiKeyEnv) fields.apiKey = "${" + input.apiKeyEnv + "}";
  for (const [key, value] of Object.entries(fields)) {
    text = applyEdits(
      text,
      modify(text, ["providers", input.provider, key], value, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
      }),
    );
  }
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new ProviderSettingsError(
      "MODEL_CONFIG_TOO_LARGE",
      "保存后 models.json 将超过 1 MiB",
    );
  await mkdir(agentDir, { recursive: true });
  const temp = join(agentDir, `.models-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if ((await readModelConfig(agentDir)).revision !== current.revision)
      throw new ProviderSettingsError(
        "MODEL_CONFIG_CONFLICT",
        "Pi 配置在保存期间发生变化，请刷新后重试",
      );
    await rename(temp, join(agentDir, "models.json"));
  } catch (error) {
    if (error instanceof ProviderSettingsError) throw error;
    throw new ProviderSettingsError(
      "MODEL_CONFIG_SAVE_FAILED",
      "无法保存 Pi models.json，请检查目录权限",
    );
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
