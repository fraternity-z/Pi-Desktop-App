import { useCallback, useEffect, useMemo, useState } from "react";

export type SidebarGroupMode = "project" | "list";
export type SidebarSortMode = "priority" | "recent" | "manual";

export interface ArchivedThreadMeta {
  title?: string;
  cwd?: string;
  archivedAt?: string;
}

export interface SidebarPreferences {
  groupMode: SidebarGroupMode;
  projectSortMode: SidebarSortMode;
  conversationSortMode: SidebarSortMode;
  projectsOpen: boolean;
  conversationsOpen: boolean;
  pinnedOpen: boolean;
  pinnedProjects: string[];
  projectManualOrder: string[];
  projectPriorityOrder: string[];
  archivedProjects: string[];
  projectAliases: Record<string, string>;
  expandedProjects: string[];
  threadAliases: Record<string, string>;
  archivedThreads: string[];
  archivedThreadMeta: Record<string, ArchivedThreadMeta>;
  pinnedThreads: string[];
  threadManualOrder: string[];
  unreadThreads: string[];
  deletedThreads: string[];
  threadProjectOverrides: Record<string, string>;
}

const KEYS = {
  groupMode: "pix.sidebar.groupMode",
  projectSortMode: "pix.sidebar.sortMode",
  conversationSortMode: "pix.sidebar.conversationSortMode",
  projectsOpen: "pix.sidebar.projectsOpen",
  conversationsOpen: "pix.sidebar.threadsOpen",
  pinnedOpen: "pix.sidebar.pinnedOpen",
  pinnedProjects: "pix.projects.pinned",
  projectManualOrder: "pix.projects.manualOrder",
  projectPriorityOrder: "pix.projects.priorityOrder",
  archivedProjects: "pix.projects.archived",
  projectAliases: "pix.projects.aliases",
  expandedProjects: "pix.projects.expanded",
  threadAliases: "pix.threads.aliases",
  archivedThreads: "pix.threads.archived",
  archivedThreadMeta: "pix.threads.archivedMeta",
  pinnedThreads: "pix.threads.pinned",
  threadManualOrder: "pix.threads.manualOrder",
  unreadThreads: "pix.threads.unread",
  deletedThreads: "pix.threads.deleted",
  threadProjectOverrides: "pix.threads.projectOverrides",
} as const;

const CHANGE_EVENT = "pix-sidebar-preferences";

export function normalizeSidebarPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
}

function readString(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readBoolean(key: string, fallback: boolean): boolean {
  const value = readString(key, fallback ? "1" : "0");
  return value === "1" ? true : value === "0" ? false : fallback;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function stringList(key: string, normalize = false): string[] {
  const value = readJson<unknown>(key, []);
  if (!Array.isArray(value)) return [];
  return dedupe(
    value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => (normalize ? normalizeSidebarPath(item) : item.trim())),
  );
}

function stringMap(key: string, normalizeKeys = false): Record<string, string> {
  const value = readJson<unknown>(key, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] =>
        Boolean(entry[0].trim() && typeof entry[1] === "string" && entry[1].trim()),
      )
      .map(([key, text]) => [normalizeKeys ? normalizeSidebarPath(key) : key, text.trim()]),
  );
}

function archivedMetaMap(): Record<string, ArchivedThreadMeta> {
  const value = readJson<unknown>(KEYS.archivedThreadMeta, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, ArchivedThreadMeta> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    result[id] = {
      ...(typeof item.title === "string" && item.title.trim() ? { title: item.title.trim() } : {}),
      ...(typeof item.cwd === "string" && item.cwd.trim() ? { cwd: item.cwd } : {}),
      ...(typeof item.archivedAt === "string" && item.archivedAt.trim()
        ? { archivedAt: item.archivedAt }
        : {}),
    };
  }
  return result;
}

export function loadSidebarPreferences(): SidebarPreferences {
  const groupMode = readString(KEYS.groupMode, "project") === "list" ? "list" : "project";
  return {
    groupMode,
    projectSortMode: parseSortMode(readString(KEYS.projectSortMode, "priority")),
    conversationSortMode: parseSortMode(readString(KEYS.conversationSortMode, "priority")),
    projectsOpen: readBoolean(KEYS.projectsOpen, true),
    conversationsOpen: readBoolean(KEYS.conversationsOpen, true),
    pinnedOpen: readBoolean(KEYS.pinnedOpen, true),
    pinnedProjects: stringList(KEYS.pinnedProjects, true),
    projectManualOrder: stringList(KEYS.projectManualOrder, true),
    projectPriorityOrder: stringList(KEYS.projectPriorityOrder, true),
    archivedProjects: stringList(KEYS.archivedProjects, true),
    projectAliases: stringMap(KEYS.projectAliases, true),
    expandedProjects: stringList(KEYS.expandedProjects, true),
    threadAliases: stringMap(KEYS.threadAliases),
    archivedThreads: stringList(KEYS.archivedThreads),
    archivedThreadMeta: archivedMetaMap(),
    pinnedThreads: stringList(KEYS.pinnedThreads),
    threadManualOrder: stringList(KEYS.threadManualOrder),
    unreadThreads: stringList(KEYS.unreadThreads),
    deletedThreads: stringList(KEYS.deletedThreads),
    threadProjectOverrides: stringMap(KEYS.threadProjectOverrides),
  };
}

