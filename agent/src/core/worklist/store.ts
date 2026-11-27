import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { chatScope, writeChatSideFile } from '../chat-scope.js';
import { isMissing } from '../fs.js';
import { isValidSessionId } from '../session-id.js';
import { emptyWorklist, WorklistError, type WorklistData } from './types.js';

/** A list kept in memory: a terminal conversation's, which has no saved chat. */
export interface MemoryWorklist {
  data?: WorklistData;
}

/*
 * Each terminal conversation keeps its own list across its turns, and it goes
 * with the conversation. Calls outside any conversation share one fallback.
 */
const conversation = new AsyncLocalStorage<MemoryWorklist>();
const fallback: MemoryWorklist = {};

/** Run `action` with `list` as the working list of calls that have no chat. */
export function withWorklistScope<T>(list: MemoryWorklist, action: () => T): T {
  return conversation.run(list, action);
}

function memoryList(): MemoryWorklist {
  return conversation.getStore() ?? fallback;
}

/** One update at a time per list, so parallel tool calls never lose an entry. */
const queues = new Map<string | MemoryWorklist, Promise<unknown>>();

/**
 * Where a chat's working list is saved: beside its run journals, at
 * `<web-sessions>/.worklists/<chat id>.json`. Chats are keyed by their
 * `chatScope` directory (`<web-sessions>/<chat id>`); terminal runs have none.
 */
export function worklistPath(chatDir: string | undefined): string | undefined {
  if (!chatDir) return undefined;

  const id = basename(chatDir);
  if (!isValidSessionId(id)) throw new WorklistError('This chat has no valid id for a working list.');

  return join(dirname(chatDir), '.worklists', `${id}.json`);
}

/** The working list of the chat this tool call runs in. */
export function currentWorklistPath(): string | undefined {
  return worklistPath(chatScope.getStore());
}

export async function readWorklist(path: string | undefined): Promise<WorklistData> {
  // Wait for pending writes, but not for their errors: those belong to the call that made them.
  await queues.get(path ?? memoryList())?.catch(() => undefined);

  return load(path);
}

/** Apply `change` to the saved list and save the result; returns what `change` returns. */
export async function updateWorklist<T>(path: string | undefined, change: (data: WorklistData) => T): Promise<T> {
  const key = path ?? memoryList();
  const previous = queues.get(key) ?? Promise.resolve();

  const next = previous.catch(() => undefined).then(async () => {
    const data = await load(path);
    const result = change(data);

    await save(path, data);

    return result;
  });

  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }).catch(() => undefined);

  return next;
}

async function load(path: string | undefined): Promise<WorklistData> {
  if (path === undefined) return structuredClone(memoryList().data ?? emptyWorklist());

  try {
    return parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissing(error)) return emptyWorklist();
    if (error instanceof WorklistError) throw error;

    throw new WorklistError(`Cannot read the working list: ${(error as NodeJS.ErrnoException).code ?? 'unreadable file'}`);
  }
}

function parse(raw: string): WorklistData {
  let value: Partial<WorklistData>;
  try {
    value = JSON.parse(raw) as Partial<WorklistData>;
  } catch {
    throw new WorklistError('Cannot read the working list: invalid JSON.');
  }

  if (value?.version !== 1 || !Array.isArray(value.entries) || typeof value.next !== 'number') {
    throw new WorklistError('Cannot read the working list: unknown format.');
  }

  return value as WorklistData;
}

async function save(path: string | undefined, data: WorklistData): Promise<void> {
  if (path === undefined) {
    memoryList().data = structuredClone(data);

    return;
  }

  if (!await writeChatSideFile(path, JSON.stringify(data))) {
    throw new WorklistError('This chat was deleted; its working list is gone.');
  }
}
