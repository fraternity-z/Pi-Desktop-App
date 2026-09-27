import { useCallback, useRef, useState, type SetStateAction } from "react";

import type { RightPanelFileTarget } from "./rightPanelFiles";

export type RightPanelTabId = "review" | "files" | "file" | "preview";
export type RightPanelToolTabId = "review" | "files";

interface PanelShellState {
  readonly open: boolean;
  readonly activeTool: RightPanelToolTabId | null;
  readonly activeResource: { readonly workspaceKey: string; readonly tab: "file" | "preview" } | null;
  readonly toolTabs: ReadonlyArray<RightPanelToolTabId>;
  readonly reviewScope: "git" | "session";
}

interface WorkspaceResources {
  readonly fileTab: RightPanelFileTarget | null;
  readonly previewTab: RightPanelFileTarget | null;
  readonly selectedFilePath: string | null;
}

const EMPTY_RESOURCES: WorkspaceResources = {
  fileTab: null, previewTab: null, selectedFilePath: null,
};

function activeTabFor(shell: PanelShellState, workspaceKey: string): RightPanelTabId | null {
  return shell.activeResource?.workspaceKey === workspaceKey ? shell.activeResource.tab : shell.activeTool;
}

/** Tools follow the current workspace; paths stay in workspace-scoped renderer memory. */
export function useRightPanelSessionState(workspaceKey: string) {
  const [shell, setShell] = useState<PanelShellState>({
    open: false, activeTool: null, activeResource: null, toolTabs: [], reviewScope: "git",
  });
  const [contexts, setContexts] = useState<Record<string, WorkspaceResources>>({});
  const context = useRef({ workspaceKey, generation: 0 });
  if (context.current.workspaceKey !== workspaceKey) {
    context.current = { workspaceKey, generation: context.current.generation + 1 };
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
      const activeTab = typeof value === "function" ? value(activeTabFor(current, workspaceKey)) : value;
      if (activeTab === "file" || activeTab === "preview") {
        return { ...current, activeResource: { workspaceKey, tab: activeTab } };
      }
      const toolTabs = activeTab !== null && !current.toolTabs.includes(activeTab)
        ? [...current.toolTabs, activeTab] : current.toolTabs;
      return { ...current, activeTool: activeTab, activeResource: null, toolTabs };
    });
  }, [updateShell, workspaceKey]);
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
  return { ...shell, ...(contexts[workspaceKey] ?? EMPTY_RESOURCES), activeTab: activeTabFor(shell, workspaceKey), setOpen, setActiveTab, setFileTab, setPreviewTab, setSelectedFilePath, setReviewScope, closeToolTab };
}
