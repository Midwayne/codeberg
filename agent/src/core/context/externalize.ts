import type { ModelMessage, ToolResultPart } from 'ai';

import { toolResultOutputText } from '../message.js';
import { SPILL_CHARS, spillText } from './spill.js';
import type { ContextStore } from './store.js';

/**
 * Replace oversized tool results already in a transcript (a resumed chat, or
 * the tail kept verbatim after compaction) with a file preview. Returns the
 * same array when nothing is large enough to move. Tool results are spilled
 * whether they sit on a tool message or inside an assistant message.
 */
export async function externalizeToolResults(
  messages: ModelMessage[],
  store: ContextStore,
  limit = SPILL_CHARS,
): Promise<ModelMessage[]> {
  let changed = false;
  const next: ModelMessage[] = [];
  for (const message of messages) {
    const rewritten = await externalizeMessage(message, store, limit);
    if (rewritten !== message) changed = true;
    next.push(rewritten);
  }
  return changed ? next : messages;
}

async function externalizeMessage(
  message: ModelMessage,
  store: ContextStore,
  limit: number,
): Promise<ModelMessage> {
  switch (message.role) {
    case 'system':
    case 'user':
      return message;
    case 'assistant': {
      if (typeof message.content === 'string') return message;
      const { content, changed } = await spillToolResultParts(message.content, store, limit);
      return changed ? { ...message, content } : message;
    }
    case 'tool': {
      const { content, changed } = await spillToolResultParts(message.content, store, limit);
      return changed ? { ...message, content } : message;
    }
    default: {
      const _never: never = message;
      return _never;
    }
  }
}

function isToolResultPart(part: { type: string }): part is ToolResultPart {
  return part.type === 'tool-result';
}

async function spillToolResultParts<P extends { type: string }>(
  parts: readonly P[],
  store: ContextStore,
  limit: number,
): Promise<{ content: P[]; changed: boolean }> {
  let changed = false;
  const content: P[] = [];
  for (const part of parts) {
    if (!isToolResultPart(part)) {
      content.push(part);
      continue;
    }
    const spilled = await spillResult(part, store, limit);
    if (spilled !== part) changed = true;
    content.push(spilled as unknown as P);
  }
  return { content, changed };
}

async function spillResult(
  part: ToolResultPart,
  store: ContextStore,
  limit: number,
): Promise<ToolResultPart> {
  const preview = await spillText(store, part.toolName, toolResultOutputText(part.output), limit);
  if (preview === undefined) return part;
  return { ...part, output: { type: 'text', value: preview } };
}
