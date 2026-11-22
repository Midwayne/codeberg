import { join } from 'node:path';
import { writeJsonAtomic } from '../../core/fs.js';
import { load } from './reading.js';
import type { WebSessionRecord } from './records.js';
import type { WebSessionStoreState } from './state.js';

export async function save(state: WebSessionStoreState, record: WebSessionRecord): Promise<void> {
  await serial(state, record.id, () => write(state, record));
}

export type UpsertInput = Pick<WebSessionRecord, 'id' | 'messages'> & {
  title?: string;
  parentId?: string;
  serverRunId?: string;
  /** A server run just finished with this reply, so the chat becomes unread. */
  responded?: boolean;
};

export async function upsert(
  state: WebSessionStoreState,
  { responded, ...input }: UpsertInput,
): Promise<WebSessionRecord> {
  return serial(state, input.id, async () => {
    const existing = await load(state, input.id);
    if (existing?.serverRunId && !input.serverRunId) return existing;

    const now = Date.now();
    const record: WebSessionRecord = {
      ...input,
      ...readState(existing, responded ? now : undefined),
      // Without a title, keep the saved one; a new chat starts untitled.
      title: input.title ?? existing?.title ?? 'New chat',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(input.parentId || existing?.parentId
        ? { parentId: input.parentId ?? existing?.parentId }
        : {}),
      pinned: existing?.pinned === true,
      archived: existing?.archived === true,
      // Browser saves resend the derived title; a rename outranks it.
      ...(existing?.titleEdited ? { title: existing.title, titleEdited: true } : {}),
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

/** Read and reply times carry over every message save; a finished run sets a new reply time. */
function readState(existing: WebSessionRecord | null, respondedAt?: number): Pick<WebSessionRecord, 'respondedAt' | 'readAt'> {
  const replied = respondedAt ?? existing?.respondedAt;

  return {
    ...(replied === undefined ? {} : { respondedAt: replied }),
    ...(existing?.readAt === undefined ? {} : { readAt: existing.readAt }),
  };
}

/** Records that the user has seen the latest reply. Leaves `updatedAt` alone so the sidebar keeps its order. */
export async function markRead(state: WebSessionStoreState, id: string): Promise<WebSessionRecord | null> {
  return serial(state, id, async () => {
    const record = await load(state, id);
    if (!record) return null;

    const updated = { ...record, readAt: Math.max(Date.now(), record.respondedAt ?? 0) };
    await write(state, updated);

    return updated;
  });
}

/** Leaves `updatedAt` alone so renaming does not reorder the sidebar. */
export async function rename(
  state: WebSessionStoreState,
  id: string,
  title: string,
): Promise<WebSessionRecord | null> {
  return serial(state, id, async () => {
    const record = await load(state, id);
    if (!record) return null;

    const updated = { ...record, title, titleEdited: true };
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
