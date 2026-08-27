import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type RightPanelDiffStyle = "split" | "unified";

export interface RightPanelDisplayOptions {
  readonly wordWrap: boolean;
  readonly richPreview: boolean;
  readonly wordDiff: boolean;
  readonly hideWhitespace: boolean;
}

export type RightPanelDisplayOptionKey = keyof RightPanelDisplayOptions;

export const RIGHT_PANEL_STORAGE_KEYS = {
  width: "pi-desktop.rightPanel.width.v1",
  expanded: "pi-desktop.rightPanel.expanded.v1",
  diffStyle: "pi-desktop.rightPanel.diffStyle.v1",
  displayOptions: "pi-desktop.rightPanel.displayOptions.v1",
} as const;

export const RIGHT_PANEL_DEFAULT_WIDTH = 560;
export const RIGHT_PANEL_MIN_WIDTH = 320;
export const RIGHT_PANEL_MAX_WIDTH = 1200;
export const RIGHT_PANEL_WIDTH_RATIO = 0.5;
export const RIGHT_PANEL_TRANSITION_MS = 260;
export const DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS: RightPanelDisplayOptions = Object.freeze({
  wordWrap: false,
  richPreview: true,
  wordDiff: false,
  hideWhitespace: false,
});

type PanelStorage = Pick<Storage, "getItem" | "setItem">;

export interface RightPanelLayoutState {
  readonly width: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly expanded: boolean;
  readonly diffStyle: RightPanelDiffStyle;
  readonly displayOptions: RightPanelDisplayOptions;
  readonly setWidth: (width: number) => void;
  readonly resetWidth: () => void;
  readonly setExpanded: (expanded: boolean) => void;
  readonly toggleExpanded: () => void;
  readonly setDiffStyle: (style: RightPanelDiffStyle) => void;
  readonly toggleDiffStyle: () => void;
  readonly setDisplayOption: (key: RightPanelDisplayOptionKey, value: boolean) => void;
  readonly toggleDisplayOption: (key: RightPanelDisplayOptionKey) => void;
}

export interface RightPanelVisibilityState {
  readonly open: boolean;
  readonly available: boolean;
  readonly opening: boolean;
  readonly closing: boolean;
  readonly openPanel: () => void;
  readonly closePanel: () => void;
  readonly togglePanel: () => void;
}

export function clampRightPanelWidth(value: number, maxWidth = RIGHT_PANEL_MAX_WIDTH): number {
  const boundedMax = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, maxWidth));
  if (!Number.isFinite(value)) return RIGHT_PANEL_DEFAULT_WIDTH > boundedMax ? boundedMax : RIGHT_PANEL_DEFAULT_WIDTH;
  return Math.min(boundedMax, Math.max(RIGHT_PANEL_MIN_WIDTH, Math.round(value)));
}

export function resolveRightPanelMaxWidth(viewportWidth: number | null | undefined): number {
  if (!viewportWidth || viewportWidth <= 0 || !Number.isFinite(viewportWidth)) return RIGHT_PANEL_MAX_WIDTH;
  return Math.max(
    RIGHT_PANEL_MIN_WIDTH,
    Math.min(RIGHT_PANEL_MAX_WIDTH, Math.floor(viewportWidth * RIGHT_PANEL_WIDTH_RATIO)),
  );
}

export function readRightPanelWidth(storage = getDefaultStorage()): number {
  const raw = readStorage(storage, RIGHT_PANEL_STORAGE_KEYS.width);
  return raw === null ? RIGHT_PANEL_DEFAULT_WIDTH : clampRightPanelWidth(Number(raw));
}

export function readRightPanelExpanded(storage = getDefaultStorage()): boolean {
  return readStorage(storage, RIGHT_PANEL_STORAGE_KEYS.expanded) === "1";
}

export function readRightPanelDiffStyle(storage = getDefaultStorage()): RightPanelDiffStyle {
  return readStorage(storage, RIGHT_PANEL_STORAGE_KEYS.diffStyle) === "split" ? "split" : "unified";
}

export function readRightPanelDisplayOptions(storage = getDefaultStorage()): RightPanelDisplayOptions {
  const raw = readStorage(storage, RIGHT_PANEL_STORAGE_KEYS.displayOptions);
  if (!raw) return { ...DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS };
  try {
    const value = JSON.parse(raw) as Partial<Record<RightPanelDisplayOptionKey, unknown>>;
    return {
      wordWrap: typeof value.wordWrap === "boolean" ? value.wordWrap : DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS.wordWrap,
      richPreview: typeof value.richPreview === "boolean" ? value.richPreview : DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS.richPreview,
      wordDiff: typeof value.wordDiff === "boolean" ? value.wordDiff : DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS.wordDiff,
      hideWhitespace: typeof value.hideWhitespace === "boolean" ? value.hideWhitespace : DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS.hideWhitespace,
    };
  } catch {
    return { ...DEFAULT_RIGHT_PANEL_DISPLAY_OPTIONS };
  }
}

