import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentTool, SessionConfiguration } from "../ipc/agent";

export type ToolPermissionMode = "default" | "custom";

export interface ToolPermissionPreference {
  schemaVersion: 1;
  mode: ToolPermissionMode;
  toolNames: string[];
}

export interface ToolPermissionState {
  mode: ToolPermissionMode;
  availableTools: AgentTool[];
  selectedToolNames: string[];
  defaultToolNames: string[];
  promptToolNames: string[] | undefined;
  useDefaultTools: () => void;
  setCustomTools: (toolNames: string[]) => void;
}

export const TOOL_PERMISSIONS_STORAGE_KEY = "pi-desktop.tool-permissions.v1";
export const DEFAULT_TOOL_PERMISSION_PREFERENCE: ToolPermissionPreference = {
  schemaVersion: 1,
  mode: "default",
  toolNames: [],
};

type PermissionStorage = Pick<Storage, "getItem" | "setItem">;
type ToolCatalog = Pick<SessionConfiguration, "availableTools" | "defaultToolNames">;

export function normalizeToolPermissionPreference(value: unknown): ToolPermissionPreference {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { ...DEFAULT_TOOL_PERMISSION_PREFERENCE };
  }
  if (value.mode !== "default" && value.mode !== "custom") {
    return { ...DEFAULT_TOOL_PERMISSION_PREFERENCE };
  }
  const toolNames = normalizeToolNames(value.toolNames);
  if (!toolNames) return { ...DEFAULT_TOOL_PERMISSION_PREFERENCE };
  return { schemaVersion: 1, mode: value.mode, toolNames };
}

export function loadToolPermissionPreference(
  storage = getDefaultStorage(),
): ToolPermissionPreference {
  if (!storage) return { ...DEFAULT_TOOL_PERMISSION_PREFERENCE };
  try {
    const stored = storage.getItem(TOOL_PERMISSIONS_STORAGE_KEY);
    return stored
      ? normalizeToolPermissionPreference(JSON.parse(stored))
      : { ...DEFAULT_TOOL_PERMISSION_PREFERENCE };
  } catch {
    return { ...DEFAULT_TOOL_PERMISSION_PREFERENCE };
  }
}

export function saveToolPermissionPreference(
  preference: ToolPermissionPreference,
  storage = getDefaultStorage(),
): ToolPermissionPreference {
  const normalized = normalizeToolPermissionPreference(preference);
  if (!storage) return normalized;
  try {
    storage.setItem(TOOL_PERMISSIONS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The in-memory selection remains usable when local persistence is unavailable.
  }
  return normalized;
}

export function resolveToolNames(
  availableTools: AgentTool[],
  requestedToolNames: string[],
): string[] {
  const requested = new Set(requestedToolNames);
  return availableTools.map((tool) => tool.name).filter((name) => requested.has(name));
}

export function useToolPermissions(
  configuration: SessionConfiguration | null,
): ToolPermissionState {
  const [preference, setPreference] = useState<ToolPermissionPreference>(
    loadToolPermissionPreference,
  );
  const [lastCatalog, setLastCatalog] = useState<ToolCatalog | null>(() =>
    configuration ? toCatalog(configuration) : null,
  );

  useEffect(() => {
    if (configuration) setLastCatalog(toCatalog(configuration));
  }, [configuration]);

  useEffect(() => {
    saveToolPermissionPreference(preference);
  }, [preference]);

  const catalog = configuration ? toCatalog(configuration) : lastCatalog;
  const availableTools = catalog?.availableTools ?? [];
  const defaultToolNames = resolveToolNames(availableTools, catalog?.defaultToolNames ?? []);
  const selectedToolNames = useMemo(
    () =>
      preference.mode === "default"
        ? defaultToolNames
        : resolveToolNames(availableTools, preference.toolNames),
    [availableTools, defaultToolNames, preference.mode, preference.toolNames],
  );

  const useDefaultTools = useCallback(() => {
    setPreference({ ...DEFAULT_TOOL_PERMISSION_PREFERENCE });
  }, []);
  const setCustomTools = useCallback((toolNames: string[]) => {
    setPreference({ schemaVersion: 1, mode: "custom", toolNames });
  }, []);

  return {
    mode: preference.mode,
    availableTools,
    selectedToolNames,
    defaultToolNames,
    promptToolNames:
      preference.mode === "default" &&
      (!configuration || configuration.availableTools.length === 0)
        ? undefined
        : preference.mode === "custom" && !catalog
          ? preference.toolNames
          : selectedToolNames,
    useDefaultTools,
    setCustomTools,
  };
}

function toCatalog(configuration: SessionConfiguration): ToolCatalog {
  return {
    availableTools: configuration.availableTools,
    defaultToolNames: configuration.defaultToolNames,
  };
}

function normalizeToolNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const names = new Set<string>();
  for (const name of value) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 128 ||
      /[\r\n\0]/.test(name) ||
      names.has(name)
    ) {
      return null;
    }
    names.add(name);
  }
  return [...names];
}

function getDefaultStorage(): PermissionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
