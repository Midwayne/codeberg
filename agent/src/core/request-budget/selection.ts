import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { callerScope } from '../background/context.js';
import { chatScope } from '../chat-scope.js';
import { evictOldest, touch } from '../lru.js';
import { writeAtomic } from '../fs.js';
import { isValidSessionId } from '../session-id.js';
import type { ContextSnapshot } from './snapshot.js';

/**
 * What one agent chose to keep or drop from its context. The main agent and
 * each subagent have their own: their prompts and tool call ids differ.
 */
export interface ContextSelection {
  keep: Set<string>;
  release: Set<string>;
  /** The last request this agent sent, for context_status. Not saved. */
  snapshot?: ContextSnapshot;
  /** The highest usage notice in the latest request; a notice is sent when it rises. Not saved. */
  level: number;
  /** Save keep/release; a no-op for terminal runs. */
  save(): Promise<void>;
}

interface ChatSelections {
  file?: string;
  agents: Map<string, ContextSelection>;
  writes: Promise<unknown>;
}

const MAX_CHATS = 64;
const chats = new Map<string, Promise<ChatSelections>>();

/** Where a chat's keep/release choices are saved, beside its run journals. */
export function contextKeepsPath(sessionsDir: string, chatId: string): string {
  return join(sessionsDir, '.context-keeps', `${chatId}.json`);
}

/** A fresh, unsaved selection (tests and helpers outside any chat). */
export function emptySelection(): ContextSelection {
  return { keep: new Set(), release: new Set(), level: 0, save: async () => undefined };
}

/** The selection of the agent making this call, in the chat it runs in. */
export async function currentSelection(): Promise<ContextSelection> {
  const chatDir = chatScope.getStore() ?? '';
  const agent = callerScope.getStore() ?? '';

  const loading = touch(chats, chatDir, chats.get(chatDir) ?? loadChat(chatDir));
  evictOldest(chats, MAX_CHATS, (_, key) => key !== chatDir);

  const chat = await loading;
  let selection = chat.agents.get(agent);
  if (!selection) {
    selection = { ...emptySelection(), save: () => saveChat(chat) };
    chat.agents.set(agent, selection);
  }

  return selection;
}

async function loadChat(chatDir: string): Promise<ChatSelections> {
  const id = basename(chatDir);
  const file = chatDir && isValidSessionId(id) ? contextKeepsPath(dirname(chatDir), id) : undefined;
  const chat: ChatSelections = { file, agents: new Map(), writes: Promise.resolve() };

  const saved = file ? await readSaved(file) : {};
  for (const [agent, choice] of Object.entries(saved)) {
    chat.agents.set(agent, {
      keep: new Set(stringList(choice?.keep)),
      release: new Set(stringList(choice?.release)),
      level: 0,
      save: () => saveChat(chat),
    });
  }

  return chat;
}

type Saved = Record<string, { keep?: unknown; release?: unknown } | undefined>;

/** A missing or unreadable file starts empty: clearing then falls back to its automatic rules. */
async function readSaved(file: string): Promise<Saved> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as { version?: number; agents?: Saved };

    return value?.version === 1 && value.agents && typeof value.agents === 'object' ? value.agents : {};
  } catch {
    return {};
  }
}

function saveChat(chat: ChatSelections): Promise<void> {
  if (!chat.file) return Promise.resolve();

  const file = chat.file;
  const next = chat.writes.catch(() => undefined).then(() => {
    const agents = Object.fromEntries([...chat.agents].map(([agent, selection]) =>
      [agent, { keep: [...selection.keep], release: [...selection.release] }]));

    return writeAtomic(file, JSON.stringify({ version: 1, agents }), { dirMode: 0o700 });
  });

  chat.writes = next;

  return next;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
