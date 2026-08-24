import { useCallback, useRef, useState } from "react";

import {
  checkAgentPackageUpdates,
  installAgentPackage,
  listAgentPackages,
  listAgentResources,
  removeAgentPackage,
  setAgentPackageEnabled,
  updateAgentPackage,
  type AgentPackageSummary,
  type AgentPackageUpdate,
  type AgentResourceSummary,
  type PackageScope,
} from "../ipc/agent";

export type EcosystemPhase = "idle" | "loading" | "ready" | "error";

export function useAgentEcosystem() {
  const [phase, setPhase] = useState<EcosystemPhase>("idle");
  const [packages, setPackages] = useState<AgentPackageSummary[]>([]);
  const [resources, setResources] = useState<AgentResourceSummary[]>([]);
  const [updates, setUpdates] = useState<AgentPackageUpdate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const operationSequence = useRef(0);
  const activeWorkspace = useRef("");

  const refresh = useCallback(async (cwd: string) => {
    const workspace = normalizeWorkspace(cwd);
    const request = ++requestSequence.current;
    activeWorkspace.current = workspace;
    operationSequence.current += 1;
    setOperation(null);
    setPhase("loading");
    setError(null);
    try {
      const [nextPackages, nextResources] = await Promise.all([
        listAgentPackages(cwd),
        listAgentResources(cwd),
      ]);
      if (request !== requestSequence.current || activeWorkspace.current !== workspace) return false;
      setPackages(nextPackages);
      setResources(nextResources);
      setPhase("ready");
      return true;
    } catch (cause) {
      if (request !== requestSequence.current || activeWorkspace.current !== workspace) return false;
      setPhase("error");
      setError(formatEcosystemError(cause, "ECOSYSTEM_LOAD_FAILED: 无法读取插件与资源"));
      return false;
    }
  }, []);

  const runPackageOperation = useCallback(
    async (
      operationName: string,
      task: () => Promise<AgentPackageSummary[]>,
      failureMessage: string,
      cwd: string,
    ) => {
      const workspace = normalizeWorkspace(cwd);
      const request = ++operationSequence.current;
      activeWorkspace.current = workspace;
      setOperation(operationName);
      setError(null);
      try {
        const nextPackages = await task();
        if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
        const nextResources = await listAgentResources(cwd);
        if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
        setPackages(nextPackages);
        setResources(nextResources);
        setPhase("ready");
        return true;
      } catch (cause) {
        if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
        setError(formatEcosystemError(cause, failureMessage));
        return false;
      } finally {
        if (request === operationSequence.current && activeWorkspace.current === workspace) {
          setOperation(null);
        }
      }
    },
    [],
  );

  const installPackage = useCallback(
    (cwd: string, source: string, scope: PackageScope) =>
      runPackageOperation(
        `install:${source}`,
        () => installAgentPackage(cwd, source, scope),
        "PACKAGE_INSTALL_FAILED: 无法安装插件",
        cwd,
      ),
    [runPackageOperation],
  );

  const setPackageEnabled = useCallback(
    (cwd: string, item: AgentPackageSummary, enabled: boolean) =>
      runPackageOperation(
        `enabled:${item.source}`,
        () => setAgentPackageEnabled(cwd, item.source, item.scope, enabled),
        "PACKAGE_UPDATE_FAILED: 无法更新插件启用状态",
        cwd,
      ),
    [runPackageOperation],
  );

  const removePackage = useCallback(
    (cwd: string, item: AgentPackageSummary) =>
      runPackageOperation(
        `remove:${item.source}`,
        () => removeAgentPackage(cwd, item.source, item.scope),
        "PACKAGE_REMOVE_FAILED: 无法移除插件",
        cwd,
      ),
    [runPackageOperation],
  );

  const updatePackage = useCallback(
    (cwd: string, source?: string) =>
      runPackageOperation(
        `update:${source ?? "all"}`,
        () => updateAgentPackage(cwd, source),
        "PACKAGE_UPDATE_FAILED: 无法更新插件",
        cwd,
      ),
    [runPackageOperation],
  );

  const checkUpdates = useCallback(async (cwd: string) => {
    const workspace = normalizeWorkspace(cwd);
    const request = ++operationSequence.current;
    activeWorkspace.current = workspace;
    setOperation("check-updates");
    setError(null);
    try {
      const nextUpdates = await checkAgentPackageUpdates(cwd);
      if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
      setUpdates(nextUpdates);
      return true;
    } catch (cause) {
      if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
      setError(formatEcosystemError(cause, "PACKAGE_UPDATE_CHECK_FAILED: 无法检查插件更新"));
      return false;
    } finally {
      if (request === operationSequence.current && activeWorkspace.current === workspace) {
        setOperation(null);
      }
    }
  }, []);

  return {
    phase,
    packages,
    resources,
    updates,
    error,
    operation,
    refresh,
    installPackage,
    setPackageEnabled,
    removePackage,
    updatePackage,
    checkUpdates,
  };
}

function formatEcosystemError(cause: unknown, fallback: string): string {
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    "message" in cause &&
    typeof cause.code === "string" &&
    typeof cause.message === "string"
  ) {
    return `${cause.code}: ${cause.message}`;
  }
  return fallback;
}

function normalizeWorkspace(cwd: string): string {
  return cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
}
