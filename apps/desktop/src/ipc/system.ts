import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

export async function getArchitectureStatus(): Promise<ArchitectureStatus> {
  return invoke<ArchitectureStatus>("get_architecture_status");
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("get_runtime_status");
}

export async function restartRuntime(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("restart_runtime");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
