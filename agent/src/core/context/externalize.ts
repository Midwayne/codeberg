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
    case 'assistant':
      return externalizeAssistant(message, store, limit);
    case 'tool':
      return externalizeTool(message, store, limit);
    default: {
      const _never: never = message;
      return _never;
    }
  }
}

async function externalizeAssistant(
  message: Extract<ModelMessage, { role: 'assistant' }>,
  store: ContextStore,
  limit: number,
): Promise<ModelMessage> {
  if (typeof message.content === 'string') return message;
  let changed = false;
  const content: typeof message.content = [];
  for (const part of message.content) {
    if (part.type !== 'tool-result') {
      content.push(part);
      continue;
    }
    const spilled = await spillResult(part, store, limit);
    if (spilled !== part) changed = true;
    content.push(spilled);
  }
  return changed ? { ...message, content } : message;
}

async function externalizeTool(
  message: Extract<ModelMessage, { role: 'tool' }>,
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
    const spilled = await spillResult(part, store, limit);
    if (spilled !== part) changed = true;
    content.push(spilled);
  }
  return changed ? { ...message, content } : message;
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
