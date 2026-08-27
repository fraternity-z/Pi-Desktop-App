import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import {
  hideBrowserSidebar,
  openBrowserSidebar,
  updateBrowserSidebarBounds,
  type BrowserSidebarBoundsInput,
} from "../ipc/browser";

const DEFAULT_BROWSER_URL = "https://www.google.com";
const MIN_BROWSER_SURFACE_SIZE = 24;
const BROWSER_SURFACE_BOTTOM_INSET = 12;

export interface BrowserSidebarPanelProps {
  readonly active: boolean;
}

function toErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function parsePixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveAvailableSurfaceHeight(element: HTMLElement, surfaceRect: DOMRect): number {
  const sidebar = element.closest(".right-panel");
  if (!(sidebar instanceof HTMLElement)) return surfaceRect.height;

  const sidebarRect = sidebar.getBoundingClientRect();
  const parentStyle = element.parentElement === null
    ? null
    : window.getComputedStyle(element.parentElement);
  const bottomInset = parentStyle === null
    ? BROWSER_SURFACE_BOTTOM_INSET
    : parsePixelValue(parentStyle.paddingBottom) ?? BROWSER_SURFACE_BOTTOM_INSET;
  const availableHeight = sidebarRect.bottom - surfaceRect.top - bottomInset;
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return surfaceRect.height;
  return Math.max(surfaceRect.height, availableHeight);
}

function readBounds(element: HTMLElement): BrowserSidebarBoundsInput | null {
  const rect = element.getBoundingClientRect();
  const height = resolveAvailableSurfaceHeight(element, rect);
  if (rect.width < MIN_BROWSER_SURFACE_SIZE || height < MIN_BROWSER_SURFACE_SIZE) return null;
  return {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.top),
    width: rect.width,
    height,
    visible: true,
  };
}

export function BrowserSidebarPanel(props: BrowserSidebarPanelProps): ReactElement {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const currentUrlRef = useRef(DEFAULT_BROWSER_URL);
  const browserCreatedRef = useRef(false);
  const openingRef = useRef<Promise<void> | null>(null);
  const activeRef = useRef(props.active);
  const generationRef = useRef(0);
  const [address, setAddress] = useState(DEFAULT_BROWSER_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  activeRef.current = props.active;

  const hideNativeBrowser = useCallback(() => {
    void hideBrowserSidebar().catch(() => undefined);
  }, []);

  const openAtCurrentBounds = useCallback(async (url: string) => {
    const generation = generationRef.current;
    if (!activeRef.current) return;
    if (openingRef.current !== null) await openingRef.current;
    if (!activeRef.current || generation !== generationRef.current) return;

    const surface = surfaceRef.current;
    if (surface === null) return;
    const bounds = readBounds(surface);
    if (bounds === null) return;

    const openPromise = openBrowserSidebar({ ...bounds, url });
    openingRef.current = openPromise;
    try {
      await openPromise;
      browserCreatedRef.current = true;
      currentUrlRef.current = url;
      setError(null);
      const latestSurface = surfaceRef.current;
      const latestBounds = latestSurface === null ? null : readBounds(latestSurface);
      if (activeRef.current && latestBounds !== null) {
        void updateBrowserSidebarBounds(latestBounds).catch((cause: unknown) => {
          setError(`调整浏览器区域失败：${toErrorMessage(cause)}`);
        });
      }
    } finally {
      if (openingRef.current === openPromise) openingRef.current = null;
    }
  }, []);

  const updateBounds = useCallback(() => {
    const surface = surfaceRef.current;
    if (surface === null || !props.active) return;
    const bounds = readBounds(surface);
    if (bounds === null) {
      hideNativeBrowser();
      return;
    }
    if (!browserCreatedRef.current) {
      if (openingRef.current !== null) return;
      void openAtCurrentBounds(currentUrlRef.current).catch((cause: unknown) => {
        setError(`打开浏览器失败：${toErrorMessage(cause)}`);
      });
      return;
    }
    void updateBrowserSidebarBounds(bounds).catch((cause: unknown) => {
      setError(`调整浏览器区域失败：${toErrorMessage(cause)}`);
    });
  }, [hideNativeBrowser, openAtCurrentBounds, props.active]);

  useLayoutEffect(() => {
    generationRef.current += 1;
    if (!props.active) {
      hideNativeBrowser();
      return undefined;
    }

    let animationFrame = window.requestAnimationFrame(updateBounds);
    const surface = surfaceRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateBounds);
    });
    if (surface !== null) observer?.observe(surface);
    window.addEventListener("resize", updateBounds);
    return () => {
      generationRef.current += 1;
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", updateBounds);
      hideNativeBrowser();
    };
  }, [hideNativeBrowser, props.active, updateBounds]);

  useEffect(() => {
    if (props.active) updateBounds();
  }, [props.active, updateBounds]);

  const submitAddress = useCallback(async () => {
    const nextUrl = address.trim() || DEFAULT_BROWSER_URL;
    setBusy(true);
    setError(null);
    try {
      await openAtCurrentBounds(nextUrl);
      setAddress(nextUrl);
    } catch (cause) {
      setError(`打开浏览器失败：${toErrorMessage(cause)}`);
    } finally {
      setBusy(false);
    }
  }, [address, openAtCurrentBounds]);

  return (
    <div className="workspace-side-browser">
      <form
        className="workspace-side-browser-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void submitAddress();
        }}
      >
        <input
          className="workspace-side-browser-address"
          aria-label="浏览器地址"
          value={address}
          onChange={(event) => setAddress(event.currentTarget.value)}
          placeholder="https://example.com"
        />
        <button type="submit" className="workspace-side-browser-go" disabled={busy}>
          {busy ? "打开中" : "前往"}
        </button>
      </form>
      {error === null ? null : (
        <div className="workspace-side-browser-error" role="alert">
          {error}
        </div>
      )}
      <div ref={surfaceRef} className="workspace-side-browser-surface" aria-label="浏览器内容区域">
        <span>浏览器加载中…</span>
      </div>
    </div>
  );
}
