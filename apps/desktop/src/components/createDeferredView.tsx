import { AlertTriangle, ArrowLeft, Menu, RefreshCw } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";

import { LoadingIndicator } from "./LoadingIndicator";

const VIEW_LOAD_TIMEOUT_MS = 15_000;

interface ViewNavigationProps {
  sidebarOpen?: boolean;
  onOpenSidebar?: () => void;
  onBack?: () => void;
}

type ViewState<Props extends object> =
  | { phase: "loading" }
  | { phase: "ready"; View: ComponentType<Props> }
  | { phase: "error"; message: string };

export function createDeferredView<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
): ComponentType<Props & ViewNavigationProps> {
  let loadedView: ComponentType<Props> | undefined;

  return function DeferredView(props: Props & ViewNavigationProps) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<ViewState<Props>>(() =>
      loadedView ? { phase: "ready", View: loadedView } : { phase: "loading" },
    );

    useEffect(() => {
      if (loadedView) {
        setState({ phase: "ready", View: loadedView });
        return undefined;
      }
      let active = true;
      setState({ phase: "loading" });
      const timeout = window.setTimeout(() => {
        active = false;
        setState({ phase: "error", message: "PAGE_LOAD_TIMEOUT: 页面加载超时，请重试" });
      }, VIEW_LOAD_TIMEOUT_MS);

      void Promise.resolve()
        .then(load)
        .then(({ default: View }) => {
          if (!active) return;
          loadedView = View;
          window.clearTimeout(timeout);
          setState({ phase: "ready", View });
        })
        .catch(() => {
          if (!active) return;
          window.clearTimeout(timeout);
          setState({ phase: "error", message: "PAGE_LOAD_FAILED: 页面加载失败，请重试" });
        });

      return () => {
        active = false;
        window.clearTimeout(timeout);
      };
    }, [attempt]);

    if (state.phase === "ready") {
      const View = state.View;
      return <View {...props} />;
    }

    return (
      <main className="workspace-main" aria-busy={state.phase === "loading"}>
        {(props.onBack || (!props.sidebarOpen && props.onOpenSidebar)) && (
          <header className="topbar">
            <div className="topbar-title-group">
              {!props.sidebarOpen && props.onOpenSidebar && (
                <button
                  className="icon-button sidebar-open-button"
                  type="button"
                  onClick={props.onOpenSidebar}
                  aria-label="打开侧边栏"
                  title="打开侧边栏"
                >
                  <Menu size={19} aria-hidden="true" />
                </button>
              )}
              {props.onBack && (
                <button
                  className="icon-button"
                  type="button"
                  onClick={props.onBack}
                  aria-label="返回会话工作台"
                  title="返回"
                >
                  <ArrowLeft size={18} aria-hidden="true" />
                </button>
              )}
            </div>
          </header>
        )}
        <div className="deferred-view-state">
          {state.phase === "loading" ? (
            <LoadingIndicator label="正在加载页面" />
          ) : (
            <div className="inline-alert" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>{state.message}</span>
              <button type="button" onClick={() => setAttempt((current) => current + 1)}>
                <RefreshCw size={15} aria-hidden="true" />
                重新加载
              </button>
            </div>
          )}
        </div>
      </main>
    );
  };
}
