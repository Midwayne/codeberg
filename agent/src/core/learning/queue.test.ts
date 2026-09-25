import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DurableJobQueue } from './queue.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'codeberg-jobs-'));
  roots.push(path);
  return path;
}

describe('DurableJobQueue', () => {
  it('deduplicates jobs and moves them atomically through states', async () => {
    const queue = new DurableJobQueue(await root());
    const first = await queue.enqueueKnowledge('interaction-1');
    const duplicate = await queue.enqueueKnowledge('interaction-1');
    expect(duplicate.job_id).toBe(first.job_id);
    expect((await queue.counts()).pending).toBe(1);

    const claimed = await queue.claim();
    expect(claimed?.status).toBe('processing');
    await queue.complete(claimed!);
    expect(await queue.counts()).toMatchObject({ pending: 0, processing: 0, completed: 1 });
  });

  it('recovers an abandoned processing lease and schedules transient failures', async () => {
    const dir = await root();
    let now = new Date('2026-09-26T00:00:00.000Z');
    const queue = new DurableJobQueue(dir, () => now, 1_000);
    await queue.enqueueKnowledge('interaction-1');
    const claimed = await queue.claim();
    now = new Date('2026-09-26T00:00:02.000Z');
    expect(await queue.recoverExpired()).toBe(1);
    const recovered = await queue.claim();
    expect(recovered?.attempt_count).toBe(2);
    await queue.fail(recovered!, 'NETWORK_ERROR', 'offline');
    const pending = (await queue.list('pending'))[0];
    expect(pending.last_error_category).toBe('NETWORK_ERROR');
    expect(Date.parse(pending.next_attempt_at!)).toBeGreaterThan(now.getTime());
    void claimed;
  });
});
