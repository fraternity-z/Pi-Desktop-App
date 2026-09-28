import { randomUUID } from "node:crypto";
import type { PiSessionLike, ToolDisplayPayload } from "./session-runtime.js";
import { SubagentTranscripts } from "./subagent-transcripts.js";
import type { SubagentMessage } from "./subagents.js";

interface Projection {
  redact(text: string): string;
  input(value: unknown): ToolDisplayPayload | undefined;
  output(value: unknown): ToolDisplayPayload | undefined;
  fullInput?(value: unknown): ToolDisplayPayload | undefined;
  fullOutput?(value: unknown): ToolDisplayPayload | undefined;
}
interface Task { agent: string; task: string }
type Mode = "single" | "parallel" | "chain";
type Status = "pending" | "running" | "completed" | "failed" | "cancelled";
type Message = { role: string; content: Array<Record<string, unknown>>; toolCallId?: string; toolName?: string; toolOutput?: ToolDisplayPayload; isError?: boolean; sourceId?: string };
interface Result extends Task {
  exitCode: number; messages: Message[]; model?: string; usage: { turns: number };
  stopReason?: string; errorMessage?: string; status: Status; truncated: boolean;
  transcriptAvailable?: boolean; transcriptRevision?: number;
}
interface ToolResult { content: Array<{ type: "text"; text: string }>; details: { mode: Mode; results: Result[] }; isError?: boolean }
interface Execution { controller: AbortController; settled: Promise<unknown> }
type Child = { session: PiSessionLike; dispose(): void };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const taskSchema = { type: "object", additionalProperties: false, required: ["agent", "task"], properties: { agent: { type: "string", minLength: 1, maxLength: 128 }, task: { type: "string", minLength: 1, maxLength: 4096 } } };
const invalid = () => new Error("SUBAGENT_INPUT_INVALID: 请提供单个 agent/task，或 1–4 项 tasks/chain；不支持运行时覆盖参数");

function parse(value: unknown): { mode: Mode; tasks: Task[] } {
  if (!record(value)) throw invalid();
  const keys = Object.keys(value);
  const mode = keys.length === 2 && keys.includes("agent") && keys.includes("task") ? "single"
    : keys.length === 1 && keys[0] === "tasks" ? "parallel" : keys.length === 1 && keys[0] === "chain" ? "chain" : undefined;
  if (!mode) throw invalid();
  const tasks = mode === "single" ? [value] : value[mode === "parallel" ? "tasks" : "chain"];
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 4) throw invalid();
  return { mode, tasks: tasks.map((task) => {
    if (!record(task) || Object.keys(task).length !== 2 || typeof task.agent !== "string" || !task.agent.trim() || task.agent.length > 128 || /[\x00-\x1f]/.test(task.agent) || typeof task.task !== "string" || !task.task.trim() || task.task.length > 4096 || task.task.includes("\0")) throw invalid();
    return { agent: task.agent, task: task.task };
  }) };
}

/** Owns only delegation orchestration. The factory owns SDK setup and authorization. */
export class BuiltinSubagents {
  readonly transcripts = new SubagentTranscripts();
  private closed = false;
  private reserved = 0;
  private readonly executions = new Set<Execution>();

  constructor(private readonly createChild: (signal: AbortSignal, toolPrefix: string) => Promise<Child>, private readonly projection: Projection) {}

  get active(): boolean { return this.executions.size > 0; }

