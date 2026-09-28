import { useCallback, useRef, useState, type SetStateAction } from "react";

import type { RightPanelFileTarget } from "./rightPanelFiles";

export type RightPanelSubagentTabId = `subagent:${string}`;
export type RightPanelTabId = "review" | "files" | "file" | "preview" | RightPanelSubagentTabId;
export type RightPanelToolTabId = "review" | "files";

interface PanelShellState {
  readonly open: boolean;
  readonly activeTool: RightPanelToolTabId | null;
  readonly activeResource: { readonly workspaceKey: string; readonly tab: "file" | "preview" } | null;
  readonly toolTabs: ReadonlyArray<RightPanelToolTabId>;
  readonly reviewScope: "git" | "session";
  readonly subagentSessions: Readonly<Record<string, { readonly tabs: ReadonlyArray<RightPanelSubagentTabId>; readonly active: RightPanelSubagentTabId | null }>>;
}

interface WorkspaceResources {
  readonly fileTab: RightPanelFileTarget | null;
  readonly previewTab: RightPanelFileTarget | null;
  readonly selectedFilePath: string | null;
}

const EMPTY_RESOURCES: WorkspaceResources = {
  fileTab: null, previewTab: null, selectedFilePath: null,
};

function activeTabFor(shell: PanelShellState, workspaceKey: string, sessionKey: string): RightPanelTabId | null {
  return shell.subagentSessions[sessionKey]?.active ?? (shell.activeResource?.workspaceKey === workspaceKey ? shell.activeResource.tab : shell.activeTool);
}

/** Tools follow the current workspace; paths stay in workspace-scoped renderer memory. */
export function useRightPanelSessionState(workspaceKey: string, sessionKey = workspaceKey) {
  const [shell, setShell] = useState<PanelShellState>({
    open: false, activeTool: null, activeResource: null, toolTabs: [], reviewScope: "git", subagentSessions: {},
  });
  const [contexts, setContexts] = useState<Record<string, WorkspaceResources>>({});
  const context = useRef({ workspaceKey, sessionKey, generation: 0 });
  if (context.current.workspaceKey !== workspaceKey || context.current.sessionKey !== sessionKey) {
    context.current = { workspaceKey, sessionKey, generation: context.current.generation + 1 };
  }
  const generation = context.current.generation;
  const updateShell = useCallback((transform: (current: PanelShellState) => PanelShellState) => {
    setShell((current) => context.current.generation === generation ? transform(current) : current);
  }, [generation]);
  const updateResources = useCallback((transform: (current: WorkspaceResources) => WorkspaceResources) => {
    setContexts((current) => ({ ...current, [workspaceKey]: transform(current[workspaceKey] ?? EMPTY_RESOURCES) }));
  }, [workspaceKey]);
  const setOpen = useCallback((open: boolean) => updateShell((current) => ({ ...current, open })), [updateShell]);
  const setActiveTab = useCallback((value: SetStateAction<RightPanelTabId | null>) => {
    updateShell((current) => {
      const activeTab = typeof value === "function" ? value(activeTabFor(current, workspaceKey, sessionKey)) : value;
      const session = current.subagentSessions[sessionKey] ?? { tabs: [], active: null };
      if (activeTab?.startsWith("subagent:")) {
        const tab = activeTab as RightPanelSubagentTabId;
        return { ...current, subagentSessions: { ...current.subagentSessions, [sessionKey]: { tabs: session.tabs.includes(tab) ? session.tabs : [...session.tabs, tab], active: tab } } };
      }
      const subagentSessions = { ...current.subagentSessions, [sessionKey]: { ...session, active: null } };
      if (activeTab === "file" || activeTab === "preview") {
        return { ...current, subagentSessions, activeResource: { workspaceKey, tab: activeTab } };
      }
      const tool = activeTab === "review" || activeTab === "files" ? activeTab : null;
      const toolTabs = tool !== null && !current.toolTabs.includes(tool)
        ? [...current.toolTabs, tool] : current.toolTabs;
      return { ...current, subagentSessions, activeTool: tool, activeResource: null, toolTabs };
    });
  }, [updateShell, workspaceKey, sessionKey]);
  const closeSubagentTab = useCallback((tab: RightPanelSubagentTabId) => {
    updateShell((current) => {
      const session = current.subagentSessions[sessionKey];
      if (!session) return current;
      return { ...current, subagentSessions: { ...current.subagentSessions, [sessionKey]: { tabs: session.tabs.filter((id) => id !== tab), active: session.active === tab ? null : session.active } } };
    });
  }, [updateShell, sessionKey]);
  const setFileTab = useCallback((fileTab: RightPanelFileTarget | null) => updateResources((current) => ({ ...current, fileTab })), [updateResources]);
  const setPreviewTab = useCallback((previewTab: RightPanelFileTarget | null) => updateResources((current) => ({ ...current, previewTab })), [updateResources]);
  const setSelectedFilePath = useCallback((selectedFilePath: string | null) => updateResources((current) => ({ ...current, selectedFilePath })), [updateResources]);
  const setReviewScope = useCallback((reviewScope: PanelShellState["reviewScope"]) => updateShell((current) => ({ ...current, reviewScope })), [updateShell]);
  const closeToolTab = useCallback((tab: RightPanelToolTabId) => {
    updateShell((current) => ({
      ...current, toolTabs: current.toolTabs.filter((id) => id !== tab),
      activeTool: current.activeTool === tab ? null : current.activeTool,
    }));
  }, [updateShell]);
  return { ...shell, ...(contexts[workspaceKey] ?? EMPTY_RESOURCES), subagentTabs: shell.subagentSessions[sessionKey]?.tabs ?? [], activeTab: activeTabFor(shell, workspaceKey, sessionKey), setOpen, setActiveTab, setFileTab, setPreviewTab, setSelectedFilePath, setReviewScope, closeToolTab, closeSubagentTab };
}
