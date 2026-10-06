import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJsonAtomic } from '../fs.js';
import type { JobStatus, KnowledgeJob } from '../types.js';
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
  let files: string[];
  try {
    files = (await readdir(join(state.root, 'jobs', status)))
      .filter((file) => file.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }

  const jobs: KnowledgeJob[] = [];
  for (const file of files) {
    try {
      jobs.push(
        JSON.parse(await readFile(join(state.root, 'jobs', status, file), 'utf8')) as KnowledgeJob,
      );
    } catch {
      // A malformed job stays visible on disk for manual inspection.
    }
  }

  return jobs;
}

export async function find(
  state: DurableJobQueueState,
  jobId: string,
): Promise<KnowledgeJob | undefined> {
  for (const status of ['pending', 'processing', 'completed', 'failed'] as const) {
    try {
      return JSON.parse(await readFile(path(state, status, jobId), 'utf8')) as KnowledgeJob;
    } catch {
      // Continue through all states.
    }
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
