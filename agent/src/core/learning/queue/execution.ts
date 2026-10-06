import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../fs.js';
import type { FailureCategory, KnowledgeJob } from '../types.js';
import { BACKOFF_MS, isTransientFailure, MAX_ATTEMPTS } from './policy.js';
import type { DurableJobQueueState } from './state.js';
import { find, list, path, transition } from './storage.js';

export async function claim(
  state: DurableJobQueueState,
  type?: KnowledgeJob['type'],
  enabled: (job: KnowledgeJob) => boolean = () => true,
): Promise<KnowledgeJob | undefined> {
  await mkdir(join(state.root, 'jobs', 'processing'), { recursive: true });
  for (const job of await list(state, 'pending')) {
    if ((type && job.type !== type) || !enabled(job)) continue;

    if (job.next_attempt_at && Date.parse(job.next_attempt_at) > state.now().getTime()) continue;

    const from = path(state, 'pending', job.job_id);
    const to = path(state, 'processing', job.job_id);
    try {
      await rename(from, to);
    } catch {
      continue;
    }

    const timestamp = state.now();
    const claimed: KnowledgeJob = {
      ...job,
      status: 'processing',
      updated_at: timestamp.toISOString(),
      attempt_count: job.attempt_count + 1,
      last_attempt_at: timestamp.toISOString(),
      lease_expires_at: new Date(timestamp.getTime() + state.leaseMs).toISOString(),
    };

    await writeJsonAtomic(to, claimed);

    return claimed;
  }

  return undefined;
}

export async function release(state: DurableJobQueueState, job: KnowledgeJob): Promise<void> {
  const current = await find(state, job.job_id);
  await transition(state, job.job_id, 'processing', 'pending', {
    ...(current ?? job),
    status: 'pending',
    updated_at: state.now().toISOString(),
    attempt_count: Math.max(0, job.attempt_count - 1),
    lease_expires_at: undefined,
    next_attempt_at: undefined,
    rerun_requested: undefined,
  });
}

export async function complete(state: DurableJobQueueState, job: KnowledgeJob): Promise<void> {
  const current = await find(state, job.job_id);
  if (current?.status === 'processing' && current.rerun_requested) {
    await transition(state, job.job_id, 'processing', 'pending', {
      ...current,
      status: 'pending',
      updated_at: state.now().toISOString(),
      next_attempt_at: undefined,
      lease_expires_at: undefined,
      rerun_requested: undefined,
    });
    return;
  }

  const completed: KnowledgeJob = {
    ...job,
    status: 'completed',
    updated_at: state.now().toISOString(),
    lease_expires_at: undefined,
    next_attempt_at: undefined,
    last_error: undefined,
    last_error_category: undefined,
  };

  await transition(state, job.job_id, 'processing', 'completed', completed);
}

export async function fail(
  state: DurableJobQueueState,
  job: KnowledgeJob,
  category: FailureCategory,
  error: string,
  transient = isTransientFailure(category),
): Promise<void> {
  const current = await find(state, job.job_id);
  if (current?.status === 'processing' && current.rerun_requested) {
    await transition(state, job.job_id, 'processing', 'pending', {
      ...current,
      status: 'pending',
      updated_at: state.now().toISOString(),
      next_attempt_at: undefined,
      lease_expires_at: undefined,
      rerun_requested: undefined,
    });
    return;
  }

  const permanent = !transient || job.attempt_count >= MAX_ATTEMPTS;
  const delay = BACKOFF_MS[Math.min(Math.max(job.attempt_count - 1, 0), BACKOFF_MS.length - 1)];
  const next: KnowledgeJob = {
    ...job,
    status: permanent ? 'failed' : 'pending',
    updated_at: state.now().toISOString(),
    last_error: error,
    last_error_category: category,
    lease_expires_at: undefined,
    ...(permanent
      ? { next_attempt_at: undefined }
      : { next_attempt_at: new Date(state.now().getTime() + delay).toISOString() }),
  };

  await transition(state, job.job_id, 'processing', next.status, next);
}
