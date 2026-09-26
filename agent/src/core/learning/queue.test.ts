import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyFailure, DurableJobQueue } from './queue.js';
import { writeJsonAtomic } from './fs.js';

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
  it('classifies extractor sentinel errors consistently', () => {
    expect(classifyFailure(new Error('INVALID_RESPONSE: knowledge extractor returned empty'))).toBe(
      'INVALID_RESPONSE',
    );
  });

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

  it('clears stale failure details after a retry succeeds', async () => {
    const dir = await root();
    let now = new Date('2026-09-26T00:00:00.000Z');
    const queue = new DurableJobQueue(dir, () => now);
    await queue.enqueueKnowledge('interaction-1');
    await queue.fail((await queue.claim())!, 'NETWORK_ERROR', 'offline');
    const pending = (await queue.list('pending'))[0];
    now = new Date(pending.next_attempt_at!);
    await queue.complete((await queue.claim())!);

    const completed = (await queue.list('completed'))[0];
    expect(completed).not.toHaveProperty('last_error');
    expect(completed).not.toHaveProperty('last_error_category');
  });

  it('recovers a claim interrupted before its lease was written', async () => {
    const queue = new DurableJobQueue(await root());
    const job = await queue.enqueueKnowledge('crashed');
    const { mkdir, rename } = await import('node:fs/promises');
    await mkdir(join(queue.root, 'jobs', 'processing'), { recursive: true });
    await rename(join(queue.root, 'jobs', 'pending', `${job.job_id}.json`), join(queue.root, 'jobs', 'processing', `${job.job_id}.json`));
    expect(await queue.recoverExpired()).toBe(1);
    expect((await queue.claim())?.interaction_id).toBe('crashed');
  });

  it('reports an unexpired processing lease as the next recovery deadline', async () => {
    const queue = new DurableJobQueue(await root(), () => new Date('2026-09-26T00:00:00Z'), 1_000);
    await queue.enqueueKnowledge('crashed');
    await queue.claim();
    expect(await queue.nextDueAt()).toBe(Date.parse('2026-09-26T00:00:01Z'));
  });

  it('replays feedback recorded while a job was processing', async () => {
    const queue = new DurableJobQueue(await root());
    await queue.enqueueKnowledge('updated');
    const claimed = (await queue.claim())!;
    await queue.enqueueKnowledge('updated', { requeueCompleted: true });
    await queue.complete(claimed);
    expect((await queue.claim())?.interaction_id).toBe('updated');
  });

  it('prefers the latest durable status after a crash mid-transition', async () => {
    const queue = new DurableJobQueue(await root());
    const old = await queue.enqueueKnowledge('duplicate');
    await writeJsonAtomic(join(queue.root, 'jobs', 'completed', `${old.job_id}.json`), {
      ...old, status: 'completed', updated_at: new Date(Date.parse(old.updated_at) + 1_000).toISOString(),
    });
    await queue.reconcileStates();
    expect((await queue.counts())).toMatchObject({ pending: 0, completed: 1 });
    expect((await queue.get(old.job_id))?.status).toBe('completed');
  });

  it('recovers old invalid-response failures and caps repeated retries', async () => {
    const dir = await root();
    let now = new Date('2026-09-26T00:00:00.000Z');
    const queue = new DurableJobQueue(dir, () => now);
    await queue.enqueueKnowledge('interaction-1');
    const first = (await queue.claim())!;
    await queue.fail(first, 'INVALID_RESPONSE', 'bad json', false);

    expect((await queue.counts()).failed).toBe(1);
    expect(await queue.recoverRetryableFailures()).toBe(1);
    expect((await queue.counts()).pending).toBe(1);

    for (let attempt = 2; attempt <= 5; attempt++) {
      const claimed = (await queue.claim())!;
      expect(claimed.attempt_count).toBe(attempt);
      await queue.fail(claimed, 'INVALID_RESPONSE', 'bad json');
      const job = await queue.get(claimed.job_id);
      if (attempt < 5) {
        expect(job?.status).toBe('pending');
        now = new Date(job!.next_attempt_at!);
      } else {
        expect(job?.status).toBe('failed');
      }
    }

    expect(await queue.recoverRetryableFailures()).toBe(0);
  });
});
