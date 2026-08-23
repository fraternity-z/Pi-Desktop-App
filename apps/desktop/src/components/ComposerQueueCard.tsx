import { ListTodo } from "lucide-react";

import type { QueuedMessages } from "../ipc/agent";

interface ComposerQueueCardProps {
  queuedMessages: QueuedMessages;
  paused: boolean;
  onClear: () => void;
}

export function ComposerQueueCard({ queuedMessages, paused, onClear }: ComposerQueueCardProps) {
  const items = [
    ...queuedMessages.steering.map((message, index) => ({
      key: `steer:${index}:${message}`,
      message,
      kind: "引导",
    })),
    ...queuedMessages.followUp.map((message, index) => ({
      key: `follow-up:${index}:${message}`,
      message,
      kind: "后续",
    })),
  ];
  if (items.length === 0) return null;

  return (
    <div className="composer-queue-card" data-paused={paused ? "true" : "false"}>
      {paused && <div className="composer-queue-banner">由于你中断了当前响应，队列已暂停</div>}
      <div className="composer-queue-toolbar">
        <span>{items.length} 条排队</span>
        <button type="button" onClick={onClear} aria-label="清空排队消息">
          清空
        </button>
      </div>
      <ul className="composer-queue-list">
        {items.map((item) => (
          <li key={item.key} className="composer-queue-row">
            <ListTodo size={14} aria-hidden />
            <span className="composer-queue-kind">{item.kind}</span>
            <span className="composer-queue-text" title={item.message}>
              {item.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
