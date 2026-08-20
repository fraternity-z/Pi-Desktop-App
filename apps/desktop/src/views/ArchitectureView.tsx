import { useArchitectureStatus } from "../stores/useArchitectureStatus";

export function ArchitectureView() {
  const state = useArchitectureStatus();

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Pi Desktop</p>
        <h1>桌面运行时</h1>
        <p className="summary">Renderer、Rust Core 与 Pi Bridge 的基础连接。</p>
      </header>

      <section className="status-panel" aria-live="polite">
        <h2>架构状态</h2>
        {state.phase === "loading" && <p className="muted">正在连接 Rust Core...</p>}
        {state.phase === "error" && (
          <p className="error" role="alert">
            无法读取架构状态：{state.message}
          </p>
        )}
        {state.phase === "ready" && (
          <dl className="status-list">
            <div>
              <dt>Renderer</dt>
              <dd>{state.status.renderer}</dd>
            </div>
            <div>
              <dt>Rust Core</dt>
              <dd>{state.status.core}</dd>
            </div>
            <div>
              <dt>Pi Bridge</dt>
              <dd>{state.status.bridge}</dd>
            </div>
            <div>
              <dt>协议</dt>
              <dd>v{state.status.protocolVersion}</dd>
            </div>
          </dl>
        )}
      </section>
    </main>
  );
}

