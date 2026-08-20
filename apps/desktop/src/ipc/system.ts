import { invoke } from "@tauri-apps/api/core";

export interface ArchitectureStatus {
  renderer: string;
  core: string;
  bridge: string;
  protocolVersion: number;
}

export async function getArchitectureStatus(): Promise<ArchitectureStatus> {
  return invoke<ArchitectureStatus>("get_architecture_status");
}

