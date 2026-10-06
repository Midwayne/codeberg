import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeJob } from '../types.js';
import { isProcessAlive, isTransientFailure, MAX_ATTEMPTS } from './policy.js';
import type { DurableJobQueueState } from './state.js';
import { list, path, transition } from './storage.js';

export async function recoverExpired(state: DurableJobQueueState): Promise<number> {
  let recovered = 0;
  for (const job of await list(state, 'processing')) {
    if (job.lease_expires_at && Date.parse(job.lease_expires_at) > state.now().getTime()) continue;

    const next: KnowledgeJob = {
      ...job,
      status: 'pending',
      updated_at: state.now().toISOString(),
      last_error: 'worker lease expired',
      last_error_category: 'PROCESS_CRASH',
      next_attempt_at: state.now().toISOString(),
      lease_expires_at: undefined,
    };

    await transition(state, job.job_id, 'processing', 'pending', next);
    recovered++;
  }

  return recovered;
}

export async function reconcileStates(state: DurableJobQueueState): Promise<void> {
  const statuses = ['processing', 'pending', 'failed', 'completed'] as const;
  await removeAbandonedWrites(state, statuses);

  const byId = new Map<string, KnowledgeJob[]>();
  for (const status of statuses) {
    for (const job of await list(state, status)) {
      byId.set(job.job_id, [...(byId.get(job.job_id) ?? []), job]);
    }
  }

  for (const [id, jobs] of byId) {
    if (jobs.length < 2) continue;

    const winner = jobs.sort(
      (a, b) =>
        Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
        statuses.indexOf(b.status) - statuses.indexOf(a.status),
    )[0];

    for (const job of jobs) {
      if (job === winner) continue;

      try {
        await unlink(path(state, job.status, id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Another worker may already have removed the duplicate state.
      }
    }
  }
}

export async function recoverRetryableFailures(state: DurableJobQueueState): Promise<number> {
  let recovered = 0;
  for (const job of await list(state, 'failed')) {
    if (
      !job.last_error_category ||
      !isTransientFailure(job.last_error_category) ||
      job.attempt_count >= MAX_ATTEMPTS
    ) {
      continue;
    }

    const timestamp = state.now().toISOString();
    const next: KnowledgeJob = {
      ...job,
      status: 'pending',
      updated_at: timestamp,
      next_attempt_at: timestamp,
      lease_expires_at: undefined,
    };

    await transition(state, job.job_id, 'failed', 'pending', next);
    recovered++;
  }

  return recovered;
}

async function removeAbandonedWrites(
  state: DurableJobQueueState,
  statuses: readonly KnowledgeJob['status'][],
): Promise<void> {
  for (const status of statuses) {
    const dir = join(state.root, 'jobs', status);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;

      throw error;
    }

    for (const file of files) {
      const match = /^job-[a-f\d]+\.json\.(\d+)\.[a-f\d-]+\.tmp$/.exec(file);
      if (!match || isProcessAlive(Number(match[1]))) continue;

      try {
        await unlink(join(dir, file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}
