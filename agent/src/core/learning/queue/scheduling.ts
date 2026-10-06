import type { JobStatus, KnowledgeJob } from '../types.js';
import type { DurableJobQueueState } from './state.js';
import { list } from './storage.js';

export async function nextDueAt(
  state: DurableJobQueueState,
  type?: KnowledgeJob['type'],
  enabled: (job: KnowledgeJob) => boolean = () => true,
): Promise<number | undefined> {
  const [pending, processing] = await Promise.all([
    list(state, 'pending'),
    list(state, 'processing'),
  ]);

  const times = [
    ...pending
      .filter((job) => (!type || job.type === type) && enabled(job))
      .map((job) =>
        job.next_attempt_at ? Date.parse(job.next_attempt_at) : state.now().getTime(),
      ),
    ...processing
      .filter((job) => (!type || job.type === type) && enabled(job))
      .map((job) =>
        job.lease_expires_at ? Date.parse(job.lease_expires_at) : state.now().getTime(),
      ),
  ].filter(Number.isFinite);

  return times.length ? Math.min(...times) : undefined;
}

export async function counts(state: DurableJobQueueState): Promise<Record<JobStatus, number>> {
  const rows = await Promise.all(
    (['pending', 'processing', 'completed', 'failed'] as const).map(
      async (status) => [status, (await list(state, status)).length] as const,
    ),
  );

  return Object.fromEntries(rows) as Record<JobStatus, number>;
}
