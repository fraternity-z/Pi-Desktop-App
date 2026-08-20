import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import type { PiSdkLike } from "./session-runtime.js";

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export interface LoadedPiSdk {
  root: string;
  version: string;
  sdk: PiSdkLike;
}

export interface SdkLoaderDependencies {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  realpath(path: string): Promise<string>;
  importModule(specifier: string): Promise<unknown>;
}

export class SdkLoadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SdkLoadError";
  }
}

const defaultDependencies: SdkLoaderDependencies = {
  readFile,
  realpath,
  importModule: (specifier) => import(specifier),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadPiSdk(
  sdkRoot: string,
  dependencies: SdkLoaderDependencies = defaultDependencies,
): Promise<LoadedPiSdk> {
  if (!isAbsolute(sdkRoot)) {
    throw new SdkLoadError("INVALID_SDK_ROOT", "Pi SDK 根目录必须为绝对路径");
  }

  let root: string;
  let entryPath: string;
  let metadata: unknown;
  try {
    root = await dependencies.realpath(sdkRoot);
    const packageJson = await dependencies.readFile(join(root, "package.json"), "utf8");
    metadata = JSON.parse(packageJson) as unknown;
    entryPath = await dependencies.realpath(join(root, "dist", "index.js"));
  } catch {
    throw new SdkLoadError("SDK_LAYOUT_INVALID", "Pi SDK 安装布局无效或不可读取");
  }

  const entryRelativePath = relative(root, entryPath);
  if (entryRelativePath.startsWith("..") || isAbsolute(entryRelativePath)) {
    throw new SdkLoadError("SDK_ENTRY_OUTSIDE_ROOT", "Pi SDK 入口不在 SDK 根目录内");
  }
  if (!isRecord(metadata)) {
    throw new SdkLoadError("SDK_METADATA_INVALID", "Pi SDK package.json 必须为 JSON 对象");
  }
  if (metadata.name !== PI_PACKAGE_NAME) {
    throw new SdkLoadError("SDK_IDENTITY_MISMATCH", "SDK 包身份不是官方 Pi Coding Agent");
  }
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new SdkLoadError("SDK_METADATA_INVALID", "Pi SDK 缺少有效版本号");
  }

  let imported: unknown;
  try {
    imported = await dependencies.importModule(pathToFileURL(entryPath).href);
  } catch {
    throw new SdkLoadError("SDK_IMPORT_FAILED", "无法加载 Pi SDK 模块");
  }
  if (!isRecord(imported) || typeof imported.createAgentSession !== "function") {
    throw new SdkLoadError("SDK_EXPORT_MISSING", "Pi SDK 缺少 createAgentSession 导出");
  }

  return {
    root,
    version: metadata.version,
    sdk: imported as unknown as PiSdkLike,
  };
}