function parseSortMode(value: string): SidebarSortMode {
  return value === "recent" || value === "manual" ? value : "priority";
}

function persistSidebarPreferences(value: SidebarPreferences): void {
  try {
    window.localStorage.setItem(KEYS.groupMode, value.groupMode);
    window.localStorage.setItem(KEYS.projectSortMode, value.projectSortMode);
    window.localStorage.setItem(KEYS.conversationSortMode, value.conversationSortMode);
    window.localStorage.setItem(KEYS.projectsOpen, value.projectsOpen ? "1" : "0");
    window.localStorage.setItem(KEYS.conversationsOpen, value.conversationsOpen ? "1" : "0");
    window.localStorage.setItem(KEYS.pinnedOpen, value.pinnedOpen ? "1" : "0");
    for (const key of [
      "pinnedProjects",
      "projectManualOrder",
      "projectPriorityOrder",
      "archivedProjects",
      "projectAliases",
      "expandedProjects",
      "threadAliases",
      "archivedThreads",
      "archivedThreadMeta",
      "pinnedThreads",
      "threadManualOrder",
      "unreadThreads",
      "deletedThreads",
      "threadProjectOverrides",
    ] as const) {
      window.localStorage.setItem(KEYS[key], JSON.stringify(value[key]));
    }
  } catch {
    // The rail remains fully usable in memory when local storage is unavailable.
  }
}

