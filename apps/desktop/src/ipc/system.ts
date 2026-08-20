import { invoke } from "@tauri-apps/api/core";

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
  status: "ready" | "unavailable";
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
