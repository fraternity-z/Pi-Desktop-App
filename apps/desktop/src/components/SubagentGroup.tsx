import { Bot, Check, ChevronRight, CircleAlert, Clock, LoaderCircle, Square, Target, Workflow } from "lucide-react";
import { useId, useState } from "react";

import type { SubagentSnapshot } from "../ipc/agent";
import "./subagents.css";

export const subagentStatusLabels: Record<SubagentSnapshot["status"], string> = {
  pending: "等待执行", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止",
};

export function SubagentGroup({ subagents, selectedId, onOpen }: {
  subagents: SubagentSnapshot[]; selectedId?: string | null; onOpen?: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const completed = subagents.filter((agent) => agent.status === "completed").length;
  const active = subagents.some((agent) => agent.status === "running" || agent.status === "pending");
  const warnings = subagents.filter((agent) => agent.status === "failed" || agent.status === "cancelled").length;
  const label = active ? "执行中" : warnings ? "已结束，存在未完成任务" : "已完成";
  return <section className="subagent-group" aria-label="子代理任务组">
    <button type="button" className="subagent-group-header" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      <Workflow size={16} aria-hidden="true" /><span className="subagent-group-title">Subagent {label}</span>
      <span className="subagent-group-count">{subagents.length} 个子代理 · 已完成 {completed}/{subagents.length}{warnings > 0 ? ` · ${warnings} 个未完成` : ""}</span>
      <ChevronRight size={14} className="subagent-group-chevron" aria-hidden="true" />
    </button>
    <div id={id} className="subagent-topology" hidden={!open}>
      <div className="subagent-master"><span className="subagent-avatar"><Target size={19} aria-hidden="true" /></span><div><strong>主 Agent</strong><small>{active ? "正在协调" : "已委派"} {subagents.length} 个委派任务</small></div></div>
      <ul className="subagent-children">{subagents.map((agent) => {
        const Icon = { pending: Clock, running: LoaderCircle, completed: Check, failed: CircleAlert, cancelled: Square }[agent.status];
        return <li key={agent.id}><button type="button" className="subagent-card" aria-label={`查看 ${agent.agent} 子代理会话：${agent.task}`} aria-pressed={selectedId === agent.id} onClick={() => onOpen?.(agent.id)} disabled={!onOpen}>
          <span className="subagent-avatar"><Bot size={17} aria-hidden="true" /><Icon size={11} className={`subagent-status-icon${agent.status === "running" ? " spin" : ""}`} aria-hidden="true" /></span>
          <span className="subagent-card-body"><span className="subagent-card-heading"><strong>{agent.agent}</strong>{agent.model && <span className="subagent-model" title={agent.model}>{agent.model}</span>}<span className="subagent-status" data-status={agent.status}>{subagentStatusLabels[agent.status]}</span></span>
            <span className="subagent-task" title={agent.task}>{agent.task || "未提供任务描述"}</span>
            {agent.turns !== undefined && <small>{agent.turns} 轮</small>}
          </span>
        </button></li>;
      })}</ul>
    </div>
  </section>;
}