  readonly tool = {
    name: "subagent", label: "子代理",
    description: "Delegate an isolated task to a built-in child agent. Inherits the current workspace, model and approved tools. agent is a display label, not an agent configuration file. Use tasks for parallel work or chain with {previous} for sequential results.",
    promptSnippet: "Delegate bounded independent tasks to built-in child agents.",
    promptGuidelines: ["Provide an explicit self-contained task; children do not receive parent conversation history.", "Use at most four tasks. Child agents cannot delegate further."],
    parameters: { type: "object", additionalProperties: false, properties: { ...taskSchema.properties, tasks: { type: "array", minItems: 1, maxItems: 4, items: taskSchema }, chain: { type: "array", minItems: 1, maxItems: 4, items: taskSchema } }, oneOf: [{ required: ["agent", "task"] }, { required: ["tasks"] }, { required: ["chain"] }] },
    execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (result: ToolResult) => void): Promise<ToolResult> => this.execute(toolCallId, params, signal, onUpdate),
  };

  async cancel(): Promise<void> {
    const active = [...this.executions];
    for (const execution of active) execution.controller.abort();
    await Promise.allSettled(active.map((execution) => execution.settled));
  }

  async close(): Promise<void> { this.closed = true; await this.cancel(); }

  private async execute(toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (result: ToolResult) => void): Promise<ToolResult> {
    const { mode, tasks } = parse(params);
    if (this.closed) throw new Error("SUBAGENT_CLOSED: 子代理执行器已关闭");
    const slots = mode === "parallel" ? tasks.length : 1;
    if (!signal?.aborted && this.reserved + slots > 4) throw new Error("SUBAGENT_BUSY: 同一会话最多同时执行 4 个子代理");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    this.reserved += slots;
    const execution: Execution = { controller, settled: Promise.resolve() };
    this.executions.add(execution);
    // Start in a microtask so cancellation always observes the settlement promise.
    execution.settled = Promise.resolve().then(() => this.run(toolCallId, mode, tasks, controller.signal, onUpdate));
    try { return await execution.settled as ToolResult; }
    finally { signal?.removeEventListener("abort", abort); this.reserved -= slots; this.executions.delete(execution); }
  }

  private async run(toolCallId: string, mode: Mode, tasks: Task[], signal: AbortSignal, onUpdate?: (result: ToolResult) => void): Promise<ToolResult> {
    const results: Result[] = tasks.map((task) => {
      const agent = this.projection.redact(task.agent); const text = this.projection.redact(task.task);
      return { agent: agent.slice(0, 128), task: text.slice(0, 4096), exitCode: -1, messages: [], usage: { turns: 0 }, status: "pending", truncated: agent.length > 128 || text.length > 4096 };
    });
    const fullResults = structuredClone(results);
    for (const result of fullResults) result.messages = [{ role: "user", content: [{ type: "text", text: result.task }] }];
    const saveSnapshots = () => {
      for (let index = 0; index < results.length; index++) {
        const full = fullResults[index]!;
        const messages = fullMessages(full.messages);
        const error = full.errorMessage ?? results[index]!.errorMessage;
        if (error) messages.push({ role: "system", content: error, isError: true });
        results[index]!.transcriptRevision = this.transcripts.set(`${toolCallId}:${index}`, messages);
        results[index]!.transcriptAvailable = true;
      }
    };
    const summaries = tasks.map(() => "");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const snapshot = (): ToolResult => {
      const details = { mode, results: structuredClone(results) };
      // Escaped control characters consume up to six bytes per character.
      while (Buffer.byteLength(JSON.stringify(details), "utf8") > 200_000) {
        const largest = details.results.reduce((left, right) => JSON.stringify(left).length >= JSON.stringify(right).length ? left : right);
        largest.truncated = true;
        if (largest.messages.length) trimTranscript(largest.messages);
        else if (largest.errorMessage) largest.errorMessage = largest.errorMessage.slice(0, Math.floor(largest.errorMessage.length / 2));
        else largest.task = largest.task.slice(0, Math.floor(largest.task.length / 2));
      }
      return {
        content: [{ type: "text", text: results.map((result, index) => `${result.agent}: ${result.errorMessage || summaries[index] || result.status}`).join("\n\n") }],
        details,
        ...(results.some((result) => result.status === "failed" || result.status === "cancelled") ? { isError: true } : {}),
      };
    };
    const flush = () => {
      if (timer) clearTimeout(timer); timer = undefined;
      saveSnapshots();
      // A failing consumer must never strand a child or bypass cleanup.
      try { onUpdate?.(snapshot()); } catch { /* The next/full terminal snapshot remains available. */ }
    };
    const update = () => { if (!timer) timer = setTimeout(flush, 50); };
    const runOne = async (index: number, task: string) => {
      const result = results[index]!;
      if (signal.aborted) { result.status = "cancelled"; result.stopReason = "aborted"; result.errorMessage = "子代理任务已取消"; flush(); return; }
      result.status = "running";
      const safeTask = this.projection.redact(task);
      result.task = safeTask.slice(0, 4096);
      if (safeTask.length > 4096) result.truncated = true;
      let child: Child | undefined; let unsubscribe: (() => void) | undefined; let aborting: Promise<void> | undefined;
      const transcript = new Transcript(result, this.projection);
      const complete = new Transcript(fullResults[index]!, this.projection, true);
      complete.replace([{ role: "user", content: task }]);
      const abort = () => {
        if (child && !aborting) aborting = Promise.resolve().then(() => child!.session.abort()).catch(() => undefined);
      };
      signal.addEventListener("abort", abort, { once: true });
      flush();
      try {
        child = await this.createChild(signal, randomUUID());
        if (signal.aborted) { abort(); throw new Error("子代理任务已取消"); }
        transcript.model(child.session.model);
        unsubscribe = child.session.subscribe((event) => { transcript.event(event); complete.event(event); summaries[index] = transcript.finalText; update(); });
        await child.session.prompt(task, { expandPromptTemplates: false });
        transcript.replace(child.session.messages);
        complete.replace(child.session.messages);
        summaries[index] = transcript.finalText;
        if (signal.aborted || result.stopReason === "aborted") { result.status = "cancelled"; result.stopReason = "aborted"; result.errorMessage ||= "子代理任务已取消"; }
        else if (result.stopReason === "error" || result.stopReason === "pending" || result.stopReason === "deferred") { result.status = "failed"; result.errorMessage ||= "子代理模型响应失败"; }
        else { result.status = "completed"; result.exitCode = 0; }
      } catch (error) {
        result.status = signal.aborted ? "cancelled" : "failed";
        result.stopReason = signal.aborted ? "aborted" : "error";
        result.errorMessage = this.projection.redact(signal.aborted ? "子代理任务已取消" : error instanceof Error ? error.message : "无法执行子代理任务").slice(0, 4096);
        fullResults[index]!.errorMessage = this.projection.redact(signal.aborted ? "子代理任务已取消" : error instanceof Error ? error.message : "无法执行子代理任务");
      } finally {
        signal.removeEventListener("abort", abort);
        await aborting;
        if (child) complete.replace(child.session.messages);
        try { unsubscribe?.(); } catch { result.status = "failed"; result.errorMessage = "无法解除子代理事件订阅"; }
        try { child?.dispose(); } catch { result.status = "failed"; result.errorMessage = "无法释放子代理会话"; }
        if (result.status !== "completed") result.exitCode = 1;
        flush();
      }
    };
    try {
      if (mode === "parallel") await Promise.all(tasks.map((task, index) => runOne(index, task.task)));
      else for (let index = 0; index < tasks.length; index++) {
        const result = results[index]!;
        if (index && results[index - 1]!.status !== "completed") { result.status = "cancelled"; result.stopReason = "aborted"; result.exitCode = 1; result.errorMessage = "前序任务未完成，已跳过"; continue; }
        const task = mode === "chain" ? tasks[index]!.task.replaceAll("{previous}", index ? summaries[index - 1]! : "") : tasks[index]!.task;
        if (task.length > 4096) { result.status = "failed"; result.exitCode = 1; result.stopReason = "error"; result.errorMessage = "任务链展开后超过 4096 字符上限"; continue; }
        await runOne(index, task);
      }
      saveSnapshots();
      for (let index = 0; index < results.length; index++) {
        try { this.transcripts.persist(`${toolCallId}:${index}`); }
        catch (error) {
          results[index]!.status = "failed"; results[index]!.exitCode = 1;
          results[index]!.errorMessage = error instanceof Error ? error.message : "完整子代理记录保存失败";
        }
      }
      flush();
      return snapshot();
    } finally { if (timer) clearTimeout(timer); }
  }
}

