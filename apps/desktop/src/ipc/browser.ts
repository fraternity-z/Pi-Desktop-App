import { invoke } from "@tauri-apps/api/core";

export interface BrowserSidebarBoundsInput {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}

export interface BrowserSidebarOpenInput extends BrowserSidebarBoundsInput {
  readonly url?: string | null;
}

let browserSidebarCommandQueue: Promise<void> = Promise.resolve();

function enqueueBrowserSidebarCommand(command: () => Promise<void>): Promise<void> {
  const result = browserSidebarCommandQueue.then(command);
  browserSidebarCommandQueue = result.catch(() => undefined);
  return result;
}

export async function openBrowserSidebar(input: BrowserSidebarOpenInput): Promise<void> {
  return enqueueBrowserSidebarCommand(() => invoke<void>("browser_sidebar_open", { input }));
}

export async function updateBrowserSidebarBounds(
  input: BrowserSidebarBoundsInput,
): Promise<void> {
  return enqueueBrowserSidebarCommand(() =>
    invoke<void>("browser_sidebar_update_bounds", { input }),
  );
}

export async function hideBrowserSidebar(): Promise<void> {
  return enqueueBrowserSidebarCommand(() => invoke<void>("browser_sidebar_hide"));
}
