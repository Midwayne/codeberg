import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';

import { chatScope } from '../chat-scope.js';
import type { ContextStore } from '../context/store.js';
import { SUBAGENT_TYPES, type SubagentType } from './roles.js';
import type { SubagentSession } from './store.js';

/** The shape `SubagentStore.create` gives ids; anything else never names a transcript file. */
const AGENT_ID = /^sa_[0-9a-f]{16}$/;

/** Background job ids, which the main agent sometimes passes as an agent_id after waking. */
const JOB_ID = /^[0-9a-f]{32}$/;

interface SavedTranscript {
  id: string;
  chat: string;
  type: SubagentType;
  description: string;
  messages: ModelMessage[];
}

/** Write the session's history, tagged with its chat, so it can be read and continued later. */
export function saveTranscript(context: ContextStore, session: SubagentSession): Promise<string> {
  const { id, type, description, messages } = session;
  const saved: SavedTranscript = { id, chat: currentChat(), type, description, messages };

  return context.writeRel(transcriptPath(id), JSON.stringify(saved));
}

/**
 * A session no longer in memory (after a restart, a model switch, or
 * eviction), rebuilt from its saved transcript. Only the chat that started it
 * can restore it, as with in-memory sessions.
 */
export async function restoreSession(context: ContextStore, id: string): Promise<SubagentSession | undefined> {
  if (!AGENT_ID.test(id)) return undefined;

  let saved: unknown;

  try {
    saved = JSON.parse(await readFile(join(context.root, transcriptPath(id)), 'utf8'));
  } catch {
    return undefined;
  }

  if (!isTranscript(saved) || saved.id !== id || saved.chat !== currentChat()) return undefined;

  return { id, type: saved.type, description: saved.description, messages: saved.messages, busy: false };
}

/** Why `id` named no subagent, phrased so the main agent can recover without the user's help. */
export function unknownSubagent(id: string): Error {
  if (JOB_ID.test(id)) {
    return new Error(`${id} is a background job ID, not an agent_id. Agent IDs start with "sa_" and appear in each ` +
      'report; read them with background_tool_status.');
  }

  return new Error(`Unknown subagent ${id} in this chat. Use an agent_id from a report in this chat, ` +
    'or start a new subagent with run_subagents.');
}

function transcriptPath(id: string): string {
  return join('subagents', `${id}.json`);
}

function currentChat(): string {
  return chatScope.getStore() ?? '';
}

function isTranscript(value: unknown): value is SavedTranscript {
  if (!value || typeof value !== 'object') return false;

  const saved = value as Partial<SavedTranscript>;

  return typeof saved.id === 'string'
    && typeof saved.chat === 'string'
    && typeof saved.description === 'string'
    && SUBAGENT_TYPES.includes(saved.type as SubagentType)
    && Array.isArray(saved.messages);
}
