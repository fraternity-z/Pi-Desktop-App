import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface ArchitectureStatus {
  renderer: string;
  core: string;
  bridge: string;
  protocolVersion: number;
}

export interface AppErrorPayload {
  code: string;
  message: string;
}

export interface RuntimeStatus {
  status: "starting" | "ready" | "unavailable";
  runtimeSource: string | null;
  piVersion: string | null;
  nodeVersion: string | null;
  error: AppErrorPayload | null;
}

export type RuntimeMode = "builtin" | "local";
const RUNTIME_SETTINGS_SCHEMA_VERSION = 1;

export interface RuntimeSettings {
  schemaVersion: number;
  runtimeMode: RuntimeMode;
  nodePath: string | null;
  sdkPath: string | null;
  piCommand: string | null;
  agentDir: string;
  supportedSdkRange: string;
  telemetry: boolean;
}

export async function getArchitectureStatus(): Promise<ArchitectureStatus> {
  return invoke<ArchitectureStatus>("get_architecture_status");
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("get_runtime_status");
}

export async function restartRuntime(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("restart_runtime");
}

export async function closeAppWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const value = await invoke<unknown>("get_runtime_settings");
  const settings = readRuntimeSettings(value);
  if (!settings) throw new Error("RUNTIME_SETTINGS_INVALID: 运行时设置格式无效");
  return settings;
}

export async function setRuntimeMode(mode: RuntimeMode): Promise<RuntimeSettings> {
  const value = await invoke<unknown>("set_runtime_mode", { mode });
  const settings = readRuntimeSettings(value);
  if (!settings) throw new Error("RUNTIME_SETTINGS_INVALID: 运行时设置格式无效");
  return settings;
}

export async function listenToRuntimeStatus(
  handler: (status: RuntimeStatus) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("runtime://status", (event) => {
    const status = readRuntimeStatus(event.payload);
    if (status) handler(status);
  });
}

function readRuntimeStatus(value: unknown): RuntimeStatus | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (status !== "starting" && status !== "ready" && status !== "unavailable") return null;
  const runtimeSource = readOptionalString(value.runtimeSource);
  const piVersion = readOptionalString(value.piVersion);
  const nodeVersion = readOptionalString(value.nodeVersion);
  const error = readAppError(value.error);
  if (
    runtimeSource === undefined ||
    piVersion === undefined ||
    nodeVersion === undefined ||
    error === undefined
  ) {
    return null;
  }
  return { status, runtimeSource, piVersion, nodeVersion, error };
}

function readOptionalString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function readAppError(value: unknown): AppErrorPayload | null | undefined {
  if (value === null) return null;
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string"
    ? { code: value.code, message: value.message }
    : undefined;
}

function readRuntimeSettings(value: unknown): RuntimeSettings | null {
  if (!isRecord(value)) return null;
  const runtimeMode = value.runtimeMode;
  if (runtimeMode !== "builtin" && runtimeMode !== "local") return null;
  if (
    typeof value.schemaVersion !== "number" ||
    !Number.isInteger(value.schemaVersion) ||
    value.schemaVersion !== RUNTIME_SETTINGS_SCHEMA_VERSION ||
    typeof value.agentDir !== "string" ||
    typeof value.supportedSdkRange !== "string" ||
    typeof value.telemetry !== "boolean"
  ) {
    return null;
  }
  const nodePath = readOptionalString(value.nodePath);
  const sdkPath = readOptionalString(value.sdkPath);
  const piCommand = readOptionalString(value.piCommand);
  if (nodePath === undefined || sdkPath === undefined || piCommand === undefined) return null;
  return {
    schemaVersion: value.schemaVersion,
    runtimeMode,
    nodePath,
    sdkPath,
    piCommand,
    agentDir: value.agentDir,
    supportedSdkRange: value.supportedSdkRange,
    telemetry: value.telemetry,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
