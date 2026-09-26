export function SessionLoading() {
  return (
    <div className="conversation-loading" aria-busy="true">
      <div className="conversation-loading-content" role="status" aria-live="polite" aria-label="正在切换会话">
        <span className="conversation-loading-orbit" aria-hidden="true">
          <span />
          <span />
        </span>
        <span className="conversation-loading-label">正在切换会话</span>
      </div>
    </div>
  );
}
