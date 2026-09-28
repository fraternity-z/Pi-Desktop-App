import { useCallback } from "react";
import type { PermissionDecision, PermissionRequest } from "../ipc/agent";
import { SidebarDialogFrame } from "./SidebarDialog";

export function PermissionDialog({ request, workspace, pendingCount, busy, error, onReply }: {
  request: PermissionRequest;
  workspace: string;
  pendingCount: number;
  busy: boolean;
  error: string | null;
  onReply: (decision: PermissionDecision) => void;
}) {
  const deny = useCallback(() => onReply("deny"), [onReply]);
  return (
    <SidebarDialogFrame title="工具执行需要授权" description={`当前工具：${request.toolName}`} busy={busy} onClose={deny}>
      <div className="sidebar-dialog-form">
        <p className="sidebar-dialog-hint" style={{ overflowWrap: "anywhere" }}>当前项目：{workspace}</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 240, overflowY: "auto" }}>{request.summary}</pre>
        <p className="sidebar-dialog-hint">
          本会话允许会放行此工具的后续调用（包括不同参数及路径），直到更改权限模式或关闭运行时。
          请求发出 120 秒后自动拒绝；关闭此窗口也会拒绝。
          {pendingCount > 1 && `还有 ${pendingCount - 1} 项操作等待授权。`}
        </p>
        {error && <p className="sidebar-dialog-error" role="alert">{error}</p>}
        <div className="sidebar-dialog-actions" style={{ flexWrap: "wrap" }}>
          <button className="secondary-button" type="button" disabled={busy} onClick={deny}>拒绝</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => onReply("allow-session")}>本会话允许</button>
          <button className="primary-button" type="button" disabled={busy} onClick={() => onReply("allow-once")}>仅允许一次</button>
        </div>
      </div>
    </SidebarDialogFrame>
  );
}
