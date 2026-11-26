import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { chatScope } from '../chat-scope.js';
import { isMissing, writeAtomic } from '../fs.js';
import { isValidSessionId } from '../session-id.js';
import { emptyWorklist, WorklistError, type WorklistData } from './types.js';

/** Terminal runs have no saved chat; their list lives as long as the process. */
const TERMINAL_KEY = '';
const memory = new Map<string, WorklistData>();

/** One update at a time per list, so parallel tool calls never lose an entry. */
const queues = new Map<string, Promise<unknown>>();

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
  await queues.get(path ?? TERMINAL_KEY);

  return load(path);
}

/** Apply `change` to the saved list and save the result; returns what `change` returns. */
export async function updateWorklist<T>(path: string | undefined, change: (data: WorklistData) => T): Promise<T> {
  const key = path ?? TERMINAL_KEY;
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
  if (path === undefined) return structuredClone(memory.get(TERMINAL_KEY) ?? emptyWorklist());

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
    memory.set(TERMINAL_KEY, structuredClone(data));

    return;
  }

  // Lists can quote private source, so new directories are private too.
  await writeAtomic(path, JSON.stringify(data), { dirMode: 0o700 });
}
