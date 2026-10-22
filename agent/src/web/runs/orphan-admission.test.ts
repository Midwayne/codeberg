import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { WebSessionStore } from '../sessions/store.js';
import { RunJournal } from './journal.js';
import { SearchRuns } from './manager.js';
import type { ChatGenerator, RunInput, RunRecord } from './types.js';

it.each(['missing chat', 'browser snapshot', 'previous run'])('interrupts an unreferenced admission journal after restart: %s', async (state) => {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-orphan-admission-'));
  const sessions = new WebSessionStore(directory);
  const input: RunInput = { chatId: 'chat', requestId: 'orphan',
    messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Find auth' }] }] };
  const record: RunRecord = { ...input,
    id: createHash('sha256').update('chat:orphan').digest('hex').slice(0, 32),
    fingerprint: createHash('sha256').update(JSON.stringify([input.messages, input.trigger])).digest('hex'),
    status: 'running', createdAt: 1 };
  const journal = new RunJournal(join(directory, '.runs', 'chat', record.id));
  const generate = vi.fn<ChatGenerator>();
  const runs = new SearchRuns(sessions, generate);

  try {
    if (state !== 'missing chat') await sessions.upsert({ id: 'chat', title: 'Keep this snapshot', messages: input.messages,
      ...(state === 'previous run' ? { serverRunId: 'prior' } : {}) });
    const prior = await sessions.load('chat');
    // Durable boundary: run.json reached disk, but the session pointer did not.
    await journal.create(record);
    await runs.initialize();
    const [recovered, status] = await Promise.all([runs.admit(input), runs.find('chat', record.id)]);

    expect(recovered.record.status).toBe('interrupted');
    expect(recovered.settled).toBe(true);
    expect(recovered.events).toContainEqual(expect.objectContaining({ type: 'error' }));
    const saved = await journal.read();
    expect(saved?.record.status).toBe('interrupted');
    expect(saved?.entries.filter((entry) => entry.kind === 'chunk' && entry.chunk.type === 'error')).toHaveLength(1);
    expect(status?.record.status).toBe('interrupted');
    expect(await sessions.load('chat')).toEqual(prior);
    expect(generate).not.toHaveBeenCalled();
    await runs.stop('chat', recovered.record.id);
    const retry = await runs.admit(input);
    expect(retry.events).toEqual(recovered.events);
    expect(retry.record.status).toBe('interrupted');
    expect(generate).not.toHaveBeenCalled();
  } finally {
    await runs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