/** Whitelist transcript fields before storing them in parent-session tool details. */
class Transcript {
  finalText = "";
  private streamingIndex = -1;
  private receivedMessages = false;
  constructor(private readonly result: Result, private readonly project: Projection, private readonly full = false) {}

  private text(value: unknown, cap = 8192): string {
    if (typeof value !== "string") return "";
    const text = this.project.redact(value);
    if (this.full) return text;
    if (text.length > cap) this.result.truncated = true;
    return text.slice(0, cap);
  }

  model(value: unknown): void {
    if (record(value) && typeof value.id === "string") this.result.model = this.text(`${typeof value.provider === "string" ? `${value.provider}/` : ""}${value.id}`, 256);
  }

  private display(value: unknown, output: boolean): ToolDisplayPayload | undefined {
    if (this.full) return output ? this.project.fullOutput?.(value) ?? this.project.output(value) : this.project.fullInput?.(value) ?? this.project.input(value);
    const blocks = Array.isArray(value) ? value : record(value) && Array.isArray(value.content) ? value.content : [];
    const omittedImage = blocks.some((block) => record(block) && (block.type === "image" || block.type === "image_url"));
    const payload = output ? this.project.output(value) : this.project.input(value);
    if (!payload) return undefined;
    const safe = this.project.redact(payload.text);
    const clipped = safe.length > 4096;
    return { text: safe.slice(0, 4096), format: clipped ? "text" : payload.format, truncated: payload.truncated || clipped || omittedImage };
  }

