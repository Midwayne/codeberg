import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionStore, type SessionRecord } from './session-store.js';

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'a3f2',
    title: 'jwt auth bug',
    modelSpec: 'openai:gpt-4o-mini',
    createdAt: 1000,
    updatedAt: 2000,
    messages: [
      { role: 'user', content: 'why does login fail?' },
      { role: 'assistant', content: 'the token expires' },
    ],
    ...over,
  };
}

describe('SessionStore', () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'codeberg-sessions-'));
    store = new SessionStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a saved session', async () => {
    await store.save(record());
    const loaded = await store.load('a3f2');
    expect(loaded).toEqual(record());
  });

  it('returns null for a missing session', async () => {
    expect(await store.load('nope')).toBeNull();
  });

  it('lists sessions newest first with turn counts', async () => {
    await store.save(record({ id: 'old', updatedAt: 1 }));
    await store.save(record({ id: 'new', updatedAt: 9 }));

    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['new', 'old']);
    expect(list[0]).toMatchObject({
      id: 'new',
      title: 'jwt auth bug',
      turns: 1,
    });
  });

  it('returns an empty list when the dir does not exist', async () => {
    const missing = new SessionStore(join(dir, 'does-not-exist'));
    expect(await missing.list()).toEqual([]);
  });

  it('resolves by exact id and unique prefix', async () => {
    await store.save(record({ id: 'a3f2' }));
    await store.save(record({ id: 'b7c1' }));

    expect((await store.resolve('a3f2'))?.id).toBe('a3f2');
    expect((await store.resolve('a3'))?.id).toBe('a3f2');
    expect(await store.resolve('zz')).toBeNull();
  });

  it('returns null for an ambiguous prefix', async () => {
    await store.save(record({ id: 'a311' }));
    await store.save(record({ id: 'a322' }));
    expect(await store.resolve('a3')).toBeNull();
  });
});
