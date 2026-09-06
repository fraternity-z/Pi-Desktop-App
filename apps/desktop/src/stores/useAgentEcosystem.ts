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
export type EcosystemCatalog = "packages" | "resources";

export function useAgentEcosystem() {
  const [phase, setPhase] = useState<EcosystemPhase>("idle");
  const [packages, setPackages] = useState<AgentPackageSummary[]>([]);
  const [resources, setResources] = useState<AgentResourceSummary[]>([]);
  const [updates, setUpdates] = useState<AgentPackageUpdate[]>([]);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "checked" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const operationSequence = useRef(0);
  const activeWorkspace = useRef("");

  const checkUpdates = useCallback(async (cwd: string) => {
    const workspace = normalizeWorkspace(cwd);
    const request = ++operationSequence.current;
    activeWorkspace.current = workspace;
    setOperation("check-updates");
    setUpdateStatus("checking");
    setUpdates([]);
    setError(null);
    try {
      const nextUpdates = await checkAgentPackageUpdates(cwd);
      if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
      setUpdates(nextUpdates);
      setUpdateStatus("checked");
      return true;
    } catch (cause) {
      if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
      setUpdateStatus("error");
      setError(formatEcosystemError(cause, "PACKAGE_UPDATE_CHECK_FAILED: 无法检查插件更新"));
      return false;
    } finally {
      if (request === operationSequence.current && activeWorkspace.current === workspace) {
        setOperation(null);
      }
    }
  }, []);

  const refresh = useCallback(async (cwd: string, catalog: EcosystemCatalog) => {
    const workspace = normalizeWorkspace(cwd);
    const request = ++requestSequence.current;
    activeWorkspace.current = workspace;
    operationSequence.current += 1;
    setOperation(null);
    setUpdates([]);
    setUpdateStatus("idle");
    setPhase("loading");
    setError(null);
    try {
      let nextPackages: AgentPackageSummary[] | null = null;
      let nextResources: AgentResourceSummary[] | null = null;
      if (catalog === "packages") nextPackages = await listAgentPackages(cwd);
      else nextResources = await listAgentResources(cwd);
      if (request !== requestSequence.current || activeWorkspace.current !== workspace) return false;
      if (nextPackages) setPackages(nextPackages);
      if (nextResources) setResources(nextResources);
      setPhase("ready");
      if (nextPackages?.length) await checkUpdates(cwd);
      return true;
    } catch (cause) {
      if (request !== requestSequence.current || activeWorkspace.current !== workspace) return false;
      setPhase("error");
      setError(
        formatEcosystemError(
          cause,
          catalog === "packages"
            ? "PACKAGE_LIST_FAILED: 无法读取插件"
            : "RESOURCE_LIST_FAILED: 无法读取资源",
        ),
      );
      return false;
    }
  }, [checkUpdates]);

  const runPackageOperation = useCallback(
    async (
      operationName: string,
      task: () => Promise<AgentPackageSummary[]>,
      failureMessage: string,
      cwd: string,
    ) => {
      const workspace = normalizeWorkspace(cwd);
      const request = ++operationSequence.current;
      requestSequence.current += 1;
      activeWorkspace.current = workspace;
      setOperation(operationName);
      setError(null);
      try {
        const nextPackages = await task();
        if (request !== operationSequence.current || activeWorkspace.current !== workspace) return false;
        setPackages(nextPackages);
        setPhase("ready");
        if (operationName.startsWith("update:") || operationName.startsWith("install:") || operationName.startsWith("remove:")) {
          setUpdates([]);
          setUpdateStatus("idle");
          if (nextPackages.length) await checkUpdates(cwd);
        }
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
    [checkUpdates],
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

  return {
    phase,
    packages,
    resources,
    updates,
    updateStatus,
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
