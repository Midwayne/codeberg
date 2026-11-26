import type { UIMessage } from 'ai';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { chatScope } from '../../core/chat-scope.js';
import { worklistTools } from '../../core/worklist/tools.js';
import { WebSessionStore, isValidSessionId } from './store.js';

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
  it('round-trips optional parentId on a branched session', async () => {
    const store = tempStore();
    const record = {
      id: 'child',
      title: 'How does auth work (branch)',
      createdAt: 1,
      updatedAt: 2,
      messages: [userMsg('m1', 'hi')],
      parentId: 'abc123',
    };

    await store.save(record);
    expect(await store.load('child')).toEqual(record);

    const list = await store.list();
    expect(list[0]).toMatchObject({ id: 'child', parentId: 'abc123' });
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

  it('re-reads a listed chat after its file changes, including writes by another store', async () => {
    const store = tempStore();
    const other = new WebSessionStore(store.dir);
    await store.upsert({ id: 'a', title: 'First', messages: [userMsg('1', 'hi')] });
    await store.upsert({ id: 'b', title: 'Second', messages: [userMsg('2', 'yo')] });
    expect((await store.list()).map((row) => row.title).sort()).toEqual(['First', 'Second']);

    await other.rename('a', 'Renamed');
    await other.remove('b');

    expect((await store.list()).map((row) => row.title)).toEqual(['Renamed']);
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

  it('removes the working list saved beside a deleted chat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeberg-sessions-'));
    dirs.push(dir);
    const store = new WebSessionStore(dir);
    await store.save({ id: 'noted', title: 'x', createdAt: 1, updatedAt: 1, messages: [] });

    const add = worklistTools().worklist_add!.execute!;
    await chatScope.run(join(dir, 'noted'), () =>
      add({ items: [{ text: 'a fact' }] } as never, { toolCallId: 'call_0', messages: [], context: undefined }));
    expect(existsSync(join(dir, '.worklists', 'noted.json'))).toBe(true);

    await store.remove('noted');

    expect(existsSync(join(dir, '.worklists', 'noted.json'))).toBe(false);
  });

  it('keeps pin/archive metadata when a new turn saves concurrently with a toggle', async () => {
    const store = tempStore();
    await store.upsert({ id: 'chat', title: 'Example', messages: [userMsg('a', 'first')] });
    await Promise.all([
      store.setFlags('chat', { pinned: true, archived: true }),
      store.upsert({
        id: 'chat',
        title: 'Example',
        messages: [userMsg('a', 'first'), userMsg('b', 'second')],
      }),
    ]);
    const record = await store.load('chat');
    expect(record).toMatchObject({
      pinned: true,
      archived: true,
      messages: [userMsg('a', 'first'), userMsg('b', 'second')],
    });
  });

  it('keeps a renamed title when later saves send the derived one', async () => {
    const store = tempStore();
    await store.upsert({ id: 'chat', title: 'first', messages: [userMsg('a', 'first')] });
    const before = await store.load('chat');

    const renamed = await store.rename('chat', 'Auth investigation');

    expect(renamed).toMatchObject({ title: 'Auth investigation', updatedAt: before!.updatedAt });

    await store.upsert({
      id: 'chat',
      title: 'first',
      messages: [userMsg('a', 'first'), userMsg('b', 'second')],
    });

    expect(await store.load('chat')).toMatchObject({
      title: 'Auth investigation',
      messages: [userMsg('a', 'first'), userMsg('b', 'second')],
    });
    expect((await store.list())[0]).toMatchObject({ title: 'Auth investigation' });
  });

  it('marks a chat unread when a server run finishes until it is read', async () => {
    const store = tempStore();
    await store.upsert({ id: 'chat', title: 'Example', messages: [userMsg('a', 'first')] });

    expect((await store.list())[0]!.unread).toBeUndefined();

    await store.upsert({ id: 'chat', messages: [userMsg('a', 'first')], serverRunId: 'run', responded: true });

    expect((await store.list())[0]).toMatchObject({ id: 'chat', unread: true });

    const before = await store.load('chat');
    expect(await store.markRead('chat')).not.toBeNull();

    expect((await store.list())[0]!.unread).toBeUndefined();
    expect((await store.load('chat'))!.updatedAt).toBe(before!.updatedAt);
  });

  it('keeps read state across later saves, pins, and renames', async () => {
    const store = tempStore();
    await store.upsert({ id: 'chat', messages: [userMsg('a', 'first')], serverRunId: 'run', responded: true });

    await store.setFlags('chat', { pinned: true });
    await store.rename('chat', 'Renamed');
    await store.upsert({ id: 'chat', messages: [userMsg('a', 'first')], serverRunId: 'run' });

    expect((await store.list())[0]).toMatchObject({ unread: true, pinned: true });

    await store.markRead('chat');
    await store.upsert({ id: 'chat', messages: [userMsg('a', 'first'), userMsg('b', 'next')], serverRunId: 'run2' });

    expect((await store.list())[0]!.unread).toBeUndefined();
  });

  it('does not create a chat when marking a missing one read', async () => {
    const store = tempStore();

    expect(await store.markRead('missing')).toBeNull();
    expect(await store.load('missing')).toBeNull();
  });

  it('does not create a chat when renaming a missing one', async () => {
    const store = tempStore();

    expect(await store.rename('missing', 'Anything')).toBeNull();
    expect(await store.load('missing')).toBeNull();
  });
});
