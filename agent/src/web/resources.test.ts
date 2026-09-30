import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LearningService } from '../core/learning/service.js';
import { serializeArtifact } from '../core/learning/store.js';
import type { KnowledgeArtifact } from '../core/learning/types.js';
import { WebSessionStore } from './sessions/store.js';
import { ResourceSettings, ResourceSettingsError } from './resources.js';

const dirs: string[] = [];
const services: LearningService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) { service.stop(); await service.waitForCurrent(); }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-resources-'));
  dirs.push(home);
  const sessions = new WebSessionStore(join(home, 'web-sessions'));
  const learning = new LearningService({ root: join(home, 'learning'), repositories: async () => [] });
  services.push(learning);
  const resources = new ResourceSettings({ home, sessions, learning, env: {} });
  return { home, sessions, learning, resources };
}

describe('resource settings', () => {
  it('previews and deletes only the selected old chats, retaining pinned and recently updated chats', async () => {
    const { sessions, resources } = await fixture();
    for (const [id, updatedAt, pinned] of [['old', 1, false], ['pinned', 1, true], ['new', Date.now(), false]] as const) {
      await sessions.save({ id, title: id, messages: [], createdAt: 1, updatedAt, pinned });
    }
    const preview = await resources.preview(30);
    expect(preview.categories.find((row) => row.category === 'chats')).toMatchObject({ count: 1 });
    const result = await resources.cleanup({ categories: ['chats'], olderThanDays: 30 });
    expect(result.deleted).toBe(1);
    expect(result.bytesFreed).toBeGreaterThan(0);
    expect((await sessions.list()).map((row) => row.id).sort()).toEqual(['new', 'pinned']);
  });

  it('keeps recently reviewed dataset families, and leaves knowledge and source events when deleting training', async () => {
    const { home, resources } = await fixture();
    const root = join(home, 'learning');
    for (const bucket of ['candidates', 'training', 'eval', 'dismissed']) await mkdir(join(root, 'datasets', bucket), { recursive: true });
    await writeFile(join(root, 'datasets/candidates/old.json'), JSON.stringify({ id: 'old', extracted_at: '2000-01-01' }));
    await writeFile(join(root, 'datasets/training/old.json'), JSON.stringify({ id: 'old', extracted_at: '2000-01-01' }));
    await writeFile(join(root, 'datasets/candidates/recent.json'), JSON.stringify({ id: 'recent', extracted_at: '2000-01-01' }));
    await writeFile(join(root, 'datasets/eval/recent.json'), JSON.stringify({ id: 'recent', extracted_at: '2000-01-01', review: { timestamp: new Date().toISOString() } }));
    await mkdir(join(root, 'knowledge/concepts'), { recursive: true });
    await writeFile(join(root, 'knowledge/concepts/fact.md'), 'keep');
    await mkdir(join(root, 'events'), { recursive: true });
    await writeFile(join(root, 'events/2000-01-01.jsonl'), 'keep');
    const result = await resources.cleanup({ categories: ['training'], olderThanDays: 30 });
    expect(result.deleted).toBe(2);
    expect(await readFile(join(root, 'datasets/eval/recent.json'), 'utf8')).toContain('recent');
    expect(await readFile(join(root, 'datasets/candidates/recent.json'), 'utf8')).toContain('recent');
    expect(await readFile(join(root, 'knowledge/concepts/fact.md'), 'utf8')).toBe('keep');
    expect(await readFile(join(root, 'events/2000-01-01.jsonl'), 'utf8')).toBe('keep');
  });

  it('deletes knowledge independently and never follows storage symlinks', async () => {
    const { home, resources } = await fixture();
    const dir = join(home, 'learning/knowledge/concepts');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'old.md'), serializeArtifact({ id: 'old', updated_at: '2000-01-01', body: 'old' } as KnowledgeArtifact));
    const outside = join(home, 'outside.md');
    await writeFile(outside, 'outside');
    await symlink(outside, join(dir, 'link.md'));
    expect((await resources.cleanup({ categories: ['knowledge'], olderThanDays: 30 })).deleted).toBe(1);
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });

  it('rejects invalid cleanup requests and busy learning without deleting data', async () => {
    const { learning, resources } = await fixture();
    for (const input of [{ categories: [], olderThanDays: 30 }, { categories: ['../'], olderThanDays: 0 }, { categories: ['chats'], olderThanDays: -1 }, { categories: ['chats'], olderThanDays: 'all' }]) {
      await expect(resources.cleanup(input)).rejects.toBeInstanceOf(ResourceSettingsError);
    }
    const release = learning.withMaintenance(async () => {
      await expect(resources.cleanup({ categories: ['knowledge'], olderThanDays: 0 })).rejects.toMatchObject({ status: 409 });
    });
    await release;
  });

  it('delegates cached metrics reads and invalidates storage asynchronously after cleanup', async () => {
    const { home, sessions, learning } = await fixture();
    const monitor = { start: vi.fn(), stop: vi.fn(), invalidateDisk: vi.fn(), read: vi.fn(() => '{"current":null,"history":[]}') };
    const resources = new ResourceSettings({ home, sessions, learning, monitor });
    expect(await resources.usage(123)).toContain('"current":null');
    expect(monitor.read).toHaveBeenCalledWith(123);
    await sessions.save({ id: 'old', title: 'old', messages: [], createdAt: 1, updatedAt: 1 });
    await resources.cleanup({ categories: ['chats'], olderThanDays: 0 });
    expect(monitor.invalidateDisk).toHaveBeenCalledOnce();
  });

  it('does not recreate deleted training on restart from unchanged source records', async () => {
    const { home, learning, resources } = await fixture();
    await learning.store.recordSession('conversation', [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Where is the handler?' }] },
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'The handler is in server.ts.' }] },
    ]);
    const attempt = (await learning.store.attempts())[0]!;
    await learning.store.recordFeedback({ attemptId: attempt.attempt_id, rating: 3, label: 'solved' });
    await learning.initialize();
    await learning.waitForCurrent();
    expect((await learning.datasets.list('candidates')).length).toBeGreaterThan(0);
    expect((await resources.cleanup({ categories: ['training'], olderThanDays: 0 })).deleted).toBeGreaterThan(0);
    learning.stop();
    await learning.waitForCurrent();
    const restarted = new LearningService({ root: join(home, 'learning'), repositories: async () => [] });
    services.push(restarted);
    await restarted.initialize();
    await restarted.waitForCurrent();
    expect(await restarted.datasets.list('candidates')).toEqual([]);
    expect(await restarted.store.attempts()).toHaveLength(1);
  });

  it('refuses derived cleanup when runnable work is queued, including deferred retries', async () => {
    const { learning, resources } = await fixture();
    await learning.queue.enqueueDataset('interaction');
    await expect(resources.cleanup({ categories: ['training'], olderThanDays: 0 })).rejects.toMatchObject({ status: 409 });
  });

  it('does not traverse a symlinked knowledge category', async () => {
    const { home, resources } = await fixture();
    await mkdir(join(home, 'learning/knowledge'), { recursive: true });
    const outside = join(home, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'fact.md'), serializeArtifact({ id: 'fact', updated_at: '2000-01-01', body: 'keep' } as KnowledgeArtifact));
    await symlink(outside, join(home, 'learning/knowledge/concepts'));
    expect((await resources.cleanup({ categories: ['knowledge'], olderThanDays: 0 })).deleted).toBe(0);
    expect(await readFile(join(outside, 'fact.md'), 'utf8')).toContain('keep');
  });

  it('reports partial failures alongside deleted chat ids so the browser can invalidate its cache', async () => {
    const { sessions, resources } = await fixture();
    for (const id of ['a', 'b']) await sessions.save({ id, title: id, messages: [], createdAt: 1, updatedAt: 1 });
    const remove = sessions.removeOlder.bind(sessions);
    vi.spyOn(sessions, 'removeOlder').mockImplementation(async (id, cutoff) => {
      if (id === 'b') throw new Error('disk unavailable');
      return remove(id, cutoff);
    });
    const result = await resources.cleanup({ categories: ['chats'], olderThanDays: 0 });
    expect(result).toMatchObject({ deleted: 1, failed: 1, deletedChatIds: ['a'] });
    expect((await sessions.list()).map((row) => row.id)).toEqual(['b']);
  });

});