export function useRightPanelLayout(): RightPanelLayoutState {
  const [viewportWidth, setViewportWidth] = useState<number | null>(() =>
    typeof window === "undefined" ? null : window.innerWidth,
  );
  const maxWidth = resolveRightPanelMaxWidth(viewportWidth);
  const [width, setWidthState] = useState(readRightPanelWidth);
  const [expanded, setExpandedState] = useState(readRightPanelExpanded);
  const [diffStyle, setDiffStyleState] = useState(readRightPanelDiffStyle);
  const [displayOptions, setDisplayOptionsState] = useState(readRightPanelDisplayOptions);

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);
  useEffect(() => setWidthState((current) => clampRightPanelWidth(current, maxWidth)), [maxWidth]);
  useEffect(() => saveStorage(RIGHT_PANEL_STORAGE_KEYS.width, String(width)), [width]);
  useEffect(() => saveStorage(RIGHT_PANEL_STORAGE_KEYS.expanded, expanded ? "1" : "0"), [expanded]);
  useEffect(() => saveStorage(RIGHT_PANEL_STORAGE_KEYS.diffStyle, diffStyle), [diffStyle]);
  useEffect(() => saveStorage(RIGHT_PANEL_STORAGE_KEYS.displayOptions, JSON.stringify(displayOptions)), [displayOptions]);

  const setWidth = useCallback((value: number) => setWidthState((current) => {
    const next = clampRightPanelWidth(value, maxWidth);
    return current === next ? current : next;
  }), [maxWidth]);
  const resetWidth = useCallback(() => setWidth(RIGHT_PANEL_DEFAULT_WIDTH), [setWidth]);
  const setExpanded = useCallback((value: boolean) => setExpandedState(value), []);
  const toggleExpanded = useCallback(() => setExpandedState((value) => !value), []);
  const setDiffStyle = useCallback((value: RightPanelDiffStyle) => setDiffStyleState(value), []);
  const toggleDiffStyle = useCallback(() => setDiffStyleState((value) => value === "split" ? "unified" : "split"), []);
  const setDisplayOption = useCallback((key: RightPanelDisplayOptionKey, value: boolean) => {
    setDisplayOptionsState((current) => current[key] === value ? current : { ...current, [key]: value });
  }, []);
  const toggleDisplayOption = useCallback((key: RightPanelDisplayOptionKey) => {
    setDisplayOptionsState((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  return useMemo(() => ({
    width,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    maxWidth,
    expanded,
    diffStyle,
    displayOptions,
    setWidth,
    resetWidth,
    setExpanded,
    toggleExpanded,
    setDiffStyle,
    toggleDiffStyle,
    setDisplayOption,
    toggleDisplayOption,
  }), [width, maxWidth, expanded, diffStyle, displayOptions, setWidth, resetWidth, setExpanded, toggleExpanded, setDiffStyle, toggleDiffStyle, setDisplayOption, toggleDisplayOption]);
}

export function useRightPanelVisibility(enabled: boolean): RightPanelVisibilityState {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current !== null && typeof window !== "undefined") {
      window.clearTimeout(openTimer.current);
    }
    openTimer.current = null;
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null && typeof window !== "undefined") {
      window.clearTimeout(closeTimer.current);
    }
    closeTimer.current = null;
  }, []);
  const startOpenAnimation = useCallback(() => {
    clearOpenTimer();
    if (typeof window === "undefined") {
      setOpening(false);
      return;
    }
    setOpening(true);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setOpening(false);
    }, RIGHT_PANEL_TRANSITION_MS);
  }, [clearOpenTimer]);
  const startCloseAnimation = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
    setOpening(false);
    if (typeof window === "undefined") {
      setClosing(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
    }, RIGHT_PANEL_TRANSITION_MS);
  }, [clearCloseTimer, clearOpenTimer]);
  const openPanel = useCallback(() => {
    if (!enabled) return;
    clearCloseTimer();
    setClosing(false);
    if (!open) startOpenAnimation();
    setOpen(true);
  }, [clearCloseTimer, enabled, open, startOpenAnimation]);
  const closePanel = useCallback(() => {
    if (!open && !closing) return;
    setOpen(false);
    startCloseAnimation();
  }, [closing, open, startCloseAnimation]);
  const togglePanel = useCallback(() => {
    if (open) closePanel();
    else openPanel();
  }, [closePanel, open, openPanel]);

  useEffect(() => {
    if (enabled) return;
    clearCloseTimer();
    clearOpenTimer();
    setOpen(false);
    setClosing(false);
    setOpening(false);
  }, [clearCloseTimer, clearOpenTimer, enabled]);
  useEffect(() => () => {
    clearCloseTimer();
    clearOpenTimer();
  }, [clearCloseTimer, clearOpenTimer]);

  return useMemo(() => ({
    open: open && enabled,
    available: enabled && (open || closing || opening),
    opening,
    closing,
    openPanel,
    closePanel,
    togglePanel,
  }), [closePanel, closing, enabled, open, openPanel, opening, togglePanel]);
}

function getDefaultStorage(): PanelStorage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

function readStorage(storage: PanelStorage | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function saveStorage(key: string, value: string): void {
  try { getDefaultStorage()?.setItem(key, value); } catch { /* Keep the in-memory layout usable. */ }
}
