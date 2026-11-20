import type { UIMessageChunk } from 'ai';
import { interruptedOutput } from './salvage.js';
import { publish } from './stream.js';
import type { SearchRun } from './types.js';

interface OpenCall {
  name: string;
  available: boolean;
  dynamic?: boolean;
  /** Preliminary outputs of a streaming tool, oldest first. */
  progress: unknown[];
}

const REASON = 'Search interrupted. This call has no delivered result; inspect the saved run outcomes before retrying.';

/** Close incomplete protocol exchanges without claiming their external outcome is known. */
export async function settleInterruptedEvents(run: SearchRun): Promise<void> {
  const calls = new Map<string, OpenCall>();
  const texts = new Map<string, 'text' | 'reasoning'>();
  for (const event of run.events) track(event, calls, texts);

  for (const [toolCallId, call] of calls) await publish(run, closing(toolCallId, call));
  for (const [id, type] of texts) await publish(run, { type: `${type}-end`, id });
}

/**
 * A streaming tool with an interrupted-output hook keeps its partial work as
 * the result (subagent runs keep finished reports). Every other call gets an error.
 */
function closing(toolCallId: string, call: OpenCall): UIMessageChunk {
  if (!call.available) {
    return { type: 'tool-input-error', toolCallId, toolName: call.name, input: null, errorText: REASON, dynamic: true };
  }

  const salvaged = interruptedOutput(call.name, call.progress);
  if (salvaged !== undefined) return { type: 'tool-output-available', toolCallId, output: salvaged, dynamic: call.dynamic };

  return { type: 'tool-output-error', toolCallId, errorText: REASON, dynamic: call.dynamic };
}

function track(event: UIMessageChunk, calls: Map<string, OpenCall>, texts: Map<string, 'text' | 'reasoning'>): void {
  if (event.type === 'tool-input-start' || event.type === 'tool-input-available') {
    const progress = calls.get(event.toolCallId)?.progress ?? [];
    calls.set(event.toolCallId, { name: event.toolName, available: event.type === 'tool-input-available', dynamic: event.dynamic, progress });
  }

  // A preliminary output is progress from a streaming tool, not its result.
  if (event.type === 'tool-output-available') {
    const call = calls.get(event.toolCallId);
    if (event.preliminary && call) call.progress.push(event.output);
    else calls.delete(event.toolCallId);
  } else if (event.type === 'tool-input-error' || event.type === 'tool-output-error' || event.type === 'tool-output-denied') {
    calls.delete(event.toolCallId);
  }

  if (event.type === 'text-start') texts.set(event.id, 'text');
  if (event.type === 'reasoning-start') texts.set(event.id, 'reasoning');
  if (event.type === 'text-end' || event.type === 'reasoning-end') texts.delete(event.id);
}