  private message(raw: unknown): Message | undefined {
    if (!record(raw) || !["user", "assistant", "toolResult", "system"].includes(String(raw.role))) return undefined;
    if (raw.role === "toolResult") return { role: "toolResult", toolCallId: this.text(raw.toolCallId, 256), toolName: this.text(raw.toolName, 128), content: [], toolOutput: this.display(raw.content, true), isError: raw.isError === true };
    const blocks = typeof raw.content === "string" ? [{ type: "text", text: raw.content }] : Array.isArray(raw.content) ? raw.content : [];
    if (blocks.length > 100) this.result.truncated = true;
    const content: Array<Record<string, unknown>> = [];
    for (const block of this.full ? blocks : blocks.slice(0, 100)) {
      if (!record(block)) continue;
      if (block.type === "text") content.push({ type: "text", text: this.text(block.text) });
      else if (block.type === "thinking") content.push({ type: "thinking", thinking: this.text(block.thinking ?? block.text) });
      else if (block.type === "toolCall") content.push({ type: "toolCall", id: this.text(block.id, 256), name: this.text(block.name, 128), toolInput: this.display(block.arguments, false) });
      else if (this.full && (block.type === "image" || block.type === "image_url")) content.push({ type: "text", text: "[image omitted]" });
      else this.result.truncated = true;
    }
    return { role: String(raw.role), content, ...(this.full && typeof raw.timestamp === "number" ? { sourceId: `${raw.role}:${raw.timestamp}` } : {}) };
  }

  private metadata(raw: unknown, ended: boolean): void {
    if (!record(raw) || raw.role !== "assistant") return;
    if (typeof raw.model === "string") this.result.model = this.text(`${typeof raw.provider === "string" ? `${raw.provider}/` : ""}${raw.model}`, 256);
    if (ended) {
      this.result.usage.turns++;
      if (typeof raw.stopReason === "string") this.result.stopReason = this.text(raw.stopReason, 64);
      if (typeof raw.errorMessage === "string") this.result.errorMessage = this.text(raw.errorMessage, 4096);
    }
    const content = Array.isArray(raw.content) ? raw.content : [];
    this.finalText = this.text(typeof raw.content === "string" ? raw.content : content.filter((block) => record(block) && block.type === "text").map((block) => String(block.text ?? "")).join(""));
  }

  private fit(): void {
    if (this.full) return;
    // Reserve ample space for task/model/error metadata across four results.
    while (this.result.messages.length > 100 || this.result.messages.reduce((total, message) => total + Math.max(1, message.content.length), 0) > 100 || Buffer.byteLength(JSON.stringify(this.result.messages), "utf8") > 36_000) {
      this.result.truncated = true;
      const index = trimTranscript(this.result.messages);
      if (index >= 0 && this.streamingIndex >= index) this.streamingIndex--;
    }
  }

  replace(messages: unknown[]): void {
    if (!messages.length) return;
    // Reconcile authoritative final messages without dropping pre-compaction events.
    if (this.full && this.receivedMessages) {
      const incoming = messages.map((raw) => { this.metadata(raw, false); return this.message(raw); }).filter((item): item is Message => item !== undefined);
      const same = (left: Message, right: Message) => {
        if (left.role !== right.role) return false;
        if (left.sourceId && right.sourceId) return left.sourceId === right.sourceId;
        if (left.toolCallId && right.toolCallId) return left.toolCallId === right.toolCallId;
        const calls = (message: Message) => message.content.filter((block) => block.type === "toolCall").map((block) => block.id).join("\0");
        const leftCalls = calls(left);
        return leftCalls ? leftCalls === calls(right) : JSON.stringify(left) === JSON.stringify(right);
      };
      let cursor = 0;
      for (let index = 0; index < incoming.length; index++) {
        const message = incoming[index]!;
        let match = this.result.messages.findIndex((prior, position) => position >= cursor && same(prior, message));
        if (match < 0 && this.streamingIndex >= cursor && this.result.messages[this.streamingIndex]?.role === message.role) match = this.streamingIndex;
        if (match >= 0) { this.result.messages[match] = message; cursor = match + 1; continue; }
        const next = this.result.messages.findIndex((prior, position) => position >= cursor && incoming.slice(index + 1).some((later) => same(prior, later)));
        const position = next < 0 ? this.result.messages.length : next;
        this.result.messages.splice(position, 0, message); cursor = position + 1;
      }
      this.streamingIndex = -1;
      return;
    }
    this.result.messages = []; this.result.usage.turns = 0; this.streamingIndex = -1;
    for (const raw of messages) { const message = this.message(raw); if (message) { this.metadata(raw, true); this.result.messages.push(message); this.fit(); } }
  }

