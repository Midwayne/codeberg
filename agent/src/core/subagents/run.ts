import type { ModelMessage, ToolLoopAgent, ToolSet } from 'ai';

import type { ContextStore } from '../context/store.js';
import { errorMessage } from '../errors.js';
import { roleLoop, type SubagentWorker } from './loop.js';
import { progressScope, type ProgressSink } from './progress.js';
import type { SubagentType } from './roles.js';
import type { Semaphore } from '../semaphore.js';
import type { SubagentSession } from './store.js';

/** Longest report returned inline; the full text stays in the transcript. */
const MAX_REPORT_CHARS = 8_000;

export interface SubagentReport {
  agent_id: string;
  description: string;
  agent_type: SubagentType;
  /** `queued`/`running` only appear in live progress; `incomplete` means a configured step budget ran out. */
  status: 'queued' | 'running' | 'completed' | 'incomplete' | 'failed';
  report?: string;
  /** Live progress only: `report` is a preview; the full text was sent in an earlier snapshot. */
  report_truncated?: boolean;
  error?: string;
  tool_calls: number;
  steps?: number;
  /** Live progress only: the latest tool call, e.g. `grep · timeout`. */
  activity?: string;
  /** Live progress only: when the subagent left the queue (epoch ms), so the chat can tick its own clock. */
  started_at?: number;
  elapsed_ms?: number;
  usage?: { input_tokens: number; output_tokens: number };
  /** Full transcript in the context store, readable with context tools. */
  transcript?: string;
}

/** Live hooks for one subagent turn: when it leaves the queue, and what it does. */
export interface SessionProgress extends ProgressSink {
  start: (startedAt: number) => void;
}

/** Everything a subagent turn needs, shared by every call from one agent. */
export interface SubagentRuntime {
  worker: SubagentWorker;
  tools: ToolSet;
  context: ContextStore;
  gate: Semaphore;
  loops: Map<SubagentType, ToolLoopAgent>;
}

/** Send `input` to the session and run it to a report; a failure becomes a failed report. */
export async function sendToSession(
  runtime: SubagentRuntime,
  session: SubagentSession,
  input: string,
  abortSignal?: AbortSignal,
  progress?: SessionProgress,
): Promise<SubagentReport> {
  if (session.busy) throw new Error(`Subagent ${session.id} is still running.`);

  const base = { agent_id: session.id, description: session.description, agent_type: session.type };
  const history = session.messages.length;
  session.busy = true;
  session.messages.push({ role: 'user', content: input });

  try {
    const { result, elapsed_ms } = await runtime.gate.run(async () => {
      const started = Date.now();
      progress?.start(started);
      const loop = roleLoop(runtime.loops, runtime.worker, session.type, runtime.tools);
      const result = await progressScope.run(progress ?? silent, () => runStreamed(loop, session.messages, abortSignal));

      return { result, elapsed_ms: Date.now() - started };
    });

    // Disk I/O happens after the slot is free, so queued subagents are not kept waiting.
    // A failed write only loses the transcript file, never the finished report.
    session.messages.push(...result.responseMessages);
    const transcript = await saveTranscript(runtime.context, session).catch(() => undefined);

    return { ...base, ...outcome(result, transcript, runtime.worker.maxSteps), elapsed_ms, ...(transcript ? { transcript } : {}) };
  } catch (error) {
    session.messages.length = history;
    if (abortSignal?.aborted) throw error;

    return { ...base, status: 'failed', error: errorMessage(error), tool_calls: 0 };
  } finally {
    session.busy = false;
  }
}

const silent: ProgressSink = { step: () => undefined, tool: () => undefined };

type LoopResult = Pick<Awaited<ReturnType<ToolLoopAgent['generate']>>, 'steps' | 'text' | 'totalUsage' | 'responseMessages'>;

/**
 * Run one subagent message as a stream and collect what `generate` would
 * return. Streaming lets only a silent provider end a step; a non-streamed
 * request can only be bounded as a whole, which would cut off long reasoning.
 */
async function runStreamed(loop: ToolLoopAgent, messages: ModelMessage[], abortSignal?: AbortSignal): Promise<LoopResult> {
  let failure: unknown;
  const stream = await loop.stream({ messages, ...(abortSignal ? { abortSignal } : {}) });

  // Error parts carry the provider's own error; awaiting the results would only say no output was generated.
  for await (const part of stream.fullStream) {
    if (part.type === 'error') failure ??= part.error;
  }
  if (failure !== undefined) throw failure;

  const [steps, text, totalUsage, responseMessages] = await Promise.all([
    stream.steps, stream.text, stream.totalUsage, stream.responseMessages,
  ]);

  return { steps, text, totalUsage, responseMessages };
}

function outcome(result: LoopResult, transcript: string | undefined, maxSteps: number | undefined) {
  const tool_calls = result.steps.reduce((total, step) => total + step.toolCalls.length, 0);
  const { inputTokens, outputTokens } = result.totalUsage;

  return {
    status: maxSteps !== undefined && result.steps.length >= maxSteps ? 'incomplete' as const : 'completed' as const,
    report: bounded(result.text.trim(), transcript),
    tool_calls,
    steps: result.steps.length,
    usage: { input_tokens: inputTokens ?? 0, output_tokens: outputTokens ?? 0 },
  };
}

function bounded(report: string, transcript: string | undefined): string {
  if (report.length <= MAX_REPORT_CHARS) return report;

  const rest = transcript ? `the full text is in ${transcript}` : 'the transcript could not be saved';

  return `${report.slice(0, MAX_REPORT_CHARS)}\n… (report truncated; ${rest})`;
}

function saveTranscript(context: ContextStore, session: SubagentSession): Promise<string> {
  const { id, type, description, messages } = session;

  return context.writeRel(`subagents/${id}.json`, JSON.stringify({ id, type, description, messages }));
}