function notifyChanged(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Non-browser tests can still use the pure load helpers.
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function useSidebarPreferences() {
  const [preferences, setPreferences] = useState(loadSidebarPreferences);

  useEffect(() => {
    const reload = () => setPreferences(loadSidebarPreferences());
    window.addEventListener("storage", reload);
    window.addEventListener(CHANGE_EVENT, reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener(CHANGE_EVENT, reload);
    };
  }, []);

  const update = useCallback((change: (current: SidebarPreferences) => SidebarPreferences) => {
    setPreferences((current) => {
      const next = change(current);
      persistSidebarPreferences(next);
      queueMicrotask(notifyChanged);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      preferences,
      setGroupMode: (groupMode: SidebarGroupMode) =>
        update((current) => ({ ...current, groupMode })),
      setProjectSortMode: (projectSortMode: SidebarSortMode) =>
        update((current) => ({ ...current, projectSortMode })),
      setConversationSortMode: (conversationSortMode: SidebarSortMode) =>
        update((current) => ({ ...current, conversationSortMode })),
      setProjectsOpen: (projectsOpen: boolean) =>
        update((current) => ({ ...current, projectsOpen })),
      setConversationsOpen: (conversationsOpen: boolean) =>
        update((current) => ({ ...current, conversationsOpen })),
      setPinnedOpen: (pinnedOpen: boolean) => update((current) => ({ ...current, pinnedOpen })),
      setProjectAlias: (path: string, alias?: string) =>
        update((current) => {
          const projectAliases = { ...current.projectAliases };
          const key = normalizeSidebarPath(path);
          if (alias?.trim()) projectAliases[key] = alias.trim();
          else delete projectAliases[key];
          return { ...current, projectAliases };
        }),
      togglePinnedProject: (path: string) =>
        update((current) => {
          const key = normalizeSidebarPath(path);
          const pinnedProjects = current.pinnedProjects.includes(key)
            ? current.pinnedProjects.filter((item) => item !== key)
            : [key, ...current.pinnedProjects];
          return { ...current, pinnedProjects };
        }),
      setProjectArchived: (path: string, archived: boolean) =>
        update((current) => {
          const key = normalizeSidebarPath(path);
          return {
            ...current,
            archivedProjects: archived
              ? [key, ...current.archivedProjects.filter((item) => item !== key)]
              : current.archivedProjects.filter((item) => item !== key),
            pinnedProjects: archived
              ? current.pinnedProjects.filter((item) => item !== key)
              : current.pinnedProjects,
          };
        }),
      toggleExpandedProject: (path: string) =>
        update((current) => {
          const key = normalizeSidebarPath(path);
          const expandedProjects = current.expandedProjects.includes(key)
            ? current.expandedProjects.filter((item) => item !== key)
            : [...current.expandedProjects, key];
          return { ...current, expandedProjects };
        }),
      setProjectManualOrder: (paths: readonly string[]) =>
        update((current) => ({
          ...current,
          projectManualOrder: dedupe(paths.map(normalizeSidebarPath)),
        })),
      setProjectPriorityOrder: (paths: readonly string[]) =>
        update((current) => ({
          ...current,
          projectPriorityOrder: dedupe(paths.map(normalizeSidebarPath)),
        })),
      removeProjectMetadata: (path: string) =>
        update((current) => {
          const key = normalizeSidebarPath(path);
          const projectAliases = { ...current.projectAliases };
          delete projectAliases[key];
          const threadProjectOverrides = Object.fromEntries(
            Object.entries(current.threadProjectOverrides).filter(
              ([, project]) => normalizeSidebarPath(project) !== key,
            ),
          );
          return {
            ...current,
            projectAliases,
            threadProjectOverrides,
            pinnedProjects: current.pinnedProjects.filter((item) => item !== key),
            archivedProjects: current.archivedProjects.filter((item) => item !== key),
            expandedProjects: current.expandedProjects.filter((item) => item !== key),
            projectManualOrder: current.projectManualOrder.filter((item) => item !== key),
            projectPriorityOrder: current.projectPriorityOrder.filter((item) => item !== key),
          };
        }),
      setThreadAlias: (id: string, alias?: string) =>
        update((current) => {
          const threadAliases = { ...current.threadAliases };
          if (alias?.trim()) threadAliases[id] = alias.trim();
          else delete threadAliases[id];
          return { ...current, threadAliases };
        }),
      togglePinnedThread: (id: string) =>
        update((current) => ({
          ...current,
          pinnedThreads: current.pinnedThreads.includes(id)
            ? current.pinnedThreads.filter((item) => item !== id)
            : [id, ...current.pinnedThreads],
        })),
      setThreadArchived: (id: string, archived: boolean, meta?: ArchivedThreadMeta) =>
        update((current) => {
          const archivedThreadMeta = { ...current.archivedThreadMeta };
          if (archived) {
            archivedThreadMeta[id] = {
              ...meta,
              archivedAt: meta?.archivedAt ?? new Date().toISOString(),
            };
          } else {
            delete archivedThreadMeta[id];
          }
          return {
            ...current,
            archivedThreadMeta,
            archivedThreads: archived
              ? [id, ...current.archivedThreads.filter((item) => item !== id)]
              : current.archivedThreads.filter((item) => item !== id),
            pinnedThreads: archived
              ? current.pinnedThreads.filter((item) => item !== id)
              : current.pinnedThreads,
          };
        }),
      deleteThread: (id: string) =>
        update((current) => {
          const threadAliases = { ...current.threadAliases };
          const archivedThreadMeta = { ...current.archivedThreadMeta };
          const threadProjectOverrides = { ...current.threadProjectOverrides };
          delete threadAliases[id];
          delete archivedThreadMeta[id];
          delete threadProjectOverrides[id];
          return {
            ...current,
            threadAliases,
            archivedThreadMeta,
            threadProjectOverrides,
            deletedThreads: [id, ...current.deletedThreads.filter((item) => item !== id)],
            archivedThreads: current.archivedThreads.filter((item) => item !== id),
            pinnedThreads: current.pinnedThreads.filter((item) => item !== id),
            unreadThreads: current.unreadThreads.filter((item) => item !== id),
            threadManualOrder: current.threadManualOrder.filter((item) => item !== id),
          };
        }),
      markThreadUnread: (id: string, unread: boolean) =>
        update((current) => ({
          ...current,
          unreadThreads: unread
            ? [id, ...current.unreadThreads.filter((item) => item !== id)]
            : current.unreadThreads.filter((item) => item !== id),
        })),
      setThreadManualOrder: (ids: readonly string[]) =>
        update((current) => ({ ...current, threadManualOrder: dedupe(ids) })),
      setThreadProject: (id: string, cwd?: string) =>
        update((current) => {
          const threadProjectOverrides = { ...current.threadProjectOverrides };
          if (cwd?.trim()) threadProjectOverrides[id] = cwd;
          else delete threadProjectOverrides[id];
          return { ...current, threadProjectOverrides };
        }),
    }),
    [preferences, update],
  );
}

