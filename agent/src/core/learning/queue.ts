import { mkdir, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { writeJsonAtomic } from './fs.js';
import { stableId } from './store.js';
import type { FailureCategory, JobStatus, KnowledgeJob } from './types.js';

const DEFAULT_LEASE_MS = 10 * 60_000;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000];

export class DurableJobQueue {
  constructor(
    readonly root: string,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseMs = DEFAULT_LEASE_MS,
  ) {}

  async enqueueKnowledge(
    interactionId: string,
    options: { requeueCompleted?: boolean } = {},
  ): Promise<KnowledgeJob> {
    const jobId = stableId('job', 'extract_knowledge', interactionId);
    const existing = await this.find(jobId);
    if (existing && !(options.requeueCompleted && ['completed', 'failed'].includes(existing.status))) {
      return existing;
    }
    const timestamp = this.now().toISOString();
    const job: KnowledgeJob = {
      ...(existing ?? {}),
      job_id: jobId,
      type: 'extract_knowledge',
      interaction_id: interactionId,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
      attempt_count: existing?.attempt_count ?? 0,
      status: 'pending',
      next_attempt_at: undefined,
      lease_expires_at: undefined,
    };
    await writeJsonAtomic(this.path('pending', jobId), job);
    if (existing && existing.status !== 'pending') {
      try {
        await unlink(this.path(existing.status, jobId));
      } catch {
        // Stable id keeps a duplicate state file harmless if cleanup is interrupted.
      }
    }
    return job;
  }

  async recoverExpired(): Promise<number> {
    let recovered = 0;
    for (const job of await this.list('processing')) {
      if (!job.lease_expires_at || Date.parse(job.lease_expires_at) > this.now().getTime()) continue;
      const next: KnowledgeJob = {
        ...job,
        status: 'pending',
        updated_at: this.now().toISOString(),
        last_error: 'worker lease expired',
        last_error_category: 'PROCESS_CRASH',
        next_attempt_at: this.now().toISOString(),
        lease_expires_at: undefined,
      };
      await this.transition(job.job_id, 'processing', 'pending', next);
      recovered++;
    }
    return recovered;
  }

  async claim(): Promise<KnowledgeJob | undefined> {
    await mkdir(join(this.root, 'jobs', 'processing'), { recursive: true });
    for (const job of await this.list('pending')) {
      if (job.next_attempt_at && Date.parse(job.next_attempt_at) > this.now().getTime()) continue;
      const from = this.path('pending', job.job_id);
      const to = this.path('processing', job.job_id);
      try {
        await rename(from, to);
      } catch {
        continue;
      }
      const timestamp = this.now();
      const claimed: KnowledgeJob = {
        ...job,
        status: 'processing',
        updated_at: timestamp.toISOString(),
        attempt_count: job.attempt_count + 1,
        last_attempt_at: timestamp.toISOString(),
        lease_expires_at: new Date(timestamp.getTime() + this.leaseMs).toISOString(),
      };
      await writeJsonAtomic(to, claimed);
      return claimed;
    }
    return undefined;
  }

  async complete(job: KnowledgeJob): Promise<void> {
    const completed: KnowledgeJob = {
      ...job,
      status: 'completed',
      updated_at: this.now().toISOString(),
      lease_expires_at: undefined,
      next_attempt_at: undefined,
    };
    await this.transition(job.job_id, 'processing', 'completed', completed);
  }

  async fail(
    job: KnowledgeJob,
    category: FailureCategory,
    error: string,
    transient = isTransientFailure(category),
  ): Promise<void> {
    const permanent = !transient;
    const delay = BACKOFF_MS[Math.min(Math.max(job.attempt_count - 1, 0), BACKOFF_MS.length - 1)];
    const next: KnowledgeJob = {
      ...job,
      status: permanent ? 'failed' : 'pending',
      updated_at: this.now().toISOString(),
      last_error: error,
      last_error_category: category,
      lease_expires_at: undefined,
      ...(permanent
        ? { next_attempt_at: undefined }
        : { next_attempt_at: new Date(this.now().getTime() + delay).toISOString() }),
    };
    await this.transition(job.job_id, 'processing', next.status, next);
  }

  async counts(): Promise<Record<JobStatus, number>> {
    const rows = await Promise.all(
      (['pending', 'processing', 'completed', 'failed'] as const).map(async (status) => [
        status,
        (await this.list(status)).length,
      ] as const),
    );
    return Object.fromEntries(rows) as Record<JobStatus, number>;
  }

  async get(jobId: string): Promise<KnowledgeJob | undefined> {
    return this.find(jobId);
  }

  async list(status: JobStatus): Promise<KnowledgeJob[]> {
    let files: string[];
    try {
      files = (await readdir(join(this.root, 'jobs', status))).filter((file) => file.endsWith('.json')).sort();
    } catch {
      return [];
    }
    const jobs: KnowledgeJob[] = [];
    for (const file of files) {
      try {
        jobs.push(JSON.parse(await readFile(join(this.root, 'jobs', status, file), 'utf8')) as KnowledgeJob);
      } catch {
        // A malformed job stays visible on disk for manual inspection.
      }
    }
    return jobs;
  }

  private async find(jobId: string): Promise<KnowledgeJob | undefined> {
    for (const status of ['pending', 'processing', 'completed', 'failed'] as const) {
      try {
        return JSON.parse(await readFile(this.path(status, jobId), 'utf8')) as KnowledgeJob;
      } catch {
        // Continue through all states.
      }
    }
    return undefined;
  }

  private async transition(
    jobId: string,
    from: JobStatus,
    to: JobStatus,
    job: KnowledgeJob,
  ): Promise<void> {
    const destination = this.path(to, jobId);
    await writeJsonAtomic(destination, job);
    if (this.path(from, jobId) !== destination) {
      try {
        await unlink(this.path(from, jobId));
      } catch {
        // The destination is durable; duplicate state files are reconciled by
        // stable job id and can safely be retried.
      }
    }
  }

  private path(status: JobStatus, jobId: string): string {
    return join(this.root, 'jobs', status, `${jobId}.json`);
  }
}

export function isTransientFailure(category: FailureCategory): boolean {
  return !['INVALID_RESPONSE', 'PERMANENT_ERROR'].includes(category);
}

export function classifyFailure(error: unknown): FailureCategory {
  const text = String(error).toLowerCase();
  if (/permanent_error/.test(text)) return 'PERMANENT_ERROR';
  if (/rate.?limit|\b429\b/.test(text)) return 'RATE_LIMITED';
  if (/network|fetch failed|econn|enotfound|timeout|offline/.test(text)) return 'NETWORK_ERROR';
  if (/repository|enoent/.test(text)) return 'REPOSITORY_UNAVAILABLE';
  if (/invalid response|invalid json|schema/.test(text)) return 'INVALID_RESPONSE';
  return 'MODEL_ERROR';
}
