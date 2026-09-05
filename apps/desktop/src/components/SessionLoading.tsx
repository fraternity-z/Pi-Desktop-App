import { LoadingIndicator } from "./LoadingIndicator";

export function SessionLoading() {
  return (
    <div className="conversation-loading" aria-busy="true">
      <div className="conversation-loading-content">
        <LoadingIndicator label="正在切换会话" />
        <div className="conversation-loading-skeleton" aria-hidden="true">
          <div className="conversation-loading-prompt" />
          <div className="conversation-loading-response">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
