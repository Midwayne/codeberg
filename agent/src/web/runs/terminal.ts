import type { UIMessageChunk } from 'ai';
import { publish } from './stream.js';
import type { SearchRun } from './types.js';

/** Close incomplete protocol exchanges without claiming their external outcome is known. */
export async function settleInterruptedEvents(run: SearchRun): Promise<void> {
  const calls = new Map<string, { name: string; available: boolean; dynamic?: boolean }>();
  const texts = new Map<string, 'text' | 'reasoning'>();
  for (const event of run.events) track(event, calls, texts);

  const reason = 'Search interrupted. This call has no delivered result; inspect the saved run outcomes before retrying.';
  for (const [toolCallId, call] of calls) {
    await publish(run, call.available
      ? { type: 'tool-output-error', toolCallId, errorText: reason, dynamic: call.dynamic }
      : { type: 'tool-input-error', toolCallId, toolName: call.name, input: null, errorText: reason, dynamic: true });
  }
  for (const [id, type] of texts) await publish(run, { type: `${type}-end`, id });
}

function track(event: UIMessageChunk, calls: Map<string, { name: string; available: boolean; dynamic?: boolean }>,
  texts: Map<string, 'text' | 'reasoning'>): void {
  if (event.type === 'tool-input-start' || event.type === 'tool-input-available') {
    calls.set(event.toolCallId, { name: event.toolName, available: event.type === 'tool-input-available', dynamic: event.dynamic });
  }
  if (event.type === 'tool-input-error' || event.type === 'tool-output-available'
    || event.type === 'tool-output-error' || event.type === 'tool-output-denied') calls.delete(event.toolCallId);

  if (event.type === 'text-start') texts.set(event.id, 'text');
  if (event.type === 'reasoning-start') texts.set(event.id, 'reasoning');
  if (event.type === 'text-end' || event.type === 'reasoning-end') texts.delete(event.id);
}
