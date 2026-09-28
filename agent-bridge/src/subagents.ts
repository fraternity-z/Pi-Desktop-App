import type { ToolDisplayPayload } from "./session-runtime.js";

export interface SubagentMessage {
  role: "user" | "assistant" | "thinking" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: ToolDisplayPayload;
  toolOutput?: ToolDisplayPayload;
  isError?: boolean;
}

export interface SubagentSnapshot {
  id: string;
  agent: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  messages: SubagentMessage[];
  truncated: boolean;
  model?: string;
  turns?: number;
  transcriptAvailable?: boolean;
  transcriptRevision?: number;
}

interface Projection {
  redact(text: string): string;
  input(value: unknown): ToolDisplayPayload | undefined;
  output(value: unknown): ToolDisplayPayload | undefined;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const readableTask = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() && !/^\[prompt redacted\](?:$|;)/i.test(value.trim()) ? value : undefined;

/** Projects public subagent results, including pi-subagents compact progress snapshots. */
export function projectSubagents(
  toolCallId: string, input: unknown, details: unknown,
  phase: "start" | "update" | "complete" | "failed",
  project: Projection, previous: SubagentSnapshot[] = [],
): SubagentSnapshot[] | undefined {
  const args = record(input) ? input : {};
  const chain = Array.isArray(args.chain) || (record(details) && details.mode === "chain");
  const seeds = Array.isArray(args.chain) ? args.chain : Array.isArray(args.tasks) ? args.tasks : args.agent ? [args] : [];
  const results = record(details) && ["single", "parallel", "chain"].includes(String(details.mode)) && Array.isArray(details.results) ? details.results : [];
  const count = Math.max(seeds.length, previous.length, results.length);
  if (!count) return undefined;
  const snapshots: SubagentSnapshot[] = [];
  for (let index = 0; index < Math.min(count, 16); index++) {
    const seed = record(seeds[index]) ? seeds[index] : {};
    const raw = record(results[index]) ? results[index] : undefined;
    const prior = previous[index];
    // Share the budget so one busy peer cannot hide another peer's final answer.
    let remaining = Math.floor(48_000 / Math.min(count, 16));
    let truncated = count > 16 || raw?.truncated === true || (!Array.isArray(raw?.messages) && (prior?.truncated ?? false));
    const text = (value: unknown, cap: number, budgeted = true): string => {
      if (typeof value !== "string") return "";
      const safe = project.redact(value);
      const limited = safe.slice(0, budgeted ? Math.min(cap, remaining) : cap);
      if (limited.length !== safe.length) truncated = true;
      if (budgeted) remaining -= limited.length;
      return limited;
    };
    // Transcript exhaustion must never remove later agents or change their identity.
    const agent = text(raw?.agent ?? seed.agent ?? prior?.agent, 128, false);
    // pi-subagents redacts result.task; retain the delegation already supplied by the parent.
    const task = text(readableTask(raw?.task) ?? readableTask(seed.task) ?? readableTask(prior?.task) ?? raw?.task ?? seed.task ?? prior?.task, 4_096, false);
    if (!agent.trim()) continue;
    const active = raw && (raw.exitCode === 0 || (Array.isArray(raw.messages) && raw.messages.length > 0));
    const final = phase === "complete" || phase === "failed";
    let status: SubagentSnapshot["status"] = chain && index > 0 ? "pending" : "running";
    if (raw?.stopReason === "aborted") status = "cancelled";
    else if (raw && ((typeof raw.exitCode === "number" && raw.exitCode !== 0 && (raw.exitCode !== -1 || final)) || raw.stopReason === "error" || raw.errorMessage)) status = "failed";
    else if (!raw && prior && ["completed", "failed", "cancelled"].includes(prior.status)) status = prior.status;
    else if (final) status = active ? "completed" : phase === "failed" && !raw && !prior ? "failed" : "cancelled";
    else if (raw) status = active ? "running" : "pending";
    else if (prior) status = prior.status;
    if (!final && chain && raw && index < results.length - 1 && status === "running") status = "completed";
    if (final && phase === "failed" && !raw && prior?.status === "running") status = "failed";
    if (typeof raw?.status === "string" && ["pending", "running", "completed", "failed", "cancelled"].includes(raw.status)) {
      status = raw.status as SubagentSnapshot["status"];
      if (final && (status === "pending" || status === "running")) status = phase === "failed" ? "failed" : "cancelled";
    }
    const messages: SubagentMessage[] = [];
    const display = (value: unknown, output: boolean, prepared?: unknown): ToolDisplayPayload | undefined => {
      const saved = record(prepared) && typeof prepared.text === "string" && ["text", "json"].includes(String(prepared.format)) && typeof prepared.truncated === "boolean" ? prepared : undefined;
      let source = value;
      // Older built-in records stored JSON inputs as strings, losing their format.
      if (!output && typeof source === "string" && /^[{[]/.test(source.trimStart())) {
        try { source = JSON.parse(source); } catch { /* A clipped input remains readable text. */ }
      }
      let payload: ToolDisplayPayload | undefined = saved
        ? { text: saved.text as string, format: saved.format as ToolDisplayPayload["format"], truncated: saved.truncated === true }
        : output ? project.output(source) : project.input(source);
      if (saved?.format === "json") {
        try { payload = project.input(JSON.parse(saved.text as string)); } catch { /* Retain clipped JSON as plain text below. */ }
      }
      if (!payload) return undefined;
      const redacted = project.redact(payload.text);
      if (remaining < Math.min(4_096, redacted.length)) truncated = true;
      const safe = redacted.slice(0, Math.min(4_096, remaining));
      remaining -= safe.length;
      // Tool previews carry their own warning; do not label the whole conversation.
      if (!safe.trim()) return undefined;
      return { text: safe, format: safe.length < redacted.length ? "text" : payload.format, truncated: saved?.truncated === true || payload.truncated || safe.length < redacted.length };
    };
    const append = (message: SubagentMessage, prepend = false) => {
      if (message.role === "tool" && message.toolCallId) {
        const existing = messages.findIndex((item) => item.role === "tool" && item.toolCallId === message.toolCallId);
        if (existing >= 0) {
          if (prepend) { const merged = { ...message, ...messages[existing]! }; messages.splice(existing, 1); messages.unshift(merged); }
          else messages[existing] = { ...messages[existing]!, ...message };
          return;
        }
      }
      if (messages.length < 100) { if (prepend) messages.unshift(message); else messages.push(message); } else truncated = true;
    };
    const hasTranscript = Array.isArray(raw?.messages) && raw.messages.length > 0;
    const progress = record(raw?.progress) ? raw.progress : undefined;
    const finalOutput = typeof raw?.finalOutput === "string" && raw.finalOutput.trim() ? raw.finalOutput : undefined;
    const recentOutput: unknown[] = Array.isArray(progress?.recentOutput) ? progress.recentOutput : [];
    if (hasTranscript) {
      const transcript = raw.messages as unknown[];
      if (transcript.length > 100) truncated = true;
      for (const message of transcript.slice(-100).reverse()) {
        if (!record(message)) continue;
        if (message.role === "toolResult") {
          const toolCallId = text(message.toolCallId, 256, false);
          const toolName = text(message.toolName, 128, false);
          if (!toolCallId.trim() || !toolName.trim()) continue;
          const toolOutput = display(message.content, true, message.toolOutput);
          append({ role: "tool", content: "", toolCallId, toolName, ...(toolOutput ? { toolOutput } : {}), isError: message.isError === true }, true);
          continue;
        }
        if (!["user", "assistant", "system"].includes(String(message.role))) continue;
        const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? message.content : [];
        if (blocks.length > 100) truncated = true;
        for (const block of blocks.slice(-100).reverse()) {
          if (!record(block)) continue;
          if (block.type === "toolCall") {
            const toolCallId = text(block.id, 256, false);
            const toolName = text(block.name, 128, false);
            const toolInput = display(block.arguments, false, block.toolInput);
            if (toolCallId.trim() && toolName.trim()) append({ role: "tool", content: "", toolCallId, toolName, ...(toolInput ? { toolInput } : {}) }, true);
          } else if (block.type === "text" || block.type === "thinking") {
            const content = text(block.type === "thinking" ? block.thinking ?? block.text : block.text, 8_192);
            if (content) append({ role: block.type === "thinking" ? "thinking" : message.role as SubagentMessage["role"], content }, true);
          } else if (block.type === "image" || block.type === "image_url") truncated = true;
        }
      }
    } else if (finalOutput) {
      append({ role: "system", content: "扩展未提供完整会话，以下为子代理返回的结果。" });
      append({ role: "assistant", content: text(finalOutput, 8_192) });
    } else if (recentOutput.some((line) => typeof line === "string" && line.trim())) {
      // These lines mix assistant text and tool results; do not invent transcript roles.
      if (recentOutput.length > 50) truncated = true;
      const lines = recentOutput.slice(-50).filter((line): line is string => typeof line === "string").map((line) => text(line, 8_192));
      append({ role: "system", content: text(`子代理进度摘要（扩展未提供完整会话）\n\n${lines.join("\n")}`, 8_192, false) });
    } else if (prior) {
      for (const message of [...prior.messages].reverse()) {
        const content = text(message.content, 8_192);
        const { toolInput, toolOutput, ...rest } = message;
        const retain = (payload: ToolDisplayPayload | undefined) => {
          if (!payload) return undefined;
          return display(undefined, false, payload);
        };
        const retainedInput = retain(toolInput);
        const retainedOutput = retain(toolOutput);
        append({ ...rest, content, ...(retainedInput ? { toolInput: retainedInput } : {}), ...(retainedOutput ? { toolOutput: retainedOutput } : {}) }, true);
      }
    }
    if (status === "failed" || status === "cancelled") {
      const error = text(raw?.errorMessage || raw?.error || raw?.stderr, 4_096);
      if (error && !messages.some((message) => message.content === error)) append({ role: "system", content: error, isError: true });
    }
    const model = text(raw?.model ?? prior?.model, 256, false);
    const turns = record(raw?.usage) ? raw.usage.turns : prior?.turns;
    const transcriptAvailable = raw?.transcriptAvailable === true || (!raw && prior?.transcriptAvailable === true);
    const transcriptRevision = raw?.transcriptRevision ?? prior?.transcriptRevision;
    snapshots.push({ id: `${toolCallId}:${index}`, agent, task, status, messages, truncated, ...(model ? { model } : {}), ...(Number.isSafeInteger(turns) && Number(turns) >= 0 ? { turns: Number(turns) } : {}),
      ...(transcriptAvailable ? { transcriptAvailable: true } : {}), ...(Number.isSafeInteger(transcriptRevision) && Number(transcriptRevision) > 0 ? { transcriptRevision: Number(transcriptRevision) } : {}) });
  }
  return fitSubagents(snapshots, 100_000);
}

/** Fit metadata inside an existing history page without evicting its parent message. */
export function fitSubagents(snapshots: SubagentSnapshot[], maximumBytes: number): SubagentSnapshot[] | undefined {
  // JSON escaping and non-ASCII text can consume far more bytes than characters.
  while (snapshots.length && Buffer.byteLength(JSON.stringify(snapshots), "utf8") > maximumBytes) {
    const largest = snapshots.reduce((left, right) => JSON.stringify(left).length > JSON.stringify(right).length ? left : right);
    largest.truncated = true;
    if (largest.messages.length > 1) largest.messages.splice(largest.messages[0]?.role === "user" && largest.messages.length > 2 ? 1 : 0, 1);
    else if (largest.messages[0]?.content.length) largest.messages[0].content = largest.messages[0].content.slice(0, Math.floor(largest.messages[0].content.length / 2));
    else if (largest.messages.length) largest.messages.shift();
    else if (largest.task.length) largest.task = largest.task.slice(0, Math.floor(largest.task.length / 2));
    else { snapshots.pop(); if (snapshots[0]) snapshots[0].truncated = true; }
  }
  return snapshots.length ? snapshots : undefined;
}
