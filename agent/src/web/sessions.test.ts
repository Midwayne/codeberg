import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';

import { WebSessionStore, isValidSessionId } from './sessions.js';

const dirs: string[] = [];
function tempStore(): WebSessionStore {
  const dir = mkdtempSync(join(tmpdir(), 'codeberg-sessions-'));
  dirs.push(dir);
  return new WebSessionStore(dir);
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function userMsg(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

describe('isValidSessionId', () => {
  it('accepts the hex/url-safe ids the client generates', () => {
    expect(isValidSessionId('a1b2c3')).toBe(true);
    expect(isValidSessionId('My-Session_1')).toBe(true);
  });
  it('rejects traversal and empty/overlong ids', () => {
    expect(isValidSessionId('../etc/passwd')).toBe(false);
    expect(isValidSessionId('a/b')).toBe(false);
    expect(isValidSessionId('a.b')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('x'.repeat(65))).toBe(false);
  });
});

describe('WebSessionStore', () => {
  it('saves and loads a record verbatim', async () => {
    const store = tempStore();
    const record = {
      id: 'abc123',
      title: 'How does auth work',
      createdAt: 1,
      updatedAt: 2,
      messages: [userMsg('m1', 'hi')],
    };
    await store.save(record);
    expect(await store.load('abc123')).toEqual(record);
  });

  it('returns null for a missing or corrupt session', async () => {
    const store = tempStore();
    expect(await store.load('nope')).toBeNull();
  });

  it('lists summaries newest-first with a user-turn count', async () => {
    const store = tempStore();
    await store.save({
      id: 'old',
      title: 'older',
      createdAt: 1,
      updatedAt: 100,
      messages: [userMsg('a', 'q1')],
    });
    await store.save({
      id: 'new',
      title: 'newer',
      createdAt: 2,
      updatedAt: 200,
      messages: [
        userMsg('a', 'q1'),
        { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'a1' }] },
        userMsg('c', 'q2'),
      ],
    });

    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['new', 'old']);
    expect(list[0]).toMatchObject({ title: 'newer', turns: 2 });
    expect(list[1]).toMatchObject({ title: 'older', turns: 1 });
  });

  it('lists nothing when the store dir does not exist yet', async () => {
    const store = new WebSessionStore(join(tmpdir(), 'codeberg-nonexistent-xyz'));
    expect(await store.list()).toEqual([]);
  });

  it('removes a session and tolerates removing a missing one', async () => {
    const store = tempStore();
    await store.save({
      id: 'gone',
      title: 'x',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });
    await store.remove('gone');
    expect(await store.load('gone')).toBeNull();
    await expect(store.remove('gone')).resolves.toBeUndefined();
  });
});
