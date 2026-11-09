import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readOptionalRecord, readRecordFiles, writeJsonAtomic } from '../fs.js';
import { JOB_STATUSES, type JobStatus, type KnowledgeJob } from '../types.js';
import type { DurableJobQueueState } from './state.js';

export async function get(
  state: DurableJobQueueState,
  jobId: string,
): Promise<KnowledgeJob | undefined> {
  return find(state, jobId);
}

export async function list(
  state: DurableJobQueueState,
  status: JobStatus,
): Promise<KnowledgeJob[]> {
  return readRecordFiles(
    join(state.root, 'jobs', status),
    (file) => file.endsWith('.json'),
    (raw) => JSON.parse(raw) as KnowledgeJob,
    true,
  );
}

export async function find(
  state: DurableJobQueueState,
  jobId: string,
): Promise<KnowledgeJob | undefined> {
  for (const status of JOB_STATUSES) {
    const job = await readOptionalRecord(
      path(state, status, jobId),
      (raw) => JSON.parse(raw) as KnowledgeJob,
    );
    if (job !== undefined) return job;
  }

  return undefined;
}

export async function transition(
  state: DurableJobQueueState,
  jobId: string,
  from: JobStatus,
  to: JobStatus,
  job: KnowledgeJob,
): Promise<void> {
  const destination = path(state, to, jobId);
  await writeJsonAtomic(destination, job);
  if (path(state, from, jobId) !== destination) {
    try {
      await unlink(path(state, from, jobId));
    } catch {
      // The destination is durable; duplicate state files are reconciled by
      // stable job id and can safely be retried.
    }
  }
}

export function path(state: DurableJobQueueState, status: JobStatus, jobId: string): string {
  return join(state.root, 'jobs', status, `${jobId}.json`);
}
