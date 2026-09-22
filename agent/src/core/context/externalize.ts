import type { ModelMessage } from 'ai';

import { toolResultOutputText } from '../message.js';
import { isSpillPreview, SPILL_CHARS, spillPreview } from './spill.js';
import type { ContextStore } from './store.js';

/**
 * Replace oversized tool results already in a transcript (a resumed chat, or
 * the tail kept verbatim after compaction) with a file preview. Returns the
 * same array when nothing is large enough to move.
 */
export async function externalizeToolResults(
  messages: ModelMessage[],
  store: ContextStore,
  limit = SPILL_CHARS,
): Promise<ModelMessage[]> {
  let changed = false;
  const next: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'tool') {
      next.push(message);
      continue;
    }
    const rewritten = await externalizeToolMessage(message, store, limit);
    if (rewritten !== message) changed = true;
    next.push(rewritten);
  }
  return changed ? next : messages;
}

async function externalizeToolMessage(
  message: ModelMessage & { role: 'tool' },
  store: ContextStore,
  limit: number,
): Promise<ModelMessage> {
  let changed = false;
  const content: typeof message.content = [];
  for (const part of message.content) {
    if (part.type !== 'tool-result') {
      content.push(part);
      continue;
    }
    const body = toolResultOutputText(part.output);
    if (body.length <= limit || isSpillPreview(body)) {
      content.push(part);
      continue;
    }
    const file = await store.writeToolOutput(part.toolName, body);
    content.push({
      ...part,
      output: { type: 'text', value: spillPreview(file, body) },
    });
    changed = true;
  }
  return changed ? { ...message, content } : message;
}