  event(event: unknown): void {
    if (!record(event)) return;
    if (["message_start", "message_update", "message_end"].includes(String(event.type))) {
      const raw = event.message ?? (record(event.assistantMessageEvent) ? event.assistantMessageEvent.partial : undefined);
      const message = this.message(raw);
      if (!message) return;
      this.receivedMessages = true;
      this.metadata(raw, event.type === "message_end");
      if (event.type === "message_start") {
        const seededTask = this.full && message.role === "user" && this.result.messages.length === 1 && this.result.messages[0]?.role === "user" && JSON.stringify(message.content) === JSON.stringify(this.result.messages[0].content);
        if (seededTask) this.result.messages[0] = message; else this.result.messages.push(message);
        this.streamingIndex = this.result.messages.length - 1;
      }
      else if (this.streamingIndex >= 0) this.result.messages[this.streamingIndex] = message;
      else this.result.messages.push(message);
      if (event.type === "message_end") this.streamingIndex = -1;
      this.fit();
    } else if (typeof event.type === "string" && event.type.startsWith("tool_execution_")) {
      const id = this.text(event.toolCallId, 256); const name = this.text(event.toolName, 128);
      if (!id || !name) return;
      if (event.type === "tool_execution_start") {
        if (!this.result.messages.some((message) => message.content.some((block) => block.type === "toolCall" && block.id === id))) this.result.messages.push({ role: "assistant", content: [{ type: "toolCall", id, name, toolInput: this.display(event.args, false) }] });
      } else {
        const raw = event.partialResult ?? event.result;
        const message: Message = { role: "toolResult", toolCallId: id, toolName: name, content: [], toolOutput: this.display(record(raw) ? raw.content : raw, true), isError: event.isError === true };
        const existing = this.result.messages.findIndex((item) => item.role === "toolResult" && item.toolCallId === id);
        if (existing >= 0) this.result.messages[existing] = message; else this.result.messages.push(message);
      }
      this.fit();
    }
  }
}

/** Already sanitized SDK messages, projected without length or entry ceilings. */
function fullMessages(source: Message[]): SubagentMessage[] {
  const messages: SubagentMessage[] = [];
  const tools = new Map<string, SubagentMessage>();
  for (const message of source) {
    if (message.role === "toolResult") {
      const item = message.toolCallId ? tools.get(message.toolCallId) : undefined;
      if (item) { item.toolOutput = message.toolOutput; item.isError = message.isError; }
      else messages.push({ role: "tool", content: "", toolCallId: message.toolCallId, toolName: message.toolName, toolOutput: message.toolOutput, isError: message.isError });
      continue;
    }
    for (const block of message.content) {
      if (block.type === "toolCall") {
        const item: SubagentMessage = { role: "tool", content: "", toolCallId: String(block.id), toolName: String(block.name), toolInput: block.toolInput as ToolDisplayPayload | undefined };
        messages.push(item); tools.set(item.toolCallId!, item);
      } else if (block.type === "text" || block.type === "thinking") messages.push({ role: block.type === "thinking" ? "thinking" : message.role as SubagentMessage["role"], content: String(block.type === "thinking" ? block.thinking : block.text) });
    }
  }
  return messages;
}

/** Evict older activity first; a large final response must remain visible. */
function trimTranscript(messages: Message[]): number {
  const firstActivity = messages[0]?.role === "user" ? 1 : 0;
  if (messages.length > firstActivity + 1) { messages.splice(firstActivity, 1); return firstActivity; }
  const latest = messages.at(-1)!;
  if (latest.content.length > 1) { latest.content.shift(); return -1; }
  const block = latest.content[0];
  const payload = latest.toolOutput ?? (record(block?.toolInput) ? block.toolInput : undefined);
  if (payload && typeof payload.text === "string" && payload.text.length > 1) {
    payload.text = payload.text.slice(0, Math.floor(payload.text.length / 2)); payload.format = "text"; payload.truncated = true; return -1;
  }
  const key = block?.type === "thinking" ? "thinking" : "text";
  if (block && typeof block[key] === "string" && block[key].length > 1) { block[key] = block[key].slice(0, Math.floor(block[key].length / 2)); return -1; }
  messages.shift(); return 0;
}
