import { join } from 'node:path';
import { writeJsonAtomic } from '../../core/learning/fs.js';
import { load } from './reading.js';
import type { WebSessionRecord } from './records.js';
import type { WebSessionStoreState } from './state.js';

export async function save(state: WebSessionStoreState, record: WebSessionRecord): Promise<void> {
  await serial(state, record.id, () => write(state, record));
}

export async function upsert(
  state: WebSessionStoreState,
  input: Pick<WebSessionRecord, 'id' | 'title' | 'messages'> & { parentId?: string },
): Promise<WebSessionRecord> {
  return serial(state, input.id, async () => {
    const existing = await load(state, input.id);
    const now = Date.now();
    const record: WebSessionRecord = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(input.parentId || existing?.parentId
        ? { parentId: input.parentId ?? existing?.parentId }
        : {}),
      pinned: existing?.pinned === true,
      archived: existing?.archived === true,
    };

    await write(state, record);

    return record;
  });
}

export async function setFlags(
  state: WebSessionStoreState,
  id: string,
  flags: { pinned?: boolean; archived?: boolean },
): Promise<WebSessionRecord | null> {
  return serial(state, id, async () => {
    const record = await load(state, id);
    if (!record) return null;

    const updated = { ...record, ...flags };
    await write(state, updated);

    return updated;
  });
}

export function write(state: WebSessionStoreState, record: WebSessionRecord): Promise<void> {
  return writeJsonAtomic(join(state.dir, `${record.id}.json`), record);
}

export async function serial<T>(
  state: WebSessionStoreState,
  id: string,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = state.writes.get(id) ?? Promise.resolve();
  const result = prior.catch(() => undefined).then(operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );

  state.writes.set(id, settled);
  try {
    return await result;
  } finally {
    if (state.writes.get(id) === settled) state.writes.delete(id);
  }
}
